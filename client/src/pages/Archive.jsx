import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getRecordings, restoreRecording, trashRecording } from '../lib/api'
import { formatDateTime } from '../lib/date'
import { useAppStore } from '../stores/appStore'
import StatusBadge from '../components/StatusBadge'

function formatDuration(sec) {
  if (!sec) return '--:--'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Archive view — recordings hidden from the main dashboard.
 *
 * Archived ≠ deleted: the full transcript, summary and audio are preserved.
 * The user can still search archived items from the dashboard by enabling
 * "アーカイブ済みも検索対象に含める". Archive is the right place for things
 * the user wants to keep but isn't actively working with.
 */
export default function Archive() {
  const [recordings, setRecordings] = useState([])
  const [loading, setLoading] = useState(true)
  const addToast = useAppStore((s) => s.addToast)

  const fetchData = useCallback(async () => {
    try {
      const recs = await getRecordings({ state: 'archived' })
      setRecordings(recs)
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => { fetchData() }, [fetchData])

  const handleRestore = async (id) => {
    try {
      await restoreRecording(id)
      addToast('ダッシュボードに戻しました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleTrash = async (id) => {
    try {
      await trashRecording(id)
      addToast('ゴミ箱に移動しました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">📦 アーカイブ</h1>
          <p className="text-xs text-gray-400 mt-1">
            ダッシュボードから非表示ですが、完全に保存されています。検索対象から外れるため一覧がスッキリします。
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-12">読み込み中...</div>
      ) : recordings.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-lg">アーカイブはありません</p>
          <p className="text-gray-400 text-sm mt-2">
            ダッシュボードで 📦 ボタンを押すと、その録音をここに移動できます
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {recordings.map((rec) => (
            <div
              key={rec.id}
              className="bg-card border border-theme rounded-lg p-4 group"
            >
              <div className="flex items-start justify-between">
                <Link to={`/recordings/${rec.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-medium truncate">
                      {rec.title || rec.id}
                    </h3>
                    <StatusBadge status={rec.status} />
                    <span className="text-yellow-700/60 text-xs shrink-0">
                      {'★'.repeat(rec.importance || 1)}{'☆'.repeat(3 - (rec.importance || 1))}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span>{formatDateTime(rec.recorded_at)}</span>
                    <span>{formatDuration(rec.duration_sec)}</span>
                    {rec.archived_at && (
                      <span className="text-amber-400/70">
                        📦 {formatDateTime(rec.archived_at)} にアーカイブ
                      </span>
                    )}
                  </div>
                </Link>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <button
                    onClick={() => handleRestore(rec.id)}
                    className="text-xs px-2 py-1 bg-blue-600/20 text-blue-300 hover:bg-blue-600/40 rounded"
                    title="ダッシュボードに戻す"
                  >
                    ↩ 戻す
                  </button>
                  <button
                    onClick={() => handleTrash(rec.id)}
                    className="text-xs px-2 py-1 bg-gray-700 text-gray-300 hover:bg-red-900/40 hover:text-red-300 rounded"
                    title="ゴミ箱へ"
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
