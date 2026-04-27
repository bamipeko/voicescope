import { useState, useEffect, useCallback } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { getFolders, createFolder, deleteFolder, updateFolder, getTags, addRecordingToFolder, getTierInfo, getRecordingCounts } from '../lib/api'
import RecordingRecoveryDialog from './RecordingRecoveryDialog'

const NAV_ITEMS = [
  { path: '/', label: 'ダッシュボード', icon: '⊞' },
  { path: '/ask-all', label: 'Ask All', icon: '⊕' },
  { path: '/templates', label: 'テンプレート', icon: '⊟' },
  { path: '/settings', label: '設定', icon: '⊡' },
]

function lightenColor(hex) {
  if (!hex || !hex.startsWith('#')) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lighten = (c) => Math.min(255, c + Math.round((255 - c) * 0.45))
  return `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`
}

export default function Layout({ children }) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const toasts = useAppStore((s) => s.toasts)
  const [folders, setFolders] = useState([])
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [editingFolder, setEditingFolder] = useState(null)
  const [allTags, setAllTags] = useState([])
  const [dropTargetId, setDropTargetId] = useState(null)
  const [updateInfo, setUpdateInfo] = useState(null) // { latestVersion, downloadUrl, releaseUrl }
  const [counts, setCounts] = useState({ active: 0, archived: 0, trashed: 0 })
  const addToast = useAppStore((s) => s.addToast)
  const processingMode = useAppStore((s) => s.processingMode)

  const activeFolderId = searchParams.get('folder')

  const setTierInfo = useAppStore((s) => s.setTierInfo)

  // Load tier info on mount and when navigating (so Ollama models refresh)
  useEffect(() => {
    getTierInfo().then(setTierInfo).catch(() => {})
  }, [setTierInfo, location.pathname])

  // Refresh archive/trash counts on every navigation so the badges stay accurate
  // when the user archives / trashes / restores items.
  useEffect(() => {
    getRecordingCounts().then(setCounts).catch(() => {})
  }, [location.pathname])

  // Check for updates on mount (Electron only)
  useEffect(() => {
    if (!window.electronAPI?.checkForUpdates) return
    // Delay 5s so the app loads first
    const timer = setTimeout(async () => {
      try {
        const result = await window.electronAPI.checkForUpdates()
        if (result?.hasUpdate) {
          setUpdateInfo(result)
        }
      } catch {}
    }, 5000)
    return () => clearTimeout(timer)
  }, [])

  const loadSidebarData = useCallback(async () => {
    try {
      const [f, t] = await Promise.all([getFolders(), getTags()])
      setFolders(f)
      setAllTags(t)
    } catch {
      // Retry once after short delay (startup race condition)
      setTimeout(async () => {
        try {
          const [f, t] = await Promise.all([getFolders(), getTags()])
          setFolders(f)
          setAllTags(t)
        } catch {}
      }, 1000)
    }
  }, [])

  useEffect(() => {
    loadSidebarData()
  }, [loadSidebarData])

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      await createFolder({ name: newFolderName.trim() })
      setNewFolderName('')
      setShowNewFolder(false)
      const updated = await getFolders()
      setFolders(updated)
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleDeleteFolder = async (id) => {
    try {
      await deleteFolder(id)
      setEditingFolder(null)
      const updated = await getFolders()
      setFolders(updated)
      addToast('フォルダを削除しました', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleToggleAutoTag = async (folder, tagId) => {
    const current = JSON.parse(folder.auto_tag_ids || '[]')
    const updated = current.includes(tagId)
      ? current.filter(id => id !== tagId)
      : [...current, tagId]
    try {
      await updateFolder(folder.id, { auto_tag_ids: updated })
      const updatedFolders = await getFolders()
      setFolders(updatedFolders)
      setEditingFolder(prev => prev ? { ...prev, auto_tag_ids: JSON.stringify(updated) } : null)
      addToast('自動振り分けを更新しました', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleFolderDrop = async (e, folderId) => {
    e.preventDefault()
    setDropTargetId(null)
    const recordingId = e.dataTransfer.getData('application/voicescope-recording')
    if (!recordingId) return
    try {
      await addRecordingToFolder(folderId, recordingId)
      const updated = await getFolders()
      setFolders(updated)
      addToast('フォルダに追加しました', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  return (
    <div className="min-h-screen bg-base flex">
      {/* Recovery dialog for interrupted recordings (only renders if found) */}
      <RecordingRecoveryDialog />

      {/* Sidebar */}
      <nav className="w-56 bg-sidebar border-r border-theme flex flex-col fixed h-full">
        <div className="p-4 border-b border-theme">
          <h1 className="text-lg font-bold text-white tracking-tight">VoiceScope</h1>
          <p className="text-xs text-gray-400 mt-0.5">音声文字起こし & AI要約</p>
        </div>
        <div className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                location.pathname === item.path && !activeFolderId
                  ? 'bg-card text-white border-r-2 border-blue-500'
                  : 'text-gray-300 hover:text-white hover:bg-card/50'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}

          {/* Folders section */}
          {folders.length > 0 && (
            <div className="mt-3 pt-3 border-t border-theme">
              <div className="flex items-center justify-between px-4 mb-1">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">フォルダ</span>
                <button
                  onClick={() => setShowNewFolder(!showNewFolder)}
                  className="text-gray-400 hover:text-white text-sm"
                  title="新規フォルダ"
                >
                  +
                </button>
              </div>
              {folders.map((folder) => (
                <Link
                  key={folder.id}
                  to={`/?folder=${folder.id}`}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('application/voicescope-recording')) {
                      e.preventDefault()
                      setDropTargetId(folder.id)
                    }
                  }}
                  onDragLeave={() => setDropTargetId(null)}
                  onDrop={(e) => handleFolderDrop(e, folder.id)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors group ${
                    dropTargetId === folder.id
                      ? 'bg-blue-900/40 text-blue-300 ring-1 ring-blue-500'
                      : activeFolderId === String(folder.id)
                        ? 'bg-card text-white border-r-2 border-blue-500'
                        : 'text-gray-300 hover:text-white hover:bg-card/50'
                  }`}
                >
                  <svg className="w-4 h-4 text-gray-300 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                  <span className="flex-1 truncate">{folder.name}</span>
                  <span className="text-xs text-gray-400">{folder.recording_count || 0}</span>
                  <button
                    onClick={(e) => {
                      e.preventDefault(); e.stopPropagation()
                      setEditingFolder(folder)
                      // Re-fetch tags to ensure fresh data
                      getTags().then(setAllTags).catch(() => {})
                    }}
                    className="text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 text-xs"
                    title="フォルダ設定"
                  >
                    ⚙
                  </button>
                </Link>
              ))}
            </div>
          )}

          {/* New folder input or initial add button */}
          {showNewFolder ? (
            <div className="px-4 py-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                placeholder="フォルダ名"
                className="w-full bg-input border border-theme-light rounded px-2 py-1 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <div className="flex gap-1 mt-1">
                <button onClick={handleCreateFolder} className="text-xs text-blue-400 hover:text-blue-300">作成</button>
                <button onClick={() => { setShowNewFolder(false); setNewFolderName('') }} className="text-xs text-gray-400 hover:text-white">キャンセル</button>
              </div>
            </div>
          ) : folders.length === 0 ? (
            <div className="mt-3 pt-3 border-t border-theme px-4">
              <button
                onClick={() => setShowNewFolder(true)}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              >
                <span>+</span> フォルダを作成
              </button>
            </div>
          ) : null}

          {/* Archive / Trash section — appears after folders */}
          <div className="mt-3 pt-3 border-t border-theme">
            <Link
              to="/archive"
              className={`flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                location.pathname === '/archive'
                  ? 'bg-card text-white border-r-2 border-blue-500'
                  : 'text-gray-300 hover:text-white hover:bg-card/50'
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="text-base">📦</span>
                アーカイブ
              </span>
              {counts.archived > 0 && (
                <span className="text-[10px] text-gray-400">{counts.archived}</span>
              )}
            </Link>
            <Link
              to="/trash"
              className={`flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                location.pathname === '/trash'
                  ? 'bg-card text-white border-r-2 border-blue-500'
                  : 'text-gray-300 hover:text-white hover:bg-card/50'
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="text-base">🗑</span>
                ゴミ箱
              </span>
              {counts.trashed > 0 && (
                <span className="text-[10px] text-gray-400">{counts.trashed}</span>
              )}
            </Link>
          </div>
        </div>

        {/* Offline mode indicator */}
        {processingMode === 'offline' && (
          <div className="p-3 border-t border-theme">
            <Link
              to="/settings"
              className="block bg-green-900/30 border border-green-700/50 rounded-lg px-3 py-2 hover:bg-green-900/40 transition-colors"
              title="動作モード設定へ"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🔒</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-green-300 font-medium">オフラインモード</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">外部通信なし</p>
                </div>
              </div>
            </Link>
          </div>
        )}

        {/* Update notification */}
        {updateInfo && (
          <div className="p-3 border-t border-theme">
            <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg px-3 py-2.5">
              <p className="text-xs text-blue-300 font-medium">v{updateInfo.latestVersion} が利用可能</p>
              <p className="text-[10px] text-gray-400 mt-0.5">現在: v{updateInfo.currentVersion}</p>
              <button
                onClick={() => window.electronAPI?.openReleasePage?.(updateInfo.releaseUrl)}
                className="text-[11px] text-blue-400 hover:text-blue-300 mt-1.5 block"
              >
                ダウンロード →
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Main content */}
      <main className="flex-1 ml-56 pb-20">
        {children}
      </main>

      {/* Folder Settings Modal */}
      {editingFolder && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setEditingFolder(null)}>
          <div className="bg-card border border-theme rounded-xl p-6 w-96 max-w-[90vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-semibold text-base mb-4">
              {editingFolder.icon || '📁'} {editingFolder.name} の設定
            </h3>

            {/* Auto-assign tags */}
            <div className="mb-5">
              <p className="text-sm text-gray-300 mb-2">自動振り分けタグ</p>
              <p className="text-xs text-gray-400 mb-3">選択したタグが付いた録音を自動でこのフォルダに追加します</p>
              {allTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => {
                    const autoTags = JSON.parse(editingFolder.auto_tag_ids || '[]')
                    const isActive = autoTags.includes(tag.id)
                    return (
                      <button
                        key={tag.id}
                        onClick={() => handleToggleAutoTag(editingFolder, tag.id)}
                        className={`px-2.5 py-1 rounded text-xs transition-colors ${
                          isActive ? 'ring-1 ring-blue-500' : 'opacity-50 hover:opacity-80'
                        }`}
                        style={{ backgroundColor: tag.color + '40', color: lightenColor(tag.color) }}
                      >
                        {tag.name}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400">タグがまだありません。録音を文字起こしすると自動でタグが生成されます。</p>
              )}
            </div>

            <div className="border-t border-theme pt-4 flex items-center justify-between">
              <button
                onClick={() => {
                  if (confirm(`「${editingFolder.name}」を削除しますか？\n録音データは削除されません。`)) {
                    handleDeleteFolder(editingFolder.id)
                  }
                }}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                このフォルダを削除
              </button>
              <button
                onClick={() => setEditingFolder(null)}
                className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications — bottom-left to avoid overlapping record button (bottom-right) */}
      <div className="fixed bottom-4 left-4 flex flex-col gap-2 z-50 ml-48">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm animate-in slide-in-from-left ${
              toast.type === 'error' ? 'bg-red-900/90 text-red-100' :
              toast.type === 'warning' ? 'bg-yellow-900/90 text-yellow-100 border border-yellow-600/50' :
              toast.type === 'success' ? 'bg-green-900/90 text-green-100' :
              'bg-card text-gray-100'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}
