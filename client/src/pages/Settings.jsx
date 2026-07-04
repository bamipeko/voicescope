import { useState, useEffect } from 'react'
import {
  getSettings, updateSettings, updateApiKeys, getLocalStatus,
  setupWhisperCpp, downloadWhisperModel, pullOllamaModel, getDownloadStatus,
  getStorageStats, bulkDeleteRecordings,
  getTierInfo, activateTrial, setProcessingMode,
  testCustomEndpoint,
} from '../lib/api'
import { useAppStore } from '../stores/appStore'
import { getAvailableModels, PROVIDER_LABELS, getDefaultModel } from '../lib/models'

function lightenColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lighten = (c) => Math.min(255, c + Math.round((255 - c) * 0.45))
  return `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`
}

const isElectron = !!window.electronAPI?.isElectron
// Server can persist API keys in Electron (electron-store) or Standalone (config.json).
// Docker mode uses .env only. This flag decides whether to show the key editor UI.
function canEditKeys(tierInfo) {
  if (isElectron) return true
  const mode = tierInfo?.runtimeMode
  return mode === 'standalone' || mode === 'dev'
}

const API_KEY_LABELS = {
  deepgram: 'Deepgram',
  openai: 'OpenAI',
  gemini: 'Gemini',
  grok: 'Grok (xAI)',
  anthropic: 'Claude (Anthropic)',
}

const API_KEY_ENV_NAMES = {
  deepgram: 'DEEPGRAM_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  grok: 'GROK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

const WHISPER_MODELS = [
  { value: 'tiny', label: 'tiny (~75MB, 最速)', ram: '~1GB' },
  { value: 'base', label: 'base (~150MB, 高速)', ram: '~1GB' },
  { value: 'small', label: 'small (~500MB, バランス)', ram: '~2GB' },
  { value: 'medium', label: 'medium (~1.5GB, 高精度)', ram: '~5GB' },
  { value: 'large-v3', label: 'large-v3 (~3GB, 最高精度)', ram: '~10GB' },
]

function StatusDot({ ok }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-green-400' : 'bg-gray-600'}`} />
  )
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function ProcessingModeSection({ addToast }) {
  const processingMode = useAppStore((s) => s.processingMode)
  const setMode = useAppStore((s) => s.setProcessingMode)
  const setTierInfo = useAppStore((s) => s.setTierInfo)
  const [saving, setSaving] = useState(false)
  const [pendingReviewDialog, setPendingReviewDialog] = useState(null) // { fromMode, toMode }

  const handleSwitch = async (newMode) => {
    if (newMode === processingMode || saving) return
    const fromMode = processingMode
    setSaving(true)
    try {
      await setProcessingMode(newMode)
      setMode(newMode)

      // When switching TO offline: auto-set default LLM to Ollama
      if (newMode === 'offline') {
        try {
          await updateSettings({
            default_summary_provider: 'ollama',
            default_ask_provider: 'ollama',
          })
        } catch (e) {
          console.warn('Failed to auto-set Ollama defaults:', e)
        }
      }

      // When switching OUT of offline (to ownkey/managed): auto-set a cloud default
      if (fromMode === 'offline' && newMode !== 'offline') {
        try {
          await updateSettings({
            default_summary_provider: 'openai',
            default_summary_model: 'gpt-5.4-mini',
            default_ask_provider: 'openai',
            default_ask_model: 'gpt-5.4-mini',
          })
        } catch (e) {
          console.warn('Failed to auto-set cloud defaults:', e)
        }
      }

      // Refresh tier info (mode affects managed flag, etc.)
      const info = await getTierInfo()
      setTierInfo(info)

      const labels = { offline: 'オフライン', ownkey: '自前API', managed: 'おまかせ' }
      addToast(`${labels[newMode]}モードに切り替えました`, 'success')

      // Show review dialog unless suppressed
      const suppress = localStorage.getItem('vs_suppress_mode_review') === '1'
      if (!suppress) {
        setPendingReviewDialog({ fromMode, toMode: newMode })
      }
    } catch (err) {
      addToast(err.message, 'error')
    }
    setSaving(false)
  }

  const MODES = [
    {
      key: 'offline',
      label: 'オフライン',
      icon: '🔒',
      desc: '外部通信なし（whisper.cpp + Ollama）',
    },
    {
      key: 'ownkey',
      label: '自前API',
      icon: '🔑',
      desc: '自分のAPIキーで利用',
    },
    {
      key: 'managed',
      label: 'おまかせ',
      icon: '☁️',
      desc: '運営APIに一部依存',
    },
  ]

  const currentMode = MODES.find(m => m.key === processingMode) || MODES[1]

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-white mb-3">動作モード</h2>
      <div className="bg-card border border-theme rounded-lg p-4">
        <div className="grid grid-cols-3 gap-2 mb-3">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => handleSwitch(m.key)}
              disabled={saving}
              className={`px-3 py-3 rounded-lg text-center transition-all ${
                processingMode === m.key
                  ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                  : 'bg-input hover:bg-input/80 text-gray-300 border border-theme-light'
              }`}
            >
              <div className="text-xl mb-1">{m.icon}</div>
              <div className="text-xs font-medium">{m.label}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">{currentMode.desc}</p>
        {processingMode === 'offline' && (
          <p className="text-[11px] text-green-400 mt-2">
            🛡 外部通信は一切発生しません。全ての処理はこのPC内で完結します。
          </p>
        )}
        {processingMode === 'managed' && (
          <p className="text-[11px] text-blue-400 mt-2">
            運営のWorker経由でAPIを利用します。ユーザー自身の継続課金は発生しません。
          </p>
        )}
      </div>

      {pendingReviewDialog && (
        <ModeReviewDialog
          fromMode={pendingReviewDialog.fromMode}
          toMode={pendingReviewDialog.toMode}
          onClose={(dontShowAgain) => {
            if (dontShowAgain) localStorage.setItem('vs_suppress_mode_review', '1')
            setPendingReviewDialog(null)
          }}
        />
      )}
    </section>
  )
}

function ModeReviewDialog({ fromMode, toMode, onClose }) {
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const LABELS = { offline: 'オフライン', ownkey: '自前API', managed: 'おまかせ' }

  const message = toMode === 'offline'
    ? 'オフラインモードに切り替えました。デフォルトのLLMを自動的にOllamaに変更しました。使用するモデルを選び直してください。'
    : `${LABELS[toMode]}モードに切り替えました。各テンプレートや個別の設定で使用するLLMが変わる場合があります。設定を見直してください。`

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => onClose(dontShowAgain)}>
      <div
        className="bg-card border border-blue-600/50 rounded-xl max-w-md w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="text-2xl">⚙️</div>
          <div>
            <h3 className="text-lg font-semibold text-white">
              LLM設定を見直してください
            </h3>
            <p className="text-sm text-gray-300 mt-2">{message}</p>
            <p className="text-xs text-gray-400 mt-3">
              下にスクロールして「要約」「AI質問」セクションでモデルを確認できます。
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-400 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="rounded"
          />
          今後この通知を表示しない
        </label>

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onClose(dontShowAgain)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-2 rounded-lg font-medium"
          >
            了解
          </button>
        </div>
      </div>
    </div>
  )
}

function SubscriptionSection({ addToast }) {
  const [tierInfo, setTierInfo] = useState(null)
  const [trialCode, setTrialCode] = useState('')
  const [activating, setActivating] = useState(false)
  const globalSetTier = useAppStore((s) => s.setTierInfo)

  useEffect(() => {
    getTierInfo().then(info => setTierInfo(info)).catch(() => {})
  }, [])

  const handleActivate = async () => {
    if (!trialCode.trim()) return
    setActivating(true)
    try {
      const result = await activateTrial(trialCode.trim())
      const label = result.source ? `${result.source} 特典` : 'トライアル'
      addToast(`${label}を有効化しました（${new Date(result.expiry).toLocaleDateString('ja-JP')}まで）`, 'success')
      const updated = await getTierInfo()
      setTierInfo(updated)
      globalSetTier(updated)
      setTrialCode('')
    } catch (err) {
      addToast(err.message, 'error')
    }
    setActivating(false)
  }

  const TIER_BADGES = {
    ownkey: { label: '自前APIキー', color: 'bg-green-900/50 text-green-400' },
    trial: { label: 'トライアル', color: 'bg-blue-900/50 text-blue-400' },
    pro: { label: 'Pro', color: 'bg-purple-900/50 text-purple-400' },
    heavy: { label: 'Heavy', color: 'bg-yellow-900/50 text-yellow-400' },
    free: { label: 'Free', color: 'bg-gray-700 text-gray-400' },
  }

  const tier = tierInfo?.tier || 'ownkey'
  const badge = TIER_BADGES[tier] || TIER_BADGES.ownkey

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-white mb-3">プラン</h2>
      <div className="bg-card border border-theme rounded-lg p-4 space-y-4">
        {/* Current plan */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-300">現在のプラン:</span>
            <span className={`px-2.5 py-1 rounded text-xs font-medium ${badge.color}`}>
              {badge.label}
            </span>
          </div>
          {tier === 'trial' && tierInfo?.expiry && (
            <span className="text-xs text-gray-400">
              {tierInfo.source && `${tierInfo.source} 特典 · `}
              有効期限: {new Date(tierInfo.expiry).toLocaleDateString('ja-JP')}
            </span>
          )}
        </div>

        {tierInfo?.isExpired && (
          <div className="bg-red-900/20 border border-red-700/50 rounded px-3 py-2 text-xs text-red-300">
            トライアル期間が終了しました。トライアルコードを入力するか、プランをアップグレードしてください。
          </div>
        )}

        {tier === 'ownkey' && (
          <p className="text-xs text-gray-400">
            自前のAPIキーを使用中 — 全機能が制限なく使えます。
          </p>
        )}

        {/* Trial code input */}
        <div>
          <p className="text-xs text-gray-400 mb-2">トライアルコードをお持ちの方:</p>
          <div className="flex gap-2">
            <input
              value={trialCode}
              onChange={(e) => setTrialCode(e.target.value)}
              placeholder="コードを入力..."
              className="flex-1 bg-input border border-theme rounded px-3 py-1.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 font-mono"
            />
            <button
              onClick={handleActivate}
              disabled={!trialCode.trim() || activating}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white text-xs px-4 py-1.5 rounded font-medium transition-colors"
            >
              {activating ? '処理中...' : '有効化'}
            </button>
          </div>
        </div>

        {/* Plan comparison */}
        <div className="border-t border-theme pt-4">
          <p className="text-xs text-gray-400 mb-3">おまかせプラン（近日公開）</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-input/50 border border-theme rounded-lg p-3">
              <div className="text-sm font-medium text-white">Pro</div>
              <div className="text-xs text-blue-400 font-medium mt-0.5">¥980/月</div>
              <p className="text-[11px] text-gray-400 mt-1">APIキー不要で標準モデルを利用</p>
              <button disabled className="mt-2 w-full bg-gray-700 text-gray-400 text-xs py-1.5 rounded cursor-not-allowed">
                近日公開
              </button>
            </div>
            <div className="bg-input/50 border border-theme rounded-lg p-3">
              <div className="text-sm font-medium text-white">Heavy</div>
              <div className="text-xs text-yellow-400 font-medium mt-0.5">¥2,480/月</div>
              <p className="text-[11px] text-gray-400 mt-1">高性能モデル使い放題</p>
              <button disabled className="mt-2 w-full bg-gray-700 text-gray-400 text-xs py-1.5 rounded cursor-not-allowed">
                近日公開
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function StorageSection({ addToast }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null) // { label, action }

  const loadStats = async () => {
    setLoading(true)
    try {
      const s = await getStorageStats()
      setStats(s)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadStats() }, [])

  const handleBulkAction = async (options, label) => {
    setConfirmAction(null)
    try {
      const result = await bulkDeleteRecordings(options)
      addToast(`${result.deletedCount}件${options.audioOnly ? 'の音声ファイル' : ''}を削除（${formatBytes(result.freedBytes)} 解放）`, 'success')
      loadStats()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const IMPORTANCE_LABELS = { 1: '★', 2: '★★', 3: '★★★' }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-white">ストレージ管理</h2>
        <button onClick={loadStats} disabled={loading} className="text-xs text-blue-500 hover:text-blue-400 disabled:text-gray-400">
          {loading ? '読み込み中...' : '再取得'}
        </button>
      </div>
      <div className="bg-card border border-theme rounded-lg p-4 space-y-4">
        {stats ? (
          <>
            {/* Overview */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-input rounded-lg p-3">
                <div className="text-lg font-bold text-white">{formatBytes(stats.totalSize)}</div>
                <div className="text-[11px] text-gray-400">合計使用量</div>
              </div>
              <div className="bg-input rounded-lg p-3">
                <div className="text-lg font-bold text-white">{stats.totalRecordings}</div>
                <div className="text-[11px] text-gray-400">録音数</div>
              </div>
              <div className="bg-input rounded-lg p-3">
                <div className="text-lg font-bold text-white">{formatBytes(stats.audioSize)}</div>
                <div className="text-[11px] text-gray-400">音声ファイル</div>
              </div>
            </div>

            {/* By importance */}
            <div>
              <p className="text-xs text-gray-400 mb-2">重要度別の内訳</p>
              <div className="space-y-1.5">
                {[1, 2, 3].map(imp => {
                  const d = stats.byImportance?.[imp] || { count: 0, size: 0 }
                  if (d.count === 0) return null
                  return (
                    <div key={imp} className="flex items-center justify-between text-xs bg-input/50 rounded px-3 py-2">
                      <span className="text-yellow-500">{IMPORTANCE_LABELS[imp]}</span>
                      <span className="text-gray-300">{d.count}件 / {formatBytes(d.size)}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmAction({
                            label: `${IMPORTANCE_LABELS[imp]} の音声ファイルのみ削除`,
                            action: () => handleBulkAction({ importance: imp, audioOnly: true }),
                          })}
                          className="text-gray-400 hover:text-yellow-400 transition-colors"
                          title="音声ファイルのみ削除（文字起こし・要約は残る）"
                        >
                          音声削除
                        </button>
                        <button
                          onClick={() => setConfirmAction({
                            label: `${IMPORTANCE_LABELS[imp]} の録音をすべて削除`,
                            action: () => handleBulkAction({ importance: imp, audioOnly: false }),
                          })}
                          className="text-gray-400 hover:text-red-400 transition-colors"
                          title="録音・文字起こし・要約をすべて削除"
                        >
                          全削除
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Bulk by age */}
            <div>
              <p className="text-xs text-gray-400 mb-2">古い録音の整理</p>
              <div className="flex flex-wrap gap-2">
                {[30, 90, 180].map(days => (
                  <button
                    key={days}
                    onClick={() => setConfirmAction({
                      label: `${days}日以上前の ★ 録音の音声を削除`,
                      action: () => handleBulkAction({ importance: 1, olderThanDays: days, audioOnly: true }),
                    })}
                    className="text-xs bg-input hover:bg-input/80 border border-theme-light text-gray-300 px-3 py-1.5 rounded transition-colors"
                  >
                    {days}日以上前の★（音声のみ）
                  </button>
                ))}
              </div>
            </div>

            {/* Confirm dialog */}
            {confirmAction && (
              <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3">
                <p className="text-sm text-red-300 mb-2">{confirmAction.label}</p>
                <p className="text-xs text-gray-400 mb-3">この操作は元に戻せません。</p>
                <div className="flex gap-2">
                  <button
                    onClick={confirmAction.action}
                    className="bg-red-600 hover:bg-red-700 text-white text-xs px-4 py-1.5 rounded"
                  >
                    実行
                  </button>
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs px-4 py-1.5 rounded"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-400 text-center py-4">
            {loading ? '読み込み中...' : 'ストレージ情報を取得できませんでした'}
          </div>
        )}
      </div>
    </section>
  )
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const tierInfo = useAppStore((s) => s.tierInfo)

  const [appVersion, setAppVersion] = useState('')

  // Electron mode: editable API keys
  const [apiKeys, setApiKeys] = useState({})
  const [keyDirty, setKeyDirty] = useState({})

  // Meeting auto-record (Electron only)
  const [meetingAutoRecord, setMeetingAutoRecord] = useState(false)
  const [meetBrowser, setMeetBrowser] = useState('brave')

  // Export audio path (Electron only)
  const [exportAudioPath, setExportAudioPath] = useState('')
  const [exportInfographicPath, setExportInfographicPath] = useState('')

  // Local services status
  const [localStatus, setLocalStatus] = useState(null)
  const [checkingLocal, setCheckingLocal] = useState(false)
  const [downloads, setDownloads] = useState({})
  const [ollamaPullModel, setOllamaPullModel] = useState('')

  // Custom OpenAI-compatible endpoint (LM Studio / llama.cpp / Jan etc.)
  const [customTestResult, setCustomTestResult] = useState(null) // { ok, models?, error? }
  const [customTesting, setCustomTesting] = useState(false)
  const [customHelpOpen, setCustomHelpOpen] = useState(false)
  const [customHelpTool, setCustomHelpTool] = useState('lmstudio')

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err) => addToast(err.message, 'error'))
      .finally(() => setLoading(false))

    if (isElectron) {
      loadElectronKeys()
      // Load meeting auto-record setting
      window.electronAPI?.getMeetingAutoRecord?.().then((v) => setMeetingAutoRecord(!!v))
      window.electronAPI?.getMeetBrowser?.().then((v) => setMeetBrowser(v || 'brave'))
      window.electronAPI?.storeGet?.('exportAudioPath').then((v) => setExportAudioPath(v || ''))
      window.electronAPI?.storeGet?.('exportInfographicPath').then((v) => setExportInfographicPath(v || ''))
      window.electronAPI?.getInfo?.().then((info) => setAppVersion(info?.version || ''))
    }

    // Check local services status
    getLocalStatus().then((s) => {
      setLocalStatus(s)
      if (s.downloads) setDownloads(s.downloads)
    }).catch(() => {})
  }, [addToast])

  // Poll downloads progress when active
  useEffect(() => {
    const hasActive = Object.values(downloads).some(d => d.status === 'downloading' || d.status === 'pulling' || d.status === 'starting' || d.status === 'extracting')
    if (!hasActive) return
    const timer = setInterval(async () => {
      try {
        const dl = await getDownloadStatus()
        setDownloads(dl)
        // If all done, refresh local status
        const stillActive = Object.values(dl).some(d => d.status === 'downloading' || d.status === 'pulling' || d.status === 'starting' || d.status === 'extracting')
        if (!stillActive) {
          const s = await getLocalStatus(true)
          setLocalStatus(s)
        }
      } catch {}
    }, 1500)
    return () => clearInterval(timer)
  }, [downloads])

  const loadElectronKeys = async () => {
    const keys = {}
    for (const [, envName] of Object.entries(API_KEY_ENV_NAMES)) {
      const val = await window.electronAPI.storeGet(envName)
      keys[envName] = val || ''
    }
    setApiKeys(keys)
  }

  const globalSetTierInfo = useAppStore((s) => s.setTierInfo)
  const handleSave = async (key, value) => {
    setSaving(true)
    try {
      const updated = await updateSettings({ [key]: value })
      setSettings((s) => ({ ...s, ...updated }))
      addToast('設定を更新しました', 'success')
      // Refresh tier info so provider list updates when custom endpoint / ollama model is changed
      if (key.startsWith('custom_endpoint_') || key === 'ollama_model' || key === 'local_ollama_url') {
        getTierInfo().then(globalSetTierInfo).catch(() => {})
      }
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveApiKey = async (envName) => {
    try {
      await window.electronAPI.storeSet(envName, apiKeys[envName])
      try {
        await updateApiKeys({ [envName]: apiKeys[envName] })
      } catch (e) {
        console.warn('Failed to sync API key to server:', e)
      }
      setKeyDirty((d) => ({ ...d, [envName]: false }))
      addToast(`${envName} を保存しました（即時反映）`, 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const refreshLocalStatus = async () => {
    setCheckingLocal(true)
    try {
      const status = await getLocalStatus(true)
      setLocalStatus(status)
    } catch {} finally {
      setCheckingLocal(false)
    }
  }

  if (loading) return <div className="p-6 text-gray-400">読み込み中...</div>
  if (!settings) return <div className="p-6 text-gray-400">設定を読み込めませんでした</div>

  const selectedEngine = settings.default_transcription_engine || 'deepgram'
  const selectedProvider = settings.default_summary_provider || 'openai'
  const selectedAskProvider = settings.default_ask_provider || selectedProvider
  const selectedAskModel = settings.default_ask_model || settings.default_summary_model || 'gpt-5.4-mini'

  const { providers: summaryProviders, models: summaryModels } = getAvailableModels(tierInfo, 'summary')
  const { providers: askProviders, models: askModels } = getAvailableModels(tierInfo, 'ask')

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-bold text-white mb-5">設定</h1>

      {/* Processing Mode Toggle */}
      <ProcessingModeSection addToast={addToast} />

      {/* Local Services Status */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">ローカルサービス</h2>
          <button
            onClick={refreshLocalStatus}
            disabled={checkingLocal}
            className="text-xs text-blue-500 hover:text-blue-400 disabled:text-gray-400"
          >
            {checkingLocal ? '確認中...' : '再確認'}
          </button>
        </div>
        <div className="bg-card border border-theme rounded-lg p-4 space-y-4">
          {/* whisper.cpp */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot ok={localStatus?.whisperCpp?.installed} />
                <span className="text-sm text-gray-300">whisper.cpp (ローカル文字起こし)</span>
              </div>
              {localStatus?.whisperCpp?.installed ? (
                <span className="text-xs text-green-400">
                  インストール済み / {localStatus.whisperCpp.models?.length || 0}モデル
                </span>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await setupWhisperCpp()
                      setDownloads(d => ({ ...d, 'whisper-cpp-binary': { status: 'downloading', progress: 0 } }))
                      addToast('whisper.cpp のダウンロードを開始しました。完了までしばらくお待ちください...', 'success')
                      // Poll until installed
                      const pollSetup = setInterval(async () => {
                        try {
                          const status = await getLocalStatus(true)
                          setLocalStatus(status)
                          if (status?.whisperCpp?.installed) {
                            clearInterval(pollSetup)
                            setDownloads(d => { const n = { ...d }; delete n['whisper-cpp-binary']; return n })
                            addToast('✅ whisper.cpp のセットアップが完了しました！モデルをダウンロードしてください。', 'success')
                          }
                        } catch {}
                      }, 3000)
                      // Stop polling after 5 min
                      setTimeout(() => clearInterval(pollSetup), 300000)
                    } catch (err) {
                      addToast(err.message, 'error')
                    }
                  }}
                  disabled={downloads['whisper-cpp-binary']?.status === 'downloading'}
                  className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white px-3 py-1 rounded"
                >
                  {downloads['whisper-cpp-binary']?.status === 'downloading'
                    ? `DL中 ${Math.round((downloads['whisper-cpp-binary']?.progress || 0) * 100)}%`
                    : 'セットアップ'}
                </button>
              )}
            </div>

            {/* Model download buttons */}
            {localStatus?.whisperCpp?.installed && (
              <div className="mt-2 ml-4 space-y-1">
                {(localStatus.whisperCpp.availableModels || []).map((m) => {
                  const isInstalled = localStatus.whisperCpp.models?.some(im => im.name === m.name)
                  const dlKey = `whisper-model-${m.name}`
                  const dlStatus = downloads[dlKey]
                  return (
                    <div key={m.name} className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">
                        {m.name} ({m.size})
                      </span>
                      {isInstalled ? (
                        <span className="text-green-500">DL済み</span>
                      ) : dlStatus?.status === 'downloading' ? (
                        <span className="text-blue-400">
                          DL中 {Math.round((dlStatus.progress || 0) * 100)}%
                        </span>
                      ) : (
                        <button
                          onClick={async () => {
                            try {
                              await downloadWhisperModel(m.name)
                              setDownloads(d => ({ ...d, [dlKey]: { status: 'downloading', progress: 0 } }))
                            } catch (err) {
                              addToast(err.message, 'error')
                            }
                          }}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          ダウンロード
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-t border-theme" />

          {/* Ollama */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot ok={localStatus?.ollama?.available} />
                <span className="text-sm text-gray-300">Ollama (ローカルLLM)</span>
              </div>
              {localStatus?.ollama?.available ? (
                <span className="text-xs text-green-400">
                  v{localStatus.ollama.version} / {localStatus.ollama.models?.length || 0}モデル
                </span>
              ) : (
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  インストール →
                </a>
              )}
            </div>

            {/* Ollama model pull + default model selection */}
            {localStatus?.ollama?.available && (
              <div className="mt-2 ml-4">
                {/* Default Ollama model selector */}
                {localStatus.ollama.models?.length > 0 && (
                  <div className="mb-3">
                    <label className="block text-xs text-gray-400 mb-1">デフォルトモデル</label>
                    <select
                      value={settings.ollama_model ? JSON.parse(settings.ollama_model) : ''}
                      onChange={(e) => handleSave('ollama_model', e.target.value)}
                      className="bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white w-full focus:outline-none focus:border-blue-500"
                    >
                      <option value="">未選択</option>
                      {localStatus.ollama.models.map((m) => (
                        <option key={m.name} value={m.name}>{m.name}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1">オフラインモード時の要約・AI質問に使用されます</p>
                  </div>
                )}
                {localStatus.ollama.models?.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {localStatus.ollama.models.map((m) => (
                      <div key={m.name} className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">{m.name}</span>
                        <span className="text-green-500">利用可能</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={ollamaPullModel}
                    onChange={(e) => setOllamaPullModel(e.target.value)}
                    placeholder="モデル名 (例: llama3.2, gemma3)"
                    className="flex-1 bg-input border border-theme-light rounded px-2 py-1 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={async () => {
                      if (!ollamaPullModel.trim()) return
                      try {
                        await pullOllamaModel(ollamaPullModel.trim())
                        const dlKey = `ollama-${ollamaPullModel.trim()}`
                        setDownloads(d => ({ ...d, [dlKey]: { status: 'pulling', progress: 0 } }))
                        addToast(`${ollamaPullModel} のダウンロードを開始しました`, 'success')
                        setOllamaPullModel('')
                      } catch (err) {
                        addToast(err.message, 'error')
                      }
                    }}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded shrink-0"
                  >
                    Pull
                  </button>
                </div>
                {/* Show active Ollama downloads */}
                {Object.entries(downloads).filter(([k]) => k.startsWith('ollama-')).map(([k, d]) => (
                  d.status === 'pulling' && (
                    <div key={k} className="text-xs text-blue-400 mt-1">
                      {d.model}: DL中 {Math.round((d.progress || 0) * 100)}%
                      {d.detail && ` — ${d.detail}`}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>

          {/* Custom OpenAI-compatible endpoint (LM Studio / llama.cpp / Jan / LocalAI) */}
          <div className="border-t border-theme pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <StatusDot ok={tierInfo?.availableProviders?.includes('custom')} />
                <span className="text-sm text-gray-300">カスタムエンドポイント (OpenAI互換)</span>
              </div>
              <button
                onClick={() => setCustomHelpOpen((v) => !v)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {customHelpOpen ? '× ヘルプを閉じる' : '? 接続方法のヘルプ'}
              </button>
            </div>

            {/* Help panel — tool-specific setup instructions */}
            {customHelpOpen && (
              <div className="ml-4 mb-3 bg-input/40 border border-theme-light rounded-lg p-3">
                <p className="text-xs text-gray-300 mb-2">
                  ローカルLLMツールを起動して、その接続先URLをこの画面に登録します。初めての方は <strong className="text-white">LM Studio</strong> が最も簡単です。
                </p>

                {/* Tool tabs */}
                <div className="flex gap-1 mb-3 flex-wrap">
                  {[
                    { key: 'lmstudio', label: 'LM Studio（推奨）' },
                    { key: 'llamacpp', label: 'llama.cpp' },
                    { key: 'jan', label: 'Jan' },
                    { key: 'localai', label: 'LocalAI' },
                    { key: 'koboldcpp', label: 'KoboldCpp' },
                  ].map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setCustomHelpTool(t.key)}
                      className={`text-[11px] px-2 py-1 rounded ${
                        customHelpTool === t.key
                          ? 'bg-blue-600 text-white'
                          : 'bg-theme text-gray-300 hover:bg-theme-light'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* LM Studio */}
                {customHelpTool === 'lmstudio' && (
                  <div className="text-xs text-gray-300 space-y-2 leading-relaxed">
                    <p className="font-semibold text-white">LM Studio（GUIで完結・初心者向け）</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-300">
                      <li>
                        <a href="https://lmstudio.ai/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">lmstudio.ai</a> からインストール
                      </li>
                      <li>左メニュー「Discover」で好きなモデルをDL（例: <code className="bg-base px-1 rounded">Llama 3.2 3B Instruct</code>、<code className="bg-base px-1 rounded">Qwen2.5 7B Instruct</code>）</li>
                      <li>左メニュー「Developer」→ モデルを選択 → <strong>「Start Server」</strong>ボタンを押す</li>
                      <li>画面に表示されるURLをこの下の「ベースURL」に貼り付け（通常は <code className="bg-base px-1 rounded">http://localhost:1234</code>）</li>
                      <li>「モデル名」はLM Studioの画面上部に表示されているモデルID（例: <code className="bg-base px-1 rounded">llama-3.2-3b-instruct</code>）をコピペ</li>
                      <li>「疎通テスト」ボタンを押して緑の✓が出ればOK</li>
                    </ol>
                    <p className="text-gray-400 text-[10px] mt-2">⚠ LM Studioのサーバーを停止するとVoiceScopeからも使えなくなります。使用中は起動したまま。</p>
                  </div>
                )}

                {/* llama.cpp */}
                {customHelpTool === 'llamacpp' && (
                  <div className="text-xs text-gray-300 space-y-2 leading-relaxed">
                    <p className="font-semibold text-white">llama.cpp（軽量・コマンドライン）</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-300">
                      <li>
                        <a href="https://github.com/ggerganov/llama.cpp/releases" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">llama.cpp releases</a> からビルド済みバイナリをDL
                      </li>
                      <li>HuggingFaceなどからGGUF形式のモデルファイルをDL（例: <code className="bg-base px-1 rounded">llama-3.2-3b-instruct-q4_k_m.gguf</code>）</li>
                      <li>コマンドプロンプトで以下を実行:
                        <pre className="bg-base border border-theme-light rounded px-2 py-1.5 mt-1 overflow-x-auto text-[10px] whitespace-pre">llama-server -m model.gguf --port 8080</pre>
                      </li>
                      <li>ベースURLに <code className="bg-base px-1 rounded">http://localhost:8080</code></li>
                      <li>モデル名は任意（llama.cppは1サーバー1モデル運用なので何でも良い）</li>
                    </ol>
                    <p className="text-gray-400 text-[10px] mt-2">💡 上級者向け。GPU（CUDA/Metal）版を使うと速い。</p>
                  </div>
                )}

                {/* Jan */}
                {customHelpTool === 'jan' && (
                  <div className="text-xs text-gray-300 space-y-2 leading-relaxed">
                    <p className="font-semibold text-white">Jan（オープンソース・プライバシー重視）</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-300">
                      <li>
                        <a href="https://jan.ai/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">jan.ai</a> からインストール
                      </li>
                      <li>Hub（ハブ）から好きなモデルをDL</li>
                      <li>Settings → <strong>Local API Server</strong> → Enable をオン</li>
                      <li>ベースURLに <code className="bg-base px-1 rounded">http://localhost:1337</code></li>
                      <li>モデル名はJan上のモデルID（Hubの各モデルページで確認可）</li>
                    </ol>
                  </div>
                )}

                {/* LocalAI */}
                {customHelpTool === 'localai' && (
                  <div className="text-xs text-gray-300 space-y-2 leading-relaxed">
                    <p className="font-semibold text-white">LocalAI（Docker / サーバー向け）</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-300">
                      <li>Docker をインストール</li>
                      <li>以下を実行:
                        <pre className="bg-base border border-theme-light rounded px-2 py-1.5 mt-1 overflow-x-auto text-[10px] whitespace-pre">docker run -p 8080:8080 localai/localai:latest</pre>
                      </li>
                      <li>ブラウザで <code className="bg-base px-1 rounded">http://localhost:8080</code> を開いてモデルをインストール</li>
                      <li>ベースURLに <code className="bg-base px-1 rounded">http://localhost:8080</code></li>
                      <li>モデル名はLocalAIのモデル名（インストール時に決まる）</li>
                    </ol>
                    <p className="text-gray-400 text-[10px] mt-2">💡 上級者向け。LAN内サーバーで運用する場合に便利。</p>
                  </div>
                )}

                {/* KoboldCpp */}
                {customHelpTool === 'koboldcpp' && (
                  <div className="text-xs text-gray-300 space-y-2 leading-relaxed">
                    <p className="font-semibold text-white">KoboldCpp（創作・チャット系）</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-300">
                      <li>
                        <a href="https://github.com/LostRuins/koboldcpp/releases" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">KoboldCpp releases</a> から実行ファイルをDL
                      </li>
                      <li>GGUF形式のモデルをDL（HuggingFaceなど）</li>
                      <li>KoboldCppを起動 → モデルファイルを選択 → Launch</li>
                      <li>ベースURLに <code className="bg-base px-1 rounded">http://localhost:5001</code></li>
                      <li>OpenAI互換APIは <code className="bg-base px-1 rounded">/v1</code> エンドポイントで提供される</li>
                    </ol>
                  </div>
                )}

                <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-theme-light">
                  🔒 セキュリティ: 本アプリは <strong>localhost または LAN 内（10.x / 172.16-31.x / 192.168.x）</strong> のアドレスのみ許可します。外部サーバーには接続できません。
                </p>
              </div>
            )}

            <div className="ml-4 space-y-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  ベースURL
                  {!settings?.custom_endpoint_url && !customHelpOpen && (
                    <button
                      onClick={() => setCustomHelpOpen(true)}
                      className="ml-2 text-blue-400 hover:text-blue-300 text-[10px]"
                    >
                      ← 初めての方は「接続方法のヘルプ」をクリック
                    </button>
                  )}
                </label>
                <input
                  value={settings?.custom_endpoint_url || ''}
                  onChange={(e) => handleSave('custom_endpoint_url', e.target.value)}
                  placeholder="例: http://localhost:1234"
                  className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  LM Studio → <code className="bg-base px-1 rounded">http://localhost:1234</code> / llama.cpp → <code className="bg-base px-1 rounded">http://localhost:8080</code> / Jan → <code className="bg-base px-1 rounded">http://localhost:1337</code>
                </p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">モデル名</label>
                <input
                  value={settings?.custom_endpoint_model || ''}
                  onChange={(e) => handleSave('custom_endpoint_model', e.target.value)}
                  placeholder="例: llama-3-8b-instruct, qwen2.5-7b"
                  className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">APIキー（任意）</label>
                <input
                  type="password"
                  value={settings?.custom_endpoint_api_key || ''}
                  onChange={(e) => handleSave('custom_endpoint_api_key', e.target.value)}
                  placeholder="多くのローカルサーバでは不要"
                  className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setCustomTesting(true)
                    setCustomTestResult(null)
                    try {
                      const r = await testCustomEndpoint(settings?.custom_endpoint_url)
                      setCustomTestResult(r)
                      if (r.ok) addToast(`疎通成功: ${r.models?.length || 0}モデル検出`, 'success')
                      else addToast(`疎通失敗: ${r.error}`, 'error')
                    } catch (err) {
                      setCustomTestResult({ ok: false, error: err.message })
                      addToast(err.message, 'error')
                    } finally {
                      setCustomTesting(false)
                    }
                  }}
                  disabled={customTesting || !settings?.custom_endpoint_url}
                  className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white px-3 py-1 rounded"
                >
                  {customTesting ? '確認中...' : '疎通テスト'}
                </button>
                {customTestResult?.ok && (
                  <span className="text-xs text-green-400">
                    ✓ {customTestResult.models?.length || 0}モデル利用可能
                  </span>
                )}
                {customTestResult?.ok === false && (
                  <span className="text-xs text-red-400">✗ {customTestResult.error}</span>
                )}
              </div>
              {customTestResult?.ok && customTestResult.models?.length > 0 && (
                <div className="bg-input/50 rounded px-2 py-1.5 text-[10px] text-gray-400 max-h-20 overflow-y-auto">
                  {customTestResult.models.join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* faster-whisper (advanced) */}
          <div className="border-t border-theme pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot ok={localStatus?.fasterWhisper?.available} />
                <span className="text-xs text-gray-400">faster-whisper (上級者向け)</span>
              </div>
              {localStatus?.fasterWhisper?.available ? (
                <span className="text-xs text-green-400">
                  v{localStatus.fasterWhisper.version}
                  {localStatus.fasterWhisper.gpu && ' (GPU)'}
                </span>
              ) : (
                <span className="text-xs text-gray-400">Python + pip install faster-whisper</span>
              )}
            </div>
          </div>

          {!localStatus && (
            <p className="text-xs text-gray-400">ステータス確認中...</p>
          )}
        </div>
      </section>

      {/* API Key Status / Editor */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-white mb-3">APIキー（クラウドモード）</h2>
        {canEditKeys(tierInfo) ? (
          <>
            <p className="text-xs text-gray-400 mb-3">クラウドエンジン使用時に必要です。ローカルモードでは不要。</p>
            <div className="bg-card border border-theme rounded-lg p-4 space-y-4">
              {Object.entries(API_KEY_LABELS).map(([key, label]) => {
                const envName = API_KEY_ENV_NAMES[key]
                const source = settings.api_keys?.[key] // false | 'store' | 'env'
                const configured = !!source
                const fromEnv = source === 'env'
                return (
                  <div key={key}>
                    <label className="flex items-center gap-2 text-sm text-gray-300 mb-1">
                      {label}
                      {configured && !fromEnv && (
                        <span className="text-xs bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded">
                          設定済み
                        </span>
                      )}
                      {fromEnv && (
                        <span
                          className="text-xs bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded"
                          title="PCの環境変数から自動検出されました"
                        >
                          環境変数から自動検出
                        </span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={apiKeys[envName] || ''}
                        onChange={(e) => {
                          setApiKeys((k) => ({ ...k, [envName]: e.target.value }))
                          setKeyDirty((d) => ({ ...d, [envName]: true }))
                        }}
                        placeholder={
                          fromEnv
                            ? '環境変数から自動検出（上書きする場合のみ入力）'
                            : configured ? '●●●●●●●● (設定済み)' : '未設定'
                        }
                        className="flex-1 bg-input border border-theme-light rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        autoComplete="off"
                        data-form-type="other"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        name={`api-key-${envName}-${Math.random().toString(36).slice(2, 8)}`}
                      />
                      {keyDirty[envName] && (
                        <button
                          onClick={() => handleSaveApiKey(envName)}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm shrink-0"
                        >
                          保存
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-3">APIキーは .env ファイルで管理します。ローカルモードでは不要。</p>
            <div className="bg-card border border-theme rounded-lg divide-y divide-gray-800">
              {Object.entries(settings.api_keys || {}).map(([key, source]) => {
                const configured = !!source
                const fromEnv = source === 'env'
                const badgeClass = fromEnv
                  ? 'bg-blue-900/50 text-blue-400'
                  : configured ? 'bg-green-900/50 text-green-400' : 'bg-input text-gray-400'
                const label = fromEnv ? '環境変数から自動検出' : configured ? '設定済み' : '未設定'
                return (
                  <div key={key} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-300">{API_KEY_LABELS[key] || key}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${badgeClass}`}>{label}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>

      {/* Default Transcription Engine */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-white mb-3">文字起こし</h2>
        <div className="bg-card border border-theme rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルトエンジン</label>
            <select
              value={selectedEngine}
              onChange={(e) => handleSave('default_transcription_engine', e.target.value)}
              className="bg-input border border-theme-light rounded px-3 py-2 text-sm text-white w-full"
            >
              <optgroup label="クラウド">
                <option value="deepgram">Deepgram (Nova-2) — 実績あり</option>
                <option value="grok-stt">⚡ Grok STT — 新・低価格（$0.10/時）</option>
                <option value="whisper">OpenAI Whisper</option>
              </optgroup>
              <optgroup label="ローカル">
                <option value="whisper-cpp"
                  disabled={localStatus && !localStatus.whisperCpp?.installed}
                >
                  whisper.cpp (ローカル・おすすめ)
                  {localStatus && !localStatus.whisperCpp?.installed ? ' — 未セットアップ' : ''}
                </option>
                <option value="faster-whisper"
                  disabled={localStatus && !localStatus.fasterWhisper?.available}
                >
                  faster-whisper (ローカル・上級者)
                  {localStatus && !localStatus.fasterWhisper?.available ? ' — 未インストール' : ''}
                </option>
              </optgroup>
            </select>
            {selectedEngine === 'grok-stt' && (
              <div className="mt-2 bg-yellow-900/20 border border-yellow-700/40 rounded px-2 py-1.5 text-[11px] text-gray-300 leading-relaxed">
                ⚠ <strong className="text-white">Grok STT は新サービス（2026年4月リリース）</strong>です。
                Deepgramより安価（$0.10/時）ですが、日本語の実地評価はまだ十分ではありません。
                比較のため、同じ録音を録音詳細画面の「再文字起こし」から別エンジンで再実行できます。
                xAI の <code className="bg-base px-1 rounded">GROK_API_KEY</code> が必要です（Grok LLM と同じキーを使えます）。
              </div>
            )}
          </div>

          {/* Local whisper model settings */}
          {(selectedEngine === 'whisper-cpp' || selectedEngine === 'faster-whisper') && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Whisperモデルサイズ</label>
              <select
                value={settings.local_whisper_model || 'base'}
                onChange={(e) => handleSave('local_whisper_model', e.target.value)}
                className="bg-input border border-theme-light rounded px-3 py-2 text-sm text-white w-full"
              >
                {WHISPER_MODELS.map((m) => {
                  const installed = localStatus?.whisperCpp?.models?.some(im => im.name === m.value)
                  return (
                    <option key={m.value} value={m.value}>
                      {m.label} — RAM: {m.ram}
                      {installed ? ' ✓ DL済み' : ' (未DL)'}
                    </option>
                  )
                })}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                未DLのモデルを選んだ場合、文字起こし時に自動で「DL済みの中から最も大きい（精度の高い）モデル」にフォールバックします。
                先に下の「whisper.cpp」セクションで使いたいサイズをDLしておくのが確実です。
              </p>
              <p className="text-xs text-amber-400/80 mt-1">
                ⚠ webm / mp3 / m4a 等の音声を扱うには <code className="bg-base px-1 rounded">ffmpeg</code> が PATH に必要です（自動でwav変換するため）。
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルト言語</label>
            <select
              value={settings.default_language || 'auto'}
              onChange={(e) => handleSave('default_language', e.target.value)}
              className="bg-input border border-theme-light rounded px-3 py-2 text-sm text-white w-full"
            >
              <option value="auto">自動検出</option>
              <option value="ja">日本語</option>
              <option value="en">英語</option>
              <option value="zh">中国語</option>
              <option value="ko">韓国語</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={settings.diarization_enabled === 'true' || settings.diarization_enabled === true}
              onChange={(e) => handleSave('diarization_enabled', e.target.checked ? 'true' : 'false')}
              className="rounded"
            />
            話者分離を有効にする（Deepgramのみ）
          </label>

          {/* 整形（自動リファイン）セクション */}
          <div className="border-t border-theme pt-3 mt-2 space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={settings.auto_refine_transcription !== false && settings.auto_refine_transcription !== 'false'}
                onChange={(e) => handleSave('auto_refine_transcription', e.target.checked)}
                className="rounded"
              />
              文字起こし自動整形（誤字修正・フィラー除去）
            </label>
            <p className="text-[11px] text-gray-400 ml-6">
              ONにすると、文字起こし後に LLM で整形します（「えーと」の除去、誤変換修正など）。
            </p>

            {settings.auto_refine_transcription !== false && settings.auto_refine_transcription !== 'false' && (
              <div className="ml-6 space-y-2">
                <label className="block text-xs text-gray-400">整形に使うモデル</label>
                <select
                  value={settings.refine_preference || 'auto'}
                  onChange={(e) => handleSave('refine_preference', e.target.value)}
                  className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="auto">自動（推奨・コストと精度のバランス）</option>
                  <optgroup label="OpenAI">
                    <option value="openai:gpt-5-nano">gpt-5-nano（最安）</option>
                    <option value="openai:gpt-5.4-mini">gpt-5.4-mini（推奨）</option>
                  </optgroup>
                  <optgroup label="Google Gemini">
                    <option value="gemini:gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
                    <option value="gemini:gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite</option>
                  </optgroup>
                  <optgroup label="xAI Grok">
                    <option value="grok:grok-4.3">Grok 4.3</option>
                  </optgroup>
                  <optgroup label="Anthropic Claude">
                    <option value="claude:claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                  </optgroup>
                  <optgroup label="ローカル">
                    <option value="ollama:__default__">Ollama（設定したモデル）</option>
                    <option value="custom:__default__">カスタムエンドポイント</option>
                  </optgroup>
                </select>
                <div className="bg-blue-900/20 border border-blue-700/40 rounded px-2 py-1.5 text-[11px] text-gray-300 leading-relaxed">
                  <strong className="text-white">自動設定</strong>:
                  利用可能なAPIキーから低コスト寄りの現行モデルを選びます。
                  APIエラー時はローカルLLM（Ollama/カスタム）に自動フォールバックします。
                  ローカルLLM未設定時はエラー通知してスキップ。
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Custom Keywords (Deepgram) */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-white mb-3">カスタム辞書</h2>
        <div className="bg-card border border-theme rounded-lg p-4 space-y-3">
          <p className="text-xs text-gray-400">
            固有名詞や専門用語を登録すると文字起こし精度が向上します（Deepgramのみ有効）
          </p>
          <textarea
            value={settings.custom_keywords || ''}
            onChange={(e) => setSettings((s) => ({ ...s, custom_keywords: e.target.value }))}
            onBlur={(e) => handleSave('custom_keywords', e.target.value)}
            placeholder="1行に1単語ずつ入力&#10;例:&#10;VoiceScope&#10;コミュニティ&#10;配信者"
            rows={5}
            className="w-full bg-input border border-theme-light rounded px-3 py-2 text-sm text-white resize-y"
          />
          <p className="text-xs text-gray-400">
            {(settings.custom_keywords || '').split('\n').filter(w => w.trim()).length} 件登録済み
          </p>
        </div>
      </section>

      {/* Default Summary LLM */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-white mb-3">要約</h2>
        <div className="bg-card border border-theme rounded-lg p-4 space-y-4">
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div>
              <span className="text-sm text-gray-300">アップロード後に自動要約する</span>
              <p className="text-xs text-gray-400 mt-0.5">
                OFFにすると、録音やテキストを取り込んだ後は文字起こしまで行い、要約は詳細画面から手動生成します。
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.auto_summarize_uploads !== false && settings.auto_summarize_uploads !== 'false'}
              onChange={(e) => handleSave('auto_summarize_uploads', e.target.checked)}
              className="mt-1 rounded"
            />
          </label>

          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルトLLM</label>
            <select
              value={selectedProvider}
              onChange={(e) => {
                const newProvider = e.target.value
                const defaultModel = getDefaultModel(summaryModels, newProvider)
                handleSave('default_summary_provider', newProvider)
                if (newProvider !== 'ollama') {
                  handleSave('default_summary_model', defaultModel)
                  setSettings(s => ({ ...s, default_summary_provider: newProvider, default_summary_model: defaultModel }))
                } else {
                  setSettings(s => ({ ...s, default_summary_provider: newProvider }))
                }
              }}
              className="bg-input border border-theme-light rounded px-3 py-2 text-sm text-white w-full"
            >
              <optgroup label="クラウド">
                {summaryProviders.filter(p => p !== 'ollama' && (summaryModels[p] || []).length > 0).map(p => (
                  <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
                ))}
              </optgroup>
              <optgroup label="ローカル">
                <option value="ollama"
                  disabled={localStatus && !localStatus.ollama?.available}
                >
                  Ollama (ローカル)
                  {localStatus && !localStatus.ollama?.available ? ' — 未起動' : ''}
                </option>
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルトモデル</label>
            {selectedProvider === 'ollama' ? (
              <>
                <select
                  value={settings.default_summary_model || ''}
                  onChange={(e) => handleSave('default_summary_model', e.target.value)}
                  className="bg-input border border-theme-light rounded px-3 py-2 text-sm text-white w-full"
                >
                  {localStatus?.ollama?.models?.length > 0 ? (
                    localStatus.ollama.models.map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))
                  ) : (
                    <option value="">モデルが見つかりません</option>
                  )}
                </select>
                {(!localStatus?.ollama?.models?.length) && (
                  <p className="text-xs text-yellow-500 mt-1">
                    Ollamaでモデルをダウンロードしてください: ollama pull llama3.2
                  </p>
                )}
              </>
            ) : (
              <select
                value={settings.default_summary_model || ''}
                onChange={(e) => {
                  const newModel = e.target.value
                  handleSave('default_summary_model', newModel)
                }}
                className="bg-input border border-theme-light rounded px-3 py-2 text-sm text-white w-full"
              >
                {(summaryModels[selectedProvider] || []).map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </section>

      {/* AI Ask LLM */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-white mb-3">AI質問</h2>
        <div className="bg-card border border-theme rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルトLLM</label>
            <select
              value={selectedAskProvider}
              onChange={(e) => {
                const newProvider = e.target.value
                const defaultModel = getDefaultModel(askModels, newProvider)
                handleSave('default_ask_provider', newProvider)
                if (newProvider !== 'ollama') {
                  handleSave('default_ask_model', defaultModel)
                  setSettings(s => ({ ...s, default_ask_provider: newProvider, default_ask_model: defaultModel }))
                } else {
                  setSettings(s => ({ ...s, default_ask_provider: newProvider }))
                }
              }}
              className="bg-input border border-theme-light rounded px-3 py-2 text-sm text-white w-full"
            >
              <optgroup label="クラウド">
                {askProviders.filter(p => p !== 'ollama' && (askModels[p] || []).length > 0).map(p => (
                  <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
                ))}
              </optgroup>
              <optgroup label="ローカル">
                <option value="ollama"
                  disabled={localStatus && !localStatus.ollama?.available}
                >
                  Ollama (ローカル)
                  {localStatus && !localStatus.ollama?.available ? ' — 未起動' : ''}
                </option>
              </optgroup>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルトモデル</label>
            {selectedAskProvider === 'ollama' ? (
              <select
                value={selectedAskModel}
                onChange={(e) => handleSave('default_ask_model', e.target.value)}
                className="bg-input border border-theme-light rounded px-3 py-2 text-sm text-white w-full"
              >
                {localStatus?.ollama?.models?.length > 0 ? (
                  localStatus.ollama.models.map((m) => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))
                ) : (
                  <option value="">モデルが見つかりません</option>
                )}
              </select>
            ) : (
              <select
                value={selectedAskModel}
                onChange={(e) => {
                  const newModel = e.target.value
                  handleSave('default_ask_model', newModel)
                }}
                className="bg-input border border-theme-light rounded px-3 py-2 text-sm text-white w-full"
              >
                {(askModels[selectedAskProvider] || []).map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            )}
          </div>
          <p className="text-xs text-gray-400">録音の詳細画面「AI質問」タブで使用するモデルです。質問時に都度変更も可能です。</p>
        </div>
      </section>

      {/* Meeting Auto-Record (Electron only) */}
      {isElectron && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-white mb-3">会議アプリ検知</h2>
          <div className="bg-card border border-theme rounded-lg p-4 space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-sm text-gray-300">会議アプリ検知 → 録音確認ポップアップ</span>
                <p className="text-xs text-gray-400 mt-0.5">
                  Zoom / Teams / Webex / Google Meet / Discord (Voice) を検知すると録音開始を提案します
                </p>
              </div>
              <div
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  meetingAutoRecord ? 'bg-blue-600' : 'bg-gray-700'
                }`}
                onClick={async () => {
                  const next = !meetingAutoRecord
                  setMeetingAutoRecord(next)
                  try {
                    await window.electronAPI.setMeetingAutoRecord(next)
                    addToast(next ? '会議アプリ検知を有効にしました' : '会議アプリ検知を無効にしました', 'success')
                  } catch (err) {
                    setMeetingAutoRecord(!next) // revert
                    addToast(err.message, 'error')
                  }
                }}
              >
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  meetingAutoRecord ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </div>
            </label>
            {meetingAutoRecord && (
              <>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-400 whitespace-nowrap">Google Meet 検知ブラウザ:</label>
                  <select
                    value={meetBrowser}
                    onChange={async (e) => {
                      const val = e.target.value
                      setMeetBrowser(val)
                      try {
                        await window.electronAPI.setMeetBrowser(val)
                      } catch {}
                    }}
                    className="bg-input border border-theme rounded px-2 py-1 text-xs text-gray-300"
                  >
                    <option value="brave">Brave</option>
                    <option value="chrome">Chrome</option>
                    <option value="edge">Edge</option>
                    <option value="firefox">Firefox</option>
                    <option value="none">検知しない</option>
                  </select>
                </div>
                <p className="text-xs text-blue-400">
                  🔍 バックグラウンドで30秒ごとにプロセスを監視しています
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {/* Audio Export Path (Electron only) */}
      {isElectron && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-white mb-3">音声エクスポート</h2>
          <div className="bg-card border border-theme rounded-lg p-4 space-y-3">
            <p className="text-xs text-gray-400">
              録音ファイルのコピーを指定フォルダに自動保存します（元ファイルはアプリ内に保持）
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={exportAudioPath}
                placeholder="未設定"
                className="flex-1 bg-input border border-theme rounded px-3 py-1.5 text-sm text-gray-300 cursor-default"
              />
              <button
                onClick={async () => {
                  try {
                    const selected = await window.electronAPI.openDirectoryDialog()
                    if (selected) {
                      setExportAudioPath(selected)
                      await window.electronAPI.storeSet('exportAudioPath', selected)
                      await updateApiKeys({ EXPORT_AUDIO_PATH: selected })
                      addToast('エクスポート先を設定しました', 'success')
                    }
                  } catch (err) {
                    addToast(err.message, 'error')
                  }
                }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
              >
                参照
              </button>
              {exportAudioPath && (
                <button
                  onClick={async () => {
                    setExportAudioPath('')
                    await window.electronAPI.storeSet('exportAudioPath', '')
                    await updateApiKeys({ EXPORT_AUDIO_PATH: '' })
                    addToast('エクスポート先をクリアしました', 'success')
                  }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
                >
                  クリア
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Infographic Export Path (Electron only) — same pattern as audio export.
          Generated infographics are still kept inside the app's data folder
          for the gallery, but a copy is also dropped into this folder for
          quick external use (drag into Slack, post to SNS, etc). */}
      {isElectron && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-white mb-3">🎨 画像エクスポート</h2>
          <div className="bg-card border border-theme rounded-lg p-4 space-y-3">
            <p className="text-xs text-gray-400">
              生成したインフォグラフィック画像のコピーを指定フォルダに自動保存します。
              元ファイルはアプリ内に保持されます。
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={exportInfographicPath}
                placeholder="未設定"
                className="flex-1 bg-input border border-theme rounded px-3 py-1.5 text-sm text-gray-300 cursor-default"
              />
              <button
                onClick={async () => {
                  try {
                    const selected = await window.electronAPI.openDirectoryDialog()
                    if (selected) {
                      setExportInfographicPath(selected)
                      await window.electronAPI.storeSet('exportInfographicPath', selected)
                      await updateApiKeys({ EXPORT_INFOGRAPHIC_PATH: selected })
                      addToast('画像エクスポート先を設定しました', 'success')
                    }
                  } catch (err) {
                    addToast(err.message, 'error')
                  }
                }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
              >
                参照
              </button>
              {exportInfographicPath && (
                <button
                  onClick={async () => {
                    setExportInfographicPath('')
                    await window.electronAPI.storeSet('exportInfographicPath', '')
                    await updateApiKeys({ EXPORT_INFOGRAPHIC_PATH: '' })
                    addToast('画像エクスポート先をクリアしました', 'success')
                  }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors"
                >
                  クリア
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-500">
              ファイル名: <code className="bg-base px-1 rounded">{'{録音ID}_{スタイル}_{比率}_{品質}_ig{N}_{枚数}.png'}</code>
            </p>
          </div>
        </section>
      )}

      {/* Folder auto-assign is now configured via the gear icon on each folder in the sidebar */}

      {/* Storage Management */}
      {/* Subscription */}
      <SubscriptionSection addToast={addToast} />

      {/* Trash / retention settings */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-white mb-3">ゴミ箱</h2>
        <div className="bg-card border border-theme rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-2">
              自動削除までの日数: <strong className="text-white">{Number(settings?.trash_retention_days) || 14}日</strong>
            </label>
            <input
              type="range"
              min="1"
              max="30"
              step="1"
              value={Number(settings?.trash_retention_days) || 14}
              onChange={(e) => handleSave('trash_retention_days', Number(e.target.value))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>1日</span>
              <span>15日</span>
              <span>30日</span>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              ゴミ箱に入れた録音は、この日数を過ぎるとサーバ起動時に自動で削除されます。
              長期間アプリを起動しなかった場合は、次回起動時に期限切れのものがまとめて削除されます。
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-2">削除モード</label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="trash_delete_mode"
                  value="complete"
                  checked={(settings?.trash_delete_mode || 'complete') === 'complete'}
                  onChange={() => handleSave('trash_delete_mode', 'complete')}
                  className="mt-1 accent-blue-500"
                />
                <span>
                  <strong className="text-white">完全削除</strong>
                  <span className="block text-[11px] text-gray-400 mt-0.5">
                    音声・文字起こし・要約すべてを削除します。元に戻せません。
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="trash_delete_mode"
                  value="audio_only"
                  checked={settings?.trash_delete_mode === 'audio_only'}
                  onChange={() => handleSave('trash_delete_mode', 'audio_only')}
                  className="mt-1 accent-blue-500"
                />
                <span>
                  <strong className="text-white">音声のみ削除</strong>
                  <span className="block text-[11px] text-gray-400 mt-0.5">
                    音声ファイルだけ削除し、文字起こし・要約はアーカイブに保持します。
                    容量は節約できますが、再生はできなくなります。
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <StorageSection addToast={addToast} />

      {/* App Info (Electron only) */}
      {isElectron && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-white mb-3">アプリ情報</h2>
          <div className="bg-card border border-theme rounded-lg p-4 text-sm text-gray-400">
            {appVersion && <p>バージョン: v{appVersion}</p>}
            <p className={appVersion ? 'mt-1' : ''}>モード: デスクトップアプリ (Electron)</p>
            <p className="mt-1">ショートカット: Ctrl+Shift+F8 で録音開始/停止</p>
          </div>
        </section>
      )}
    </div>
  )
}
