import { useState, useRef, useCallback, useEffect } from 'react'

export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [analyserData, setAnalyserData] = useState(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const streamRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    mediaRecorderRef.current = null
    analyserRef.current = null
    setAnalyserData(null)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const startRecording = useCallback(async ({ captureSystem = true } = {}) => {
    try {
      chunksRef.current = []
      setDuration(0)

      const audioCtx = new AudioContext()
      const destination = audioCtx.createMediaStreamDestination()

      // Capture system audio (screen share)
      if (captureSystem) {
        try {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          })
          // Stop video track (we only need audio)
          displayStream.getVideoTracks().forEach(t => t.stop())

          const systemSource = audioCtx.createMediaStreamSource(
            new MediaStream(displayStream.getAudioTracks())
          )
          systemSource.connect(destination)

          // Store for cleanup
          streamRef.current = displayStream
        } catch {
          // User cancelled screen share - continue with mic only
          console.log('System audio capture skipped')
        }
      }

      // Capture microphone
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const micSource = audioCtx.createMediaStreamSource(micStream)
      micSource.connect(destination)

      // Keep mic tracks for cleanup
      if (streamRef.current) {
        micStream.getTracks().forEach(t => streamRef.current.addTrack(t))
      } else {
        streamRef.current = micStream
      }

      // Set up analyser for visualizer
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      micSource.connect(analyser)
      analyserRef.current = analyser

      const updateAnalyser = () => {
        if (!analyserRef.current) return
        const data = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(data)
        setAnalyserData(data)
        animFrameRef.current = requestAnimationFrame(updateAnalyser)
      }
      updateAnalyser()

      // Start recording
      const recorder = new MediaRecorder(destination.stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorderRef.current = recorder
      recorder.start(1000) // Collect chunks every second
      setIsRecording(true)

      // Duration timer
      timerRef.current = setInterval(() => {
        setDuration(d => d + 1)
      }, 1000)

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
    startRecording,
    stopRecording,
  }
}
