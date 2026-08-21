import type { CSSProperties } from 'react'
import type { EditSession, SourceSegment, TransitionEffect, VideoTransition } from '@shared/types'
import { clamp, isFreezeSegment, positionAtOutputTime, sourceForSegment } from './timeline'

export interface ActiveTransition extends VideoTransition {
  currentSegmentIndex: number
  previousSegmentIndex: number
  progress: number
}

export interface TransitionStyles {
  current: CSSProperties
  previous: CSSProperties
}

export interface TransitionPreview {
  active: ActiveTransition
  previousFrameTime: number
  previousPath: string
  styles: TransitionStyles
}

/** Returns the transition active during the beginning of the current segment. */
export function transitionAtOutputTime(
  segments: SourceSegment[],
  outputTime: number
): ActiveTransition | null {
  const position = positionAtOutputTime(segments, outputTime)
  const previous = position ? segments[position.segmentIndex - 1] : undefined
  if (!position || position.segmentIndex === 0 || isFreezeSegment(position.segment) || !previous || isFreezeSegment(previous)) return null
  const transition = position.segment.transition
  if (!transition) return null
  const elapsed = outputTime - position.outputStart
  if (elapsed < 0 || elapsed >= transition.duration) return null
  return {
    ...transition,
    currentSegmentIndex: position.segmentIndex,
    previousSegmentIndex: position.segmentIndex - 1,
    progress: clamp(elapsed / transition.duration, 0, 1)
  }
}

function currentStyle(effect: TransitionEffect, progress: number): CSSProperties {
  const remaining = 1 - progress
  switch (effect) {
    case 'fade':
      return { opacity: progress }
    case 'dissolve':
      return { opacity: progress, filter: `blur(${remaining * 5}px)` }
    case 'wipeleft':
      return { clipPath: `inset(0 ${remaining * 100}% 0 0)` }
    case 'wiperight':
      return { clipPath: `inset(0 0 0 ${remaining * 100}%)` }
    case 'slideleft':
      return { transform: `translateX(${remaining * 100}%)` }
    case 'slideright':
      return { transform: `translateX(${-remaining * 100}%)` }
    case 'circleopen':
      return { clipPath: `circle(${progress * 75}% at 50% 50%)` }
    case 'zoomin':
      return { opacity: progress, transform: `scale(${0.72 + progress * 0.28})` }
    case 'hblur':
      return { opacity: progress, filter: `blur(${remaining * 18}px)` }
  }
}

function previousStyle(effect: TransitionEffect, progress: number): CSSProperties {
  switch (effect) {
    case 'slideleft':
      return { transform: `translateX(${-progress * 28}%)` }
    case 'slideright':
      return { transform: `translateX(${progress * 28}%)` }
    case 'dissolve':
      return { filter: `blur(${progress * 5}px)`, opacity: 1 - progress * 0.25 }
    case 'zoomin':
      return { filter: `brightness(${1 - progress * 0.3})`, transform: `scale(${1 + progress * 0.08})` }
    case 'hblur':
      return { filter: `blur(${progress * 12}px)` }
    default:
      return {}
  }
}

export function transitionStyles(transition: Pick<ActiveTransition, 'effect' | 'progress'>): TransitionStyles {
  const progress = clamp(transition.progress, 0, 1)
  return {
    current: currentStyle(transition.effect, progress),
    previous: previousStyle(transition.effect, progress)
  }
}

export function transitionPreviewAtOutputTime(
  session: EditSession,
  outputTime: number
): TransitionPreview | null {
  const active = transitionAtOutputTime(session.segments, outputTime)
  if (!active) return null
  const previous = session.segments[active.previousSegmentIndex]
  if (!previous || isFreezeSegment(previous)) return null
  const source = sourceForSegment(session, previous)
  if (!source) return null
  return {
    active,
    previousPath: source.playbackPath,
    previousFrameTime: Math.max(previous.sourceStart, previous.sourceEnd - 1 / session.canvas.fps),
    styles: transitionStyles(active)
  }
}
