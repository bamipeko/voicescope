import { useState, useEffect, useCallback, useRef } from 'react'
import { useRecorder } from '../hooks/useRecorder'
import { uploadRecording } from '../lib/api'
import { useAppStore } from '../stores/appStore'
import { useNavigate } from 'react-router-dom'

function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function WaveformBar({ value }) {
  const height = Math.max(4, (value / 255) * 32)
  return (
    <div
      className="w-1 bg-red-400 rounded-full transition-all duration-75"
      style={{ height: `${height}px` }}
    />
  )
}

export default function RecordButton() {
  const { isRecording, duration, analyserData, autoStopReason, startRecording, stopRecording } = useRecorder()
  const [uploading, setUploading] = useState(false)
  const [meetingApp, setMeetingApp] = useState(null) // detected meeting app name
  const [meetingPrompt, setMeetingPrompt] = useState(null) // show auto-record prompt
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showMemoInput, setShowMemoInput] = useState(false)
  const [memoText, setMemoText] = useState('')
  const [micDevices, setMicDevices] = useState([])
  const memoInputRef = useRef(null)
  const addToast = useAppStore((s) => s.addToast)
  const recordingMode = useAppStore((s) => s.recordingMode)
  const setRecordingMode = useAppStore((s) => s.setRecordingMode)
  const selectedMicId = useAppStore((s) => s.selectedMicId)
  const setSelectedMicId = useAppStore((s) => s.setSelectedMicId)
  const highlights = useAppStore((s) => s.highlights)
  const addHighlight = useAppStore((s) => s.addHighlight)
  const clearHighlights = useAppStore((s) => s.clearHighlights)
  const navigate = useNavigate()

  // Enumerate microphone devices when mode menu opens
  useEffect(() => {
    if (!showModeMenu) return
    async function loadMics() {
      try {
        // Request permission first (needed to get device labels)
        await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()))
        const devices = await navigator.mediaDevices.enumerateDevices()
        const mics = devices.filter(d => d.kind === 'audioinput')
        setMicDevices(mics)
      } catch {
        setMicDevices([])
      }
    }
    loadMics()
  }, [showModeMenu])

  // Auto-stop handler: when autoStopReason fires, save recording automatically
  const autoStopInProgressRef = useRef(false)
  useEffect(() => {
    if (!autoStopReason || autoStopInProgressRef.current) return
    autoStopInProgressRef.current = true
    const reason = autoStopReason === 'silence' ? '無音が5分続いたため' : '最大録音時間(4時間)に達したため'
    ;(async () => {
      try {
        const file = await stopRecording()
        if (!file) return
        setUploading(true)
        const recording = await uploadRecording(file, null, highlights)
        clearHighlights()
        addToast(`${reason}、録音を自動停止しました`, 'info')
        navigate(`/recordings/${recording.id}`)
      } catch (err) {
        addToast(err.message, 'error')
      } finally {
        setUploading(false)
        autoStopInProgressRef.current = false
      }
    })()
  }, [autoStopReason, stopRecording, highlights, clearHighlights, addToast, navigate])

  const handleToggle = useCallback(() => {
    handleClick()
  }, [isRecording])

  // Listen for Electron global shortcut
  useEffect(() => {
    if (!window.electronAPI?.onToggleRecording) return
    const cleanup = window.electronAPI.onToggleRecording(() => {
      handleToggle()
    })
    return cleanup
  }, [handleToggle])

  // Listen for highlight shortcut (Ctrl+Shift+Q)
  useEffect(() => {
    // Electron global shortcut
    if (window.electronAPI?.onMarkHighlight) {
      const cleanup = window.electronAPI.onMarkHighlight(() => {
        if (isRecording) {
          addHighlight(duration)
          addToast(`ハイライト追加 (${formatTime(duration)})`, 'success')
        }
      })
      return cleanup
    }
    // Browser fallback: keyboard event
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'Q') {
        e.preventDefault()
        if (isRecording) {
          addHighlight(duration)
          addToast(`ハイライト追加 (${formatTime(duration)})`, 'success')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isRecording, duration, addHighlight, addToast])

  // Warn user when they try to close the browser/tab during recording.
  // Electron respects returnValue on beforeunload and shows a native prompt.
  useEffect(() => {
    const handler = (e) => {
      if (isRecording || uploading) {
        const msg = '録音中です。ページを閉じると録音が失われる可能性があります（バックアップから復元可能ですが確実ではありません）。本当に閉じますか？'
        e.preventDefault()
        e.returnValue = msg
        return msg
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isRecording, uploading])

  // Close mode menu when clicking outside
  useEffect(() => {
    if (!showModeMenu) return
    const handleClickOutside = () => setShowModeMenu(false)
    setTimeout(() => document.addEventListener('click', handleClickOutside), 0)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showModeMenu])

  // Notify Electron of recording state (for tray icon)
  useEffect(() => {
    if (!window.electronAPI) return
    if (isRecording) {
      window.electronAPI.notifyRecordingStart()
    } else {
      window.electronAPI.notifyRecordingStop()
    }
  }, [isRecording])

  // Listen for meeting app detection (Electron only)
  useEffect(() => {
    if (!window.electronAPI?.onMeetingDetected) return
    const cleanupDetected = window.electronAPI.onMeetingDetected((appName) => {
      if (!isRecording && !uploading) {
        setMeetingApp(appName)
        setMeetingPrompt(appName)
        // Auto-dismiss after 15 seconds
        setTimeout(() => setMeetingPrompt((cur) => cur === appName ? null : cur), 15000)
      }
    })
    const cleanupClosed = window.electronAPI.onMeetingClosed((appName) => {
      setMeetingApp((cur) => cur === appName ? null : cur)
      setMeetingPrompt((cur) => cur === appName ? null : cur)
      // If recording and this meeting closed, show toast
      if (isRecording) {
        addToast(`${appName} が終了しました。録音を停止するには停止ボタンを押してください。`, 'info')
      }
    })
    return () => { cleanupDetected(); cleanupClosed() }
  }, [isRecording, uploading, addToast])

  const recordingOptions = {
    onNotify: (msg) => addToast(msg, 'info'),
    onAutoStop: () => {}, // handled by autoStopReason effect above
    deviceId: selectedMicId || undefined,
  }

  const handleMeetingRecordStart = async () => {
    setMeetingPrompt(null)
    try {
      await startRecording({ captureSystem: recordingMode === 'mix', ...recordingOptions })
      addToast(`${meetingApp} を検知 — 録音を開始しました`, 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleClick = async () => {
    if (isRecording) {
      // Stop recording
      try {
        const file = await stopRecording()
        if (!file) return

        setUploading(true)
        const recording = await uploadRecording(file, null, highlights)
        clearHighlights()
        addToast('録音をアップロードしました。処理を開始します。', 'success')
        navigate(`/recordings/${recording.id}`)
      } catch (err) {
        addToast(err.message, 'error')
      } finally {
        setUploading(false)
      }
    } else {
      // Start recording
      try {
        clearHighlights()
        await startRecording({ captureSystem: recordingMode === 'mix', ...recordingOptions })
      } catch (err) {
        addToast(err.message, 'error')
      }
    }
  }

  // Sample 8 bars from analyser data
  const bars = []
  if (analyserData && isRecording) {
    const step = Math.floor(analyserData.length / 8)
    for (let i = 0; i < 8; i++) {
      bars.push(analyserData[i * step] || 0)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2">
      {/* Meeting detection prompt */}
      {meetingPrompt && !isRecording && (
        <div className="bg-card border border-blue-600 rounded-lg px-4 py-3 shadow-lg flex flex-col gap-2 max-w-xs">
          <div className="text-sm text-white">
            🎤 <span className="font-semibold text-blue-400">{meetingPrompt}</span> を検知しました
          </div>
          <div className="text-xs text-gray-400">録音を開始しますか？</div>
          <div className="flex gap-2">
            <button
              onClick={handleMeetingRecordStart}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs py-1.5 rounded font-medium"
            >
              録音開始
            </button>
            <button
              onClick={() => setMeetingPrompt(null)}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs py-1.5 rounded"
            >
              スキップ
            </button>
          </div>
        </div>
      )}

      {/* Recording info — positioned above the button row so it doesn't shift buttons */}
      {isRecording && (
        <div className="relative">
          {/* Memo input — absolute above recording bar */}
          {showMemoInput && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const text = memoText.trim()
                if (text) {
                  addHighlight(duration, text)
                  addToast(`メモ追加 (${formatTime(duration)})`, 'success')
                  setMemoText('')
                }
                setShowMemoInput(false)
              }}
              className="absolute bottom-full right-0 mb-2 bg-card border border-theme-light rounded-lg px-3 py-2 shadow-lg flex gap-2 w-72"
            >
              <input
                ref={memoInputRef}
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                placeholder="メモを入力..."
                className="flex-1 bg-input border border-theme rounded px-2 py-1 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowMemoInput(false); setMemoText('') }
                }}
              />
              <button type="submit" className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded">
                追加
              </button>
            </form>
          )}

          <div className="bg-card border border-theme-light rounded-full px-4 py-2 flex items-center gap-3 shadow-lg">
            <div className="flex items-center gap-0.5 h-8">
              {bars.map((v, i) => <WaveformBar key={i} value={v} />)}
            </div>
            <span className="text-white text-sm font-mono">{formatTime(duration)}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                addHighlight(duration)
                addToast(`ハイライト追加 (${formatTime(duration)})`, 'success')
              }}
              className="text-yellow-400 hover:text-yellow-300 text-base transition-colors"
              title="ハイライト (Ctrl+Shift+Q)"
            >
              ★
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMemoInput(!showMemoInput)
                setTimeout(() => memoInputRef.current?.focus(), 50)
              }}
              className="text-blue-400 hover:text-blue-300 text-xs transition-colors"
              title="テキストメモ追加"
            >
              📝
            </button>
            {highlights.length > 0 && (
              <span className="text-yellow-400 text-xs font-medium">{highlights.length}</span>
            )}
          </div>
        </div>
      )}

      {uploading && (
        <div className="bg-card border border-theme-light rounded-full px-4 py-2 shadow-lg">
          <span className="text-gray-400 text-sm">アップロード中...</span>
        </div>
      )}

      {/* Recording mode selector — always visible (not only when stopped) */}
      {!uploading && (
        <div className="relative">
          <button
            onClick={() => setShowModeMenu(!showModeMenu)}
            className={`w-9 h-9 rounded-full bg-card/60 border border-theme-light/50 flex items-center justify-center shadow-md text-gray-400 hover:text-white hover:bg-card transition-all ${
              isRecording ? 'opacity-80' : 'opacity-60 hover:opacity-100'
            }`}
            title="録音モード切替"
          >
            {recordingMode === 'mix' ? (
              <span className="text-base">🔊</span>
            ) : (
              <span className="text-base">🎤</span>
            )}
          </button>
          {showModeMenu && (
            <div className="absolute bottom-12 right-0 bg-card border border-theme-light rounded-lg shadow-xl w-64 overflow-hidden">
              {isRecording && (
                <div className="px-3 pt-2 pb-1 text-[10px] text-yellow-500">次回の録音から反映されます</div>
              )}
              {/* Recording mode selection */}
              <div className="px-3 pt-2 pb-1 text-[10px] text-gray-400 font-medium uppercase tracking-wider">録音モード</div>
              <button
                onClick={() => { setRecordingMode('mix'); setShowModeMenu(false) }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                  recordingMode === 'mix' ? 'bg-blue-600/20 text-blue-400' : 'text-gray-300 hover:bg-input'
                }`}
              >
                <span>🔊</span>
                <div>
                  <div className="font-medium">マイク + デスクトップ音声</div>
                  <div className="text-gray-400 mt-0.5">会議・通話の録音向け</div>
                </div>
              </button>
              <button
                onClick={() => { setRecordingMode('mic'); setShowModeMenu(false) }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                  recordingMode === 'mic' ? 'bg-blue-600/20 text-blue-400' : 'text-gray-300 hover:bg-input'
                }`}
              >
                <span>🎤</span>
                <div>
                  <div className="font-medium">マイクのみ</div>
                  <div className="text-gray-400 mt-0.5">メモ録音・動画視聴中の独り言</div>
                </div>
              </button>

              {/* Microphone device selection */}
              {micDevices.length > 0 && (
                <>
                  <div className="border-t border-theme-light mx-2 my-1" />
                  <div className="px-3 pt-1 pb-1 text-[10px] text-gray-400 font-medium uppercase tracking-wider">マイク選択</div>
                  <div className="max-h-36 overflow-y-auto">
                    <button
                      onClick={() => { setSelectedMicId(''); setShowModeMenu(false) }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors truncate ${
                        !selectedMicId ? 'bg-blue-600/20 text-blue-400' : 'text-gray-300 hover:bg-input'
                      }`}
                    >
                      システムデフォルト
                    </button>
                    {micDevices.map((dev) => (
                      <button
                        key={dev.deviceId}
                        onClick={() => { setSelectedMicId(dev.deviceId); setShowModeMenu(false) }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors truncate ${
                          selectedMicId === dev.deviceId ? 'bg-blue-600/20 text-blue-400' : 'text-gray-300 hover:bg-input'
                        }`}
                        title={dev.label || `マイク ${dev.deviceId.slice(0, 8)}`}
                      >
                        {dev.label || `マイク ${dev.deviceId.slice(0, 8)}`}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Record / Stop button */}
      <button
        onClick={handleClick}
        disabled={uploading}
        className={`w-11 h-11 rounded-full flex items-center justify-center shadow-md transition-all ${
          isRecording
            ? 'bg-red-600 hover:bg-red-700 animate-pulse opacity-90'
            : 'bg-red-500/70 hover:bg-red-500 opacity-60 hover:opacity-100'
        } ${uploading ? 'opacity-30 cursor-not-allowed' : ''}`}
        title={isRecording ? '録音停止' : `録音開始（${recordingMode === 'mix' ? 'マイク+デスクトップ' : 'マイクのみ'}）`}
      >
        {isRecording ? (
          <div className="w-4 h-4 bg-white rounded-sm" />
        ) : (
          <div className="w-4 h-4 bg-white rounded-full" />
        )}
      </button>
    </div>
  )
}
