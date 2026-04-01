import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Markdown from 'react-markdown'
import {
  getRecording, updateRecording, deleteRecording,
  transcribeRecording, summarizeRecording, deleteSummary,
  updateTranscription, addTag, removeTag, getTemplates,
  getAudioUrl,
} from '../lib/api'
import { useAppStore } from '../stores/appStore'
import StatusBadge from '../components/StatusBadge'

function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function RecordingDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const addToast = useAppStore((s) => s.addToast)

  const [recording, setRecording] = useState(null)
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState('')
  const [activeSummaryTab, setActiveSummaryTab] = useState(0)
  const [newTag, setNewTag] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [audioRef, setAudioRef] = useState(null)

  // Auto-scroll sync state
  const [currentTime, setCurrentTime] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const transcriptContainerRef = useRef(null)
  const segmentRefs = useRef([])

  // Inline editing state
  const [editingSegment, setEditingSegment] = useState(null)
  const [editText, setEditText] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const [rec, tmpls] = await Promise.all([getRecording(id), getTemplates()])
      setRecording(rec)
      setTemplates(tmpls)
      setTitle(rec.title || rec.id)
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [id, addToast])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-refresh while processing
  useEffect(() => {
    if (!recording) return
    if (['transcribing', 'summarizing', 'uploaded'].includes(recording.status)) {
      const timer = setInterval(fetchData, 3000)
      return () => clearInterval(timer)
    }
  }, [recording, fetchData])

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

  const handleDelete = async () => {
    if (!confirm('この録音を削除しますか？音声・文字起こし・要約がすべて削除されます。')) return
    try {
      await deleteRecording(id)
      addToast('削除しました', 'success')
      navigate('/')
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleRetranscribe = async () => {
    try {
      await transcribeRecording(id)
      addToast('文字起こしを開始しました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

  const handleSummarize = async () => {
    setSummarizing(true)
    try {
      await summarizeRecording(id, {
        template_id: selectedTemplate || undefined,
      })
      addToast('要約を生成しました', 'success')
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    } finally {
      setSummarizing(false)
    }
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
    speakers[speakerIndex] = { ...speakers[speakerIndex], label: newLabel }
    try {
      await updateTranscription(recording.transcription.id, { speakers_json: speakers })
      fetchData()
    } catch (err) {
      addToast(err.message, 'error')
    }
  }

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
    return <div className="p-6 text-gray-500">読み込み中...</div>
  }

  if (!recording) {
    return <div className="p-6 text-gray-500">録音が見つかりません</div>
  }

  const transcription = recording.transcription
  const summaries = recording.summaries || []
  const tags = recording.tags || []
  const speakerMap = {}
  if (transcription?.speakers) {
    transcription.speakers.forEach(s => { speakerMap[s.id] = s.label || s.id })
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
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-white text-sm mb-2 block">
            ← 録音一覧に戻る
          </button>
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-xl font-bold bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
              />
              <button onClick={handleSaveTitle} className="text-blue-500 text-sm">保存</button>
              <button onClick={() => setEditingTitle(false)} className="text-gray-500 text-sm">キャンセル</button>
            </div>
          ) : (
            <h1
              className="text-xl font-bold text-white cursor-pointer hover:text-gray-300"
              onClick={() => setEditingTitle(true)}
              title="クリックで編集"
            >
              {recording.title || recording.id}
            </h1>
          )}
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
            <StatusBadge status={recording.status} />
            <span>{new Date(recording.recorded_at).toLocaleString('ja-JP')}</span>
            {recording.duration_sec && <span>{formatTime(recording.duration_sec)}</span>}
          </div>
        </div>
        <button onClick={handleDelete} className="text-gray-500 hover:text-red-400 text-sm">削除</button>
      </div>

      {/* Audio Player */}
      <div className="mb-6">
        <audio
          ref={setAudioRef}
          src={getAudioUrl(id)}
          controls
          className="w-full"
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Transcription */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">文字起こし</h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded w-3 h-3"
                />
                自動スクロール
              </label>
              <button
                onClick={handleRetranscribe}
                className="text-xs text-blue-500 hover:text-blue-400"
              >
                再実行
              </button>
            </div>
          </div>

          {transcription ? (
            <div
              ref={transcriptContainerRef}
              className="bg-gray-900 border border-gray-800 rounded-lg p-4 max-h-[600px] overflow-y-auto space-y-3"
            >
              {/* Speaker labels */}
              {transcription.speakers?.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-gray-800">
                  {transcription.speakers.map((speaker, i) => (
                    <input
                      key={speaker.id}
                      defaultValue={speaker.label}
                      onBlur={(e) => handleSpeakerEdit(i, e.target.value)}
                      className="bg-gray-800 text-sm px-2 py-1 rounded text-gray-300 border border-gray-700 focus:outline-none focus:border-blue-500 w-32"
                      placeholder={speaker.id}
                    />
                  ))}
                </div>
              )}

              {/* Segments */}
              {transcription.segments?.map((seg, i) => (
                <div
                  key={i}
                  ref={(el) => (segmentRefs.current[i] = el)}
                  className={`group rounded px-2 py-1 -mx-2 transition-colors ${
                    activeSegmentIdx === i
                      ? 'bg-blue-500/10 border-l-2 border-blue-500'
                      : 'border-l-2 border-transparent hover:bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => seekAudio(seg.start)}
                      className={`text-xs mt-0.5 shrink-0 font-mono transition-colors ${
                        activeSegmentIdx === i ? 'text-blue-400' : 'text-gray-600 hover:text-blue-400'
                      }`}
                    >
                      {formatTime(seg.start)}
                    </button>
                    <div className="flex-1 min-w-0">
                      {transcription.speakers?.length > 1 && (
                        <span className="text-xs text-blue-400 font-medium">
                          {speakerMap[seg.speaker] || seg.speaker}
                        </span>
                      )}
                      {editingSegment === i ? (
                        <div className="mt-1">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full bg-gray-800 border border-blue-500 rounded px-2 py-1 text-sm text-white focus:outline-none font-normal resize-none"
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
                              className="text-xs text-gray-500 hover:text-gray-400"
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
              ))}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center text-gray-500">
              {recording.status === 'transcribing' ? '文字起こし中...' : '文字起こしがありません'}
            </div>
          )}
        </div>

        {/* Right: Summary + Tags */}
        <div>
          {/* Summary */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">要約</h2>
              <div className="flex items-center gap-2">
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded text-xs px-2 py-1 text-gray-300"
                >
                  <option value="">デフォルトテンプレート</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleSummarize}
                  disabled={summarizing || !transcription}
                  className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1 rounded transition-colors"
                >
                  {summarizing ? '生成中...' : '要約生成'}
                </button>
              </div>
            </div>

            {summaries.length > 0 ? (
              <div>
                {/* Summary tabs */}
                {summaries.length > 1 && (
                  <div className="flex gap-1 mb-2 overflow-x-auto">
                    {summaries.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => setActiveSummaryTab(i)}
                        className={`text-xs px-3 py-1.5 rounded shrink-0 ${
                          activeSummaryTab === i
                            ? 'bg-gray-700 text-white'
                            : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {s.template_name || s.llm_model}
                      </button>
                    ))}
                  </div>
                )}

                {/* Active summary */}
                {summaries[activeSummaryTab] && (
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3 text-xs text-gray-500">
                      <span>{summaries[activeSummaryTab].llm_provider} / {summaries[activeSummaryTab].llm_model}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(summaries[activeSummaryTab].content)
                            addToast('コピーしました', 'success')
                          }}
                          className="hover:text-white"
                        >
                          コピー
                        </button>
                        <button
                          onClick={async () => {
                            await deleteSummary(summaries[activeSummaryTab].id)
                            fetchData()
                          }}
                          className="hover:text-red-400"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none">
                      <Markdown>{summaries[activeSummaryTab].content}</Markdown>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center text-gray-500">
                {recording.status === 'summarizing' ? '要約生成中...' : '要約がありません'}
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-3">タグ</h2>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex flex-wrap gap-2 mb-3">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
                    style={{ backgroundColor: tag.color + '33', color: tag.color }}
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
                {tags.length === 0 && <span className="text-gray-500 text-sm">タグなし</span>}
              </div>
              <form onSubmit={handleAddTag} className="flex gap-2">
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="タグを追加..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded"
                >
                  追加
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
