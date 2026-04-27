import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../stores/appStore'
import { updateApiKeys, activateTrial, getLocalStatus, setupWhisperCpp, downloadWhisperModel, pullOllamaModel, getSettings } from '../lib/api'

const isElectron = !!window.electronAPI?.isElectron

const API_KEYS = [
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI',
    badge: 'おすすめ',
    description: '文字起こし(Whisper) + 要約 + 整形。これ1つで全機能が使えます',
    helpUrl: 'https://platform.openai.com/api-keys',
    group: 'transcription',
  },
  {
    key: 'DEEPGRAM_API_KEY',
    label: 'Deepgram',
    badge: '話者分離',
    description: '高精度な文字起こし。話者分離に対応しています',
    helpUrl: 'https://console.deepgram.com/',
    group: 'transcription',
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'Gemini (Google)',
    description: '要約生成に使用できます',
    helpUrl: 'https://aistudio.google.com/apikey',
    group: 'summary',
  },
  {
    key: 'GROK_API_KEY',
    label: 'Grok (xAI)',
    description: '要約生成に使用できます',
    helpUrl: 'https://console.x.ai/',
    group: 'summary',
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Claude (Anthropic)',
    description: '要約生成に使用できます',
    helpUrl: 'https://console.anthropic.com/',
    group: 'summary',
  },
]

export default function SetupWizard({ onComplete }) {
  const [keys, setKeys] = useState({})
  const [checking, setChecking] = useState(true)
  const [visible, setVisible] = useState(false)
  const [envDetectedKeys, setEnvDetectedKeys] = useState([]) // list of api keys auto-detected from env
  const [saving, setSaving] = useState(false)
  const [localMode, setLocalMode] = useState(false)
  const [localStatus, setLocalStatus] = useState(null)
  const [localLoading, setLocalLoading] = useState(false)
  const [downloads, setDownloads] = useState({})
  const [ollamaPullModel, setOllamaPullModel] = useState('')
  const addToast = useAppStore((s) => s.addToast)

  // Check if setup is needed
  useEffect(() => {
    if (!isElectron) {
      setChecking(false)
      return
    }
    const checkKeys = async () => {
      // Check electron-store for user-entered keys
      const checks = await Promise.all(
        API_KEYS.map(k => window.electronAPI.storeGet(k.key))
      )
      const hasStoreKey = checks.some(v => !!v)

      // Also check server-side settings for env-detected keys
      const API_KEY_TO_SETTINGS = {
        OPENAI_API_KEY: 'openai',
        DEEPGRAM_API_KEY: 'deepgram',
        GEMINI_API_KEY: 'gemini',
        GROK_API_KEY: 'grok',
        ANTHROPIC_API_KEY: 'anthropic',
      }
      let envKeys = []
      try {
        const settings = await getSettings()
        const apiKeys = settings.api_keys || {}
        for (const [envName, settingKey] of Object.entries(API_KEY_TO_SETTINGS)) {
          if (apiKeys[settingKey] === 'env') envKeys.push(envName)
        }
        setEnvDetectedKeys(envKeys)
      } catch {}

      // Show wizard only if there are no keys from either source
      if (!hasStoreKey && envKeys.length === 0) setVisible(true)
      setChecking(false)
    }
    checkKeys()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    let savedCount = 0
    const keysToSync = {}
    for (const [key, value] of Object.entries(keys)) {
      if (value?.trim()) {
        await window.electronAPI.storeSet(key, value.trim())
        keysToSync[key] = value.trim()
        savedCount++
      }
    }

    if (Object.keys(keysToSync).length > 0) {
      try {
        await updateApiKeys(keysToSync)
      } catch (e) {
        console.warn('Failed to sync API keys to server:', e)
      }
    }

    if (savedCount > 0) {
      addToast(`${savedCount}件のAPIキーを保存しました`, 'success')
    }

    setSaving(false)
    setVisible(false)
    if (onComplete) onComplete()
  }

  const handleSkip = () => {
    setVisible(false)
    if (onComplete) onComplete()
  }

  const hasAnyKey = Object.values(keys).some(v => v?.trim())
  const hasTranscriptionKey = !!(keys.OPENAI_API_KEY?.trim() || keys.DEEPGRAM_API_KEY?.trim())
  const hasOnlySummaryKey = hasAnyKey && !hasTranscriptionKey
  const transcriptionKeys = API_KEYS.filter(k => k.group === 'transcription')
  const summaryKeys = API_KEYS.filter(k => k.group === 'summary')

  const enterLocalMode = async () => {
    setLocalMode(true)
    setLocalLoading(true)
    try {
      const status = await getLocalStatus(true)
      setLocalStatus(status)
    } catch { }
    setLocalLoading(false)
  }

  const refreshLocal = async () => {
    setLocalLoading(true)
    try {
      const status = await getLocalStatus(true)
      setLocalStatus(status)
    } catch { }
    setLocalLoading(false)
  }

  if (checking || !visible) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-card border border-theme-light rounded-2xl max-w-xl w-full p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🎙️</div>
          <h1 className="text-2xl font-bold text-white">VoiceScope セットアップ</h1>
          {!localMode ? (
            <>
              <p className="text-sm text-gray-300 mt-2">
                使いたいAPIキーを入力してください
              </p>
              <p className="text-xs text-gray-400 mt-1">
                <span className="text-yellow-400">文字起こし用（OpenAI または Deepgram）</span>が必須です。<br/>
                後から設定画面でいつでも変更できます。
              </p>
              <button
                onClick={enterLocalMode}
                className="text-xs text-blue-400 hover:text-blue-300 mt-2 transition-colors"
              >
                💻 APIキーなしでローカルのみで使用する
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-300 mt-2">
                ローカル環境のセットアップ
              </p>
              <p className="text-xs text-gray-400 mt-1">
                PCの処理能力で文字起こし・要約を行います。APIキーは不要です。
              </p>
              <p className="text-[11px] text-gray-400 mt-1">
                ※ 初回のみモデルDLにネット接続が必要です。DL後は完全オフラインで動作します。
              </p>
              <button
                onClick={() => setLocalMode(false)}
                className="text-xs text-blue-400 hover:text-blue-300 mt-2 transition-colors"
              >
                ← APIキーで設定する
              </button>
            </>
          )}
        </div>

        {!localMode ? (
          <>
            {/* Transcription group */}
            <div className="mb-5">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                🎤 文字起こし用
              </h2>
              <div className="space-y-3">
                {transcriptionKeys.map(api => (
                  <KeyInput
                    key={api.key}
                    api={api}
                    keys={keys}
                    setKeys={setKeys}
                    envDetected={envDetectedKeys.includes(api.key)}
                  />
                ))}
              </div>
            </div>

            {/* Summary group */}
            <div className="mb-6">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                📝 要約用（任意 / OpenAIキーがあれば要約もカバーされます）
              </h2>
              <div className="space-y-3">
                {summaryKeys.map(api => (
                  <KeyInput
                    key={api.key}
                    api={api}
                    keys={keys}
                    setKeys={setKeys}
                    envDetected={envDetectedKeys.includes(api.key)}
                  />
                ))}
              </div>
            </div>

            {/* Warning: summary key only, no transcription */}
            {hasOnlySummaryKey && (
              <div className="mb-4 bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-3 py-2 text-xs text-yellow-300">
                ⚠ 文字起こしには OpenAI または Deepgram のキーが必要です。
                要約用キーだけでは録音を処理できません。
              </div>
            )}

            {/* Trial code (optional) */}
            <TrialCodeInput addToast={addToast} />

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button
                onClick={handleSkip}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                あとで設定する
              </button>
              <button
                onClick={handleSave}
                disabled={!hasAnyKey || saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white px-8 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                {saving ? '保存中...' : '始める'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Local mode setup */}
            {localLoading ? (
              <div className="text-center py-8 text-gray-400 text-sm">確認中...</div>
            ) : (
              <div className="space-y-5 mb-6">
                {/* whisper.cpp */}
                <LocalServiceCard
                  icon="🎤"
                  name="whisper.cpp"
                  description="ローカル文字起こしエンジン"
                  installed={localStatus?.whisperCpp?.installed}
                  detail={localStatus?.whisperCpp?.installed
                    ? `${localStatus.whisperCpp.models?.length || 0}モデル利用可能`
                    : null}
                  onSetup={async () => {
                    try {
                      await setupWhisperCpp()
                      setDownloads(d => ({ ...d, 'whisper-cpp': { status: 'downloading' } }))
                      addToast('whisper.cpp のダウンロードを開始しました', 'success')
                      const poll = setInterval(async () => {
                        try {
                          const s = await getLocalStatus(true)
                          setLocalStatus(s)
                          if (s?.whisperCpp?.installed) {
                            clearInterval(poll)
                            setDownloads(d => { const n = { ...d }; delete n['whisper-cpp']; return n })
                            addToast('whisper.cpp のセットアップ完了！モデルをダウンロードしてください', 'success')
                          }
                        } catch {}
                      }, 3000)
                      setTimeout(() => clearInterval(poll), 300000)
                    } catch (err) { addToast(err.message, 'error') }
                  }}
                  downloading={downloads['whisper-cpp']?.status === 'downloading'}
                >
                  {/* Model downloads */}
                  {localStatus?.whisperCpp?.installed && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-[11px] text-gray-400">モデルをダウンロード（smallがおすすめ）:</p>
                      {(localStatus.whisperCpp.availableModels || []).map(m => {
                        const isInstalled = localStatus.whisperCpp.models?.some(im => im.name === m.name)
                        const dlKey = `wm-${m.name}`
                        return (
                          <div key={m.name} className="flex items-center justify-between text-xs">
                            <span className="text-gray-300">{m.name} ({m.size})</span>
                            {isInstalled ? (
                              <span className="text-green-400">✓ DL済み</span>
                            ) : downloads[dlKey]?.status === 'downloading' ? (
                              <span className="text-blue-400">DL中...</span>
                            ) : (
                              <button
                                onClick={async () => {
                                  try {
                                    await downloadWhisperModel(m.name)
                                    setDownloads(d => ({ ...d, [dlKey]: { status: 'downloading' } }))
                                    // Poll for completion
                                    const poll = setInterval(async () => {
                                      try {
                                        const s = await getLocalStatus(true)
                                        setLocalStatus(s)
                                        if (s?.whisperCpp?.models?.some(im => im.name === m.name)) {
                                          clearInterval(poll)
                                          setDownloads(d => { const n = { ...d }; delete n[dlKey]; return n })
                                        }
                                      } catch {}
                                    }, 3000)
                                    setTimeout(() => clearInterval(poll), 300000)
                                  } catch (err) { addToast(err.message, 'error') }
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
                </LocalServiceCard>

                {/* Ollama */}
                <LocalServiceCard
                  icon="🤖"
                  name="Ollama"
                  description="ローカルLLM（要約・AI質問用）"
                  installed={localStatus?.ollama?.available}
                  detail={localStatus?.ollama?.available
                    ? `v${localStatus.ollama.version} / ${localStatus.ollama.models?.length || 0}モデル`
                    : null}
                  installUrl="https://ollama.com/download"
                >
                  {localStatus?.ollama?.available && (
                    <div className="mt-3">
                      {localStatus.ollama.models?.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {localStatus.ollama.models.map(m => (
                            <div key={m.name} className="flex items-center justify-between text-xs">
                              <span className="text-gray-300">{m.name}</span>
                              <span className="text-green-400">✓</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={ollamaPullModel}
                          onChange={(e) => setOllamaPullModel(e.target.value)}
                          placeholder="モデル名 (例: gemma3, llama3.2)"
                          className="flex-1 bg-input border border-gray-600 rounded px-2 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={async () => {
                            if (!ollamaPullModel.trim()) return
                            try {
                              await pullOllamaModel(ollamaPullModel.trim())
                              addToast(`${ollamaPullModel} のダウンロードを開始しました`, 'success')
                              setOllamaPullModel('')
                            } catch (err) { addToast(err.message, 'error') }
                          }}
                          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded shrink-0"
                        >
                          Pull
                        </button>
                      </div>
                    </div>
                  )}
                </LocalServiceCard>
              </div>
            )}

            {/* Actions for local mode */}
            <div className="flex items-center justify-between">
              <button
                onClick={refreshLocal}
                disabled={localLoading}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-500"
              >
                {localLoading ? '確認中...' : '状態を再確認'}
              </button>
              <button
                onClick={handleSkip}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                始める
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function KeyInput({ api, keys, setKeys, envDetected = false }) {
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef(null)
  const value = keys[api.key] || ''

  // Defeat browser autofill: on expand, clear any auto-filled value
  useEffect(() => {
    if (expanded && inputRef.current) {
      const clearAutofill = () => {
        if (inputRef.current && inputRef.current.value !== value) {
          inputRef.current.value = value
        }
      }
      clearAutofill()
      const timers = [setTimeout(clearAutofill, 50), setTimeout(clearAutofill, 150), setTimeout(clearAutofill, 500)]
      return () => timers.forEach(clearTimeout)
    }
  }, [expanded, value])

  return (
    <div className="bg-input/50 border border-theme rounded-lg px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{api.label}</span>
          {api.badge && (
            <span className="text-[10px] bg-blue-600/30 text-blue-400 px-1.5 py-0.5 rounded font-medium">
              {api.badge}
            </span>
          )}
          {envDetected && (
            <span
              className="text-[10px] bg-blue-900/60 text-blue-300 px-1.5 py-0.5 rounded font-medium"
              title="PCの環境変数から自動検出されました"
            >
              環境変数から自動検出
            </span>
          )}
          {!envDetected && value?.trim() && <span className="text-green-400 text-xs">✓</span>}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={api.helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-400 hover:text-blue-300"
            onClick={(e) => e.stopPropagation()}
          >
            キー取得 →
          </a>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-400 hover:text-white text-xs transition-colors"
          >
            {expanded ? '閉じる' : '入力'}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        {envDetected ? '環境変数から自動で読み込まれています。上書きする場合のみ入力してください。' : api.description}
      </p>
      {expanded && (
        <input
          ref={inputRef}
          type="password"
          value={value}
          onChange={(e) => setKeys((k) => ({ ...k, [api.key]: e.target.value }))}
          placeholder={envDetected ? '環境変数から自動検出（上書きする場合のみ入力）' : `${api.label} APIキーを貼り付け...`}
          className="w-full mt-2 bg-input border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          autoFocus
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore="true"
          name={`api-key-${api.key}-${Math.random().toString(36).slice(2, 8)}`}
        />
      )}
    </div>
  )
}

function LocalServiceCard({ icon, name, description, installed, detail, onSetup, installUrl, downloading, children }) {
  return (
    <div className="bg-input/50 border border-theme rounded-lg px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <span className="text-sm font-medium text-white">{name}</span>
          {installed && <span className="text-green-400 text-xs">✓</span>}
        </div>
        {installed ? (
          <span className="text-xs text-green-400">{detail}</span>
        ) : onSetup ? (
          <button
            onClick={onSetup}
            disabled={downloading}
            className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white px-3 py-1 rounded"
          >
            {downloading ? 'DL中...' : 'セットアップ'}
          </button>
        ) : installUrl ? (
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            インストール →
          </a>
        ) : null}
      </div>
      <p className="text-[11px] text-gray-400 mt-1">{description}</p>
      {children}
    </div>
  )
}

function TrialCodeInput({ addToast }) {
  const [code, setCode] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [activating, setActivating] = useState(false)

  const handleActivate = async () => {
    if (!code.trim()) return
    setActivating(true)
    try {
      const result = await activateTrial(code.trim())
      addToast(`トライアルを有効化しました（${new Date(result.expiry).toLocaleDateString('ja-JP')}まで）`, 'success')
      setCode('')
      setExpanded(false)
    } catch (err) {
      addToast(err.message, 'error')
    }
    setActivating(false)
  }

  if (!expanded) {
    return (
      <div className="text-center mb-4">
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          トライアルコードをお持ちの方はこちら
        </button>
      </div>
    )
  }

  return (
    <div className="bg-input/50 border border-theme rounded-lg px-4 py-3 mb-4">
      <p className="text-xs text-gray-400 mb-2">トライアルコード（14日間全機能無料）</p>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="コードを入力..."
          className="flex-1 bg-input border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 font-mono"
          autoFocus
        />
        <button
          onClick={handleActivate}
          disabled={!code.trim() || activating}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white text-xs px-3 py-1.5 rounded"
        >
          {activating ? '...' : '有効化'}
        </button>
      </div>
    </div>
  )
}
