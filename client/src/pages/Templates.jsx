import { useState, useEffect } from 'react'
import Markdown from 'react-markdown'
import { getTemplates, createTemplate, updateTemplate, deleteTemplate, testTemplate, getRecordings } from '../lib/api'
import { useAppStore } from '../stores/appStore'

const EMPTY_TEMPLATE = {
  name: '',
  description: '',
  system_prompt: '',
  output_format: 'markdown',
  is_default: false,
  preferred_llm_provider: '',
  preferred_llm_model: '',
}

export default function Templates() {
  const [templates, setTemplates] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_TEMPLATE)
  const [loading, setLoading] = useState(true)
  const addToast = useAppStore((s) => s.addToast)

  // Test execution state
  const [recordings, setRecordings] = useState([])
  const [testRecordingId, setTestRecordingId] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  const fetchTemplates = async () => {
    try {
      const data = await getTemplates()
      setTemplates(data)
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchRecordings = async () => {
    try {
      const data = await getRecordings()
      // Only show recordings that have transcriptions
      setRecordings(data.filter(r => r.status === 'completed' || r.status === 'transcribed'))
    } catch (err) {
      // Silently fail — recordings are optional for test feature
    }
  }

  useEffect(() => {
    fetchTemplates()
    fetchRecordings()
  }, [])

  const handleEdit = (template) => {
    setEditing(template.id)
    setForm({
      name: template.name,
      description: template.description || '',
      system_prompt: template.system_prompt,
      output_format: template.output_format || 'markdown',
      is_default: !!template.is_default,
      preferred_llm_provider: template.preferred_llm_provider || '',
      preferred_llm_model: template.preferred_llm_model || '',
    })
    setTestResult(null)
  }

  const handleNew = () => {
    setEditing('new')
    setForm(EMPTY_TEMPLATE)
    setTestResult(null)
  }

  const handleSave = async () => {
    try {
      if (!form.name || !form.system_prompt) {
        addToast('テンプレート名とプロンプトは必須です', 'error')
        return
      }
      if (editing === 'new') {
        await createTemplate(form)
        addToast('テンプレートを作成しました', 'success')
      } else {
        await updateTemplate(editing, form)
        addToast('テンプレートを更新しました', 'success')
      }
      setEditing(null)
      setTestResult(null)
      fetchTemplates()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('このテンプレートを削除しますか？')) return
    try {
      await deleteTemplate(id)
      addToast('削除しました', 'success')
      if (editing === id) {
        setEditing(null)
        setTestResult(null)
      }
      fetchTemplates()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleTest = async () => {
    if (!testRecordingId) {
      addToast('テスト対象の録音を選択してください', 'error')
      return
    }
    if (editing === 'new') {
      addToast('テンプレートを保存してからテストしてください', 'error')
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await testTemplate(editing, { recording_id: testRecordingId })
      setTestResult(result)
      addToast('テスト実行完了', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="p-6 text-gray-500">読み込み中...</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">テンプレート管理</h1>
        <button
          onClick={handleNew}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          新規作成
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Template list */}
        <div className="space-y-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className={`bg-gray-900 border rounded-lg p-4 cursor-pointer transition-colors ${
                editing === t.id ? 'border-blue-500' : 'border-gray-800 hover:border-gray-700'
              }`}
              onClick={() => handleEdit(t)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-white font-medium">{t.name}</h3>
                    {t.is_default ? (
                      <span className="text-xs bg-blue-600/30 text-blue-400 px-2 py-0.5 rounded">デフォルト</span>
                    ) : null}
                  </div>
                  {t.description && (
                    <p className="text-sm text-gray-500 mt-1">{t.description}</p>
                  )}
                  {t.preferred_llm_provider && (
                    <p className="text-xs text-gray-600 mt-1">
                      LLM: {t.preferred_llm_provider} / {t.preferred_llm_model}
                    </p>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(t.id) }}
                  className="text-gray-600 hover:text-red-400 text-sm"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Edit form */}
        {editing && (
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 sticky top-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                {editing === 'new' ? '新規テンプレート' : 'テンプレート編集'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">テンプレート名</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">説明</label>
                  <input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">システムプロンプト</label>
                  <textarea
                    value={form.system_prompt}
                    onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                    rows={10}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">優先LLM</label>
                    <select
                      value={form.preferred_llm_provider}
                      onChange={(e) => setForm({ ...form, preferred_llm_provider: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
                    >
                      <option value="">グローバル設定に従う</option>
                      <option value="gemini">Gemini</option>
                      <option value="grok">Grok</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">モデル</label>
                    <select
                      value={form.preferred_llm_model}
                      onChange={(e) => setForm({ ...form, preferred_llm_model: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
                    >
                      <option value="">グローバル設定に従う</option>
                      <optgroup label="Gemini">
                        <option value="gemini-3.1-flash-lite-preview">gemini-3.1-flash-lite-preview</option>
                        <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                        <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                      </optgroup>
                      <optgroup label="Grok">
                        <option value="grok-4-1-fast-non-reasoning">grok-4-1-fast-non-reasoning</option>
                        <option value="grok-4-1-fast-reasoning">grok-4-1-fast-reasoning</option>
                        <option value="grok-4.20-0309-non-reasoning">grok-4.20</option>
                        <option value="grok-4.20-0309-reasoning">grok-4.20 推論</option>
                      </optgroup>
                      <optgroup label="OpenAI">
                        <option value="gpt-5.4-nano">gpt-5.4-nano</option>
                        <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                        <option value="gpt-5.4">gpt-5.4</option>
                        <option value="gpt-5-nano">gpt-5-nano</option>
                        <option value="gpt-5">gpt-5</option>
                        <option value="gpt-4o">gpt-4o</option>
                      </optgroup>
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                    className="rounded"
                  />
                  デフォルトテンプレートにする
                </label>

                <div className="flex gap-3">
                  <button
                    onClick={handleSave}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => { setEditing(null); setTestResult(null) }}
                    className="text-gray-400 hover:text-white text-sm"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </div>

            {/* Test execution panel */}
            {editing !== 'new' && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <h3 className="text-md font-semibold text-white mb-3">テスト実行</h3>
                <p className="text-xs text-gray-500 mb-3">既存の文字起こしデータを使ってプロンプトの出力をプレビューします</p>

                <div className="flex gap-2 mb-4">
                  <select
                    value={testRecordingId}
                    onChange={(e) => setTestRecordingId(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
                  >
                    <option value="">録音を選択...</option>
                    {recordings.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title || r.id} ({new Date(r.recorded_at).toLocaleDateString('ja-JP')})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleTest}
                    disabled={testing || !testRecordingId}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors shrink-0"
                  >
                    {testing ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        実行中...
                      </span>
                    ) : 'テスト実行'}
                  </button>
                </div>

                {recordings.length === 0 && (
                  <p className="text-xs text-gray-600">文字起こし済みの録音がありません。先に音声をアップロードしてください。</p>
                )}

                {/* Test result */}
                {testResult && (
                  <div className="border border-emerald-800/50 bg-emerald-950/20 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
                      <span className="text-emerald-400">テスト結果</span>
                      <span>{testResult.provider} / {testResult.model}</span>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none">
                      <Markdown>{testResult.content}</Markdown>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
