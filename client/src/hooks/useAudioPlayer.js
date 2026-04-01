import { useState, useRef, useCallback, useEffect } from 'react'

export function useAudioPlayer() {
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const setAudioElement = useCallback((el) => {
    if (!el) return
    audioRef.current = el

    el.addEventListener('timeupdate', () => setCurrentTime(el.currentTime))
    el.addEventListener('loadedmetadata', () => setDuration(el.duration))
    el.addEventListener('play', () => setIsPlaying(true))
    el.addEventListener('pause', () => setIsPlaying(false))
    el.addEventListener('ended', () => setIsPlaying(false))
  }, [])

  const play = useCallback(() => audioRef.current?.play(), [])
  const pause = useCallback(() => audioRef.current?.pause(), [])
  const seek = useCallback((time) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time
    }
  }, [])

  const toggle = useCallback(() => {
    if (isPlaying) pause()
    else play()
  }, [isPlaying, play, pause])

  return {
    setAudioElement,
    isPlaying,
    currentTime,
    duration,
    play,
    pause,
    seek,
    toggle,
  }
}
