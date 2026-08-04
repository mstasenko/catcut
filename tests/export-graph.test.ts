import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ExportRequest, Overlay } from '../src/types'

vi.mock('electron', () => ({ nativeImage: { createFromPath: vi.fn() } }))
vi.mock('../../src/main/binaries', () => ({ ffmpegPath: () => '/ffmpeg', ffprobePath: () => '/ffprobe' }))
vi.mock('../../src/main/jobs', () => ({ jobs: { run: vi.fn() } }))

let buildFilterGraph: typeof import('../src/main/exporter').buildFilterGraph

beforeAll(async () => {
  ;({ buildFilterGraph } = await import('../src/main/exporter'))
})

describe('FFmpeg export graph', () => {
  it('builds retained segments, visual overlays, and equal audio mixing', () => {
    const overlays: Overlay[] = [
      {
        id: 'v', type: 'video', name: 'meme', path: '/meme.mp4', start: 1, duration: 2,
        zIndex: 1, x: 0, y: 0, width: 1, height: 1, opacity: 1, loop: true,
        audioEnabled: true, hasAudio: true, volume: 1, sourceDuration: 2
      },
      {
        id: 'a', type: 'audio', name: 'sound', path: '/sound.wav', start: 2, duration: 1,
        zIndex: 2, volume: 0.8, sourceDuration: 1
      }
    ]
    const request: ExportRequest = {
      source: {
        path: '/source.mp4', name: 'source.mp4', size: 100, duration: 10,
        width: 1280, height: 720, fps: 30, videoCodec: 'h264', audioCodec: 'aac',
        hasAudio: true, rotation: 0, pixelFormat: 'yuv420p'
      },
      outputPath: '/output.mp4',
      segments: [
        { id: 's1', sourceStart: 0, sourceEnd: 4 },
        { id: 's2', sourceStart: 6, sourceEnd: 10 }
      ],
      overlays
    }
    const [video, audio] = overlays
    if (!video || !audio) throw new Error('Overlay fixture is incomplete')
    const result = buildFilterGraph(request, [{ overlay: video, index: 1 }, { overlay: audio, index: 2 }])
    expect(result.graph).toContain('concat=n=2:v=1:a=0')
    expect(result.graph).toContain('overlay=x=0:y=0')
    expect(result.graph).toContain('amix=inputs=3')
    expect(result.graph).toContain('alimiter=limit=0.95')
    expect(result.videoLabel).toBe('vout0')
  })

  it('creates silence for a source without audio', () => {
    const request: ExportRequest = {
      source: {
        path: '/silent.mp4', name: 'silent.mp4', size: 10, duration: 3,
        width: 320, height: 180, fps: 24, videoCodec: 'h264', audioCodec: null,
        hasAudio: false, rotation: 0, pixelFormat: 'yuv420p'
      },
      outputPath: '/output.mp4', segments: [{ id: 's', sourceStart: 0, sourceEnd: 3 }], overlays: []
    }
    expect(buildFilterGraph(request, []).graph).toContain('anullsrc=channel_layout=stereo')
  })
})
