import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getRecordings, uploadRecording, uploadText, trashRecording, archiveRecording, updateRecording, getTags, getFolders, getTemplates } from '../lib/api'
import { formatDateTime } from '../lib/date'
import { getAvailableModels, PROVIDER_LABELS, getDefaultModel } from '../lib/models'
import { useAppStore } from '../stores/appStore'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'

function lightenColor(hex) {
  // Make tag colors brighter for dark backgrounds
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lighten = (c) => Math.min(255, c + Math.round((255 - c) * 0.45))
  return `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`
}

function formatDuration(sec) {
  if (!sec) return '--:--'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// formatDate — use shared helper
const formatDate = formatDateTime

export default function Dashboard() {
  const [recordings, setRecordings] = useState([])
  const [allTags, setAllTags] = useState([])
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [importanceFilter, setImportanceFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const [searchParams] = useSearchParams()
  const folderFilter = searchParams.get('folder') || ''
  const [currentFolder, setCurrentFolder] = useState(null)

  const fetchData = useCallback(async (retryOnFail = false) => {
    try {
      const params = { state: 'active' }
      if (includeArchived) params.include_archived = '1'
      if (search) params.q = search
      if (importanceFilter) params.importance = importanceFilter
      if (tagFilter) params.tag = tagFilter
      if (folderFilter) params.folder = folderFilter
      const [recs, tags] = await Promise.all([getRecordings(params), getTags()])
      setRecordings(recs)
      setAllTags(tags)

      // Get current folder name
      if (folderFilter) {
        const folders = await getFolders()
        setCurrentFolder(folders.find(f => String(f.id) === folderFilter) || null)
      } else {
        setCurrentFolder(null)
      }
    } catch (err) {
      if (retryOnFail) {
        // Startup race: retry once after delay
        setTimeout(() => fetchData(false), 1500)
        return
      }
      addToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [search, tagFilter, folderFilter, importanceFilter, includeArchived, addToast])

  useEffect(() => { fetchData(true) }, [fetchData])

  // Show refine warnings as toasts — once per recording, then auto-acknowledge.
  // refine_warning is set by the server when primary provider failed (quota, rate, etc.)
  // and either fallback succeeded (type='fallback') or failed entirely (type='failed').
  const seenWarningsRef = useRef(new Set())
  useEffect(() => {
    for (const rec of recordings) {
      if (!rec.refine_warning) continue
      if (seenWarningsRef.current.has(rec.id)) continue
      seenWarningsRef.current.add(rec.id)

      let warning
      try { warning = typeof rec.refine_warning === 'string' ? JSON.parse(rec.refine_warning) : rec.refine_warning } catch { continue }

      const title = rec.title || rec.id
      if (warning.type === 'fallback') {
        addToast(
          `整形: ${warning.primary} がエラーのため ${warning.fallback} に切替（${title.slice(0, 20)}）。APIキー残高を確認してください。`,
          'warning',
          8000,
        )
      } else if (warning.type === 'failed') {
        addToast(
          `整形失敗: ${warning.primary} がエラー、ローカルLLM未設定のため整形をスキップしました（${title.slice(0, 20)}）`,
          'error',
          8000,
        )
      }
      // Acknowledge on the server so it doesn't show again
      updateRecording(rec.id, { acknowledge_warning: true }).catch(() => {})
    }
  }, [recordings, addToast])

  // Auto-refresh for in-progress items (pauses when tab is not visible)
  useEffect(() => {
    const hasInProgress = recordings.some(r =>
      ['uploaded', 'transcribing', 'transcribed', 'refining', 'summarizing'].includes(r.status)
    )
    if (!hasInProgress) return

    let timer = null
    const start = () => { if (!timer) timer = setInterval(() => fetchData(false), 8000) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVisChange = () => document.hidden ? stop() : start()

    start()
    document.addEventListener('visibilitychange', onVisChange)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisChange) }
  }, [recordings, fetchData])

  // Upload dialog state
  const [uploadDialogFiles, setUploadDialogFiles] = useState(null) // show dialog when set
  const [uploadOptions, setUploadOptions] = useState({ auto_summarize: true, template_id: '', granularity: 'normal', provider: '', model: '' })
  const [uploadTemplates, setUploadTemplates] = useState([])
  const tierInfo = useAppStore((s) => s.tierInfo)
  const { providers: availProviders, models: availModels } = getAvailableModels(tierInfo, 'summary')

  const handleFilesSelected = (files) => {
    if (files.length === 0) return
    // Load templates for the dialog
    getTemplates().then(setUploadTemplates).catch(() => {})
    setUploadDialogFiles(files)
  }

  const handleUploadConfirm = async () => {
    const files = uploadDialogFiles
    setUploadDialogFiles(null)
    if (!files) return

    for (const file of files) {
      try {
        const isText = /\.(txt|md|markdown)$/i.test(file.name)
        if (isText) {
          await uploadText(file, null, uploadOptions)
        } else {
          await uploadRecording(file, null, [], uploadOptions)
        }
        addToast(`${file.name} をアップロードしました`, 'success')
      } catch (err) {
        addToast(`${file.name}: ${err.message}`, 'error')
      }
    }
    fetchData()
  }

  // X button → move to trash (soft delete, purged after retention period).
  // Permanent deletion happens only from the Trash view.
  const handleTrash = async (id) => {
    try {
      await trashRecording(id)
      addToast('ゴミ箱に移動しました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  // Archive button → hidden from dashboard but keeps all data.
  // Can still be accessed from /archive and optionally surfaced in search via includeArchived.
  const handleArchive = async (id) => {
    try {
      await archiveRecording(id)
      addToast('アーカイブしました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f =>
      /\.(mp3|wav|m4a|webm|ogg|flac|txt|md|markdown)$/i.test(f.name)
    )
    if (files.length > 0) handleFilesSelected(files)
  }

  // Determine heading based on context
  const heading = currentFolder
    ? `${currentFolder.icon || '📁'} ${currentFolder.name}`
    : '録音一覧'

  return (
    <div
      className="p-6"
      onDragOver={(e) => {
        // Only show drop zone for external files, not internal recording card drags
        if (e.dataTransfer.types.includes('application/voicescope-recording')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes('application/voicescope-recording')) return
        handleDrop(e)
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-white">{heading}</h1>
        <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          ファイルをアップロード
          <input
            type="file"
            className="hidden"
            accept=".mp3,.wav,.m4a,.webm,.ogg,.flac,.txt,.md"
            multiple
            onChange={(e) => handleFilesSelected(Array.from(e.target.files))}
          />
        </label>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-3 mb-5">
        <div className="flex flex-1 gap-1">
          <span className="bg-card border border-theme-light rounded-l-lg px-3 py-2 text-xs text-gray-400 shrink-0 flex items-center">
            {folderFilter ? 'フォルダ内' : tagFilter ? 'タグ内' : '全体'}
          </span>
          <input
            type="text"
            placeholder="キーワード検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-card border border-theme-light rounded-r-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="bg-card border border-theme-light rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">すべてのタグ</option>
          {allTags.map((tag) => (
            <option key={tag.id} value={tag.name}>{tag.name}</option>
          ))}
        </select>
        <select
          value={importanceFilter}
          onChange={(e) => setImportanceFilter(e.target.value)}
          className="bg-card border border-theme-light rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">すべての重要度</option>
          <option value="3">★★★</option>
          <option value="2">★★</option>
          <option value="1">★</option>
        </select>
      </div>

      {/* Include archived toggle — only visible when actually searching / filtering */}
      {(search || tagFilter || importanceFilter) && (
        <label className="flex items-center gap-2 mb-4 text-xs text-gray-400 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="rounded accent-blue-500"
          />
          アーカイブ済みも検索対象に含める
        </label>
      )}

      {/* Active filters indicator */}
      {(folderFilter || tagFilter) && (
        <div className="flex items-center gap-2 mb-4 text-xs">
          {currentFolder && (
            <span className="bg-blue-900/50 text-blue-300 px-2 py-1 rounded flex items-center gap-1">
              {currentFolder.icon || '📁'} {currentFolder.name}
              <Link to="/" className="hover:text-white ml-1">✕</Link>
            </span>
          )}
          {tagFilter && (
            <span className="bg-green-900/50 text-green-300 px-2 py-1 rounded flex items-center gap-1">
              🏷 {tagFilter}
              <button onClick={() => setTagFilter('')} className="hover:text-white ml-1">✕</button>
            </span>
          )}
        </div>
      )}

      {/* Drop zone overlay */}
      {dragging && (
        <div className="fixed inset-0 bg-blue-500/20 z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-card border-2 border-dashed border-blue-500 rounded-2xl p-12 text-center">
            <p className="text-xl text-blue-400 font-medium">ここにファイルをドロップ</p>
            <p className="text-sm text-gray-400 mt-2">音声: mp3, wav, m4a, webm, ogg, flac / テキスト: txt, md</p>
          </div>
        </div>
      )}

      {/* Upload options dialog */}
      {uploadDialogFiles && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setUploadDialogFiles(null)}>
          <div className="bg-card border border-theme-light rounded-xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">アップロード設定</h3>

            <div className="space-y-4 mb-6">
              <div className="text-sm text-gray-300">
                {uploadDialogFiles.map(f => (
                  <div key={f.name} className="flex items-center gap-2 mb-1">
                    <span className="text-gray-400">{/\.(txt|md|markdown)$/i.test(f.name) ? '📄' : '🎤'}</span>
                    <span className="truncate">{f.name}</span>
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={uploadOptions.auto_summarize}
                  onChange={(e) => setUploadOptions(o => ({ ...o, auto_summarize: e.target.checked }))}
                  className="rounded"
                />
                自動要約を実行する
              </label>

              {uploadOptions.auto_summarize && (
                <div className="space-y-3 ml-6">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">テンプレート</label>
                      <select
                        value={uploadOptions.template_id}
                        onChange={(e) => setUploadOptions(o => ({ ...o, template_id: e.target.value }))}
                        className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white"
                      >
                        <option value="">デフォルト</option>
                        {uploadTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (デフォルト)' : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">粒度</label>
                      <select
                        value={uploadOptions.granularity}
                        onChange={(e) => setUploadOptions(o => ({ ...o, granularity: e.target.value }))}
                        className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white"
                      >
                        <option value="brief">簡易</option>
                        <option value="normal">通常</option>
                        <option value="detailed">詳細</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">プロバイダ</label>
                      <select
                        value={uploadOptions.provider}
                        onChange={(e) => {
                          const p = e.target.value
                          const models = availModels[p] || []
                          setUploadOptions(o => ({
                            ...o,
                            provider: p,
                            model: models[0]?.value || '',
                          }))
                        }}
                        className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white"
                      >
                        <option value="">デフォルト</option>
                        {availProviders.filter(p => (availModels[p] || []).length > 0 || p === 'ollama').map(p => (
                          <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">モデル</label>
                      {!uploadOptions.provider ? (
                        <select disabled className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-gray-400">
                          <option>デフォルト</option>
                        </select>
                      ) : (availModels[uploadOptions.provider] || []).length > 0 ? (
                        <select
                          value={uploadOptions.model}
                          onChange={(e) => setUploadOptions(o => ({ ...o, model: e.target.value }))}
                          className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white"
                        >
                          <option value="">デフォルト</option>
                          {(availModels[uploadOptions.provider] || []).map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={uploadOptions.model}
                          onChange={(e) => setUploadOptions(o => ({ ...o, model: e.target.value }))}
                          placeholder="モデル名を入力"
                          className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white placeholder-gray-400"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setUploadDialogFiles(null)} className="text-sm text-gray-400 hover:text-white px-4 py-2">
                キャンセル
              </button>
              <button onClick={handleUploadConfirm} className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-2 rounded-lg font-medium">
                アップロード
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recording list */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">読み込み中...</div>
      ) : recordings.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-lg">録音がありません</p>
          <p className="text-gray-400 text-sm mt-2">音声ファイルをアップロードするか、録音ボタンで録音を開始してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {recordings.map((rec) => (
            <Link
              key={rec.id}
              to={`/recordings/${rec.id}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/voicescope-recording', rec.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              className="block bg-card border border-theme rounded-lg p-4 hover:border-theme-light transition-colors group cursor-grab active:cursor-grabbing"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-medium truncate">
                      {rec.title || rec.id}
                    </h3>
                    <StatusBadge status={rec.status} />
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const next = ((rec.importance || 1) % 3) + 1
                        updateRecording(rec.id, { importance: next }).then(() => {
                          setRecordings(rs => rs.map(r => r.id === rec.id ? { ...r, importance: next } : r))
                        }).catch(() => {})
                      }}
                      className="text-yellow-700/60 hover:text-yellow-500 text-xs shrink-0 transition-colors"
                      title={`重要度: ${'★'.repeat(rec.importance || 1)} (クリックで変更)`}
                    >
                      {'★'.repeat(rec.importance || 1)}{'☆'.repeat(3 - (rec.importance || 1))}
                    </button>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span>{formatDate(rec.recorded_at)}</span>
                    <span>{formatDuration(rec.duration_sec)}</span>
                    {rec.original_filename ? (
                      <span className="text-gray-400 truncate" title={rec.original_filename}>
                        📄 {rec.original_filename}
                      </span>
                    ) : null}
                  </div>
                  {rec.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {rec.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 rounded text-xs"
                          style={{ backgroundColor: tag.color + '40', color: lightenColor(tag.color) }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Right side: local toggle + archive + trash */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const newVal = !rec.processed_locally
                      updateRecording(rec.id, { processed_locally: newVal }).then(() => {
                        setRecordings(rs => rs.map(r => r.id === rec.id ? { ...r, processed_locally: newVal ? 1 : 0 } : r))
                        addToast(newVal ? 'ローカル保護を有効にしました' : 'ローカル保護を解除しました', 'success')
                      }).catch((err) => addToast(err.message, 'error'))
                    }}
                    className={`p-1 text-sm transition-all ${
                      rec.processed_locally
                        ? 'text-green-400 hover:text-green-300'
                        : 'text-gray-500 hover:text-gray-400 opacity-0 group-hover:opacity-100'
                    }`}
                    title={rec.processed_locally ? 'ローカル保護中（クリックで解除）' : 'ローカル保護を有効にする（横断検索の対象外に）'}
                  >
                    {rec.processed_locally ? '🔒' : '🔓'}
                  </button>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleArchive(rec.id) }}
                    className="text-gray-500 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-xs"
                    title="アーカイブに移動（ダッシュボードから非表示）"
                  >
                    📦
                  </button>
                  <button
                    onClick={(e) => { e.preventDefault(); setDeleteTarget(rec.id) }}
                    className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    title="ゴミ箱に移動"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="ゴミ箱に移動"
        message="この録音をゴミ箱に移動します。一定期間後に自動削除されますが、それまでは『ゴミ箱』から復元できます。"
        confirmLabel="ゴミ箱へ"
        onConfirm={() => {
          handleTrash(deleteTarget)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
