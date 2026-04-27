import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { askCross, getCrossSessions, getCrossChat, clearCrossChat, getFolders, getTags } from '../lib/api'
import { formatDateTimeShort } from '../lib/date'
import { useAppStore } from '../stores/appStore'
import { getAvailableModels, PROVIDER_LABELS, buildModelToProvider, getDefaultModel } from '../lib/models'

export default function CrossAsk() {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState([]) // { role, content, recordings? }
  const [loading, setLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState('')
  const [sessionId, setSessionId] = useState(null)

  // Scope filters
  const [scopeFolder, setScopeFolder] = useState('')
  const [scopeTag, setScopeTag] = useState('')
  const [scopeImportance, setScopeImportance] = useState('')
  const [includeLocal, setIncludeLocal] = useState(false)
  const [showLocalWarning, setShowLocalWarning] = useState(false)
  const [folders, setFolders] = useState([])
  const [allTags, setAllTags] = useState([])

  // Sessions
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)

  // Model selection
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('gpt-5.4-mini')

  const chatEndRef = useRef(null)
  const inputRef = useRef(null)
  const addToast = useAppStore((s) => s.addToast)
  const tier = useAppStore((s) => s.tier)
  const tierInfo = useAppStore((s) => s.tierInfo)

  const { providers, models: PROVIDER_MODELS } = getAvailableModels(tierInfo, 'ask')
  const MODEL_TO_PROVIDER = buildModelToProvider(PROVIDER_MODELS)

  // Load folders, tags, and past sessions
  useEffect(() => {
    getFolders().then(setFolders).catch(() => {})
    getTags().then(setAllTags).catch(() => {})
    loadSessions()
  }, [])

  const loadSessions = () => {
    getCrossSessions().then(setSessions).catch(() => {})
  }

  // Load session history when selecting a past session
  const selectSession = async (sid) => {
    try {
      const messages = await getCrossChat(sid)
      const formatted = messages.map(m => {
        const msg = { role: m.role, content: m.content }
        if (m.referenced_recordings) {
          try {
            const ids = JSON.parse(m.referenced_recordings)
            msg.recordings = ids.map(id => ({ id, title: id }))
          } catch {}
        }
        return msg
      })
      setHistory(formatted)
      setSessionId(sid)
      setActiveSessionId(sid)
    } catch {}
  }

  const startNewSession = () => {
    setHistory([])
    setSessionId(null)
    setActiveSessionId(null)
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  const handleAsk = async (e) => {
    e?.preventDefault()
    const q = question.trim()
    if (!q || loading) return

    setQuestion('')
    setHistory(h => [...h, { role: 'user', content: q }])
    setLoading(true)
    setLoadingStage('関連録音を特定中...')

    try {
      const scope = {}
      if (scopeFolder) scope.folder = scopeFolder
      if (scopeTag) scope.tag = scopeTag
      if (scopeImportance) scope.importance = scopeImportance

      // Small delay to show stage 1 message
      setTimeout(() => {
        if (loading) setLoadingStage('録音を分析中...')
      }, 3000)

      const result = await askCross(q, scope, history, {
        provider,
        model,
        sessionId,
        includeLocal,
      })

      if (!sessionId && result.sessionId) {
        setSessionId(result.sessionId)
        setActiveSessionId(result.sessionId)
      }

      setHistory(h => [...h, {
        role: 'assistant',
        content: result.answer,
        recordings: result.relevantRecordings,
        meta: result.stage === 'complete'
          ? `${result.recordingsAnalyzed}件の録音を分析（全${result.totalInScope}件中）`
          : null,
      }])
    } catch (err) {
      setHistory(h => [...h, {
        role: 'assistant',
        content: `エラー: ${err.message}`,
      }])
    } finally {
      setLoading(false)
      setLoadingStage('')
      loadSessions()
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const handleDeleteSession = async (sid) => {
    try {
      await clearCrossChat(sid)
      if (activeSessionId === sid) startNewSession()
      loadSessions()
    } catch {}
  }

  const handleClear = () => {
    setHistory([])
    setSessionId(null)
  }

  // Tier lock
  const isLocked = tier === 'free'

  if (isLocked) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-white mb-4">Ask All</h1>
        <div className="bg-card border border-theme rounded-lg p-8 text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-lg text-white font-medium mb-2">Ask AllはProプラン以上で利用できます</h2>
          <p className="text-sm text-gray-400 mb-4">
            APIキーを設定するか、トライアルコードを入力してください。
          </p>
          <Link to="/settings" className="text-blue-400 hover:text-blue-300 text-sm">
            設定画面へ →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-2rem)]">
      {/* Session sidebar */}
      <div className="w-52 border-r border-theme flex flex-col shrink-0">
        <div className="p-3 border-b border-theme flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">セッション</span>
          <button
            onClick={startNewSession}
            className="text-xs text-blue-400 hover:text-blue-300"
            title="新しい会話"
          >
            + 新規
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="text-xs text-gray-400 p-3">まだセッションがありません</p>
          ) : (
            sessions.map(s => (
              <div
                key={s.session_id}
                className={`px-3 py-2 cursor-pointer border-b border-theme/50 group transition-colors ${
                  activeSessionId === s.session_id ? 'bg-card text-white' : 'text-gray-400 hover:bg-card/50 hover:text-gray-300'
                }`}
                onClick={() => selectSession(s.session_id)}
              >
                <p className="text-xs truncate">{s.first_question || '(質問なし)'}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-gray-400">{formatDateTimeShort(s.started_at)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.session_id) }}
                    className="text-[10px] text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="削除"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Local inclusion warning dialog */}
      {showLocalWarning && (
        <LocalWarningDialog
          onConfirm={(dontShowAgain) => {
            setIncludeLocal(true)
            if (dontShowAgain) localStorage.setItem('vs_suppress_local_warning', '1')
            setShowLocalWarning(false)
          }}
          onCancel={() => setShowLocalWarning(false)}
        />
      )}

      {/* Main chat area */}
      <div className="flex-1 p-6 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">Ask All</h1>
          {history.length > 0 && (
            <button onClick={handleClear} className="text-xs text-gray-400 hover:text-white">
              会話クリア
            </button>
          )}
        </div>

      {/* Scope + Model selectors */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={scopeFolder} onChange={(e) => setScopeFolder(e.target.value)}
          className="bg-card border border-theme-light rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500">
          <option value="">全録音</option>
          {folders.map(f => <option key={f.id} value={f.id}>{f.icon || '📁'} {f.name}</option>)}
        </select>
        <select value={scopeTag} onChange={(e) => setScopeTag(e.target.value)}
          className="bg-card border border-theme-light rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500">
          <option value="">全タグ</option>
          {allTags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
        <select value={scopeImportance} onChange={(e) => setScopeImportance(e.target.value)}
          className="bg-card border border-theme-light rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500">
          <option value="">全重要度</option>
          <option value="3">★★★</option>
          <option value="2">★★</option>
          <option value="1">★</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer" title="ローカル処理した録音もAPIに送って分析する">
          <input
            type="checkbox"
            checked={includeLocal}
            onChange={(e) => {
              if (e.target.checked) {
                // Check warning-suppression flag
                const suppress = localStorage.getItem('vs_suppress_local_warning') === '1'
                if (suppress) {
                  setIncludeLocal(true)
                } else {
                  setShowLocalWarning(true)
                }
              } else {
                setIncludeLocal(false)
              }
            }}
            className="rounded"
          />
          🔒 ローカル録音も含める
        </label>
        <div className="ml-auto flex items-center gap-1">
          <select value={provider} onChange={(e) => {
            setProvider(e.target.value)
            const models = PROVIDER_MODELS[e.target.value]
            if (models?.length) setModel(models[0].value)
          }}
            className="bg-card border border-theme-light rounded px-2 py-1.5 text-xs text-white focus:outline-none">
            {providers.filter(p => (PROVIDER_MODELS[p] || []).length > 0).map(p => (
              <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
            ))}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)}
            className="bg-card border border-theme-light rounded px-2 py-1.5 text-xs text-white focus:outline-none">
            {(PROVIDER_MODELS[provider] || []).map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto bg-card/30 border border-theme rounded-lg p-4 mb-4 space-y-4">
        {history.length === 0 && !loading && (
          <div className="text-center py-12">
            <div className="text-3xl mb-3">🔍</div>
            <p className="text-gray-400 text-sm">すべての録音をAIに横断して質問できます</p>
            <p className="text-gray-400 text-xs mt-2">フォルダ・タグ・重要度で範囲を絞ることもできます</p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {['最近の会議で決まったことは？', '共通して出てきたテーマは？', 'タスクの進捗は？'].map(q => (
                <button
                  key={q}
                  onClick={() => { setQuestion(q); setTimeout(() => handleAsk(), 50) }}
                  className="text-xs bg-input border border-theme-light text-gray-300 px-3 py-1.5 rounded hover:bg-card transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-blue-900/40 text-white'
                : 'bg-input text-gray-200'
            }`}>
              {msg.role === 'assistant' ? (
                <>
                  <div className="md-content text-sm">
                    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{msg.content}</Markdown>
                  </div>
                  {msg.recordings?.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-theme">
                      <p className="text-[10px] text-gray-400 mb-1">参照された録音:</p>
                      <div className="flex flex-wrap gap-1">
                        {msg.recordings.map(r => (
                          <Link
                            key={r.id}
                            to={`/recordings/${r.id}`}
                            className="text-[11px] text-blue-400 hover:text-blue-300 bg-blue-900/20 px-2 py-0.5 rounded"
                          >
                            {r.title}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  {msg.meta && (
                    <p className="text-[10px] text-gray-400 mt-2">{msg.meta}</p>
                  )}
                </>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-input rounded-lg px-4 py-3 flex items-center gap-2">
              <div className="animate-pulse text-blue-400 text-sm">{loadingStage || '処理中...'}</div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleAsk} className="flex gap-2">
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="録音全体に対して質問..."
          className="flex-1 bg-card border border-theme-light rounded-lg px-4 py-3 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          disabled={loading}
          autoFocus
        />
        <button
          type="submit"
          disabled={!question.trim() || loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors"
        >
          質問
        </button>
      </form>
      </div>
    </div>
  )
}

function LocalWarningDialog({ onConfirm, onCancel }) {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-card border border-yellow-600/50 rounded-xl max-w-md w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="text-2xl">⚠️</div>
          <div>
            <h3 className="text-lg font-semibold text-white">ローカル録音を含めますか？</h3>
            <p className="text-sm text-gray-300 mt-2">
              オフラインモードで処理した録音は、本来クラウドに送信されないように保護されています。
            </p>
            <p className="text-sm text-yellow-400 mt-2">
              含めると、これらの録音の<strong>文字起こしや要約が外部API（OpenAI/Anthropic等）に送信</strong>されます。
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
          今後この警告を表示しない
        </label>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white"
          >
            キャンセル
          </button>
          <button
            onClick={() => onConfirm(dontShowAgain)}
            className="bg-yellow-600 hover:bg-yellow-700 text-white text-sm px-4 py-2 rounded-lg font-medium"
          >
            理解して含める
          </button>
        </div>
      </div>
    </div>
  )
}
