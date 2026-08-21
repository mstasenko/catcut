import type { EditSession, SourceSegment, VideoSegment, VideoSpeed } from '@shared/types'
import {
  clamp,
  isFreezeSegment,
  segmentOutputDuration,
  outputTimeForSource,
  segmentPlaybackRate,
  positionAtOutputTime,
  timelineDuration
} from './timeline'
import { splitSegmentForOutputRange } from './segment-ranges'

const EPSILON = 0.0001

function withRate(segment: VideoSegment, rate: VideoSpeed): VideoSegment {
  const result = { ...segment }
  delete result.playbackRate
  return rate === 1 ? result : { ...result, playbackRate: rate }
}

function splitSegments(segments: SourceSegment[], start: number, end: number, rate: VideoSpeed): SourceSegment[] {
  const result: SourceSegment[] = []
  let cursor = 0
  for (const segment of segments) {
    const duration = segmentOutputDuration(segment)
    const parts = splitSegmentForOutputRange(segment, cursor, start, end)
    const inside = parts.inside
    if (!inside || isFreezeSegment(inside) || segmentPlaybackRate(segment) === rate) {
      result.push(segment)
      cursor += duration
      continue
    }
    if (parts.before) result.push(parts.before)
    result.push(withRate(inside, rate))
    if (parts.after) result.push(parts.after)
    cursor += duration
  }
  return result
}

export function applySpeedToOutputRange(session: EditSession, rawStart: number, rawEnd: number, rate: VideoSpeed): EditSession {
  const oldDuration = timelineDuration(session.segments)
  const start = clamp(Math.min(rawStart, rawEnd), 0, oldDuration)
  const end = clamp(Math.max(rawStart, rawEnd), 0, oldDuration)
  if (end - start <= EPSILON) return session
  const segments = splitSegments(session.segments, start, end, rate)
  const delta = timelineDuration(segments) - oldDuration
  const map = (time: number): number => time <= start + EPSILON ? time : time >= end - EPSILON ? time + delta : start + (time - start) * (1 + delta / (end - start))
  const overlays = session.overlays.map((overlay) => ({ ...overlay, start: map(overlay.start) }))
  const cutPoints = [...new Set(session.cutPoints.map(map))].filter((point) => point > EPSILON && point < timelineDuration(segments) - EPSILON)
  const focusZooms = session.focusZooms.map((effect) => {
    const mappedStart = map(effect.start)
    return { ...effect, start: mappedStart, duration: Math.max(EPSILON, map(effect.start + effect.duration) - mappedStart) }
  })
  let playhead = clamp(map(session.playhead), 0, timelineDuration(segments))
  const oldPosition = positionAtOutputTime(session.segments, session.playhead)
  if (oldPosition && !isFreezeSegment(oldPosition.segment)) {
    const index = segments.findIndex((segment) => !isFreezeSegment(segment) && segment.sourceId === oldPosition.segment.sourceId && oldPosition.sourceTime >= segment.sourceStart - EPSILON && oldPosition.sourceTime <= segment.sourceEnd + EPSILON)
    if (index >= 0) playhead = outputTimeForSource(segments, index, oldPosition.sourceTime)
  }
  return { ...session, segments, overlays, cutPoints, playhead, focusZooms }
}
