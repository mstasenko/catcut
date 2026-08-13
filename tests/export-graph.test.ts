import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ExportRequest, Overlay } from '../src/types'

vi.mock('../../src/main/binaries', () => ({ ffmpegPath: () => '/ffmpeg', ffprobePath: () => '/ffprobe' }))
vi.mock('../../src/main/jobs', () => ({ jobs: { run: vi.fn() } }))

let buildFilterGraph: typeof import('../src/main/exporter').buildFilterGraph
let streamCopyArguments: typeof import('../src/main/exporter').streamCopyArguments

beforeAll(async () => {
  ;({ buildFilterGraph, streamCopyArguments } = await import('../src/main/exporter'))
})

describe('FFmpeg export graph', () => {
  it('builds retained segments, visual overlays, and equal audio mixing', () => {
    const overlays: Overlay[] = [
      {
        id: 'v', type: 'video', name: 'meme', path: '/meme.mp4', start: 1, duration: 2,
        zIndex: 1, x: 0, y: 0, width: 1, height: 1, opacity: 1, loop: true,
        audioEnabled: true, hasAudio: true, volume: 1, sourceIn: 0.5, sourceDuration: 2
      },
      {
        id: 'a', type: 'audio', name: 'sound', path: '/sound.wav', start: 2, duration: 1,
        zIndex: 2, volume: 0.8, sourceIn: 0.25, sourceDuration: 1
      }
    ]
    const source = {
      path: '/source.mp4', name: 'source.mp4', size: 100, modifiedAt: 1, duration: 10,
      width: 1280, height: 720, fps: 30, videoCodec: 'h264', audioCodec: 'aac',
      hasAudio: true, rotation: 0, pixelFormat: 'yuv420p'
    }
    const request: ExportRequest = {
      canvas: { width: source.width, height: source.height, fps: source.fps, fit: 'contain' },
      sources: [{ id: 'source', metadata: source }],
      outputPath: '/output.mp4',
      segments: [
        { id: 's1', sourceId: 'source', sourceStart: 0, sourceEnd: 4 },
        { id: 's2', sourceId: 'source', sourceStart: 6, sourceEnd: 10 }
      ],
      overlays
    }
    const [video, audio] = overlays
    if (!video || !audio) throw new Error('Overlay fixture is incomplete')
    const result = buildFilterGraph(request, [{ overlay: video, index: 1 }, { overlay: audio, index: 2 }])
    expect(result.graph).toContain('concat=n=2:v=1:a=0')
    expect(result.graph).toContain('overlay=x=0:y=0')
    expect(result.graph).toContain('amix=inputs=3')
    expect(result.graph).toContain('trim=start=0.500000:end=2.500000')
    expect(result.graph).toContain('atrim=start=0.250000:end=1.250000')
    expect(result.graph).toContain('alimiter=limit=0.95')
    expect(result.videoLabel).toBe('vout0')
  })

  it('creates silence for a source without audio', () => {
    const source = {
      path: '/silent.mp4', name: 'silent.mp4', size: 10, modifiedAt: 1, duration: 3,
      width: 320, height: 180, fps: 24, videoCodec: 'h264', audioCodec: null,
      hasAudio: false, rotation: 0, pixelFormat: 'yuv420p'
    }
    const request: ExportRequest = {
      canvas: { width: source.width, height: source.height, fps: source.fps, fit: 'contain' },
      sources: [{ id: 'source', metadata: source }],
      outputPath: '/output.mp4', segments: [{ id: 's', sourceId: 'source', sourceStart: 0, sourceEnd: 3 }], overlays: []
    }
    expect(buildFilterGraph(request, []).graph).toContain('anullsrc=channel_layout=stereo')
  })

  it('centers contained media and applies text opacity exactly once', () => {
    const overlays: Overlay[] = [
      {
        id: 'text', type: 'text', name: 'Title', start: 0, duration: 2, zIndex: 1,
        x: 0.1, y: 0.1, width: 0.8, height: 0.2, opacity: 0.5, text: 'Hello',
        fontFamily: 'Anton', fontSize: 7, color: '#fff', outlineColor: '#000',
        outlineWidth: 2, shadow: false, align: 'center'
      },
      {
        id: 'image', type: 'image', name: 'Picture', path: '/picture.png',
        start: 0, duration: 2, zIndex: 2, x: 0.25, y: 0.25,
        width: 0.5, height: 0.5, opacity: 1, loop: false
      }
    ]
    const source = {
      path: '/source.mp4', name: 'source.mp4', size: 100, modifiedAt: 1, duration: 2,
      width: 1280, height: 720, fps: 60, videoCodec: 'h264', audioCodec: null,
      hasAudio: false, rotation: 0, pixelFormat: 'yuv420p'
    }
    const request: ExportRequest = {
      canvas: { width: source.width, height: source.height, fps: source.fps, fit: 'contain' },
      sources: [{ id: 'source', metadata: source }],
      outputPath: '/output.mp4',
      segments: [{ id: 'source', sourceId: 'source', sourceStart: 0, sourceEnd: 2 }],
      overlays
    }
    const graph = buildFilterGraph(request, overlays.map((overlay, offset) => ({ overlay, index: offset + 1 }))).graph
    expect(graph.match(/colorchannelmixer=aa=0\.5/g)).toHaveLength(1)
    expect(graph).toContain('pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black@0')
    expect(graph).toContain('overlay=x=320:y=180')
  })

  it('maps only MP4-compatible primary streams during lossless remuxing', () => {
    const args = streamCopyArguments('/tmp/segments.ffconcat', '/tmp/output.mp4')
    expect(args).toEqual(expect.arrayContaining(['0:v:0', '0:a:0?', '-sn', '-dn']))
    expect(args.some((argument, index) => argument === '0' && args[index - 1] === '-map')).toBe(false)
  })

  it('normalizes multiple sources into a cropped 9:16 Short canvas', () => {
    const landscape = {
      path: '/landscape.mp4', name: 'landscape.mp4', size: 100, modifiedAt: 1, duration: 2,
      width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac',
      hasAudio: true, rotation: 0, pixelFormat: 'yuv420p'
    }
    const silent = {
      ...landscape, path: '/silent.mp4', name: 'silent.mp4', width: 640, height: 480,
      fps: 24, audioCodec: null, hasAudio: false
    }
    const request: ExportRequest = {
      canvas: { width: 1080, height: 1920, fps: 30, fit: 'cover' },
      sources: [{ id: 'landscape', metadata: landscape }, { id: 'silent', metadata: silent }],
      outputPath: '/short.mp4',
      segments: [
        { id: 'a', sourceId: 'landscape', sourceStart: 0, sourceEnd: 2 },
        { id: 'b', sourceId: 'silent', sourceStart: 0, sourceEnd: 2 }
      ],
      overlays: []
    }
    const graph = buildFilterGraph(request, []).graph
    expect(graph).toContain('[0:v:0]trim=')
    expect(graph).toContain('[1:v:0]trim=')
    expect(graph).toContain('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920')
    expect(graph).toContain('anullsrc=channel_layout=stereo:sample_rate=48000:d=2.000000')
    expect(graph).toContain('concat=n=2:v=1:a=0')
    expect(graph).toContain('concat=n=2:v=0:a=1')
  })
})
