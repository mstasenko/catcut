import { useEffect, useRef, useState } from 'react'
import type { EditSession, FocusZoomAmount, Overlay } from '@shared/types'
import {
  isFreezeSegment,
  outputTimeForSource,
  positionAtOutputTime,
  segmentPlaybackRate,
  segmentSourceStart,
  sourceForSegment,
  timelineDuration
} from '../model/timeline'
import { transitionPreviewAtOutputTime } from '../model/transitions'
import { OutgoingTransitionVideo } from './TransitionPreview'
import { focusCameraTransformAtTime } from '../model/focus-zoom'
import { Transport } from './Transport'
import { useFreezePlayback } from './useFreezePlayback'
import { PreviewOverlays } from './PreviewOverlays'
import { usePresentedOutputTime } from './usePresentedOutputTime'
import { gameAudioGainAtOutputTime } from '@shared/audio-envelope'
import { usePreviewAudioMixer } from './usePreviewAudioMixer'

interface PreviewProps {
  session: EditSession
  playing: boolean
  zoom: number
  canUndo: boolean
  canRedo: boolean
  onPlayingChange: (playing: boolean) => void
  onZoom: (zoom: number) => void
  onPlayhead: (time: number) => void
  onSelect: (id: string | null) => void
  onOverlayChange: (id: string, patch: Partial<Overlay>) => void
  onOverlayGestureStart: () => void
  onOverlayGestureEnd: () => void
  onOverlayGestureCancel: () => void
  onSelectPoint: () => void
  onDeleteSelection: () => void
  onUndo: () => void
  onRedo: () => void
  onStep: (direction: -1 | 1) => void
  focusPicking: FocusZoomAmount | null
  onFocusZoom: (zoom: FocusZoomAmount, x: number, y: number) => void
  onCancelFocusPick: () => void
}

function previewContext(session: EditSession): { position: ReturnType<typeof positionAtOutputTime>; playbackPath: string; freeze: boolean } {
  const position = positionAtOutputTime(session.segments, session.playhead)
  if (!position) return { position, playbackPath: '', freeze: false }
  const source = sourceForSegment(session, position.segment)
  return { position, playbackPath: source?.playbackPath ?? '', freeze: isFreezeSegment(position.segment) }
}

function previewSeekTime(position: NonNullable<ReturnType<typeof positionAtOutputTime>>, playing: boolean, sourceFps: number): number {
  if (playing || isFreezeSegment(position.segment)) return position.sourceTime
  // Seek into the middle of the chosen source frame. Seeking exactly to its
  // timestamp can leave Chromium displaying the preceding decoded frame.
  const frameInset = sourceFps > 0 ? 0.5 / sourceFps : 0.0001
  return Math.min(position.sourceTime + frameInset, position.segment.sourceEnd)
}

function previewSourceFps(session: EditSession, position: NonNullable<ReturnType<typeof positionAtOutputTime>>): number {
  const source = sourceForSegment(session, position.segment)
  return source ? source.metadata.fps : 0
}

function focusCameraStyle(session: EditSession, outputTime: number): React.CSSProperties | undefined {
  const transform = focusCameraTransformAtTime(session.focusZooms, outputTime)
  return transform ? { transform, transformOrigin: 'top left' } : undefined
}

function handleStagePointer(event: React.PointerEvent<HTMLDivElement>, focus: FocusZoomAmount | null, props: PreviewProps, done: () => void): void {
  if (focus) {
    const rect = event.currentTarget.getBoundingClientRect()
    props.onFocusZoom(focus, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
    done()
    return
  }
  if (event.target === event.currentTarget) props.onSelect(null)
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
  if (!segment || isFreezeSegment(segment)) return
  if (video.currentTime < segment.sourceEnd - 0.025) {
    onPlayhead(outputTimeForSource(session.segments, activeSegment.current, video.currentTime))
    return
  }
  const nextIndex = activeSegment.current + 1
  const next = session.segments[nextIndex]
  if (next) {
    activeSegment.current = nextIndex
    onPlayhead(outputTimeForSource(session.segments, nextIndex, segmentSourceStart(next)))
    return
  }
  onPlayhead(total)
  onPlayingChange(false)
}

export function Preview(props: PreviewProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const mixer = usePreviewAudioMixer()
  const activeSegment = useRef(0)
  const seekingFromTimeline = useRef(false)
  const total = timelineDuration(props.session.segments)
  const { position, playbackPath, freeze: positionIsFreeze } = previewContext(props.session)
  const playing = props.playing
  const onPlayingChange = props.onPlayingChange
  const onPlayhead = props.onPlayhead
  const focusPicking = props.focusPicking
  const onCancelFocusPick = props.onCancelFocusPick
  const visualTime = usePresentedOutputTime(
    videoRef,
    props.session,
    position?.segmentIndex ?? 0,
    playing,
    playbackPath
  )
  const transitionPreview = transitionPreviewAtOutputTime(props.session, visualTime)
  useFreezePlayback(videoRef, position, props.session.playhead, playing, total, onPlayhead)

  useEffect(() => {
    const video = videoRef.current
    return video ? mixer.register(video) : undefined
  }, [mixer])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    mixer.setGain(video, gameAudioGainAtOutputTime(props.session.overlays, visualTime))
  }, [mixer, props.session.overlays, visualTime])

  useEffect(() => { if (playing) mixer.resume() }, [mixer, playing])

  useEffect(() => {
    if (!focusPicking) return
    const cancel = (event: KeyboardEvent): void => { if (event.key === 'Escape') onCancelFocusPick() }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [focusPicking, onCancelFocusPick])

  useEffect(() => setMediaError(null), [playbackPath])

  useEffect(() => {
    const video = videoRef.current
    const position = positionAtOutputTime(props.session.segments, props.session.playhead)
    if (!video || !position) return
    activeSegment.current = position.segmentIndex
    video.playbackRate = segmentPlaybackRate(position.segment)
    const sourceFps = previewSourceFps(props.session, position)
    const seekTime = previewSeekTime(position, playing, sourceFps)
    const seekTolerance = playing ? 0.16 : 0.0005
    if (Math.abs(video.currentTime - seekTime) > seekTolerance) {
      seekingFromTimeline.current = true
      video.currentTime = seekTime
    }
  }, [playbackPath, playing, props.session])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing && !positionIsFreeze) {
      void video.play().catch(() => onPlayingChange(false))
    } else {
      video.pause()
    }
  }, [playing, playbackPath, onPlayingChange, positionIsFreeze])

  return (
    <section className="preview-shell" aria-label="Video preview">
      <div
        ref={stageRef}
        className={`preview-stage ${props.focusPicking ? 'focus-picking' : ''}`}
        style={{ aspectRatio: `${props.session.canvas.width} / ${props.session.canvas.height}` }}
        onPointerDown={(event) => handleStagePointer(event, props.focusPicking, props, props.onCancelFocusPick)}
      >
        <div className="camera-layer" style={focusCameraStyle(props.session, visualTime)}>
          <OutgoingTransitionVideo
            preview={transitionPreview}
            fit={props.session.canvas.fit}
            className="preview-source-video preview-transition-previous"
          />
          <video
            ref={videoRef}
            className="preview-source-video"
            src={playbackPath}
            style={{ objectFit: props.session.canvas.fit, ...transitionPreview?.styles.current }}
            data-transition={transitionPreview?.active.effect}
            preload="auto"
            playsInline
            onLoadedData={() => setMediaError(null)}
            onError={() => setMediaError('This video cannot be shown. Try reopening it.')}
            onEnded={() => props.onPlayingChange(false)}
            onSeeked={() => { seekingFromTimeline.current = false }}
            onTimeUpdate={(event) => {
              if (!seekingFromTimeline.current) updatePlayback(event.currentTarget, props.session, activeSegment, total, props.onPlayhead, props.onPlayingChange)
            }}
          />
        </div>
        {props.focusPicking && <div className="focus-prompt">Click what to focus on<br /><small>Esc to cancel</small></div>}
        {mediaError && <div className="preview-error" role="alert">{mediaError}</div>}
        <PreviewOverlays
          session={props.session}
          playing={props.playing}
          outputTime={visualTime}
          stageRef={stageRef}
          onSelect={props.onSelect}
          onChange={props.onOverlayChange}
          onGestureStart={props.onOverlayGestureStart}
          onGestureEnd={props.onOverlayGestureEnd}
          onGestureCancel={props.onOverlayGestureCancel}
          mixer={mixer}
        />
      </div>
      <Transport
        session={props.session}
        total={total}
        playing={props.playing}
        zoom={props.zoom}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        onPlayingChange={props.onPlayingChange}
        onZoom={props.onZoom}
        onStep={props.onStep}
        onSelectPoint={props.onSelectPoint}
        onDeleteSelection={props.onDeleteSelection}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
      />
    </section>
  )
}
