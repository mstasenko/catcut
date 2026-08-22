import { useEffect, useRef } from 'react'
import type { TimelinePosition } from '../model/timeline'
import { isFreezeSegment } from '../model/timeline'

function freezeContext(position: TimelinePosition | null): { id: string; duration: number; start: number } | null {
  if (!position || !isFreezeSegment(position.segment)) return null
  return { id: position.segment.id, duration: position.segment.duration, start: position.outputStart }
}

function startFreezeClock(
  start: number,
  duration: number,
  initial: number,
  total: number,
  onPlayhead: (time: number) => void
): () => void {
  const startedAt = performance.now()
  let frame = 0
  const tick = (now: number): void => {
    const elapsed = initial + (now - startedAt) / 1000
    if (elapsed >= duration) {
      onPlayhead(Math.min(total, start + duration))
      return
    }
    onPlayhead(start + elapsed)
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}

export function useFreezePlayback(
  video: React.RefObject<HTMLVideoElement | null>,
  position: TimelinePosition | null,
  playhead: number,
  playing: boolean,
  total: number,
  onPlayhead: (time: number) => void
): void {
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead
  const freeze = freezeContext(position)
  const freezeId = freeze?.id ?? ''
  const freezeDuration = freeze?.duration ?? 0
  const freezeStart = freeze?.start ?? 0

  useEffect(() => {
    if (!playing || !freezeId) return
    video.current?.pause()
    const initial = playheadRef.current - freezeStart
    return startFreezeClock(freezeStart, freezeDuration, initial, total, onPlayhead)
  }, [freezeDuration, freezeId, freezeStart, onPlayhead, playing, total, video])
}
