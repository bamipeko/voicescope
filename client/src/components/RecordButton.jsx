import { useState } from 'react'
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
  const { isRecording, duration, analyserData, startRecording, stopRecording } = useRecorder()
  const [uploading, setUploading] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const navigate = useNavigate()

  const handleClick = async () => {
    if (isRecording) {
      // Stop recording
      try {
        const file = await stopRecording()
        if (!file) return

        setUploading(true)
        const recording = await uploadRecording(file)
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
        await startRecording()
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
    <div className="fixed bottom-6 right-6 z-40 flex items-center gap-3">
      {/* Recording info */}
      {isRecording && (
        <div className="bg-gray-900 border border-gray-700 rounded-full px-4 py-2 flex items-center gap-3 shadow-lg">
          <div className="flex items-center gap-0.5 h-8">
            {bars.map((v, i) => <WaveformBar key={i} value={v} />)}
          </div>
          <span className="text-white text-sm font-mono">{formatTime(duration)}</span>
        </div>
      )}

      {uploading && (
        <div className="bg-gray-900 border border-gray-700 rounded-full px-4 py-2 shadow-lg">
          <span className="text-gray-400 text-sm">アップロード中...</span>
        </div>
      )}

      {/* Record / Stop button */}
      <button
        onClick={handleClick}
        disabled={uploading}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${
          isRecording
            ? 'bg-red-600 hover:bg-red-700 animate-pulse'
            : 'bg-red-500 hover:bg-red-600'
        } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={isRecording ? '録音停止' : '録音開始'}
      >
        {isRecording ? (
          <div className="w-5 h-5 bg-white rounded-sm" />
        ) : (
          <div className="w-5 h-5 bg-white rounded-full" />
        )}
      </button>
    </div>
  )
}
