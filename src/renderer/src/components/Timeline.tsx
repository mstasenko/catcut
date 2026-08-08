import type { EditSession, Overlay } from '@shared/types'
import { clamp, deletionRange, timelineDuration } from '../model/timeline'
import { waveformPath } from '../model/waveform'

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

export function Timeline({
  session, zoom, onZoom, onSeek, onSelectOverlay, onOverlayChange,
  onOverlayGestureStart, onOverlayGestureEnd, onOverlayGestureCancel
}: TimelineProps): React.JSX.Element {
  const duration = timelineDuration(session.segments)
  const width = Math.max(100, zoom * 100)
  const selection = deletionRange(session)
  const markers = session.cutPoints

  const pointerToTime = (event: React.PointerEvent<HTMLDivElement>): number => {
    const rectangle = event.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((event.clientX - rectangle.left) / rectangle.width) * duration))
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
        >
          <div className="video-track">
            {session.segments.map((segment) => (
              <div
                key={segment.id}
                className="source-segment"
                style={{ width: `${((segment.sourceEnd - segment.sourceStart) / duration) * 100}%` }}
                title="Video"
              >
                <svg className="waveform" viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="Audio waveform">
                  <path d={waveformPath(session.waveform, segment.sourceStart, segment.sourceEnd, session.source.duration)} />
                </svg>
              </div>
            ))}
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
    </section>
  )
}
