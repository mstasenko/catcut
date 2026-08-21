import type { EditSession, SourceSegment } from '@shared/types'
import { cutPointsAfterRemoval, deletionRange, insertOutputGap, isFreezeSegment, makeId, normalizedCutPoints, positionAtOutputTime, removeOutputRange, segmentOutputDuration, segmentSourceDuration, timelineDuration, withTransition } from './timeline'
import { insertSegmentsAtOutputTime, segmentsForOutputRange } from './segment-ranges'
import { timedRangesAfterRemoval } from './timed-ranges'

const EPSILON = 0.0001

export interface ReplayEligibility {
  range: [number, number] | null
  reason: string | null
  removableGroupId: string | null
}

export interface ReplayRange {
  groupId: string
  start: number
  duration: number
}

function replayDuration(segments: SourceSegment[]): number {
  return segments.reduce((total, segment) => total + (isFreezeSegment(segment)
    ? segment.duration
    : segmentSourceDuration(segment) / 0.5), 0)
}

function boundaryInsideTransition(segments: SourceSegment[], boundary: number, beginning: boolean): boolean {
  let cursor = 0
  for (const segment of segments) {
    if (!isFreezeSegment(segment) && segment.transition) {
      const end = cursor + segment.transition.duration
      const afterStart = beginning ? boundary >= cursor - EPSILON : boundary > cursor + EPSILON
      if (afterStart && boundary < end - EPSILON) return true
    }
    cursor += segmentOutputDuration(segment)
  }
  return false
}

function replayGroupAtPlayhead(session: EditSession): string | null {
  return positionAtOutputTime(session.segments, session.playhead)?.segment.replayGroupId ?? null
}

export function replayEligibility(session: EditSession): ReplayEligibility {
  const removableGroupId = replayGroupAtPlayhead(session)
  if (removableGroupId) return { range: null, reason: null, removableGroupId }
  const range = deletionRange(session)
  if (!range) return { range: null, reason: 'Add cut points around a moment first.', removableGroupId: null }
  const duration = range[1] - range[0]
  if (duration < 2 / session.canvas.fps - EPSILON) return { range: null, reason: 'Choose a moment at least two frames long.', removableGroupId: null }
  if (duration > 15 + EPSILON) return { range: null, reason: 'Choose a moment 15 seconds or shorter.', removableGroupId: null }
  if (boundaryInsideTransition(session.segments, range[0], true) || boundaryInsideTransition(session.segments, range[1], false)) {
    return { range: null, reason: 'Move the cut point outside the transition.', removableGroupId: null }
  }
  const selected = segmentsForOutputRange(session.segments, range[0], range[1])
  if (selected.some((segment) => segment.replayGroupId)) return { range: null, reason: 'This moment is already a replay.', removableGroupId: null }
  if (replayDuration(selected) > 30 + EPSILON) return { range: null, reason: 'Choose a shorter moment for Replay.', removableGroupId: null }
  return { range, reason: null, removableGroupId: null }
}

function replaySegments(segments: SourceSegment[], groupId: string): SourceSegment[] {
  return segments.map((segment, index) => {
    if (isFreezeSegment(segment)) return { ...segment, id: makeId('freeze'), replayGroupId: groupId }
    const replay = {
      ...segment,
      id: makeId('segment'),
      playbackRate: 0.5 as const,
      replayGroupId: groupId
    }
    return withTransition(replay, index === 0 ? undefined : segment.transition)
  })
}

export function insertReplay(session: EditSession, start: number, end: number): EditSession {
  const selected = segmentsForOutputRange(session.segments, start, end)
  if (selected.length === 0) return session
  const groupId = makeId('replay')
  const copied = replaySegments(selected, groupId)
  const insertedDuration = timelineDuration(copied)
  if (insertedDuration <= EPSILON || insertedDuration > 30 + EPSILON) return session
  const insertionPoint = Math.max(start, end)
  const rippled = insertOutputGap(session, insertionPoint, insertedDuration, true)
  const segments = insertSegmentsAtOutputTime(session.segments, insertionPoint, copied, true)
  const total = timelineDuration(segments)
  const cutPoints = normalizedCutPoints([
    ...rippled.cutPoints,
    insertionPoint,
    insertionPoint + insertedDuration
  ], total)
  const firstFrame = 1 / session.canvas.fps
  return {
    ...rippled,
    segments,
    cutPoints,
    playhead: insertionPoint + Math.min(firstFrame, insertedDuration / 2)
  }
}

export function replayRanges(segments: SourceSegment[]): ReplayRange[] {
  const ranges: ReplayRange[] = []
  let cursor = 0
  for (const segment of segments) {
    const duration = segmentOutputDuration(segment)
    const groupId = segment.replayGroupId
    const previous = ranges.at(-1)
    if (groupId && previous?.groupId === groupId && Math.abs(previous.start + previous.duration - cursor) <= EPSILON) {
      previous.duration += duration
    } else if (groupId) {
      ranges.push({ groupId, start: cursor, duration })
    }
    cursor += duration
  }
  return ranges
}

export function removeReplayAtPlayhead(session: EditSession): EditSession {
  const position = positionAtOutputTime(session.segments, session.playhead)
  const groupId = position?.segment.replayGroupId
  if (!position || !groupId) return session
  let first = position.segmentIndex
  let last = position.segmentIndex
  while (session.segments[first - 1]?.replayGroupId === groupId) first -= 1
  while (session.segments[last + 1]?.replayGroupId === groupId) last += 1
  const start = timelineDuration(session.segments.slice(0, first))
  const end = start + timelineDuration(session.segments.slice(first, last + 1))
  const result = removeOutputRange(session.segments, session.overlays, start, end)
  const duration = timelineDuration(result.segments)
  return {
    ...session,
    ...result,
    cutPoints: cutPointsAfterRemoval(session.cutPoints, start, end, duration),
    focusZooms: timedRangesAfterRemoval(session.focusZooms, start, end),
    playhead: Math.min(start, duration),
    selectedOverlayId: result.overlays.some((overlay) => overlay.id === session.selectedOverlayId)
      ? session.selectedOverlayId
      : null
  }
}
