import { useState, useEffect } from 'react'
import { getSettings, updateSettings } from '../lib/api'
import { useAppStore } from '../stores/appStore'

const isElectron = !!window.electronAPI?.isElectron

const API_KEY_LABELS = {
  deepgram: 'Deepgram',
  openai: 'OpenAI',
  gemini: 'Gemini',
  grok: 'Grok (xAI)',
}

const API_KEY_ENV_NAMES = {
  deepgram: 'DEEPGRAM_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  grok: 'GROK_API_KEY',
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  // Electron mode: editable API keys
  const [apiKeys, setApiKeys] = useState({})
  const [keyDirty, setKeyDirty] = useState({})

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err) => addToast(err.message, 'error'))
      .finally(() => setLoading(false))

    // Load keys from Electron store
    if (isElectron) {
      loadElectronKeys()
    }
  }, [addToast])

  const loadElectronKeys = async () => {
    const keys = {}
    for (const [, envName] of Object.entries(API_KEY_ENV_NAMES)) {
      const val = await window.electronAPI.storeGet(envName)
      keys[envName] = val || ''
    }
    setApiKeys(keys)
  }

  const handleSave = async (key, value) => {
    setSaving(true)
    try {
      const updated = await updateSettings({ [key]: value })
      setSettings((s) => ({ ...s, ...updated }))
      addToast('設定を更新しました', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveApiKey = async (envName) => {
    try {
      await window.electronAPI.storeSet(envName, apiKeys[envName])
      setKeyDirty((d) => ({ ...d, [envName]: false }))
      addToast(`${envName} を保存しました。再起動後に反映されます。`, 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  if (loading) return <div className="p-6 text-gray-500">読み込み中...</div>
  if (!settings) return <div className="p-6 text-gray-500">設定を読み込めませんでした</div>

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-6">設定</h1>

      {/* API Key Status / Editor */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-3">APIキー</h2>
        {isElectron ? (
          <>
            <p className="text-xs text-gray-500 mb-3">APIキーを入力して保存してください。保存後、アプリを再起動すると反映されます。</p>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
              {Object.entries(API_KEY_LABELS).map(([key, label]) => {
                const envName = API_KEY_ENV_NAMES[key]
                const configured = settings.api_keys?.[key]
                return (
                  <div key={key}>
                    <label className="flex items-center gap-2 text-sm text-gray-300 mb-1">
                      {label}
                      {configured && (
                        <span className="text-xs bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded">
                          サーバー側設定済み
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
                        placeholder={configured ? '●●●●●●●● (設定済み)' : '未設定'}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
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
            <p className="text-xs text-gray-500 mb-3">APIキーは .env ファイルで管理します</p>
            <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
              {Object.entries(settings.api_keys || {}).map(([key, configured]) => (
                <div key={key} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-300">{API_KEY_LABELS[key] || key}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    configured ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
                  }`}>
                    {configured ? '設定済み' : '未設定'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Default Transcription Engine */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-3">文字起こし</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルトエンジン</label>
            <select
              value={settings.default_transcription_engine || 'deepgram'}
              onChange={(e) => handleSave('default_transcription_engine', e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white w-full"
            >
              <option value="deepgram">Deepgram (Nova-2)</option>
              <option value="whisper">OpenAI Whisper</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルト言語</label>
            <select
              value={settings.default_language || 'auto'}
              onChange={(e) => handleSave('default_language', e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white w-full"
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
        </div>
      </section>

      {/* Default Summary LLM */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-3">要約</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルトLLM</label>
            <select
              value={settings.default_summary_provider || 'gemini'}
              onChange={(e) => handleSave('default_summary_provider', e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white w-full"
            >
              <option value="gemini">Gemini</option>
              <option value="grok">Grok</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">デフォルトモデル</label>
            <select
              value={settings.default_summary_model || ''}
              onChange={(e) => handleSave('default_summary_model', e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white w-full"
            >
              <optgroup label="Gemini">
                <option value="gemini-3.1-flash-lite-preview">gemini-3.1-flash-lite-preview (最安・高速)</option>
                <option value="gemini-3-flash-preview">gemini-3-flash-preview (バランス)</option>
                <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (最高性能)</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash (安定版)</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro (安定・高性能)</option>
              </optgroup>
              <optgroup label="Grok (xAI)">
                <option value="grok-4-1-fast-non-reasoning">grok-4-1-fast-non-reasoning (高速)</option>
                <option value="grok-4-1-fast-reasoning">grok-4-1-fast-reasoning (推論付き)</option>
                <option value="grok-4.20-0309-non-reasoning">grok-4.20 (最新フラッグシップ)</option>
                <option value="grok-4.20-0309-reasoning">grok-4.20 推論 (最高性能)</option>
              </optgroup>
              <optgroup label="OpenAI">
                <option value="gpt-5.4-nano">gpt-5.4-nano (最安・最速)</option>
                <option value="gpt-5.4-mini">gpt-5.4-mini (バランス)</option>
                <option value="gpt-5.4">gpt-5.4 (最高性能)</option>
                <option value="gpt-5-nano">gpt-5-nano</option>
                <option value="gpt-5-mini">gpt-5-mini</option>
                <option value="gpt-5">gpt-5</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
              </optgroup>
            </select>
          </div>
        </div>
      </section>

      {/* App Info (Electron only) */}
      {isElectron && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">アプリ情報</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm text-gray-500">
            <p>モード: デスクトップアプリ (Electron)</p>
            <p className="mt-1">ショートカット: Ctrl+Shift+R で録音開始/停止</p>
          </div>
        </section>
      )}
    </div>
  )
}
