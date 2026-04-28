import { useState, useEffect, useRef } from 'react'
import {
  getInfographicStyles,
  structureInfographic,
  generateInfographic,
  listInfographicPresets,
  getPresetImageUrl,
} from '../lib/api'
import { useAppStore } from '../stores/appStore'

const ASPECT_OPTIONS = [
  { value: '2:3', label: '2:3 縦長 (1024×1536)', size: '1024×1536', isDefault: true },
  { value: '9:16', label: '9:16 縦長 (Story / Reels)', size: '1024×1536', note: 'gpt-image-1 では 1024x1536 にマッピング' },
  { value: '1:1', label: '1:1 正方形 (Instagram)', size: '1024×1024' },
  { value: '3:2', label: '3:2 横長', size: '1536×1024' },
  { value: '16:9', label: '16:9 横長 (YouTube)', size: '1536×1024', note: 'gpt-image-1 では 1536x1024 にマッピング' },
]

const QUALITY_OPTIONS = [
  { value: 'low', label: 'Low（最安・$0.02）', desc: '試し打ちに最適' },
  { value: 'medium', label: 'Medium（推奨・$0.07）', desc: 'バランス良い品質' },
  { value: 'high', label: 'High（最高品質・$0.19）', desc: '配布物・本番用' },
]

const MODEL_OPTIONS = [
  { value: 'gpt-image-1', label: 'gpt-image-1（標準）' },
  { value: 'gpt-image-1-mini', label: 'gpt-image-1-mini（低価格）' },
]

/**
 * Modal-based studio for generating an infographic from a recording's summary.
 * Two-stage flow:
 *   1. "structure" — LLM splits / structures content into a JSON layout
 *   2. "generate" — gpt-image-1 renders the chosen layout into a PNG
 */
export default function InfographicModal({ recordingId, onClose, onGenerated }) {
  const addToast = useAppStore((s) => s.addToast)

  // Stage 1 — structuring
  const [mode, setMode] = useState('whole') // 'whole' | 'split'
  const [source, setSource] = useState('summary') // 'summary' | 'transcript'
  const [structuring, setStructuring] = useState(false)
  const [structure, setStructure] = useState(null) // whole result OR { topics: [...] }
  const [selectedTopicId, setSelectedTopicId] = useState(null)

  // Stage 2 — generation options
  const [styles, setStyles] = useState([])
  const [style, setStyle] = useState('natural')
  const [customPrompt, setCustomPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('2:3')
  const [quality, setQuality] = useState('medium')
  const [model, setModel] = useState('gpt-image-1')
  const [n, setN] = useState(1)

  // Reference images (per-call upload)
  const [referenceFiles, setReferenceFiles] = useState([]) // File[]
  const fileInputRef = useRef(null)

  // Saved presets ("brand kits")
  const [presets, setPresets] = useState([])
  const [selectedPresetId, setSelectedPresetId] = useState(null)
  const [presetThumbs, setPresetThumbs] = useState({}) // { presetId: [url, url, ...] }

  // Generation result
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    getInfographicStyles().then((data) => setStyles(data.styles || [])).catch(() => {})
    listInfographicPresets().then(async (data) => {
      const list = data.presets || []
      setPresets(list)
      // Pre-resolve thumbnails (since URLs need API token)
      const thumbs = {}
      for (const p of list) {
        const refPaths = (() => { try { return JSON.parse(p.reference_image_paths_json || '[]') } catch { return [] } })()
        thumbs[p.id] = []
        for (let i = 0; i < refPaths.length; i++) {
          thumbs[p.id].push(await getPresetImageUrl(p.id, i + 1))
        }
      }
      setPresetThumbs(thumbs)
    }).catch(() => {})
  }, [])

  const handleStructure = async () => {
    setStructuring(true)
    setStructure(null)
    setSelectedTopicId(null)
    try {
      const res = await structureInfographic(recordingId, { mode, source })
      setStructure(res.structure)
      if (mode === 'split' && res.structure?.topics?.length > 0) {
        setSelectedTopicId(res.structure.topics[0].id)
      }
      addToast('構造化が完了しました', 'success')
    } catch (err) {
      addToast(err.message || '構造化に失敗しました', 'error')
    } finally {
      setStructuring(false)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      // Auto-structure if the user forgot to click 構造化を実行 first.
      // Generate is the obvious "go" button, so we treat structuring as
      // an implicit step — only required to be explicit if the user wants
      // to inspect / pick a topic before hitting Generate.
      let activeStructure = structure
      if (!activeStructure) {
        addToast('構造化を自動実行しています...', 'info')
        setStructuring(true)
        try {
          const res = await structureInfographic(recordingId, { mode, source })
          activeStructure = res.structure
          setStructure(activeStructure)
          if (mode === 'split' && activeStructure?.topics?.length > 0) {
            setSelectedTopicId(activeStructure.topics[0].id)
          }
        } finally {
          setStructuring(false)
        }
      }

      // Pick the right structure to send (whole or selected topic)
      let payload = activeStructure
      let blockIdForRequest
      if (mode === 'split') {
        // If split-mode auto-structuring just happened, use the first topic.
        // Otherwise use whatever the user picked.
        const targetId = selectedTopicId || activeStructure?.topics?.[0]?.id
        const topic = activeStructure?.topics?.find((t) => t.id === targetId)
        if (!topic) {
          addToast('生成するトピックがありません', 'error')
          return
        }
        payload = topic
        blockIdForRequest = targetId
      }

      const res = await generateInfographic(recordingId, {
        structure: payload,
        style,
        custom_prompt: customPrompt || undefined,
        aspect_ratio: aspectRatio,
        quality,
        model,
        n,
        block_id: blockIdForRequest,
        preset_id: selectedPresetId || undefined,
        reference_images: referenceFiles,
      })
      addToast(`画像を生成しました（${n}枚）`, 'success')
      onGenerated?.(res.infographic)
      onClose()
    } catch (err) {
      addToast(err.message || '画像生成に失敗しました', 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleFilePick = (e) => {
    const files = Array.from(e.target.files || [])
    setReferenceFiles((prev) => [...prev, ...files].slice(0, 8))
  }

  const removeRef = (index) => {
    setReferenceFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const estimatedCost = (() => {
    const pricing = { low: 0.02, medium: 0.07, high: 0.19 }
    const miniPricing = { low: 0.005, medium: 0.011, high: 0.05 }
    const p = model === 'gpt-image-1-mini' ? miniPricing : pricing
    return (p[quality] || 0.07) * n
  })()

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-card border border-theme-light rounded-xl max-w-3xl w-full p-6 shadow-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">🎨 インフォグラフィック生成</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        {/* Stage 1: structure */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-white mb-2">① 内容を構造化</h3>
          <div className="space-y-2 ml-2">
            <div className="flex gap-3 text-xs text-gray-300">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={mode === 'whole'} onChange={() => setMode('whole')} className="accent-blue-500" />
                ① すべてを1枚にまとめる
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={mode === 'split'} onChange={() => setMode('split')} className="accent-blue-500" />
                ② テーマ別に分割（特定ブロックを生成）
              </label>
            </div>
            <div className="flex gap-3 text-xs text-gray-400">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={source === 'summary'} onChange={() => setSource('summary')} className="accent-blue-500" />
                ソース: 既存の要約
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={source === 'transcript'} onChange={() => setSource('transcript')} className="accent-blue-500" />
                ソース: 文字起こし全文
              </label>
            </div>
            <button
              onClick={handleStructure}
              disabled={structuring}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white px-3 py-1.5 rounded"
            >
              {structuring ? '構造化中...' : '構造化を実行'}
            </button>
          </div>

          {/* Show structured output */}
          {structure && mode === 'whole' && (
            <div className="mt-3 ml-2 bg-input/40 rounded p-3 text-xs text-gray-300 space-y-1 max-h-60 overflow-y-auto">
              <div><strong className="text-white">タイトル:</strong> {structure.title}</div>
              {structure.subtitle && <div className="text-gray-400">{structure.subtitle}</div>}
              {(structure.blocks || []).map((b) => (
                <div key={b.number} className="mt-1">
                  <strong className="text-white">{b.number}. {b.headline}</strong>: {b.body}
                </div>
              ))}
              {structure.conclusion && (
                <div className="mt-2 text-green-300">結論: {structure.conclusion}</div>
              )}
            </div>
          )}

          {structure && mode === 'split' && structure.topics && (
            <div className="mt-3 ml-2 space-y-2">
              <p className="text-[11px] text-gray-400">{structure.topics.length}個のトピックに分割されました。生成する1つを選択:</p>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {structure.topics.map((t) => (
                  <label key={t.id} className={`block bg-input/40 rounded p-2 text-xs cursor-pointer border ${
                    selectedTopicId === t.id ? 'border-blue-500' : 'border-transparent hover:border-theme-light'
                  }`}>
                    <input
                      type="radio"
                      checked={selectedTopicId === t.id}
                      onChange={() => setSelectedTopicId(t.id)}
                      className="mr-2 accent-blue-500"
                    />
                    <strong className="text-white">{t.title}</strong>
                    {t.subtitle && <span className="text-gray-400 ml-2">— {t.subtitle}</span>}
                    <div className="text-[10px] text-gray-400 mt-1">{(t.blocks || []).map(b => b.headline).join(' / ')}</div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Stage 2: generation options */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-white mb-2">② スタイル・生成設定</h3>
          <div className="space-y-3 ml-2">

            {/* Style preset */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">スタイル</label>
              <div className="grid grid-cols-2 gap-2">
                {styles.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setStyle(s.key)}
                    className={`text-left p-2 rounded border text-xs ${
                      style === s.key
                        ? 'bg-blue-600/20 border-blue-500 text-white'
                        : 'bg-input border-theme-light text-gray-300 hover:border-blue-500/50'
                    }`}
                  >
                    <div className="font-semibold">{s.label}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{s.description}</div>
                  </button>
                ))}
                <button
                  onClick={() => setStyle('custom')}
                  className={`text-left p-2 rounded border text-xs ${
                    style === 'custom'
                      ? 'bg-blue-600/20 border-blue-500 text-white'
                      : 'bg-input border-theme-light text-gray-300 hover:border-blue-500/50'
                  }`}
                >
                  <div className="font-semibold">✏️ カスタムプロンプト</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">下に自由に指示</div>
                </button>
              </div>
              {style === 'custom' && (
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="例: 落ち着いたグリーン+ベージュで、植物のあしらい、9:16 縦長..."
                  rows={3}
                  className="w-full mt-2 bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              )}
              {style !== 'custom' && customPrompt && (
                <p className="text-[10px] text-amber-400/70 mt-1">※ 「カスタムプロンプト」を選んでいないため、上の追加指示は無視されます</p>
              )}
              {style !== 'custom' && (
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="プリセットへの追加指示（任意）"
                  rows={2}
                  className="w-full mt-2 bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                />
              )}
            </div>

            {/* Reference images */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                リファレンス画像（任意・最大8枚） — ロゴ・キャラクター・配色見本など
              </label>

              {/* Saved preset selector */}
              {presets.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] text-gray-400 mb-1">保存済みプリセットから選択:</p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => setSelectedPresetId(null)}
                      className={`text-[10px] px-2 py-1 rounded ${selectedPresetId === null ? 'bg-blue-600 text-white' : 'bg-theme text-gray-300'}`}
                    >
                      使わない
                    </button>
                    {presets.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPresetId(p.id)}
                        className={`text-[10px] px-2 py-1 rounded ${selectedPresetId === p.id ? 'bg-blue-600 text-white' : 'bg-theme text-gray-300'}`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  {selectedPresetId && presetThumbs[selectedPresetId]?.length > 0 && (
                    <div className="flex gap-1 mt-1.5">
                      {presetThumbs[selectedPresetId].map((url, i) => (
                        <img key={i} src={url} alt="" className="h-12 w-12 object-cover rounded border border-theme-light" />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={handleFilePick}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs bg-input border border-theme-light hover:border-blue-500 text-gray-300 px-2 py-1 rounded"
              >
                + 画像を追加 ({referenceFiles.length}/8)
              </button>
              {referenceFiles.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {referenceFiles.map((f, i) => (
                    <div key={i} className="relative">
                      <img src={URL.createObjectURL(f)} alt={f.name} className="h-16 w-16 object-cover rounded border border-theme-light" />
                      <button
                        onClick={() => removeRef(i)}
                        className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-5 h-5 text-[10px]"
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quality / Model / Aspect */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">モデル</label>
                <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white">
                  {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">品質</label>
                <select value={quality} onChange={(e) => setQuality(e.target.value)} className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white">
                  {QUALITY_OPTIONS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">枚数</label>
                <select value={n} onChange={(e) => setN(parseInt(e.target.value))} className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white">
                  {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}枚</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">アスペクト比</label>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full bg-input border border-theme-light rounded px-2 py-1.5 text-xs text-white">
                {ASPECT_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}{a.note ? ` ※ ${a.note}` : ''}</option>)}
              </select>
            </div>

            {/* Cost estimate */}
            <div className="bg-blue-900/20 border border-blue-700/40 rounded px-2 py-1.5 text-[11px] text-gray-300">
              💰 推定コスト: <strong className="text-white">${estimatedCost.toFixed(3)}</strong>
              （約 ¥{(estimatedCost * 150).toFixed(0)}）
              <span className="text-gray-400 ml-2">{quality} × {n}枚</span>
            </div>
          </div>
        </section>

        {/* Footer actions */}
        <div className="flex justify-end gap-2 pt-3 border-t border-theme">
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-white px-4 py-2">
            キャンセル
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || structuring}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white text-sm px-5 py-2 rounded font-medium"
            title={!structure ? '構造化が未実行の場合は、ボタン押下時に自動実行されます' : ''}
          >
            {generating ? '生成中...' : structuring ? '構造化中...' : '🎨 画像を生成'}
          </button>
        </div>
      </div>
    </div>
  )
}
