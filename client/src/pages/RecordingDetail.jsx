import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Markdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import {
  getRecording, updateRecording, deleteRecording,
  transcribeRecording, summarizeRecording, deleteSummary,
  updateTranscription, addTag, removeTag, getTemplates,
  getAudioUrl, reprocessRecording, refineRecording, getKnownSpeakers, askRecording,
  getChatHistory, clearChatHistory, getSettings,
  getFolders, addRecordingToFolder, removeRecordingFromFolder,
  revealRecording,
} from '../lib/api'
import { useAppStore } from '../stores/appStore'
import { getAvailableModels, PROVIDER_LABELS, buildModelToProvider, getDefaultModel } from '../lib/models'
import { parseDate, formatDateTime, formatDateTimeShort } from '../lib/date'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'

function lightenColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lighten = (c) => Math.min(255, c + Math.round((255 - c) * 0.45))
  return `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`
}

// Transcription engine labels for the "re-transcribe with..." menu.
// Used to compare engine quality on the same recording (Phase 2 evaluation).
const ENGINE_LABELS = {
  deepgram: 'Deepgram (Nova-2)',
  'grok-stt': '⚡ Grok STT ($0.10/h)',
  whisper: 'OpenAI Whisper',
  'whisper-cpp': 'whisper.cpp (ローカル)',
  'faster-whisper': 'faster-whisper (ローカル)',
}

const SPEAKER_COLORS = [
  { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500', dot: 'bg-blue-400' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500', dot: 'bg-emerald-400' },
  { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500', dot: 'bg-amber-400' },
  { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500', dot: 'bg-purple-400' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500', dot: 'bg-pink-400' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500', dot: 'bg-cyan-400' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500', dot: 'bg-orange-400' },
  { bg: 'bg-rose-500/20', text: 'text-rose-400', border: 'border-rose-500', dot: 'bg-rose-400' },
]

function getSpeakerColor(index) {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length]
}

function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function RecordingDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const addToast = useAppStore((s) => s.addToast)
  const tierInfo = useAppStore((s) => s.tierInfo)

  const { providers: summaryProviders, models: sumProviderModels } = getAvailableModels(tierInfo, 'summary')
  const { providers: askProviders, models: askProviderModels } = getAvailableModels(tierInfo, 'ask')
  const PROVIDER_MODELS = sumProviderModels // used by summary section
  const MODEL_TO_PROVIDER = buildModelToProvider({ ...sumProviderModels, ...askProviderModels })

  const [recording, setRecording] = useState(null)
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [showEngineMenu, setShowEngineMenu] = useState(false) // re-transcribe engine picker
  const [selectedRetryEngine, setSelectedRetryEngine] = useState(null) // null = use settings default
  const [retranscribing, setRetranscribing] = useState(false) // guard against double-click
  const [title, setTitle] = useState('')
  const [activeSummaryTab, setActiveSummaryTab] = useState(0)
  const [newTag, setNewTag] = useState('')
  const [allFolders, setAllFolders] = useState([])
  const [recFolders, setRecFolders] = useState([])
  const [summarizing, setSummarizing] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [granularity, setGranularity] = useState('normal')
  const [audioRef, setAudioRef] = useState(null)

  // Auto-scroll sync state
  const [currentTime, setCurrentTime] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const transcriptContainerRef = useRef(null)
  const segmentRefs = useRef([])

  // Inline editing state
  const [editingSegment, setEditingSegment] = useState(null)
  const [editText, setEditText] = useState('')

  // Speaker editing state
  const [editingSpeaker, setEditingSpeaker] = useState(null) // speaker index
  const [speakerEditValue, setSpeakerEditValue] = useState('')
  const [knownSpeakers, setKnownSpeakers] = useState([])
  const [showSpeakerSuggestions, setShowSpeakerSuggestions] = useState(false)
  const speakerInputRef = useRef(null)

  // Detail view tab: 'transcription' | 'summary' | 'tags' | 'ask'
  const [detailTab, setDetailTab] = useState('transcription')

  // Transcript view mode: 'refined' (default) or 'original'
  const [transcriptMode, setTranscriptMode] = useState('refined')
  const [refining, setRefining] = useState(false)

  // Segment selection for range-limited summary
  const [selectedSegmentIds, setSelectedSegmentIds] = useState(new Set())
  const [lastSelectedIdx, setLastSelectedIdx] = useState(null)
  const [useSelection, setUseSelection] = useState(false) // checkbox in summary tab
  const selectionLoadedRef = useRef(false)

  // Summary model override
  const [sumProvider, setSumProvider] = useState('')
  const [sumModel, setSumModel] = useState('')

  // Custom prompt for summary
  const [showCustomPrompt, setShowCustomPrompt] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')

  // AI Ask chat state
  const [askInput, setAskInput] = useState('')
  const [askHistory, setAskHistory] = useState([]) // { role: 'user'|'assistant', content }
  const [askLoading, setAskLoading] = useState(false)
  const [askProvider, setAskProvider] = useState('')
  const [askModel, setAskModel] = useState('')
  const askEndRef = useRef(null)

  // Export menu
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showRevealMenu, setShowRevealMenu] = useState(false)

  // Whether the "エクスプローラで開く" button should be visible.
  // Docker / remote deploys can't usefully open a local file manager.
  const runtimeMode = tierInfo?.runtimeMode
  const canReveal = runtimeMode === 'electron' || runtimeMode === 'standalone'

  const handleReveal = async (target) => {
    setShowRevealMenu(false)
    try {
      await revealRecording(id, target)
      addToast(target === 'data_dir' ? 'データフォルダを開きました' : 'エクスプローラを開きました', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  // Delete confirmation dialog
  const [confirmDelete, setConfirmDelete] = useState(null) // { type: 'recording' | 'summary', id? }

  const fetchData = useCallback(async () => {
    try {
      const [rec, tmpls, folders] = await Promise.all([getRecording(id), getTemplates(), getFolders()])
      setRecording(rec)
      setTemplates(tmpls)
      // Auto-select default template
      if (!selectedTemplate) {
        const defaultTmpl = tmpls.find(t => t.is_default)
        if (defaultTmpl) setSelectedTemplate(String(defaultTmpl.id))
      }
      setTitle(rec.title || rec.id)
      setAllFolders(folders)
      setRecFolders(rec.folders || [])

      // Load saved summary segment selection (only on initial load, not on re-fetch)
      if (!selectionLoadedRef.current) {
        selectionLoadedRef.current = true
        if (Array.isArray(rec.summary_segment_ids) && rec.summary_segment_ids.length > 0) {
          setSelectedSegmentIds(new Set(rec.summary_segment_ids))
          setUseSelection(true)
        }
      }
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [id, addToast])

  useEffect(() => { fetchData() }, [fetchData])

  // Load known speakers for autocomplete
  useEffect(() => {
    getKnownSpeakers().then(setKnownSpeakers).catch(() => {})
  }, [])

  // Load chat history from DB
  useEffect(() => {
    getChatHistory(id).then(msgs => {
      if (msgs?.length > 0) {
        setAskHistory(msgs.map(m => ({ role: m.role, content: m.content })))
      }
    }).catch(() => {})
  }, [id])

  // Load default provider/model for summary and ask
  useEffect(() => {
    getSettings().then(s => {
      setSumProvider(s.default_summary_provider || 'openai')
      setSumModel(s.default_summary_model || 'gpt-5.4-mini')
      setAskProvider(s.default_ask_provider || s.default_summary_provider || 'openai')
      setAskModel(s.default_ask_model || s.default_summary_model || 'gpt-5.4-mini')
    }).catch(() => {})
  }, [])

  // Auto-refresh while processing (pauses when tab is not visible).
  // Interval is kept short (2s) because refine + summary now run in parallel
  // on the server — refined text typically lands within ~5s of the transcription
  // finishing, and we want the UI to pick it up promptly so the user can start
  // reading the refined transcript while summary is still running.
  const prevStatusRef = useRef(null)
  const prevHasRefinedRef = useRef(false)
  useEffect(() => {
    if (!recording) return

    // Detect transition to completed: fetch one last time to get summary
    if (prevStatusRef.current && prevStatusRef.current !== 'completed' && recording.status === 'completed') {
      fetchData()
    }
    prevStatusRef.current = recording.status

    // Refined text just became available → let the user know, especially
    // during the brief window where summary is still running. Their transcript
    // view will have already auto-switched to the refined version since
    // transcriptMode='refined' is the default.
    // Access through recording.transcription (not the `transcription` const,
    // which is declared further down the component — referencing it here
    // would hit the temporal dead zone when the effect body first runs).
    const recTrans = recording.transcription
    const hasRefined = !!(recTrans?.refined_segments || recTrans?.refined_segments_json)
    if (!prevHasRefinedRef.current && hasRefined && prevStatusRef.current !== 'completed' && recording.status !== 'completed') {
      addToast('整形が完了しました（要約は継続中...）', 'success', 4000)
    }
    prevHasRefinedRef.current = hasRefined

    if (!['transcribing', 'refining', 'summarizing', 'uploaded', 'transcribed'].includes(recording.status)) return

    let timer = null
    const start = () => { if (!timer) timer = setInterval(fetchData, 2000) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVis = () => document.hidden ? stop() : start()

    start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [recording, fetchData, addToast])

  // Audio timeupdate listener for auto-scroll
  useEffect(() => {
    if (!audioRef) return
    const handleTimeUpdate = () => setCurrentTime(audioRef.currentTime)
    audioRef.addEventListener('timeupdate', handleTimeUpdate)
    return () => audioRef.removeEventListener('timeupdate', handleTimeUpdate)
  }, [audioRef])

  // Auto-scroll to active segment
  useEffect(() => {
    if (!autoScroll || !recording?.transcription?.segments) return
    const segments = recording.transcription.segments
    // Find current segment
    let activeIdx = -1
    for (let i = 0; i < segments.length; i++) {
      if (currentTime >= segments[i].start && currentTime < (segments[i + 1]?.start ?? Infinity)) {
        activeIdx = i
        break
      }
    }
    if (activeIdx >= 0 && segmentRefs.current[activeIdx] && transcriptContainerRef.current) {
      const container = transcriptContainerRef.current
      const el = segmentRefs.current[activeIdx]
      const elTop = el.offsetTop - container.offsetTop
      const scrollTarget = elTop - container.clientHeight / 3
      container.scrollTo({ top: scrollTarget, behavior: 'smooth' })
    }
  }, [currentTime, autoScroll, recording])

  const handleSaveTitle = async () => {
    try {
      await updateRecording(id, { title })
      setEditingTitle(false)
      addToast('タイトルを更新しました', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleDeleteRecording = async () => {
    try {
      await deleteRecording(id)
      addToast('削除しました', 'success')
      navigate('/')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleDeleteSummary = async (summaryId) => {
    try {
      await deleteSummary(summaryId)
      setActiveSummaryTab(0)
      fetchData()
      addToast('要約を削除しました', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  // Export helpers
  const buildTranscriptText = (segs) => {
    const segments = segs || activeSegments || transcription?.segments
    if (!segments) return ''
    const hasSpeakers = transcription?.speakers?.length > 1
    return segments.map(seg => {
      const speaker = speakerMap[seg.speaker] || seg.speaker
      const time = formatTime(seg.start)
      return hasSpeakers
        ? `[${time}] ${speaker}: ${seg.text}`
        : `[${time}] ${seg.text}`
    }).join('\n')
  }

  const buildExportMarkdown = () => {
    const lines = []
    lines.push(`# ${recording.title || recording.id}`)
    lines.push(``)
    lines.push(`- 日時: ${formatDateTime(recording.recorded_at)}`)
    if (recording.duration_sec) lines.push(`- 長さ: ${formatTime(recording.duration_sec)}`)
    if (tags.length > 0) lines.push(`- タグ: ${tags.map(t => t.name).join(', ')}`)
    lines.push(``)

    if (summaries.length > 0) {
      lines.push(`## 要約`)
      lines.push(``)
      summaries.forEach(s => {
        if (summaries.length > 1) lines.push(`### ${s.template_name || s.llm_model}`)
        lines.push(s.content)
        lines.push(``)
      })
    }

    if (transcription?.segments) {
      lines.push(`## 文字起こし`)
      lines.push(``)
      lines.push(buildTranscriptText())
    }

    return lines.join('\n')
  }

  const downloadFile = (content, filename, mimeType = 'text/markdown;charset=utf-8') => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadAudio = () => {
    const url = getAudioUrl(id)
    const ext = recording.file_path?.split('.').pop() || 'webm'
    const a = document.createElement('a')
    a.href = url
    a.download = `${recording.title || recording.id}.${ext}`
    a.click()
  }

  const exportTranscript = () => {
    const text = buildTranscriptText()
    if (!text) return addToast('文字起こしがありません', 'error')
    downloadFile(text, `${recording.title || recording.id}_transcript.txt`, 'text/plain;charset=utf-8')
  }

  const exportSummary = () => {
    if (summaries.length === 0) return addToast('要約がありません', 'error')
    const lines = summaries.map(s => {
      const header = summaries.length > 1 ? `## ${s.template_name || s.llm_model}\n\n` : ''
      return header + s.content
    })
    downloadFile(lines.join('\n\n---\n\n'), `${recording.title || recording.id}_summary.md`)
  }

  const exportAll = () => {
    const md = buildExportMarkdown()
    downloadFile(md, `${recording.title || recording.id}.md`)
  }

  // Two-step re-transcribe: user picks an engine in the dropdown (no API call),
  // then explicitly clicks the "実行" button. Prevents the previous bug where
  // multiple clicks during slow response queued multiple parallel jobs and
  // tripped the rate limiter.
  const handleRetranscribe = async () => {
    if (retranscribing) return // guard
    const engine = selectedRetryEngine // null = default
    setRetranscribing(true)
    try {
      await transcribeRecording(id, engine ? { engine } : undefined)
      const label = engine
        ? `${ENGINE_LABELS[engine] || engine} で再文字起こしを開始`
        : '文字起こしを開始しました'
      addToast(label, 'success')
      setShowEngineMenu(false)
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setRetranscribing(false)
    }
  }

  // Engine is already running on the server while these statuses are set.
  // Disable re-transcription until the previous run finishes.
  const isProcessing = ['transcribing', 'refining', 'summarizing'].includes(recording?.status)

  // Labels for the engine selection menu
  // (kept in this file to avoid a new module for static strings)

  const handleSummarize = async (promptOverride) => {
    // If custom prompt mode is selected but dialog not yet shown, open it
    if (selectedTemplate === '__custom__' && !promptOverride) {
      setShowCustomPrompt(true)
      return
    }
    setSummarizing(true)
    try {
      const body = {
        template_id: selectedTemplate === '__custom__' ? undefined : (selectedTemplate || undefined),
        provider: sumProvider || undefined,
        model: sumModel || undefined,
        granularity,
      }
      if (promptOverride) {
        body.custom_prompt = promptOverride
      }
      if (useSelection && selectedSegmentIds.size > 0) {
        body.selected_segment_ids = Array.from(selectedSegmentIds)
      }
      console.log('[Summarize] Request body:', JSON.stringify(body))
      await summarizeRecording(id, body)
      addToast('要約を生成しました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setSummarizing(false)
    }
  }

  // Segment selection handlers
  const handleSegmentToggle = (idx, shiftKey) => {
    const newSet = new Set(selectedSegmentIds)
    if (shiftKey && lastSelectedIdx !== null) {
      // Range selection: toggle all segments between lastSelectedIdx and idx
      const [start, end] = [lastSelectedIdx, idx].sort((a, b) => a - b)
      const shouldAdd = !newSet.has(idx) // based on current clicked state
      for (let i = start; i <= end; i++) {
        if (shouldAdd) newSet.add(i)
        else newSet.delete(i)
      }
    } else {
      if (newSet.has(idx)) newSet.delete(idx)
      else newSet.add(idx)
    }
    setSelectedSegmentIds(newSet)
    setLastSelectedIdx(idx)
    // Auto-enable useSelection when segments are selected
    if (newSet.size > 0) setUseSelection(true)
    else setUseSelection(false)
    // Save to server (debounced via timeout)
    saveSelection(newSet)
  }

  const handleSelectAll = () => {
    if (!activeSegments) return
    const all = new Set(activeSegments.map((_, i) => i))
    setSelectedSegmentIds(all)
    saveSelection(all)
  }

  const handleClearSelection = () => {
    setSelectedSegmentIds(new Set())
    setLastSelectedIdx(null)
    saveSelection(new Set())
    setUseSelection(false)
  }

  // Save selection immediately (no debounce — avoids race condition with fetchData)
  const saveSelection = (set) => {
    updateRecording(id, { summary_segment_ids: Array.from(set) }).catch(() => {})
  }

  const handleAddTag = async (e) => {
    e.preventDefault()
    if (!newTag.trim()) return
    try {
      await addTag(id, { name: newTag.trim() })
      setNewTag('')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleRemoveTag = async (tagId) => {
    try {
      await removeTag(id, tagId)
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleSpeakerEdit = async (speakerIndex, newLabel) => {
    if (!recording.transcription) return
    const speakers = [...recording.transcription.speakers]
    if (speakers[speakerIndex].label === newLabel) {
      setEditingSpeaker(null)
      return
    }
    speakers[speakerIndex] = { ...speakers[speakerIndex], label: newLabel }
    try {
      await updateTranscription(recording.transcription.id, { speakers_json: speakers })
      setEditingSpeaker(null)
      fetchData()
      // Refresh known speakers list
      getKnownSpeakers().then(setKnownSpeakers).catch(() => {})
      addToast(`話者名を「${newLabel}」に変更しました`, 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const startSpeakerEdit = (index, currentLabel) => {
    setEditingSpeaker(index)
    setSpeakerEditValue(currentLabel || '')
    setShowSpeakerSuggestions(true)
    setTimeout(() => speakerInputRef.current?.focus(), 50)
  }

  const speakerSuggestions = knownSpeakers
    .filter(s => s.name.toLowerCase().includes(speakerEditValue.toLowerCase()) && s.name !== speakerEditValue)
    .slice(0, 5)

  // Inline edit handlers
  const handleSegmentEditStart = (index, text) => {
    setEditingSegment(index)
    setEditText(text)
  }

  const handleSegmentEditSave = async (index) => {
    if (!recording.transcription) return
    const segments = [...recording.transcription.segments]
    segments[index] = { ...segments[index], text: editText }
    try {
      await updateTranscription(recording.transcription.id, { segments_json: segments })
      setEditingSegment(null)
      fetchData()
      addToast('テキストを更新しました', 'success')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleSegmentEditCancel = () => {
    setEditingSegment(null)
    setEditText('')
  }

  const seekAudio = (time) => {
    if (audioRef) {
      audioRef.currentTime = time
      audioRef.play()
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-400">読み込み中...</div>
  }

  if (!recording) {
    return <div className="p-6 text-gray-400">録音が見つかりません</div>
  }

  const transcription = recording.transcription
  const hasRefined = !!transcription?.refined_segments
  // Active segments based on view mode
  const activeSegments = (transcriptMode === 'refined' && hasRefined)
    ? transcription.refined_segments
    : transcription?.segments
  const summaries = recording.summaries || []
  const tags = recording.tags || []
  const highlights = recording.highlights || []

  // Build highlight lookup: { timestamp, label }
  const highlightTimes = highlights.map(h => h.timestamp_sec)

  // Get highlight labels for a segment
  const getSegmentHighlights = (seg) =>
    highlights.filter(h => h.timestamp_sec >= seg.start && h.timestamp_sec <= (seg.end || seg.start + 30))
  const speakerMap = {}
  const speakerIndexMap = {} // speaker id → index (for colors)
  if (transcription?.speakers) {
    transcription.speakers.forEach((s, i) => {
      speakerMap[s.id] = s.label || s.id
      speakerIndexMap[s.id] = i
    })
  }

  // Determine active segment index for highlight
  let activeSegmentIdx = -1
  if (transcription?.segments) {
    for (let i = 0; i < transcription.segments.length; i++) {
      const seg = transcription.segments[i]
      const nextStart = transcription.segments[i + 1]?.start ?? Infinity
      if (currentTime >= seg.start && currentTime < nextStart) {
        activeSegmentIdx = i
        break
      }
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white text-sm mb-2 block">
            ← 録音一覧に戻る
          </button>
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-lg font-bold bg-card border border-theme-light rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
              />
              <button onClick={handleSaveTitle} className="text-blue-500 text-sm">保存</button>
              <button onClick={() => setEditingTitle(false)} className="text-gray-400 text-sm">キャンセル</button>
            </div>
          ) : (
            <h1
              className="text-lg font-bold text-white cursor-pointer hover:text-gray-300"
              onClick={() => setEditingTitle(true)}
              title="クリックで編集"
            >
              {recording.title || recording.id}
            </h1>
          )}
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
            <StatusBadge status={recording.status} />
            <button
              onClick={async () => {
                const next = ((recording.importance || 1) % 3) + 1
                await updateRecording(recording.id, { importance: next })
                setRecording(r => ({ ...r, importance: next }))
              }}
              className="text-yellow-700/60 hover:text-yellow-500 transition-colors"
              title={`重要度: ${'★'.repeat(recording.importance || 1)} (クリックで変更)`}
            >
              {'★'.repeat(recording.importance || 1)}{'☆'.repeat(3 - (recording.importance || 1))}
            </button>
            <span>{formatDateTime(recording.recorded_at)}</span>
            {recording.duration_sec && <span>{formatTime(recording.duration_sec)}</span>}
            {recording.processed_locally ? (
              <span
                className="bg-green-900/40 text-green-400 px-2 py-0.5 rounded text-xs"
                title="この録音はオフラインで処理されています。デフォルトではAPI処理の対象外です。"
              >
                🔒 ローカル処理
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="text-gray-400 hover:text-white text-sm"
            >
              ↓ エクスポート
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 top-8 bg-card border border-theme rounded-lg shadow-xl z-50 py-1 w-52">
                  <button
                    onClick={() => { exportAll(); setShowExportMenu(false) }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white"
                  >
                    すべて (Markdown)
                  </button>
                  <div className="border-t border-theme my-1" />
                  <button
                    onClick={() => { downloadAudio(); setShowExportMenu(false) }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white"
                  >
                    音声ファイル
                  </button>
                  <button
                    onClick={() => { exportTranscript(); setShowExportMenu(false) }}
                    disabled={!transcription?.segments}
                    className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    文字起こし (テキスト)
                  </button>
                  <button
                    onClick={() => { exportSummary(); setShowExportMenu(false) }}
                    disabled={summaries.length === 0}
                    className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    要約 (Markdown)
                  </button>
                  <button
                    onClick={() => {
                      if (askHistory.length === 0) return addToast('質問履歴がありません', 'error')
                      const lines = askHistory.map(m =>
                        m.role === 'user' ? `Q: ${m.content}` : `A: ${m.content}`
                      )
                      const text = `# ${recording.title || recording.id} — AI質問履歴\n\n${lines.join('\n\n')}`
                      downloadFile(text, `${recording.title || recording.id}_chat.md`)
                      setShowExportMenu(false)
                    }}
                    disabled={askHistory.length === 0}
                    className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    AI質問履歴 (Markdown)
                  </button>
                </div>
              </>
            )}
          </div>

          {/* エクスプローラで開く — only in Electron/Standalone (not Docker) */}
          {canReveal && (
            <div className="relative">
              <button
                onClick={() => setShowRevealMenu(!showRevealMenu)}
                className="text-gray-400 hover:text-white text-sm"
                title="ファイルの場所を開く"
              >
                📁 エクスプローラで開く
              </button>
              {showRevealMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowRevealMenu(false)} />
                  <div className="absolute right-0 top-8 bg-card border border-theme rounded-lg shadow-xl z-50 py-1 w-72">
                    <button
                      onClick={() => handleReveal('audio')}
                      className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white"
                    >
                      🎵 音声ファイルの場所
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        エクスプローラでファイルを選択状態で表示
                      </div>
                    </button>
                    <div className="border-t border-theme my-1" />
                    <button
                      onClick={() => handleReveal('data_dir')}
                      className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white"
                    >
                      📂 データフォルダ全体
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        voicescope.db（全文字起こし・要約）が見えます
                      </div>
                    </button>
                    <div className="border-t border-theme my-1" />
                    <div className="px-4 py-2 text-[10px] text-gray-400 leading-relaxed">
                      ※ 音声は個別ファイル（.webm等）ですが、文字起こし・要約は <code className="bg-input px-1 rounded">voicescope.db</code> という1つのSQLiteファイルに収められています。
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            onClick={() => setConfirmDelete({ type: 'recording' })}
            className="text-gray-400 hover:text-red-400 text-sm"
          >
            削除
          </button>
        </div>
      </div>

      {/* Error banner */}
      {recording.status === 'error' && (
        <div className="mb-4 bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300 flex items-center justify-between">
          <div>
            <span className="font-medium">処理エラー: </span>
            {recording.title?.startsWith('[Error]')
              ? recording.title.slice(8)
              : 'パイプライン処理中にエラーが発生しました。設定画面でAPIキーが正しく設定されているか確認してください。'}
          </div>
          <button
            onClick={async () => {
              try {
                await reprocessRecording(id)
                addToast('パイプラインを再実行しています', 'success')
                setTimeout(fetchData, 2000)
              } catch (err) {
                addToast(err.message, 'error')
              }
            }}
            className="ml-4 bg-red-800 hover:bg-red-700 text-white px-3 py-1 rounded text-xs shrink-0"
          >
            再処理
          </button>
        </div>
      )}

      {/* Audio Player */}
      <div className="mb-6">
        <audio
          ref={setAudioRef}
          src={getAudioUrl(id)}
          controls
          className="w-full"
        />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-4 border-b border-theme">
        {[
          { key: 'transcription', label: '文字起こし' },
          { key: 'summary', label: `要約${summaries.length > 0 ? ` (${summaries.length})` : ''}` },
          { key: 'tags', label: `タグ${tags.length > 0 ? ` (${tags.length})` : ''}` },
          { key: 'ask', label: 'AI質問' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setDetailTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              detailTab === tab.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-300 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {/* Transcription tab */}
        {detailTab === 'transcription' && <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              {/* Original / Refined toggle */}
              {transcription && (
                <div className="flex bg-card border border-theme-light rounded overflow-hidden">
                  <button
                    onClick={() => setTranscriptMode('refined')}
                    className={`text-xs px-2.5 py-1 ${transcriptMode === 'refined' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    {hasRefined ? '整形済み' : '整形中...'}
                  </button>
                  <button
                    onClick={() => setTranscriptMode('original')}
                    className={`text-xs px-2.5 py-1 ${transcriptMode === 'original' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    原文
                  </button>
                </div>
              )}
              {/* Manual refine button (if not yet refined) */}
              {transcription && !hasRefined && (
                <button
                  onClick={async () => {
                    setRefining(true)
                    try {
                      await refineRecording(id)
                      addToast('整形が完了しました', 'success')
                      fetchData()
                    } catch (err) {
                      addToast(err.message, 'error')
                    } finally {
                      setRefining(false)
                    }
                  }}
                  disabled={refining}
                  className="text-xs text-blue-500 hover:text-blue-400 disabled:text-gray-400"
                >
                  {refining ? '整形中...' : '整形実行'}
                </button>
              )}
              <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded w-3 h-3"
                />
                自動スクロール
              </label>
              {transcription && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(buildTranscriptText())
                    addToast('文字起こしをコピーしました', 'success')
                  }}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  コピー
                </button>
              )}
              <div className="relative">
                <button
                  onClick={() => setShowEngineMenu((v) => !v)}
                  disabled={isProcessing || retranscribing}
                  className="text-xs text-blue-500 hover:text-blue-400 disabled:text-gray-500 disabled:cursor-not-allowed"
                  title={
                    isProcessing
                      ? '処理中のため再実行できません。完了まで待ってください'
                      : transcription
                        ? `現在のエンジン: ${ENGINE_LABELS[transcription.engine] || transcription.engine}`
                        : ''
                  }
                >
                  {isProcessing ? '処理中...' : '再実行 ▾'}
                </button>
                {showEngineMenu && !isProcessing && (
                  <>
                    {/* Click-away layer */}
                    <div className="fixed inset-0 z-10" onClick={() => setShowEngineMenu(false)} />
                    <div className="absolute right-0 mt-1 z-20 bg-card border border-theme-light rounded-lg shadow-2xl py-1 w-72">
                      <div className="px-3 py-1.5 text-[10px] text-gray-400 border-b border-theme-light">
                        エンジンを選んで「実行」ボタンを押してください
                        {transcription && (
                          <div className="text-[9px] text-gray-500 mt-0.5">
                            現在: {ENGINE_LABELS[transcription.engine] || transcription.engine}
                          </div>
                        )}
                      </div>

                      {/* Default option */}
                      <button
                        onClick={() => setSelectedRetryEngine(null)}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-theme-light ${
                          selectedRetryEngine === null ? 'bg-blue-600/20 text-white' : 'text-gray-200'
                        }`}
                      >
                        <span className="w-3 inline-block">{selectedRetryEngine === null ? '✓' : ''}</span>
                        <span>デフォルト（設定で選択したエンジン）</span>
                      </button>

                      <div className="border-t border-theme-light my-1" />

                      {/* Per-engine options */}
                      {Object.entries(ENGINE_LABELS).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setSelectedRetryEngine(key)}
                          className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-theme-light ${
                            selectedRetryEngine === key ? 'bg-blue-600/20 text-white' : 'text-gray-200'
                          }`}
                        >
                          <span className="w-3 inline-block">{selectedRetryEngine === key ? '✓' : ''}</span>
                          <span className="flex-1">{label}</span>
                          {transcription?.engine === key && (
                            <span className="text-[10px] text-gray-500">（現在）</span>
                          )}
                        </button>
                      ))}

                      {/* Execute button */}
                      <div className="border-t border-theme-light mt-1 pt-1 px-2 pb-1">
                        <button
                          onClick={handleRetranscribe}
                          disabled={retranscribing}
                          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white text-xs px-3 py-1.5 rounded transition-colors"
                        >
                          {retranscribing ? '実行中...' : '▶ 実行'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {transcription ? (
            <div
              ref={transcriptContainerRef}
              className="bg-card border border-theme rounded-lg p-4 max-h-[600px] overflow-y-auto space-y-3"
            >
              {/* Speaker labels */}
              {transcription.speakers?.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-theme">
                  {transcription.speakers.map((speaker, i) => {
                    const color = getSpeakerColor(i)
                    const isEditing = editingSpeaker === i
                    const displayLabel = speaker.label || speaker.id

                    return (
                      <div key={speaker.id} className="relative">
                        {isEditing ? (
                          <div className="relative">
                            <input
                              ref={speakerInputRef}
                              value={speakerEditValue}
                              onChange={(e) => {
                                setSpeakerEditValue(e.target.value)
                                setShowSpeakerSuggestions(true)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSpeakerEdit(i, speakerEditValue.trim() || speaker.id)
                                  setShowSpeakerSuggestions(false)
                                }
                                if (e.key === 'Escape') {
                                  setEditingSpeaker(null)
                                  setShowSpeakerSuggestions(false)
                                }
                              }}
                              onBlur={() => {
                                // Delay to allow click on suggestion
                                setTimeout(() => {
                                  if (editingSpeaker === i) {
                                    handleSpeakerEdit(i, speakerEditValue.trim() || speaker.id)
                                  }
                                  setShowSpeakerSuggestions(false)
                                }, 200)
                              }}
                              placeholder={speaker.id}
                              className={`text-sm px-3 py-1 rounded-full border ${color.border} bg-input ${color.text} focus:outline-none w-36`}
                            />
                            {/* Autocomplete suggestions */}
                            {showSpeakerSuggestions && speakerSuggestions.length > 0 && (
                              <div className="absolute top-full left-0 mt-1 bg-input border border-theme-light rounded-lg shadow-lg z-50 w-48 overflow-hidden">
                                {speakerSuggestions.map((s) => (
                                  <button
                                    key={s.name}
                                    onMouseDown={(e) => {
                                      e.preventDefault()
                                      setSpeakerEditValue(s.name)
                                      handleSpeakerEdit(i, s.name)
                                      setShowSpeakerSuggestions(false)
                                    }}
                                    className="w-full text-left text-sm px-3 py-1.5 text-gray-300 hover:bg-gray-700 flex items-center justify-between"
                                  >
                                    <span>{s.name}</span>
                                    <span className="text-xs text-gray-400">使用{s.usage_count}回</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => startSpeakerEdit(i, displayLabel === speaker.id ? '' : displayLabel)}
                            className={`inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border border-transparent ${color.bg} ${color.text} hover:border-gray-600 transition-colors cursor-pointer`}
                            title="クリックで話者名を編集"
                          >
                            <span className={`w-2 h-2 rounded-full ${color.dot}`} />
                            {displayLabel}
                            <span className="text-xs opacity-50 ml-0.5">✎</span>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Selection toolbar */}
              {activeSegments?.length > 0 && (
                <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-theme mb-3 py-2 -mx-2 px-2">
                  <div className="flex items-center gap-3 text-xs">
                    {selectedSegmentIds.size > 0 ? (
                      <>
                        <span className="text-purple-400 font-medium">
                          {selectedSegmentIds.size}件選択中
                        </span>
                        <button
                          onClick={handleClearSelection}
                          className="text-gray-400 hover:text-white"
                          title="選択を解除"
                        >
                          クリア
                        </button>
                        <span className="text-gray-400">|</span>
                      </>
                    ) : (
                      <span className="text-gray-400">
                        要約範囲を選択
                      </span>
                    )}
                    <button
                      onClick={handleSelectAll}
                      className="text-gray-400 hover:text-white"
                    >
                      すべて選択
                    </button>
                    <span className="text-gray-400 ml-auto">
                      💡 Shift+クリックで範囲選択
                    </span>
                  </div>
                </div>
              )}

              {/* Segments */}
              {activeSegments?.map((seg, i) => {
                const hasHighlight = highlightTimes.some(
                  t => t >= seg.start && t <= (seg.end || seg.start + 30)
                )
                const isSelected = selectedSegmentIds.has(i)
                return (
                <div
                  key={i}
                  ref={(el) => (segmentRefs.current[i] = el)}
                  className={`group rounded px-2 py-1 -mx-2 transition-colors ${
                    isSelected
                      ? 'bg-purple-500/15 border-l-2 border-purple-500'
                      : hasHighlight
                      ? 'bg-yellow-500/10 border-l-2 border-yellow-500'
                      : activeSegmentIdx === i
                        ? 'bg-blue-500/10 border-l-2 border-blue-500'
                        : 'border-l-2 border-transparent hover:bg-input/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => handleSegmentToggle(i, e.nativeEvent.shiftKey)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 shrink-0 rounded accent-purple-500 cursor-pointer"
                      title="クリックで選択 / Shift+クリックで範囲選択"
                    />
                    <button
                      onClick={() => seekAudio(seg.start)}
                      className={`text-xs mt-0.5 shrink-0 font-mono transition-colors ${
                        activeSegmentIdx === i ? 'text-blue-400' : 'text-gray-400 hover:text-blue-400'
                      }`}
                    >
                      {formatTime(seg.start)}
                      {hasHighlight && <span className="text-yellow-400 ml-0.5">★</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      {hasHighlight && getSegmentHighlights(seg).some(h => h.label) && (
                        <div className="mb-1 space-y-0.5">
                          {getSegmentHighlights(seg).filter(h => h.label).map((h, hi) => (
                            <div key={hi} className="inline-flex items-center gap-1 text-xs bg-yellow-500/15 text-yellow-300 rounded px-2 py-0.5 mr-1">
                              <span>📝</span> {h.label}
                            </div>
                          ))}
                        </div>
                      )}
                      {transcription.speakers?.length > 1 && seg.speaker && (
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${getSpeakerColor(speakerIndexMap[seg.speaker] ?? 0).text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${getSpeakerColor(speakerIndexMap[seg.speaker] ?? 0).dot}`} />
                          {speakerMap[seg.speaker] || seg.speaker}
                        </span>
                      )}
                      {editingSegment === i ? (
                        <div className="mt-1">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full bg-input border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none font-normal resize-none"
                            rows={3}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSegmentEditSave(i)
                              if (e.key === 'Escape') handleSegmentEditCancel()
                            }}
                          />
                          <div className="flex gap-2 mt-1">
                            <button
                              onClick={() => handleSegmentEditSave(i)}
                              className="text-xs text-blue-400 hover:text-blue-300"
                            >
                              保存 (Ctrl+Enter)
                            </button>
                            <button
                              onClick={handleSegmentEditCancel}
                              className="text-xs text-gray-400 hover:text-gray-400"
                            >
                              キャンセル (Esc)
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p
                          className="text-sm text-gray-300 leading-relaxed cursor-pointer hover:text-white"
                          onClick={() => handleSegmentEditStart(i, seg.text)}
                          title="クリックで編集"
                        >
                          {seg.text}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-card border border-theme rounded-lg p-8 text-center text-gray-400">
              {recording.status === 'transcribing' ? '文字起こし中...' : '文字起こしがありません'}
            </div>
          )}
        </div>}

        {/* Summary tab */}
        {detailTab === 'summary' && <div>
          {/* Generate controls */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="bg-card border border-theme-light rounded text-xs px-2 py-1.5 text-gray-300"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_default ? ' (デフォルト)' : ''}
                </option>
              ))}
              <option value="__custom__">✏️ カスタムプロンプト</option>
            </select>
            {selectedTemplate !== '__custom__' && (
              <select
                value={granularity}
                onChange={(e) => setGranularity(e.target.value)}
                className="bg-card border border-theme-light rounded text-xs px-2 py-1.5 text-gray-300"
              >
                <option value="brief">簡易</option>
                <option value="normal">通常</option>
                <option value="detailed">詳細</option>
              </select>
            )}
            <select
              value={sumProvider}
              onChange={(e) => {
                const p = e.target.value
                setSumProvider(p)
                const models = PROVIDER_MODELS[p]
                if (models && !models.some(m => m.value === sumModel)) {
                  setSumModel(models[0].value)
                }
              }}
              className="bg-card border border-theme-light rounded text-xs px-2 py-1 text-gray-300"
            >
              {summaryProviders.filter(p => p === 'ollama' || (sumProviderModels[p] || []).length > 0).map(p => (
                <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
              ))}
            </select>
            {(PROVIDER_MODELS[sumProvider] || []).length > 0 ? (
              <select
                value={sumModel}
                onChange={(e) => setSumModel(e.target.value)}
                className="bg-card border border-theme-light rounded text-xs px-2 py-1 text-gray-300"
              >
                {(PROVIDER_MODELS[sumProvider] || []).map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            ) : (
              <input
                value={sumModel}
                onChange={(e) => setSumModel(e.target.value)}
                placeholder="モデル名を入力 (例: gemma3)"
                className="bg-card border border-theme-light rounded text-xs px-2 py-1.5 text-gray-300 w-36"
              />
            )}
            {selectedSegmentIds.size > 0 && (
              <label
                className="flex items-center gap-1.5 text-xs text-purple-400 cursor-pointer"
                title="文字起こしタブで選択した範囲のみを要約します"
              >
                <input
                  type="checkbox"
                  checked={useSelection}
                  onChange={(e) => setUseSelection(e.target.checked)}
                  className="rounded accent-purple-500"
                />
                指定範囲のみ ({selectedSegmentIds.size}件)
              </label>
            )}
            <button
              onClick={() => handleSummarize()}
              disabled={summarizing || !transcription}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white px-3 py-1 rounded transition-colors"
            >
              {summarizing ? '生成中...' : '要約生成'}
            </button>
          </div>

            {summaries.length > 0 ? (
              <div>
                {/* Summary tabs — show all past summaries */}
                <div className="flex gap-1 mb-2 overflow-x-auto">
                  {summaries.map((s, i) => {
                    const timeLabel = formatDateTimeShort(s.created_at)
                    return (
                      <button
                        key={s.id}
                        onClick={() => setActiveSummaryTab(i)}
                        className={`text-xs px-3 py-1.5 rounded shrink-0 ${
                          activeSummaryTab === i
                            ? 'bg-gray-700 text-white'
                            : 'text-gray-400 hover:text-gray-300'
                        }`}
                        title={`${s.llm_provider}/${s.llm_model} — ${timeLabel}`}
                      >
                        {s.template_name || s.llm_model} ({timeLabel})
                      </button>
                    )
                  })}
                </div>

                {/* Active summary */}
                {summaries[activeSummaryTab] && (
                  <div className="bg-card border border-theme rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3 text-xs text-gray-400">
                      <span>{summaries[activeSummaryTab].llm_provider} / {summaries[activeSummaryTab].llm_model}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(summaries[activeSummaryTab].content)
                            addToast('要約をコピーしました', 'success')
                          }}
                          className="hover:text-white"
                          title="クリップボードにコピー"
                        >
                          コピー
                        </button>
                        <button
                          onClick={() => {
                            const s = summaries[activeSummaryTab]
                            downloadFile(s.content, `${recording.title || recording.id}_summary.md`)
                          }}
                          className="hover:text-white"
                          title="Markdownファイルとしてダウンロード"
                        >
                          ↓保存
                        </button>
                        <button
                          onClick={() => setConfirmDelete({ type: 'summary', id: summaries[activeSummaryTab].id })}
                          className="hover:text-red-400"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <div className="md-content text-sm">
                      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{summaries[activeSummaryTab].content}</Markdown>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-card border border-theme rounded-lg p-8 text-center text-gray-400">
                {recording.status === 'summarizing' ? '要約生成中...' : '要約がありません'}
              </div>
            )}
        </div>}

        {/* Tags tab */}
        {detailTab === 'tags' && <div>
          <div className="bg-card border border-theme rounded-lg p-4">
            <div className="flex flex-wrap gap-2 mb-3">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                  style={{ backgroundColor: tag.color + '40', color: lightenColor(tag.color) }}
                >
                  {tag.name}
                  <button
                    onClick={() => handleRemoveTag(tag.id)}
                    className="hover:opacity-70 ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
              {tags.length === 0 && <span className="text-gray-400 text-sm">タグなし</span>}
            </div>
            <form onSubmit={handleAddTag} className="flex gap-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="タグを追加..."
                className="flex-1 bg-input border border-theme-light rounded px-2 py-1 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded"
              >
                追加
              </button>
            </form>
          </div>

          {/* Folder assignment */}
          <div className="bg-card border border-theme rounded-lg p-4 mt-3">
            <h4 className="text-sm font-medium text-gray-300 mb-2">📁 フォルダ</h4>
            <div className="flex flex-wrap gap-2 mb-3">
              {recFolders.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1 bg-blue-900/30 text-blue-300 px-2 py-1 rounded text-xs">
                  {f.icon || '📁'} {f.name}
                  <button
                    onClick={async () => {
                      await removeRecordingFromFolder(f.id, id)
                      setRecFolders(prev => prev.filter(rf => rf.id !== f.id))
                    }}
                    className="hover:text-white ml-0.5"
                  >×</button>
                </span>
              ))}
              {recFolders.length === 0 && <span className="text-gray-400 text-sm">フォルダなし</span>}
            </div>
            {allFolders.filter(f => !recFolders.some(rf => rf.id === f.id)).length > 0 && (
              <select
                onChange={async (e) => {
                  const folderId = Number(e.target.value)
                  if (!folderId) return
                  const folder = allFolders.find(f => f.id === folderId)
                  await addRecordingToFolder(folderId, id)
                  setRecFolders(prev => [...prev, folder])
                  e.target.value = ''
                }}
                className="bg-input border border-theme-light rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                defaultValue=""
              >
                <option value="" disabled>フォルダに追加...</option>
                {allFolders
                  .filter(f => !recFolders.some(rf => rf.id === f.id))
                  .map(f => <option key={f.id} value={f.id}>{f.icon || '📁'} {f.name}</option>)
                }
              </select>
            )}
          </div>
        </div>}

        {/* Ask AI tab */}
        {detailTab === 'ask' && <div className="flex flex-col" style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }}>
          {/* Chat controls */}
          {askHistory.length > 0 && (
            <div className="flex justify-end gap-2 mb-2">
              <button
                onClick={() => {
                  const lines = askHistory.map(m =>
                    m.role === 'user' ? `Q: ${m.content}` : `A: ${m.content}`
                  )
                  const text = `# ${recording.title || recording.id} — AI質問履歴\n\n${lines.join('\n\n')}`
                  downloadFile(text, `${recording.title || recording.id}_chat.md`)
                }}
                className="text-xs text-gray-400 hover:text-white"
              >
                ↓ 履歴エクスポート
              </button>
              <button
                onClick={async () => {
                  if (!confirm('チャット履歴をすべて削除しますか？')) return
                  try {
                    await clearChatHistory(id)
                    setAskHistory([])
                    addToast('チャット履歴を削除しました', 'success')
                  } catch (err) {
                    addToast(err.message, 'error')
                  }
                }}
                className="text-xs text-gray-400 hover:text-red-400"
              >
                履歴クリア
              </button>
            </div>
          )}
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto bg-card border border-theme rounded-lg p-4 mb-3 space-y-4">
            {askHistory.length === 0 && (
              <div className="text-center text-gray-400 py-12">
                <p className="text-lg mb-2">💬 この録音について質問できます</p>
                <p className="text-sm">文字起こし・要約の内容をもとにAIが回答します</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {['この会議の決定事項は？', '主な論点をまとめて', 'TODO・アクションアイテムは？'].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setAskInput(q); }}
                      className="text-xs bg-theme hover:bg-theme-light text-gray-300 px-3 py-1.5 rounded-full transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {askHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-blue-600/30 text-blue-100'
                    : 'bg-theme text-gray-200'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div className="md-content text-sm">
                      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{msg.content}</Markdown>
                    </div>
                  ) : (
                    <p className="text-sm">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {askLoading && (
              <div className="flex justify-start">
                <div className="bg-theme text-gray-400 rounded-lg px-4 py-2.5 text-sm">
                  考え中...
                </div>
              </div>
            )}
            <div ref={askEndRef} />
          </div>

          {/* Model selector */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-400">モデル:</span>
            <select
              value={askProvider}
              onChange={(e) => {
                const p = e.target.value
                setAskProvider(p)
                const models = askProviderModels[p]
                if (models && !models.some(m => m.value === askModel)) {
                  setAskModel(models[0].value)
                }
              }}
              className="bg-card border border-theme-light rounded text-xs px-2 py-1 text-gray-300"
            >
              {askProviders.filter(p => p === 'ollama' || (askProviderModels[p] || []).length > 0).map(p => (
                <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
              ))}
            </select>
            {(askProviderModels[askProvider] || []).length > 0 ? (
              <select
                value={askModel}
                onChange={(e) => setAskModel(e.target.value)}
                className="bg-card border border-theme-light rounded text-xs px-2 py-1 text-gray-300"
              >
                {(askProviderModels[askProvider] || []).map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            ) : (
              <input
                value={askModel}
                onChange={(e) => setAskModel(e.target.value)}
                placeholder="モデル名を入力 (例: gemma3)"
                className="bg-card border border-theme-light rounded text-xs px-2 py-1.5 text-gray-300 w-36"
              />
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const q = askInput.trim()
              if (!q || askLoading) return
              const newHistory = [...askHistory, { role: 'user', content: q }]
              setAskHistory(newHistory)
              setAskInput('')
              setAskLoading(true)
              setTimeout(() => askEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
              try {
                const res = await askRecording(id, q, askHistory, { provider: askProvider, model: askModel })
                setAskHistory([...newHistory, { role: 'assistant', content: res.answer }])
              } catch (err) {
                setAskHistory([...newHistory, { role: 'assistant', content: `エラー: ${err.message}` }])
                addToast(err.message, 'error')
              } finally {
                setAskLoading(false)
                setTimeout(() => askEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
              }
            }}
            className="flex gap-2"
          >
            <input
              value={askInput}
              onChange={(e) => setAskInput(e.target.value)}
              placeholder="この録音について質問..."
              disabled={askLoading || !transcription}
              className="flex-1 bg-input border border-theme-light rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={askLoading || !askInput.trim() || !transcription}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 text-white text-sm rounded-lg transition-colors"
            >
              {askLoading ? '...' : '送信'}
            </button>
          </form>
          {!transcription && (
            <p className="text-xs text-gray-400 mt-1">文字起こしが完了してから質問できます</p>
          )}
        </div>}
      </div>

      {/* Custom prompt dialog */}
      {showCustomPrompt && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowCustomPrompt(false)}>
          <div className="bg-card border border-theme-light rounded-xl max-w-lg w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">カスタムプロンプトで要約</h3>
            <p className="text-xs text-gray-400 mb-4">
              文字起こし全文をこのプロンプトと一緒にLLMに送ります。特定の話題の抽出、特定フォーマットでの出力など自由に指示できます。
            </p>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="例: 「予算」に関する話題だけを抽出して、箇条書きでまとめてください。"
              className="w-full bg-input border border-theme-light rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-y"
              rows={5}
              autoFocus
            />
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowCustomPrompt(false)} className="text-sm text-gray-400 hover:text-white px-4 py-2">
                キャンセル
              </button>
              <button
                onClick={() => {
                  if (!customPrompt.trim()) return
                  setShowCustomPrompt(false)
                  handleSummarize(customPrompt.trim())
                }}
                disabled={!customPrompt.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white text-sm px-5 py-2 rounded-lg font-medium"
              >
                この指示で要約する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.type === 'recording' ? '録音を削除' : '要約を削除'}
        message={
          confirmDelete?.type === 'recording'
            ? 'この録音を削除しますか？音声ファイル・文字起こし・要約がすべて削除されます。この操作は取り消せません。'
            : 'この要約を削除しますか？'
        }
        confirmLabel="削除する"
        onConfirm={() => {
          if (confirmDelete?.type === 'recording') {
            handleDeleteRecording()
          } else if (confirmDelete?.type === 'summary') {
            handleDeleteSummary(confirmDelete.id)
          }
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
