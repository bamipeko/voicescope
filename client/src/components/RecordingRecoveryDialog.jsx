import { useEffect, useState } from 'react'
import { listOrphanedSessions, reconstructSession, discardSession } from '../lib/recording-backup'
import { uploadRecording } from '../lib/api'
import { useAppStore } from '../stores/appStore'

/**
 * Shown at app startup when a previous recording was interrupted
 * (app force-killed, crash, power loss). Offers to recover the audio
 * from IndexedDB chunks and upload it as a new recording.
 */
export default function RecordingRecoveryDialog() {
  const [sessions, setSessions] = useState([]) // orphaned sessions
  const [processing, setProcessing] = useState(null) // sessionId currently being handled
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => {
    // Delay a moment so the main UI has settled
    const timer = setTimeout(async () => {
      try {
        const found = await listOrphanedSessions()
        if (found.length > 0) {
          console.log(`[Recovery] Found ${found.length} orphaned recording session(s)`)
          setSessions(found)
        }
      } catch (err) {
        console.warn('[Recovery] Failed to check for orphaned sessions:', err.message)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [])

  if (sessions.length === 0) return null

  const handleRecover = async (sessionId) => {
    setProcessing(sessionId)
    try {
      const result = await reconstructSession(sessionId)
      if (!result || result.blob.size === 0) {
        addToast('復元対象のデータが見つかりませんでした', 'error')
        await discardSession(sessionId)
        setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        return
      }

      const filename = `recovered_${new Date(result.startedAt).toISOString().replace(/[:.]/g, '-')}.webm`
      const file = new File([result.blob], filename, { type: result.mimeType })

      // Upload as a regular recording with a recognizable title
      await uploadRecording(file, `[復元] ${new Date(result.startedAt).toLocaleString('ja-JP')}`, [], {
        auto_summarize: false, // let user decide whether to summarize
      })

      await discardSession(sessionId)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      addToast(`録音を復元しました（${Math.round(result.blob.size / 1024)}KB）`, 'success')
    } catch (err) {
      console.error('[Recovery] Failed:', err)
      addToast(`復元に失敗しました: ${err.message}`, 'error')
    } finally {
      setProcessing(null)
    }
  }

  const handleDiscard = async (sessionId) => {
    if (!window.confirm('この未保存の録音データを削除しますか？元には戻せません。')) return
    try {
      await discardSession(sessionId)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      addToast('破棄しました', 'info')
    } catch (err) {
      addToast(`削除に失敗しました: ${err.message}`, 'error')
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-card border border-theme-light rounded-xl max-w-lg w-full p-6 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <span className="text-2xl">⚠️</span>
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">未保存の録音が見つかりました</h3>
            <p className="text-xs text-gray-400">
              前回の録音が正常に終了しませんでした（強制終了・クラッシュ・電源断など）。
              録音データはバックアップから復元できます。
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-4 max-h-80 overflow-y-auto">
          {sessions.map((s) => {
            const isProcessing = processing === s.id
            const durationMin = Math.floor(s.chunkCount / 60)
            const durationSec = s.chunkCount % 60
            return (
              <div key={s.id} className="bg-input/60 border border-theme-light rounded-lg p-3">
                <div className="text-sm text-white mb-1">
                  {new Date(s.startedAt).toLocaleString('ja-JP')}
                </div>
                <div className="text-xs text-gray-400 mb-3">
                  約 {durationMin > 0 ? `${durationMin}分${durationSec}秒` : `${durationSec}秒`}
                  {' · '}
                  {s.chunkCount} チャンク
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRecover(s.id)}
                    disabled={isProcessing}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white text-xs px-3 py-1.5 rounded"
                  >
                    {isProcessing ? '復元中...' : '復元してアップロード'}
                  </button>
                  <button
                    onClick={() => handleDiscard(s.id)}
                    disabled={isProcessing}
                    className="text-xs text-gray-400 hover:text-red-400 px-3 py-1.5"
                  >
                    破棄
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-[10px] text-gray-500 text-center">
          💡 このダイアログは今後、録音中に強制終了されたとき自動で表示されます
        </p>
      </div>
    </div>
  )
}
