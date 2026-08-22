import type { EditSession, FreezeDuration, SourceSegment } from '@shared/types'
import { isFreezeSegment, makeId, positionAtOutputTime, timeAfterOutputRemoval, timelineDuration } from './timeline'
import { timedRangesAfterInsertion, timedRangesAfterRemoval } from './timed-ranges'

const EPSILON = 0.0001

function shiftPoint(time: number, point: number, duration: number): number {
  return time >= point - EPSILON ? time + duration : time
}

export function insertFreezeFrame(session: EditSession, outputTime: number, duration: FreezeDuration): EditSession {
  const position = positionAtOutputTime(session.segments, outputTime)
  if (!position || isFreezeSegment(position.segment)) return session
  const sourceTime = position.sourceTime
  const freeze: SourceSegment = { kind: 'freeze', id: makeId('freeze'), sourceId: position.segment.sourceId, sourceTime, duration }
  const before = sourceTime > position.segment.sourceStart + EPSILON ? { ...position.segment, id: makeId('segment'), sourceEnd: sourceTime } : null
  const after = sourceTime < position.segment.sourceEnd - EPSILON ? { ...position.segment, id: makeId('segment'), sourceStart: sourceTime, transition: undefined } : null
  const segments = [...session.segments.slice(0, position.segmentIndex), ...(before ? [before] : []), freeze, ...(after ? [after] : []), ...session.segments.slice(position.segmentIndex + 1)]
  const focusZooms = timedRangesAfterInsertion(session.focusZooms, outputTime, duration)
  return { ...session, segments, overlays: session.overlays.map((overlay) => ({ ...overlay, start: shiftPoint(overlay.start, outputTime, duration) })), cutPoints: session.cutPoints.map((point) => shiftPoint(point, outputTime, duration)), focusZooms, playhead: outputTime }
}

export function removeFreezeFrame(session: EditSession, segmentId: string): EditSession {
  const index = session.segments.findIndex((segment) => segment.id === segmentId && isFreezeSegment(segment))
  const freeze = session.segments[index]
  if (index < 0 || !freeze || !isFreezeSegment(freeze)) return session
  const start = timelineDuration(session.segments.slice(0, index))
  const duration = freeze.duration
  const end = start + duration
  const segments = session.segments.filter((segment) => segment.id !== segmentId)
  return {
    ...session,
    segments,
    overlays: session.overlays.map((overlay) => ({ ...overlay, start: timeAfterOutputRemoval(overlay.start, start, end) })),
    cutPoints: session.cutPoints.map((point) => timeAfterOutputRemoval(point, start, end)),
    focusZooms: timedRangesAfterRemoval(session.focusZooms, start, end),
    playhead: Math.min(start, timelineDuration(segments))
  }
}
