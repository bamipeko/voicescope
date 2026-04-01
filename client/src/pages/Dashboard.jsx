import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getRecordings, uploadRecording, deleteRecording, getTags } from '../lib/api'
import { useAppStore } from '../stores/appStore'
import StatusBadge from '../components/StatusBadge'

function formatDuration(sec) {
  if (!sec) return '--:--'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function Dashboard() {
  const [recordings, setRecordings] = useState([])
  const [allTags, setAllTags] = useState([])
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  const fetchData = useCallback(async () => {
    try {
      const params = {}
      if (search) params.q = search
      if (tagFilter) params.tag = tagFilter
      const [recs, tags] = await Promise.all([getRecordings(params), getTags()])
      setRecordings(recs)
      setAllTags(tags)
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [search, tagFilter, addToast])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-refresh for in-progress items
  useEffect(() => {
    const hasInProgress = recordings.some(r =>
      ['transcribing', 'summarizing', 'uploaded'].includes(r.status)
    )
    if (!hasInProgress) return
    const timer = setInterval(fetchData, 3000)
    return () => clearInterval(timer)
  }, [recordings, fetchData])

  const handleUpload = async (files) => {
    for (const file of files) {
      try {
        await uploadRecording(file)
        addToast(`${file.name} をアップロードしました`, 'success')
      } catch (err) {
        addToast(`${file.name}: ${err.message}`, 'error')
      }
    }
    fetchData()
  }

  const handleDelete = async (id) => {
    if (!confirm('この録音を削除しますか？')) return
    try {
      await deleteRecording(id)
      addToast('削除しました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f =>
      /\.(mp3|wav|m4a|webm|ogg|flac)$/i.test(f.name)
    )
    if (files.length > 0) handleUpload(files)
  }

  return (
    <div
      className="p-6"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">録音一覧</h1>
        <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          ファイルをアップロード
          <input
            type="file"
            className="hidden"
            accept=".mp3,.wav,.m4a,.webm,.ogg,.flac"
            multiple
            onChange={(e) => handleUpload(Array.from(e.target.files))}
          />
        </label>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="キーワード検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">すべてのタグ</option>
          {allTags.map((tag) => (
            <option key={tag.id} value={tag.name}>{tag.name}</option>
          ))}
        </select>
      </div>

      {/* Drop zone overlay */}
      {dragging && (
        <div className="fixed inset-0 bg-blue-500/20 z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-gray-900 border-2 border-dashed border-blue-500 rounded-2xl p-12 text-center">
            <p className="text-xl text-blue-400 font-medium">ここにファイルをドロップ</p>
            <p className="text-sm text-gray-400 mt-2">mp3, wav, m4a, webm, ogg, flac</p>
          </div>
        </div>
      )}

      {/* Recording list */}
      {loading ? (
        <div className="text-center text-gray-500 py-12">読み込み中...</div>
      ) : recordings.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg">録音がありません</p>
          <p className="text-gray-600 text-sm mt-2">音声ファイルをアップロードするか、録音ボタンで録音を開始してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {recordings.map((rec) => (
            <Link
              key={rec.id}
              to={`/recordings/${rec.id}`}
              className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-medium truncate">
                      {rec.title || rec.id}
                    </h3>
                    <StatusBadge status={rec.status} />
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    <span>{formatDate(rec.recorded_at)}</span>
                    <span>{formatDuration(rec.duration_sec)}</span>
                  </div>
                  {rec.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {rec.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 rounded text-xs"
                          style={{ backgroundColor: tag.color + '33', color: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); handleDelete(rec.id) }}
                  className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  title="削除"
                >
                  ✕
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
