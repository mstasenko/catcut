import { useEffect, useState } from 'react'
import type { EditSession } from '@shared/types'
import { isFreezeSegment, outputTimeForSource } from '../model/timeline'

interface PresentedFrame {
  segmentId: string
  outputTime: number
}

export function usePresentedOutputTime(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  session: EditSession,
  segmentIndex: number,
  playing: boolean,
  mediaKey: string
): number {
  const [frame, setFrame] = useState<PresentedFrame | null>(null)
  const segment = session.segments[segmentIndex]

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playing || !segment || isFreezeSegment(segment)) {
      setFrame(null)
      return
    }
    let callbackId = 0
    let active = true
    const update = (_now: number, metadata: VideoFrameCallbackMetadata): void => {
      if (!active) return
      setFrame({
        segmentId: segment.id,
        outputTime: outputTimeForSource(session.segments, segmentIndex, metadata.mediaTime)
      })
      callbackId = video.requestVideoFrameCallback(update)
    }
    callbackId = video.requestVideoFrameCallback(update)
    return () => {
      active = false
      video.cancelVideoFrameCallback(callbackId)
    }
  }, [mediaKey, playing, segment, segmentIndex, session.segments, videoRef])

  return playing && frame && frame.segmentId === segment?.id ? frame.outputTime : session.playhead
}
