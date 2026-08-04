import type {
  EditSession,
  MediaMetadata,
  Overlay,
  SourceSegment,
  TextOverlay
} from '@shared/types'

const EPSILON = 0.0001

export function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function timelineDuration(segments: SourceSegment[]): number {
  return segments.reduce((total, segment) => total + segment.sourceEnd - segment.sourceStart, 0)
}

export function createSession(source: MediaMetadata): EditSession {
  return {
    source,
    playbackPath: source.path,
    segments: [{ id: makeId('segment'), sourceStart: 0, sourceEnd: source.duration }],
    overlays: [],
    waveform: [],
    selectedOverlayId: null,
    playhead: 0,
    cutPoints: [],
    dirty: false
  }
}

export interface TimelinePosition {
  segmentIndex: number
  segment: SourceSegment
  outputStart: number
  sourceTime: number
}

export function positionAtOutputTime(
  segments: SourceSegment[],
  outputTime: number
): TimelinePosition | null {
  if (segments.length === 0) return null
  const total = timelineDuration(segments)
  const safeTime = clamp(outputTime, 0, total)
  let outputStart = 0

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (!segment) continue
    const segmentDuration = segment.sourceEnd - segment.sourceStart
    const isLast = index === segments.length - 1
    if (safeTime < outputStart + segmentDuration || isLast) {
      return {
        segmentIndex: index,
        segment,
        outputStart,
        sourceTime: clamp(
          segment.sourceStart + safeTime - outputStart,
          segment.sourceStart,
          segment.sourceEnd
        )
      }
    }
    outputStart += segmentDuration
  }
  return null
}

export function outputTimeForSource(
  segments: SourceSegment[],
  segmentIndex: number,
  sourceTime: number
): number {
  const before = timelineDuration(segments.slice(0, segmentIndex))
  const segment = segments[segmentIndex]
  if (!segment) return before
  return before + clamp(sourceTime - segment.sourceStart, 0, segment.sourceEnd - segment.sourceStart)
}

function trimOverlaysForRemoval(overlays: Overlay[], start: number, end: number): Overlay[] {
  const removedDuration = end - start
  return overlays.flatMap((overlay) => {
    const overlayEnd = overlay.start + overlay.duration
    if (overlayEnd <= start) return [overlay]
    if (overlay.start >= end) return [{ ...overlay, start: overlay.start - removedDuration }]
    if (overlay.start < start && overlayEnd > end) {
      return [{ ...overlay, duration: overlay.duration - removedDuration }]
    }
    if (overlay.start < start && overlayEnd > start) {
      const duration = start - overlay.start
      return duration > EPSILON ? [{ ...overlay, duration }] : []
    }
    if (overlay.start < end && overlayEnd > end) {
      const duration = overlayEnd - end
      return duration > EPSILON ? [{ ...overlay, start, duration }] : []
    }
    return []
  })
}

export function removeOutputRange(
  segments: SourceSegment[],
  overlays: Overlay[],
  rawStart: number,
  rawEnd: number
): { segments: SourceSegment[]; overlays: Overlay[] } {
  const duration = timelineDuration(segments)
  const start = clamp(Math.min(rawStart, rawEnd), 0, duration)
  const end = clamp(Math.max(rawStart, rawEnd), 0, duration)
  if (end - start <= EPSILON) return { segments, overlays }

  const output: SourceSegment[] = []
  let outputCursor = 0
  for (const segment of segments) {
    const segmentDuration = segment.sourceEnd - segment.sourceStart
    const segmentOutputEnd = outputCursor + segmentDuration
    const keepBefore = clamp(start - outputCursor, 0, segmentDuration)
    const keepAfter = clamp(segmentOutputEnd - end, 0, segmentDuration)

    if (keepBefore > EPSILON) {
      output.push({
        id: makeId('segment'),
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceStart + keepBefore
      })
    }
    if (keepAfter > EPSILON) {
      output.push({
        id: makeId('segment'),
        sourceStart: segment.sourceEnd - keepAfter,
        sourceEnd: segment.sourceEnd
      })
    }
    outputCursor = segmentOutputEnd
  }

  return {
    segments: output,
    overlays: trimOverlaysForRemoval(overlays, start, end)
  }
}

export function deletionRange(session: EditSession): [number, number] | null {
  const points = [...session.cutPoints].sort((left, right) => left - right)
  if (points.length === 0) return null
  const duration = timelineDuration(session.segments)
  // Cut points are dividers, not paired selections. Choosing the partition that
  // contains the playhead scales to any number of points and keeps one Cut action.
  // At an exact divider, select the partition on its left so a newly added point
  // immediately highlights the video leading up to it.
  const nextIndex = points.findIndex((point) => session.playhead <= point)
  if (nextIndex < 0) return [points.at(-1) ?? 0, duration]
  return [points[nextIndex - 1] ?? 0, points[nextIndex] ?? duration]
}

export function cutPointsAfterRemoval(
  points: number[],
  start: number,
  end: number,
  duration: number
): number[] {
  const removed = end - start
  // Points inside a removed partition collapse onto its join. Deduplication leaves
  // one useful divider there while endpoint filtering avoids zero-length ranges.
  const shifted = points.map((point) => {
    if (point < start) return point
    if (point > end) return point - removed
    return start
  }).filter((point) => point > EPSILON && point < duration - EPSILON)
  return [...new Set(shifted)].sort((left, right) => left - right)
}

export function defaultTextOverlay(start: number, zIndex: number): TextOverlay {
  return {
    id: makeId('text'),
    type: 'text',
    name: 'Text',
    start,
    duration: 3,
    zIndex,
    x: 0.15,
    y: 0.72,
    width: 0.7,
    height: 0.2,
    opacity: 1,
    text: 'Your text',
    fontFamily: 'Anton',
    fontSize: 7,
    color: '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 3,
    shadow: true,
    align: 'center'
  }
}

export function overlayAtTime(overlay: Overlay, time: number): boolean {
  return time >= overlay.start && time < overlay.start + overlay.duration
}

export function snapTime(time: number, candidates: number[], threshold: number): number {
  let result = time
  let closest = threshold
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - time)
    if (distance <= closest) {
      result = candidate
      closest = distance
    }
  }
  return result
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remainder = Math.floor(safe % 60)
  const frames = Math.floor((safe - Math.floor(safe)) * 30)
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
}
