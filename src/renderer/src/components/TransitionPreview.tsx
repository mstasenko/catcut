import { useEffect, useRef } from 'react'
import type { TransitionPreview } from '../model/transitions'

export function OutgoingTransitionVideo({ preview, fit, className }: {
  preview: TransitionPreview | null
  fit: 'contain' | 'cover'
  className?: string
}): React.JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null)
  const path = preview?.previousPath ?? ''
  const sourceTime = preview?.previousFrameTime ?? 0

  useEffect(() => {
    const video = videoRef.current
    if (!video || !path) return
    const seek = (): void => { video.currentTime = sourceTime }
    if (video.readyState >= 1) seek()
    else {
      video.addEventListener('loadedmetadata', seek, { once: true })
      return () => video.removeEventListener('loadedmetadata', seek)
    }
  }, [path, sourceTime])

  if (!preview) return null
  return (
    <video
      ref={videoRef}
      className={className}
      src={preview.previousPath}
      style={{ objectFit: fit, ...preview.styles.previous }}
      muted
      preload="auto"
      playsInline
      aria-label="Outgoing transition frame"
    />
  )
}
