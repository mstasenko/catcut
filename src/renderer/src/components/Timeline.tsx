import { useEffect, useRef, useState } from 'react'
import type { EditSession, Overlay } from '@shared/types'
import {
  clamp,
  deletionRange,
  formatTime,
  isSourceTimedOverlay,
  overlayAtTime,
  overlaySourceTime,
  positionAtOutputTime,
  sourceForSegment,
  timelineDuration
} from '../model/timeline'
import { transitionPreviewAtOutputTime } from '../model/transitions'
import { waveformPath } from '../model/waveform'
import { OutgoingTransitionVideo } from './TransitionPreview'

interface TimelineProps {
  session: EditSession
  zoom: number
  onZoom: (zoom: number) => void
  onSeek: (time: number) => void
  onSelectOverlay: (id: string) => void
  onOverlayChange: (id: string, patch: Partial<Overlay>) => void
  onOverlayGestureStart: () => void
  onOverlayGestureEnd: () => void
  onOverlayGestureCancel: () => void
}

const colors: Record<Overlay['type'], string> = {
  text: '#a477ff', image: '#47c6ff', gif: '#ff66c4', video: '#ff9c46', audio: '#57d987'
}

function percentage(value: number, duration: number): number {
  return duration > 0 ? value / duration * 100 : 0
}

interface HoverPreview {
  outputTime: number
  sourceTime: number
  path: string
  name: string
  frameWidth: number
  frameHeight: number
  popupWidth: number
  popupHeight: number
  left: number
  top: number
}

function previewFrameSize(canvas: EditSession['canvas']): Pick<HoverPreview, 'frameWidth' | 'frameHeight' | 'popupWidth' | 'popupHeight'> {
  const scale = Math.min(186 / Math.max(1, canvas.width), 186 / Math.max(1, canvas.height))
  const frameWidth = Math.max(1, Math.round(canvas.width * scale))
  const frameHeight = Math.max(1, Math.round(canvas.height * scale))
  return { frameWidth, frameHeight, popupWidth: frameWidth + 12, popupHeight: frameHeight + 30 }
}

function previewPosition(event: React.PointerEvent, width: number, height: number): { left: number; top: number } {
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX + 14))
  const preferredTop = event.clientY > height + 8 ? event.clientY - height - 8 : event.clientY + 18
  const top = Math.max(8, Math.min(window.innerHeight - height - 8, preferredTop))
  return { left, top }
}

function isHoverPointer(event: React.PointerEvent): boolean {
  return event.pointerType === 'mouse' && event.buttons === 0
}

function previewSourceAtTime(session: EditSession, outputTime: number): {
  position: NonNullable<ReturnType<typeof positionAtOutputTime>>
  source: NonNullable<ReturnType<typeof sourceForSegment>>
} | null {
  const position = positionAtOutputTime(session.segments, outputTime)
  if (!position) return null
  const source = sourceForSegment(session, position.segment)
  return source?.playbackPath ? { position, source } : null
}

function overlayPath(overlay: Exclude<Overlay, { type: 'audio' }>): string {
  if (overlay.type === 'text') return ''
  return overlay.type === 'gif' ? overlay.playbackPath ?? overlay.path : overlay.path
}

function imageSource(overlay: Extract<Overlay, { type: 'image' }>, url: string): string {
  return overlay.renderedImageDataUrl ?? url
}

function useTimelineMediaUrl(path?: string): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    setUrl('')
    if (!path) return
    void window.catcut.getPathUrl(path).then((value) => { if (active) setUrl(value) })
    return () => { active = false }
  }, [path])
  return url
}

function overlayStyle(overlay: Exclude<Overlay, { type: 'audio' }>, frameHeight: number): React.CSSProperties {
  return {
    left: `${overlay.x * 100}%`,
    top: `${overlay.y * 100}%`,
    width: `${overlay.width * 100}%`,
    height: `${overlay.height * 100}%`,
    opacity: overlay.opacity,
    zIndex: overlay.zIndex,
    ...(overlay.type === 'text'
      ? {
          color: overlay.color,
          fontFamily: overlay.fontFamily,
          fontSize: `${Math.max(1, frameHeight * overlay.fontSize / 100)}px`,
          fontWeight: 700,
          lineHeight: 1.05,
          textAlign: overlay.align,
          WebkitTextStroke: `${overlay.outlineWidth * Math.max(1, frameHeight / 720)}px ${overlay.outlineColor}`,
          textShadow: overlay.shadow ? '0 2px 4px #000' : 'none'
        }
      : {})
  }
}

function seekTimelineOverlay(media: HTMLVideoElement, sourceTime: number): void {
  if (media.readyState >= 1) media.currentTime = sourceTime
}

function useTimelineOverlaySeek(
  mediaRef: React.RefObject<HTMLVideoElement | null>,
  overlay: Exclude<Overlay, { type: 'audio' }>,
  sourceTime: number,
  url: string
): void {
  useEffect(() => {
    const media = mediaRef.current
    if (!media) return
    if (!url) return
    if (!isSourceTimedOverlay(overlay)) return
    const seek = (): void => seekTimelineOverlay(media, sourceTime)
    if (media.readyState >= 1) seek()
    else {
      media.addEventListener('loadedmetadata', seek, { once: true })
      return () => media.removeEventListener('loadedmetadata', seek)
    }
  }, [mediaRef, overlay, sourceTime, url])
}

function useVideoFrame(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  path: string,
  sourceTime: number
): void {
  useEffect(() => {
    const video = videoRef.current
    if (!video || !path) return
    const seek = (): void => { video.currentTime = sourceTime }
    if (video.readyState >= 1) seek()
    else {
      video.addEventListener('loadedmetadata', seek, { once: true })
      return () => video.removeEventListener('loadedmetadata', seek)
    }
  }, [path, sourceTime, videoRef])
}

function TimelineOverlay({ overlay, outputTime, frameHeight }: {
  overlay: Exclude<Overlay, { type: 'audio' }>
  outputTime: number
  frameHeight: number
}): React.JSX.Element {
  const mediaRef = useRef<HTMLVideoElement>(null)
  const url = useTimelineMediaUrl(overlayPath(overlay) || undefined)
  const sourceTime = isSourceTimedOverlay(overlay) ? overlaySourceTime(overlay, outputTime) : 0
  useTimelineOverlaySeek(mediaRef, overlay, sourceTime, url)

  const style = overlayStyle(overlay, frameHeight)
  if (overlay.type === 'text') {
    return <div className="timeline-hover-overlay timeline-hover-text" style={style} aria-label={overlay.name}>{overlay.text}</div>
  }
  if (overlay.type === 'image') {
    return <div className="timeline-hover-overlay" style={style} aria-label={overlay.name}><img src={imageSource(overlay, url)} alt="" /></div>
  }
  return (
    <div className="timeline-hover-overlay" style={style} aria-label={overlay.name}>
      <video ref={mediaRef} src={url} muted playsInline preload="auto" />
    </div>
  )
}

function TimelineHoverFrame({ session, preview }: { session: EditSession; preview: HoverPreview }): React.JSX.Element {
  const previewVideo = useRef<HTMLVideoElement>(null)
  const transitionPreview = transitionPreviewAtOutputTime(session, preview.outputTime)
  const overlays = session.overlays
    .filter((overlay): overlay is Exclude<Overlay, { type: 'audio' }> => overlay.type !== 'audio' && overlayAtTime(overlay, preview.outputTime))
    .sort((left, right) => left.zIndex - right.zIndex)

  useVideoFrame(previewVideo, preview.path, preview.sourceTime)

  return (
    <div
      className="timeline-hover-frame"
      style={{ width: preview.frameWidth, height: preview.frameHeight }}
      aria-label={`Frame at ${formatTime(preview.outputTime, session.canvas.fps)}`}
    >
      <OutgoingTransitionVideo preview={transitionPreview} fit={session.canvas.fit} />
      <video
        ref={previewVideo}
        src={preview.path}
        muted
        preload="auto"
        playsInline
        style={{ objectFit: session.canvas.fit, ...transitionPreview?.styles.current }}
        data-transition={transitionPreview?.active.effect}
      />
      {overlays.map((overlay) => <TimelineOverlay key={overlay.id} overlay={overlay} outputTime={preview.outputTime} frameHeight={preview.frameHeight} />)}
    </div>
  )
}

export function Timeline({
  session, zoom, onZoom, onSeek, onSelectOverlay, onOverlayChange,
  onOverlayGestureStart, onOverlayGestureEnd, onOverlayGestureCancel
}: TimelineProps): React.JSX.Element {
  const duration = timelineDuration(session.segments)
  const width = Math.max(100, zoom * 100)
  const selection = deletionRange(session)
  const markers = session.cutPoints
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null)

  const pointerToTime = (event: React.PointerEvent<HTMLDivElement>): number => {
    const rectangle = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((event.clientX - rectangle.left) / rectangle.width) * duration))
  }

  const updateHoverPreview = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!isHoverPointer(event)) {
      setHoverPreview(null)
      return
    }
    const outputTime = pointerToTime(event)
    const target = previewSourceAtTime(session, outputTime)
    if (!target) {
      setHoverPreview(null)
      return
    }
    const { position, source } = target
    const size = previewFrameSize(session.canvas)
    setHoverPreview({
      outputTime,
      sourceTime: position.sourceTime,
      path: source.playbackPath,
      name: source.metadata.name,
      ...size,
      ...previewPosition(event, size.popupWidth, size.popupHeight)
    })
  }

  return (
    <section className="timeline-shell" aria-label="Timeline">
      <div
        className="timeline-scroll"
        onWheel={(event) => {
          event.preventDefault()
          onZoom(clamp(zoom + (event.deltaY < 0 ? 0.25 : -0.25), 1, 8))
        }}
      >
        <div
          className="timeline"
          style={{ width: `${width}%` }}
          onPointerDown={(event) => onSeek(pointerToTime(event))}
          onPointerMove={updateHoverPreview}
          onPointerLeave={() => setHoverPreview(null)}
        >
          <div className="video-track">
            {session.segments.map((segment) => {
              const source = sourceForSegment(session, segment)
              return <div
                key={segment.id}
                className="source-segment"
                data-transition={segment.transition?.effect}
                style={{ width: `${((segment.sourceEnd - segment.sourceStart) / duration) * 100}%` }}
                title={`${source?.metadata.name ?? 'Video'}${segment.transition ? ` · ${segment.transition.effect} ${segment.transition.duration}s` : ''}`}
              >
                <svg className="waveform" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Audio waveform">
                  <path d={waveformPath(source?.waveform ?? [], segment.sourceStart, segment.sourceEnd, source?.metadata.duration ?? 0)} />
                </svg>
              </div>
            })}
          </div>
          <div className="overlay-track">
            {session.overlays.map((overlay) => (
              <button
                key={overlay.id}
                className={`timeline-overlay ${session.selectedOverlayId === overlay.id ? 'selected' : ''}`}
                style={{
                  left: `${(overlay.start / duration) * 100}%`,
                  width: `${Math.max(0.5, (overlay.duration / duration) * 100)}%`,
                  backgroundColor: colors[overlay.type]
                }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSelectOverlay(overlay.id)
                  const startX = event.clientX
                  const originalStart = overlay.start
                  const track = event.currentTarget.parentElement?.parentElement
                  if (!track) return
                  onOverlayGestureStart()
                  const rectangle = track.getBoundingClientRect()
                  const move = (moveEvent: PointerEvent): void => {
                    const delta = (moveEvent.clientX - startX) / rectangle.width * duration
                    onOverlayChange(overlay.id, { start: Math.max(0, Math.min(duration - overlay.duration, originalStart + delta)) })
                  }
                  const cleanup = (): void => {
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                    window.removeEventListener('pointercancel', cancel)
                  }
                  const up = (): void => {
                    cleanup()
                    onOverlayGestureEnd()
                  }
                  const cancel = (): void => {
                    cleanup()
                    onOverlayGestureCancel()
                  }
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up)
                  window.addEventListener('pointercancel', cancel)
                }}
                title={overlay.name}
              >
                {overlay.name}
              </button>
            ))}
          </div>
          {selection && (
            <div
              className="timeline-selection"
              style={{ left: `${percentage(selection[0], duration)}%`, width: `${percentage(selection[1] - selection[0], duration)}%` }}
            />
          )}
          {markers.map((point, index) => (
            <div key={`${point}-${index}`} className="selection-point" style={{ left: `${percentage(point, duration)}%` }} />
          ))}
          <div className="playhead" style={{ left: `${percentage(session.playhead, duration)}%` }} />
        </div>
      </div>
      {hoverPreview && (
        <div
          className="timeline-hover-preview"
          style={{ left: hoverPreview.left, top: hoverPreview.top, width: hoverPreview.popupWidth, height: hoverPreview.popupHeight }}
          aria-label={`Preview of ${hoverPreview.name} at ${formatTime(hoverPreview.outputTime, session.canvas.fps)}`}
        >
          <TimelineHoverFrame session={session} preview={hoverPreview} />
          <span>{formatTime(hoverPreview.outputTime, session.canvas.fps)} · {hoverPreview.name}</span>
        </div>
      )}
    </section>
  )
}
