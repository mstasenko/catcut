import { describe, expect, it } from 'vitest'
import type { EditSession, SourceSegment } from '@shared/types'
import { transitionAtOutputTime, transitionPreviewAtOutputTime, transitionStyles } from './transitions'

const segments: SourceSegment[] = [
  { id: 'first', sourceId: 'source', sourceStart: 0, sourceEnd: 2 },
  {
    id: 'second', sourceId: 'source', sourceStart: 4, sourceEnd: 6,
    transition: { effect: 'fade', duration: 1 }
  }
]

describe('timeline transitions', () => {
  it('finds only the active incoming transition', () => {
    expect(transitionAtOutputTime(segments, 1.9)).toBeNull()
    expect(transitionAtOutputTime(segments, 2.5)).toMatchObject({
      effect: 'fade', currentSegmentIndex: 1, previousSegmentIndex: 0, progress: 0.5
    })
    expect(transitionAtOutputTime(segments, 3)).toBeNull()
    expect(transitionAtOutputTime([], 0)).toBeNull()
  })

  it('resolves the outgoing preview frame from the preceding source', () => {
    const session = {
      canvas: { width: 320, height: 180, fps: 20, fit: 'contain' },
      sources: [{
        id: 'source', playbackPath: 'catcut:/source.mp4', waveform: [],
        metadata: {
          path: '/source.mp4', name: 'source.mp4', size: 1, modifiedAt: 1, duration: 6,
          width: 320, height: 180, fps: 20, videoCodec: 'h264', audioCodec: null,
          hasAudio: false, rotation: 0, pixelFormat: 'yuv420p'
        }
      }],
      segments,
      overlays: [], selectedOverlayId: null, playhead: 2.5, cutPoints: [], dirty: true
    } satisfies EditSession
    expect(transitionPreviewAtOutputTime(session, 2.5)).toMatchObject({
      previousPath: 'catcut:/source.mp4', previousFrameTime: 1.95,
      active: { effect: 'fade', progress: 0.5 }
    })
    expect(transitionPreviewAtOutputTime(session, 0)).toBeNull()
    expect(transitionPreviewAtOutputTime({ ...session, sources: [] }, 2.5)).toBeNull()
  })

  it.each([
    ['fade', 'opacity'],
    ['dissolve', 'filter'],
    ['wipeleft', 'clipPath'],
    ['wiperight', 'clipPath'],
    ['slideleft', 'transform'],
    ['slideright', 'transform'],
    ['circleopen', 'clipPath'],
    ['zoomin', 'transform'],
    ['hblur', 'filter']
  ] as const)('creates bounded %s preview styles', (effect, currentProperty) => {
    const styles = transitionStyles({ effect, progress: 1.5 })
    expect(styles.current).toHaveProperty(currentProperty)
    expect(styles.previous).toBeTypeOf('object')
  })
})
