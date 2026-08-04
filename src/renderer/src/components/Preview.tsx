import { useEffect, useRef, useState } from 'react'
import type { EditSession, Overlay, VisualOverlayBase } from '@shared/types'
import {
  formatTime,
  outputTimeForSource,
  overlayAtTime,
  positionAtOutputTime,
  timelineDuration
} from '../model/timeline'

interface PreviewProps {
  session: EditSession
  playing: boolean
  zoom: number
  hasCutPoints: boolean
  canUndo: boolean
  canRedo: boolean
  onPlayingChange: (playing: boolean) => void
  onZoom: (zoom: number) => void
  onPlayhead: (time: number) => void
  onSelect: (id: string | null) => void
  onOverlayChange: (id: string, patch: Partial<Overlay>) => void
  onSelectPoint: () => void
  onDeleteSelection: () => void
  onUndo: () => void
  onRedo: () => void
}

function playLabel(playing: boolean): string {
  return playing ? 'Pause' : 'Play'
}

function playSymbol(playing: boolean): string {
  return playing ? 'Ⅱ' : '▶'
}

function TransportControls({ props, total }: { props: PreviewProps; total: number }): React.JSX.Element {
  return (
    <div className="transport">
      <button className="play-button" onClick={() => props.onPlayingChange(!props.playing)} aria-label={playLabel(props.playing)}>
        <span aria-hidden="true">{playSymbol(props.playing)}</span> {playLabel(props.playing)}
      </button>
      <button onClick={props.onSelectPoint}>Cut point</button>
      <button className="danger" disabled={!props.hasCutPoints} onClick={props.onDeleteSelection}>Cut</button>
      <button disabled={!props.canUndo} onClick={props.onUndo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
      <button disabled={!props.canRedo} onClick={props.onRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷</button>
      <span className="timeline-title">Timeline</span>
      <span className="timeline-time">{formatTime(props.session.playhead)} / {formatTime(total)}</span>
      <button disabled={props.zoom <= 1} onClick={() => props.onZoom(Math.max(1, props.zoom - 0.25))} aria-label="Zoom out">−</button>
      <button disabled={props.zoom >= 8} onClick={() => props.onZoom(Math.min(8, props.zoom + 0.25))} aria-label="Zoom in">+</button>
    </div>
  )
}

function useMediaUrl(path?: string): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    if (!path) {
      setUrl('')
      return
    }
    void window.catcut.getPathUrl(path).then((value) => { if (alive) setUrl(value) })
    return () => { alive = false }
  }, [path])
  return url
}

function OverlayContent({ overlay, playhead, playing }: {
  overlay: Overlay
  playhead: number
  playing: boolean
}): React.JSX.Element | null {
  const url = useMediaUrl(overlayPath(overlay))
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null)
  const mediaVolume = overlayVolume(overlay)

  useEffect(() => {
    const media = mediaRef.current
    if (!media || !isTimedOverlay(overlay)) return
    syncOverlayMedia(media, overlay, playhead, playing, mediaVolume)
  }, [overlay, mediaVolume, playhead, playing])

  if (overlay.type === 'text') {
    return (
      <div
        className="preview-text"
        style={textStyle(overlay)}
      >
        {overlay.text}
      </div>
    )
  }
  if (overlay.type === 'image' || overlay.type === 'gif') {
    return <img src={url} alt={overlay.name} draggable={false} />
  }
  if (overlay.type === 'video') {
    return (
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        src={url}
        muted={!overlay.audioEnabled}
        loop={overlay.loop}
        playsInline
      />
    )
  }
  return <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={url} />
}

function overlayPath(overlay: Overlay): string | undefined {
  return overlay.type === 'text' ? undefined : overlay.path
}

function overlayVolume(overlay: Overlay): number {
  return isTimedOverlay(overlay) ? overlay.volume : 1
}

function textStyle(overlay: Extract<Overlay, { type: 'text' }>): React.CSSProperties {
  return {
    color: overlay.color,
    fontFamily: overlay.fontFamily,
    fontSize: `${overlay.fontSize}cqh`,
    textAlign: overlay.align,
    WebkitTextStroke: `${overlay.outlineWidth}px ${overlay.outlineColor}`,
    textShadow: overlay.shadow ? '0 4px 8px #000' : 'none'
  }
}

function isTimedOverlay(overlay: Overlay): overlay is Extract<Overlay, { type: 'video' | 'audio' }> {
  return overlay.type === 'video' || overlay.type === 'audio'
}

function playableDuration(media: HTMLMediaElement, overlay: Overlay): number {
  return Number.isFinite(media.duration) && media.duration > 0 ? media.duration : overlay.duration
}

function overlayMediaTime(overlay: Extract<Overlay, { type: 'video' | 'audio' }>, playhead: number, duration: number): number {
  const elapsed = Math.max(0, playhead - overlay.start)
  return overlay.type === 'video' && overlay.loop ? elapsed % duration : elapsed
}

function syncOverlayMedia(
  media: HTMLMediaElement,
  overlay: Extract<Overlay, { type: 'video' | 'audio' }>,
  playhead: number,
  playing: boolean,
  volume: number
): void {
  media.volume = volume
  const duration = playableDuration(media, overlay)
  const expected = overlayMediaTime(overlay, playhead, duration)
  if (Math.abs(media.currentTime - expected) > 0.2) media.currentTime = Math.min(expected, duration)
  if (playing) void media.play().catch(() => undefined)
  else media.pause()
}

function waitForSeek(video: HTMLVideoElement): Promise<void> {
  if (!video.seeking) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    const onSeeked = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(new Error('Video seek failed'))
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

function updatePlayback(
  video: HTMLVideoElement,
  session: EditSession,
  activeSegment: React.RefObject<number>,
  total: number,
  onPlayhead: PreviewProps['onPlayhead'],
  onPlayingChange: PreviewProps['onPlayingChange']
): void {
  const segment = session.segments[activeSegment.current]
  if (!segment) return
  if (video.currentTime < segment.sourceEnd - 0.025) {
    onPlayhead(outputTimeForSource(session.segments, activeSegment.current, video.currentTime))
    return
  }
  const nextIndex = activeSegment.current + 1
  const next = session.segments[nextIndex]
  if (next) {
    activeSegment.current = nextIndex
    video.currentTime = next.sourceStart
    return
  }
  onPlayhead(total)
  onPlayingChange(false)
}

function VisualItem({ overlay, children, selected, onSelect, onChange, bounds }: {
  overlay: VisualOverlayBase
  children: React.ReactNode
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Overlay>) => void
  bounds: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const resize = useRef<{ x: number; y: number; width: number; height: number } | null>(null)

  const onPointerMove = (event: React.PointerEvent): void => {
    const rectangle = bounds.current?.getBoundingClientRect()
    if (!rectangle) return
    if (drag.current) {
      onChange({
        x: Math.max(0, Math.min(1 - overlay.width, drag.current.x + (event.clientX - drag.current.startX) / rectangle.width)),
        y: Math.max(0, Math.min(1 - overlay.height, drag.current.y + (event.clientY - drag.current.startY) / rectangle.height))
      } as Partial<Overlay>)
    }
    if (resize.current) {
      onChange({
        width: Math.max(0.08, Math.min(1 - overlay.x, resize.current.width + (event.clientX - resize.current.x) / rectangle.width)),
        height: Math.max(0.08, Math.min(1 - overlay.y, resize.current.height + (event.clientY - resize.current.y) / rectangle.height))
      } as Partial<Overlay>)
    }
  }

  return (
    <div
      className={`visual-overlay ${selected ? 'selected' : ''}`}
      style={{
        left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`,
        width: `${overlay.width * 100}%`, height: `${overlay.height * 100}%`,
        opacity: overlay.opacity, zIndex: overlay.zIndex
      }}
      onPointerDown={(event) => {
        onSelect()
        drag.current = { x: overlay.x, y: overlay.y, startX: event.clientX, startY: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        drag.current = null
        resize.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    >
      {children}
      {selected && (
        <button
          className="resize-handle"
          aria-label="Resize overlay"
          onPointerDown={(event) => {
            event.stopPropagation()
            resize.current = { x: event.clientX, y: event.clientY, width: overlay.width, height: overlay.height }
            event.currentTarget.parentElement?.setPointerCapture(event.pointerId)
          }}
        />
      )}
    </div>
  )
}

export function Preview(props: PreviewProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const activeSegment = useRef(0)
  const seekingFromTimeline = useRef(false)
  const total = timelineDuration(props.session.segments)
  const playing = props.playing
  const onPlayingChange = props.onPlayingChange


  useEffect(() => setMediaError(null), [props.session.playbackPath])

  useEffect(() => {
    const video = videoRef.current
    const position = positionAtOutputTime(props.session.segments, props.session.playhead)
    if (!video || !position) return
    activeSegment.current = position.segmentIndex
    if (Math.abs(video.currentTime - position.sourceTime) > 0.16) {
      seekingFromTimeline.current = true
      video.currentTime = position.sourceTime
    }
  }, [props.session.playhead, props.session.segments])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    if (playing) {
      void waitForSeek(video)
        .then(async () => {
          if (!cancelled) await video.play()
        })
        .catch(() => onPlayingChange(false))
    } else {
      video.pause()
    }
    return () => { cancelled = true }
  }, [playing, onPlayingChange])

  return (
    <section className="preview-shell" aria-label="Video preview">
      <div
        ref={stageRef}
        className="preview-stage"
        style={{ aspectRatio: `${props.session.source.width} / ${props.session.source.height}` }}
        onPointerDown={(event) => { if (event.target === event.currentTarget) props.onSelect(null) }}
      >
        <video
          ref={videoRef}
          src={props.session.playbackPath}
          preload="auto"
          playsInline
          onLoadedData={() => setMediaError(null)}
          onError={() => setMediaError('This video cannot be shown. Try reopening it.')}
          onEnded={() => props.onPlayingChange(false)}
          onSeeked={() => { seekingFromTimeline.current = false }}
          onTimeUpdate={(event) => {
            if (seekingFromTimeline.current) return
            updatePlayback(event.currentTarget, props.session, activeSegment, total, props.onPlayhead, props.onPlayingChange)
          }}
        />
        {mediaError && <div className="preview-error" role="alert">{mediaError}</div>}
        {props.session.overlays.filter((overlay) => overlayAtTime(overlay, props.session.playhead)).map((overlay) => {
          if (overlay.type === 'audio') {
            return <OverlayContent key={overlay.id} overlay={overlay} playhead={props.session.playhead} playing={props.playing} />
          }
          return (
            <VisualItem
              key={overlay.id}
              overlay={overlay}
              selected={props.session.selectedOverlayId === overlay.id}
              onSelect={() => props.onSelect(overlay.id)}
              onChange={(patch) => props.onOverlayChange(overlay.id, patch)}
              bounds={stageRef}
            >
              <OverlayContent overlay={overlay} playhead={props.session.playhead} playing={props.playing} />
            </VisualItem>
          )
        })}
      </div>
      <TransportControls props={props} total={total} />
    </section>
  )
}
