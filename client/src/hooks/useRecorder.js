import { useState, useRef, useCallback, useEffect } from 'react'
import { createSession, appendChunk, finalizeSession } from '../lib/recording-backup'

const MAX_DURATION_SEC = 4 * 60 * 60 // 4 hours
const SILENCE_THRESHOLD = 5 // amplitude threshold (0-255)
const SILENCE_TIMEOUT_SEC = 5 * 60 // 5 minutes of silence → auto-stop
const NOTIFY_INTERVAL_SEC = 60 * 60 // 1 hour notification

export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [analyserData, setAnalyserData] = useState(null)
  const [autoStopReason, setAutoStopReason] = useState(null) // 'maxtime' | 'silence' | null
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)
  const startTimeRef = useRef(null)
  const silenceStartRef = useRef(null)
  const lastNotifyRef = useRef(0)
  const onAutoStopRef = useRef(null)
  // Crash-resilient backup: chunks are also mirrored to IndexedDB so a
  // force-quit mid-recording can be recovered on next launch.
  const sessionIdRef = useRef(null)
  const chunkIndexRef = useRef(0)

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    mediaRecorderRef.current = null
    analyserRef.current = null
    startTimeRef.current = null
    silenceStartRef.current = null
    lastNotifyRef.current = 0
    setAnalyserData(null)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const startRecording = useCallback(async ({ captureSystem = true, deviceId, onNotify, onAutoStop } = {}) => {
    try {
      chunksRef.current = []
      setDuration(0)
      setAutoStopReason(null)
      onAutoStopRef.current = onAutoStop || null

      // Use a fixed sample rate to prevent timing drift
      const audioCtx = new AudioContext({ sampleRate: 48000 })
      audioCtxRef.current = audioCtx
      const destination = audioCtx.createMediaStreamDestination()

      let hasSystemAudio = false

      // Capture system audio (screen share / loopback)
      if (captureSystem) {
        try {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,  // Required by API, but Electron intercepts
            audio: true,
          })

          const audioTracks = displayStream.getAudioTracks()
          const videoTracks = displayStream.getVideoTracks()
          console.log(`[Recorder] getDisplayMedia: ${audioTracks.length} audio, ${videoTracks.length} video tracks`)

          if (audioTracks.length > 0) {
            const systemSource = audioCtx.createMediaStreamSource(
              new MediaStream(audioTracks)
            )
            systemSource.connect(destination)
            hasSystemAudio = true
            console.log('[Recorder] System audio loopback connected')
          } else {
            console.warn('[Recorder] No audio tracks from getDisplayMedia — desktop audio will not be captured')
          }

          // Stop ONLY video tracks — keep audio tracks alive
          videoTracks.forEach(t => t.stop())

          // Store audio tracks for cleanup
          if (!streamRef.current) {
            streamRef.current = new MediaStream()
          }
          audioTracks.forEach(t => streamRef.current.addTrack(t))
        } catch (err) {
          // User cancelled screen share - continue with mic only
          console.log('System audio capture skipped:', err.message)
        }
      }

      // Capture microphone
      const micConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
      }
      if (deviceId) micConstraints.deviceId = { exact: deviceId }
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: micConstraints,
      })
      const micSource = audioCtx.createMediaStreamSource(micStream)
      micSource.connect(destination)

      // Keep mic tracks for cleanup
      if (!streamRef.current) {
        streamRef.current = new MediaStream()
      }
      micStream.getTracks().forEach(t => streamRef.current.addTrack(t))

      // Set up analyser for visualizer
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      micSource.connect(analyser)
      analyserRef.current = analyser

      // Update analyser at ~15fps (not 60fps) to save CPU
      let lastAnalyserUpdate = 0
      const updateAnalyser = (timestamp) => {
        if (!analyserRef.current) return
        if (timestamp - lastAnalyserUpdate >= 66) { // ~15fps
          const data = new Uint8Array(analyserRef.current.frequencyBinCount)
          analyserRef.current.getByteFrequencyData(data)
          setAnalyserData(data)
          lastAnalyserUpdate = timestamp
        }
        animFrameRef.current = requestAnimationFrame(updateAnalyser)
      }
      animFrameRef.current = requestAnimationFrame(updateAnalyser)

      // Choose a supported MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      // Crash-resilient backup: create an IndexedDB session for this recording
      try {
        sessionIdRef.current = await createSession(mimeType)
        chunkIndexRef.current = 0
        console.log(`[Recorder] Backup session created: ${sessionIdRef.current}`)
      } catch (err) {
        console.warn('[Recorder] IndexedDB backup unavailable:', err.message)
        sessionIdRef.current = null
      }

      // Start recording
      const recorder = new MediaRecorder(destination.stream, { mimeType })

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
          // Mirror to IndexedDB for crash recovery. Fire-and-forget — never
          // block the MediaRecorder callback. If it fails we still have the
          // in-memory chunk, so the primary flow (stop→upload) keeps working.
          if (sessionIdRef.current) {
            const idx = chunkIndexRef.current++
            appendChunk(sessionIdRef.current, idx, e.data).catch((err) => {
              console.warn(`[Recorder] Backup chunk ${idx} failed:`, err.message)
            })
          }
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start(1000) // Collect chunks every second
      setIsRecording(true)

      // Duration timer using wall clock (not interval counting)
      const startTime = Date.now()
      startTimeRef.current = startTime
      silenceStartRef.current = null
      lastNotifyRef.current = 0

      // Silence detection: reuse last analyser data from RAF loop (avoid double-read)
      let lastAvg = 255 // assume non-silent initially

      // Periodically update avg from analyser (every ~500ms via RAF callback)
      const silenceCheckInterval = 500
      let lastSilenceCheck = 0
      const origUpdateAnalyser = updateAnalyser
      // Patch: also compute avg inside the RAF loop to avoid separate getByteFrequencyData
      // (already reading data in RAF, so just store the average)

      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        setDuration(elapsed)

        // Max duration check
        if (elapsed >= MAX_DURATION_SEC) {
          setAutoStopReason('maxtime')
          onAutoStopRef.current?.('maxtime')
          return
        }

        // Hourly notification
        const hours = Math.floor(elapsed / NOTIFY_INTERVAL_SEC)
        if (hours > lastNotifyRef.current) {
          lastNotifyRef.current = hours
          onNotify?.(`録音${hours}時間経過中`)
        }

        // Silence detection — read analyser only once per interval (not duplicate of RAF)
        if (analyserRef.current) {
          const freqData = new Uint8Array(analyserRef.current.frequencyBinCount)
          analyserRef.current.getByteFrequencyData(freqData)
          const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length

          if (avg < SILENCE_THRESHOLD) {
            if (!silenceStartRef.current) {
              silenceStartRef.current = Date.now()
            } else if ((Date.now() - silenceStartRef.current) / 1000 >= SILENCE_TIMEOUT_SEC) {
              setAutoStopReason('silence')
              onAutoStopRef.current?.('silence')
              return
            }
          } else {
            silenceStartRef.current = null
          }
        }
      }, 1000) // Check every 1s (was 500ms) — reduces CPU, timer is wall-clock based anyway

    } catch (err) {
      cleanup()
      throw new Error(`録音の開始に失敗しました: ${err.message}`)
    }
  }, [cleanup])

  const stopRecording = useCallback(() => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        cleanup()
        resolve(null)
        return
      }

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], `recording_${Date.now()}.webm`, { type: 'audio/webm' })
        // Normal stop: the chunks are safely assembled in memory. Clear the
        // IndexedDB backup so recovery won't offer it later.
        const sid = sessionIdRef.current
        sessionIdRef.current = null
        if (sid) {
          finalizeSession(sid).catch(() => {})
        }
        cleanup()
        setIsRecording(false)
        setDuration(0)
        resolve(file)
      }

      mediaRecorderRef.current.stop()
    })
  }, [cleanup])

  return {
    isRecording,
    duration,
    analyserData,
    autoStopReason,
    startRecording,
    stopRecording,
  }
}
