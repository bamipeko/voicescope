import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getRecordings, restoreRecording, deleteRecording, emptyTrash, getSettings } from '../lib/api'
import { formatDateTime } from '../lib/date'
import { useAppStore } from '../stores/appStore'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'

function formatDuration(sec) {
  if (!sec) return '--:--'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Trash view — recordings awaiting auto-purge.
 *
 * Items here will be deleted by the server-side cleanup scheduler after
 * `trash_retention_days` (configurable in Settings, 1-30 days). The delete
 * mode ('complete' vs 'audio_only') also affects what happens.
 *
 * Users can:
 *   - Restore a recording (returns to active Dashboard)
 *   - Permanently delete one item (bypasses the auto-purge timer)
 *   - Empty trash (nukes all items immediately)
 */
export default function Trash() {
  const [recordings, setRecordings] = useState([])
  const [loading, setLoading] = useState(true)
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null)
  const [emptyConfirm, setEmptyConfirm] = useState(false)
  const [retentionDays, setRetentionDays] = useState(14)
  const [deleteMode, setDeleteMode] = useState('complete')
  const addToast = useAppStore((s) => s.addToast)

  const fetchData = useCallback(async () => {
    try {
      const [recs, settings] = await Promise.all([
        getRecordings({ state: 'trashed' }),
        getSettings().catch(() => ({})),
      ])
      setRecordings(recs)
      setRetentionDays(Number(settings.trash_retention_days) || 14)
      setDeleteMode(settings.trash_delete_mode || 'complete')
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
      addToast('復元しました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handlePermanentDelete = async (id) => {
    try {
      await deleteRecording(id, { permanent: true })
      addToast('完全に削除しました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleEmptyTrash = async () => {
    try {
      const result = await emptyTrash()
      addToast(`ゴミ箱を空にしました（${result.deleted}件）`, 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  // Compute scheduled deletion date for each item
  const getScheduledDeletionDate = (trashedAt) => {
    if (!trashedAt) return null
    const d = new Date(trashedAt)
    d.setDate(d.getDate() + retentionDays)
    return d
  }

  const getDaysRemaining = (trashedAt) => {
    const scheduled = getScheduledDeletionDate(trashedAt)
    if (!scheduled) return null
    const now = new Date()
    const diffMs = scheduled - now
    return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)))
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">🗑 ゴミ箱</h1>
          <p className="text-xs text-gray-400 mt-1">
            {retentionDays}日後に自動削除されます（削除モード:{' '}
            <span className="text-gray-300">{deleteMode === 'audio_only' ? '音声のみ削除' : '完全削除'}</span>）。
            設定から変更できます。
          </p>
        </div>
        {recordings.length > 0 && (
          <button
            onClick={() => setEmptyConfirm(true)}
            className="text-xs bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-700/50 px-3 py-2 rounded"
          >
            🗑 すべて完全削除
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-12">読み込み中...</div>
      ) : recordings.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-lg">ゴミ箱は空です</p>
        </div>
      ) : (
        <div className="space-y-3">
          {recordings.map((rec) => {
            const daysLeft = getDaysRemaining(rec.trashed_at)
            const scheduledDate = getScheduledDeletionDate(rec.trashed_at)
            return (
              <div
                key={rec.id}
                className="bg-card border border-theme rounded-lg p-4 group opacity-75 hover:opacity-100 transition-opacity"
              >
                <div className="flex items-start justify-between">
                  <Link to={`/recordings/${rec.id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="text-gray-300 font-medium truncate line-through">
                        {rec.title || rec.id}
                      </h3>
                      <StatusBadge status={rec.status} />
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span>{formatDateTime(rec.recorded_at)}</span>
                      <span>{formatDuration(rec.duration_sec)}</span>
                      {scheduledDate && (
                        <span className={daysLeft <= 3 ? 'text-red-400' : 'text-amber-400/70'}>
                          {daysLeft <= 0
                            ? '次回の自動削除対象'
                            : `あと${daysLeft}日で自動削除（${formatDateTime(scheduledDate.toISOString())}）`}
                        </span>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <button
                      onClick={() => handleRestore(rec.id)}
                      className="text-xs px-2 py-1 bg-blue-600/20 text-blue-300 hover:bg-blue-600/40 rounded"
                      title="復元"
                    >
                      ↩ 復元
                    </button>
                    <button
                      onClick={() => setPermanentDeleteTarget(rec.id)}
                      className="text-xs px-2 py-1 bg-red-900/30 text-red-300 hover:bg-red-900/60 rounded"
                      title="今すぐ完全削除"
                    >
                      完全削除
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!permanentDeleteTarget}
        title="完全に削除"
        message="この録音を今すぐ完全に削除します。音声・文字起こし・要約すべてが失われ、復元できません。"
        confirmLabel="完全に削除"
        onConfirm={() => {
          handlePermanentDelete(permanentDeleteTarget)
          setPermanentDeleteTarget(null)
        }}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
      <ConfirmDialog
        open={emptyConfirm}
        title="ゴミ箱を空にする"
        message={`ゴミ箱内の${recordings.length}件すべてを今すぐ完全削除します。この操作は取り消せません。`}
        confirmLabel="すべて完全削除"
        onConfirm={() => {
          handleEmptyTrash()
          setEmptyConfirm(false)
        }}
        onCancel={() => setEmptyConfirm(false)}
      />
    </div>
  )
}
