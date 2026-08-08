import { describe, expect, it } from 'vitest'
import type { MediaMetadata, Overlay, SourceSegment } from '@shared/types'
import {
  clamp,
  createSession,
  cutPointsAfterRemoval,
  deletionRange,
  defaultTextOverlay,
  formatTime,
  isSourceTimedOverlay,
  overlaySourceTime,
  outputTimeForSource,
  overlayAtTime,
  positionAtOutputTime,
  removeOutputRange,
  snapTime,
  timelineDuration
} from './timeline'

const source: MediaMetadata = {
  path: '/video.mp4', name: 'video.mp4', size: 100, modifiedAt: 1, duration: 20,
  width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac',
  hasAudio: true, rotation: 0, pixelFormat: 'yuv420p'
}

describe('timeline model', () => {
  it('creates a path-backed initial session', () => {
    const session = createSession(source)
    expect(session.source).toBe(source)
    expect(session.segments).toHaveLength(1)
    expect(timelineDuration(session.segments)).toBe(20)
    expect(session.dirty).toBe(false)
  })

  it('maps output positions across retained source segments', () => {
    const segments: SourceSegment[] = [
      { id: 'a', sourceStart: 2, sourceEnd: 5 },
      { id: 'b', sourceStart: 10, sourceEnd: 14 }
    ]
    expect(timelineDuration(segments)).toBe(7)
    expect(positionAtOutputTime(segments, 1)?.sourceTime).toBe(3)
    expect(positionAtOutputTime(segments, 4)).toMatchObject({ segmentIndex: 1, sourceTime: 11 })
    expect(positionAtOutputTime(segments, 99)?.sourceTime).toBe(14)
    expect(positionAtOutputTime([], 0)).toBeNull()
    expect(outputTimeForSource(segments, 1, 12)).toBe(5)
    expect(outputTimeForSource(segments, 9, 2)).toBe(7)
  })

  it('derives the partition containing the playhead from any number of cut points', () => {
    const session = createSession(source)
    session.cutPoints = [4]
    session.playhead = 4
    expect(deletionRange(session)).toEqual([0, 4])
    session.playhead = 2
    expect(deletionRange(session)).toEqual([0, 4])
    session.playhead = 8
    expect(deletionRange(session)).toEqual([4, 20])
    session.cutPoints = [16, 4, 12]
    session.playhead = 8
    expect(deletionRange(session)).toEqual([4, 12])
    session.playhead = 2
    expect(deletionRange(session)).toEqual([0, 4])
    session.playhead = 14
    expect(deletionRange(session)).toEqual([12, 16])
    session.playhead = 18
    expect(deletionRange(session)).toEqual([16, 20])
    expect(cutPointsAfterRemoval([4, 12, 16], 12, 16, 16)).toEqual([4, 12])
  })

  it('removes a range spanning segments and collapses output time', () => {
    const segments: SourceSegment[] = [
      { id: 'a', sourceStart: 0, sourceEnd: 5 },
      { id: 'b', sourceStart: 10, sourceEnd: 15 }
    ]
    const result = removeOutputRange(segments, [], 3, 7)
    expect(result.segments.map(({ sourceStart, sourceEnd }) => [sourceStart, sourceEnd])).toEqual([[0, 3], [12, 15]])
    expect(timelineDuration(result.segments)).toBe(6)
  })

  it('trims, removes, and shifts overlays with deleted video', () => {
    const base = (id: string, start: number, duration: number): Overlay => ({
      ...defaultTextOverlay(start, 1), id, duration
    })
    const overlays = [
      base('before', 0, 1),
      base('left', 1, 3),
      base('inside', 3, 1),
      base('span', 1, 7),
      base('right', 5, 3),
      base('after', 8, 1)
    ]
    const result = removeOutputRange([{ id: 's', sourceStart: 0, sourceEnd: 10 }], overlays, 2, 6)
    expect(result.overlays.map(({ id, start, duration }) => ({ id, start, duration }))).toEqual([
      { id: 'before', start: 0, duration: 1 },
      { id: 'left', start: 1, duration: 1 },
      { id: 'span', start: 1, duration: 3 },
      { id: 'right', start: 2, duration: 2 },
      { id: 'after', start: 4, duration: 1 }
    ])
  })

  it('splits timed media and preserves its source position across a ripple cut', () => {
    const audio: Overlay = {
      id: 'audio', type: 'audio', name: 'Music', path: '/music.wav',
      start: 1, duration: 7, zIndex: 1, volume: 1, sourceIn: 10, sourceDuration: 30
    }
    const result = removeOutputRange(
      [{ id: 'source', sourceStart: 0, sourceEnd: 10 }],
      [audio],
      2,
      6
    )
    expect(result.overlays).toHaveLength(2)
    expect(result.overlays[0]).toMatchObject({ id: 'audio', start: 1, duration: 1, sourceIn: 10 })
    expect(result.overlays[1]).toMatchObject({ start: 2, duration: 2, sourceIn: 15 })
    expect(result.overlays[1]?.id).not.toBe('audio')
  })

  it('trims either edge of timed source media without restarting it', () => {
    const audio = (id: string, start: number, duration: number): Overlay => ({
      id, type: 'audio', name: id, path: `/${id}.wav`, start, duration,
      zIndex: 1, volume: 1, sourceIn: 4, sourceDuration: 20
    })
    const result = removeOutputRange(
      [{ id: 'source', sourceStart: 0, sourceEnd: 10 }],
      [audio('left', 1, 3), audio('right', 3, 5), audio('removed', 3, 1)],
      2,
      6
    )
    expect(result.overlays).toHaveLength(2)
    expect(result.overlays[0]).toMatchObject({ id: 'left', start: 1, duration: 1, sourceIn: 4 })
    expect(result.overlays[1]).toMatchObject({ id: 'right', start: 2, duration: 2, sourceIn: 7 })
  })

  it('uses the same source-aware ripple behavior for video and GIF clips', () => {
    const visual = {
      name: 'Clip', path: '/clip', start: 1, duration: 7, zIndex: 1,
      x: 0, y: 0, width: 1, height: 1, opacity: 1, loop: true,
      sourceIn: 2, sourceDuration: 20
    }
    const overlays: Overlay[] = [
      { ...visual, id: 'video', type: 'video', audioEnabled: false, hasAudio: false, volume: 1 },
      { ...visual, id: 'gif', type: 'gif' }
    ]
    const result = removeOutputRange(
      [{ id: 'source', sourceStart: 0, sourceEnd: 10 }],
      overlays,
      2,
      6
    )
    expect(result.overlays.filter((overlay) => overlay.type === 'video')).toHaveLength(2)
    expect(result.overlays.filter((overlay) => overlay.type === 'gif')).toHaveLength(2)
    expect(result.overlays.filter(isSourceTimedOverlay).filter((overlay) => overlay.sourceIn === 7)).toHaveLength(2)
  })

  it('handles reversed, empty, and bounded removals', () => {
    const segments = [{ id: 'a', sourceStart: 0, sourceEnd: 10 }]
    expect(removeOutputRange(segments, [], 5, 5).segments).toBe(segments)
    expect(timelineDuration(removeOutputRange(segments, [], 9, 2).segments)).toBe(3)
    expect(removeOutputRange(segments, [], -10, 20).segments).toEqual([])
  })

  it('provides overlay, snapping, formatting, and clamp helpers', () => {
    const overlay = defaultTextOverlay(2, 3)
    expect(overlay.fontFamily).toBe('Anton')
    expect(overlayAtTime(overlay, 2)).toBe(true)
    expect(overlayAtTime(overlay, 5)).toBe(false)
    expect(snapTime(3.08, [1, 3, 7], 0.1)).toBe(3)
    expect(snapTime(3.2, [3], 0.1)).toBe(3.2)
    expect(clamp(-1, 0, 2)).toBe(0)
    expect(clamp(5, 0, 2)).toBe(2)
    expect(formatTime(65.5)).toBe('01:05.15')
    expect(formatTime(3661)).toBe('1:01:01.00')
    expect(formatTime(Number.NaN)).toBe('00:00.00')
    expect(formatTime(1.5, 24)).toBe('00:01.12')
    expect(formatTime(1.5, 0)).toBe('00:01.15')
    const audio: Overlay = {
      id: 'audio', type: 'audio', name: 'audio', path: '/audio.wav', start: 2,
      duration: 3, zIndex: 1, volume: 1, sourceIn: 4, sourceDuration: 10
    }
    const gif: Overlay = {
      id: 'gif', type: 'gif', name: 'gif', path: '/gif.gif', start: 2,
      duration: 3, zIndex: 1, x: 0, y: 0, width: 1, height: 1, opacity: 1,
      loop: true, sourceIn: 9, sourceDuration: 10
    }
    expect(isSourceTimedOverlay(audio)).toBe(true)
    expect(isSourceTimedOverlay(overlay)).toBe(false)
    expect(overlaySourceTime(audio, 3)).toBe(5)
    expect(overlaySourceTime(gif, 4)).toBe(1)
  })
})
