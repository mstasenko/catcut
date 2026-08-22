import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ExportRequest, Overlay } from '../src/types'

vi.mock('../../src/main/binaries', () => ({ ffmpegPath: () => '/ffmpeg', ffprobePath: () => '/ffprobe' }))
vi.mock('../../src/main/jobs', () => ({ jobs: { run: vi.fn() } }))

let buildFilterGraph: typeof import('../src/main/exporter').buildFilterGraph
let estimatedExportBytes: typeof import('../src/main/exporter').estimatedExportBytes
let loopsInput: typeof import('../src/main/exporter').loopsInput

beforeAll(async () => {
  ;({ buildFilterGraph, estimatedExportBytes, loopsInput } = await import('../src/main/exporter'))
})

describe('FFmpeg export graph', () => {
  it('estimates output space from timeline duration rather than source file size', () => {
    const source = { path: '/huge.mp4', name: 'huge.mp4', size: 100 * 1024 ** 3, modifiedAt: 1, duration: 3600, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, rotation: 0, pixelFormat: 'yuv420p' }
    const request: ExportRequest = {
      canvas: { width: 1920, height: 1080, fps: 30, fit: 'contain' },
      sources: [{ id: 's', metadata: source }], outputPath: '/out.mp4',
      segments: [{ id: 'short', sourceId: 's', sourceStart: 0, sourceEnd: 10 }], overlays: []
    }
    expect(estimatedExportBytes(request)).toBeLessThan(1024 ** 3)
  })

  it('loops GIF input only when requested', () => {
    const gif: Overlay = {
      id: 'gif', type: 'gif', name: 'Reaction', path: '/reaction.gif', playbackPath: '/reaction.mp4',
      start: 0, duration: 2, zIndex: 1, x: 0, y: 0, width: 1, height: 1, opacity: 1,
      loop: false, sourceIn: 0, sourceDuration: 2
    }
    expect(loopsInput(gif)).toBe(false)
    expect(loopsInput({ ...gif, loop: true })).toBe(true)
  })

  it('holds freeze frames with silence and applies focus before overlays', () => {
    const source = { path: '/v.mp4', name: 'v.mp4', size: 1, modifiedAt: 1, duration: 2, width: 320, height: 180, fps: 30, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, rotation: 0, pixelFormat: 'yuv420p' }
    const graph = buildFilterGraph({ canvas: { width: 320, height: 180, fps: 30, fit: 'contain' }, sources: [{ id: 's', metadata: source }], outputPath: '/out.mp4', segments: [{ kind: 'freeze', id: 'f', sourceId: 's', sourceTime: 1, duration: 1 }], overlays: [], focusZooms: [{ id: 'z', start: 0, duration: 1, zoom: 1.5, focusX: 0.5, focusY: 0.5 }] }, []).graph
    expect(graph).toContain("select='eq(n,0)',tpad=stop_mode=clone:stop_duration=1.000000")
    expect(graph).toContain('anullsrc=channel_layout=stereo:sample_rate=48000:d=1.000000')
    expect(graph).toContain('[basev]zoompan=')
  })

  it('exports every supported segment speed with matching video, audio, and silence timing', () => {
    const source = { path: '/speed.mp4', name: 'speed.mp4', size: 1, modifiedAt: 1, duration: 10, width: 320, height: 180, fps: 30, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, rotation: 0, pixelFormat: 'yuv420p' }
    const rates = [0.25, 0.5, 1, 2, 4] as const
    const graph = buildFilterGraph({ canvas: { width: 320, height: 180, fps: 30, fit: 'contain' }, sources: [{ id: 's', metadata: source }], outputPath: '/speed.mp4', segments: rates.map((playbackRate, index) => ({ id: `s${index}`, sourceId: 's', sourceStart: 0, sourceEnd: 1, playbackRate })), overlays: [] }, []).graph
    expect(graph).toContain('setpts=(PTS-STARTPTS)/0.25')
    expect(graph).toContain('atempo=0.5,atempo=0.5')
    expect(graph).toContain('setpts=(PTS-STARTPTS)/4')
    expect(graph).toContain('atempo=2,atempo=2')
  })

  it('exports Replay through the existing half-speed segment path without another source', () => {
    const source = { path: '/game.mp4', name: 'game.mp4', size: 1, modifiedAt: 1, duration: 4, width: 320, height: 180, fps: 30, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, rotation: 0, pixelFormat: 'yuv420p' }
    const graph = buildFilterGraph({
      canvas: { width: 320, height: 180, fps: 30, fit: 'contain' },
      sources: [{ id: 'game', metadata: source }], outputPath: '/replay.mp4', overlays: [],
      segments: [
        { id: 'original', sourceId: 'game', sourceStart: 0, sourceEnd: 1 },
        { id: 'replay', sourceId: 'game', sourceStart: 0, sourceEnd: 1, playbackRate: 0.5, replayGroupId: 'replay-one' }
      ]
    }, []).graph
    expect(graph).toContain('[0:v:0]trim=start=0.000000:end=1.000000')
    expect(graph).toContain('setpts=(PTS-STARTPTS)/0.5')
    expect(graph).toContain('atempo=0.5')
    expect(graph).not.toContain('[1:v:0]trim=')
  })

  it('animates only a prepared local text bitmap while None stays static', () => {
    const source = { path: '/game.mp4', name: 'game.mp4', size: 1, modifiedAt: 1, duration: 3, width: 320, height: 180, fps: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false, rotation: 0, pixelFormat: 'yuv420p' }
    const text = {
      id: 'text', type: 'text' as const, name: 'Title', start: 0.5, duration: 2, zIndex: 1,
      x: 0.25, y: 0.25, width: 0.5, height: 0.2, opacity: 0.8, text: 'POP',
      fontFamily: 'Anton', fontSize: 7, color: '#fff', outlineColor: '#000', outlineWidth: 2,
      shadow: false, align: 'center' as const, animation: 'pop' as const,
      renderedTextBitmap: { dataUrl: 'data:image/png;base64,AA==', x: 70, y: 35, width: 180, height: 70, anchorX: 160, anchorY: 63 }
    }
    const request: ExportRequest = {
      canvas: { width: 320, height: 180, fps: 30, fit: 'contain' }, sources: [{ id: 'game', metadata: source }],
      outputPath: '/text.mp4', segments: [{ id: 'game', sourceId: 'game', sourceStart: 0, sourceEnd: 3 }], overlays: [text]
    }
    const animated = buildFilterGraph(request, [{ overlay: text, index: 1 }]).graph
    expect(animated).toContain("scale=w='max(2,2*round(iw*(")
    expect(animated).toContain("geq=r='r(X,Y)'")
    expect(animated).toContain("overlay=x='160-overlay_w/2")
    const still = { ...text, animation: 'none' as const }
    const staticGraph = buildFilterGraph({ ...request, overlays: [still] }, [{ overlay: still, index: 1 }]).graph
    expect(staticGraph).toContain('overlay=x=70:y=35')
    expect(staticGraph).not.toContain('eval=frame')
  })

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

  it('keeps duration while transitioning into and back from an inserted clip', () => {
    const source = {
      path: '/source.mp4', name: 'source.mp4', size: 100, modifiedAt: 1, duration: 5,
      width: 320, height: 180, fps: 24, videoCodec: 'h264', audioCodec: 'aac',
      hasAudio: true, rotation: 0, pixelFormat: 'yuv420p'
    }
    const request: ExportRequest = {
      canvas: { width: 320, height: 180, fps: 24, fit: 'contain' },
      sources: [
        { id: 'source', metadata: source },
        { id: 'inserted', metadata: { ...source, path: '/inserted.mp4', name: 'inserted.mp4', duration: 1 } }
      ],
      outputPath: '/transitioned.mp4',
      segments: [
        { id: 'left', sourceId: 'source', sourceStart: 0, sourceEnd: 2 },
        {
          id: 'inserted', sourceId: 'inserted', sourceStart: 0, sourceEnd: 1,
          transition: { effect: 'dissolve', duration: 0.35 }
        },
        {
          id: 'right', sourceId: 'source', sourceStart: 2, sourceEnd: 5,
          transition: { effect: 'circleopen', duration: 0.65 }
        }
      ],
      overlays: []
    }
    const graph = buildFilterGraph(request, []).graph
    expect(graph).toContain('[vseg0]tpad=stop_mode=clone:stop_duration=0.350000[vhold1]')
    expect(graph).toContain('[vhold1][vseg1]xfade=transition=dissolve:duration=0.350000:offset=2.000000[vjoin1]')
    expect(graph).toContain('[vjoin1]tpad=stop_mode=clone:stop_duration=0.650000[vhold2]')
    expect(graph).toContain('[vhold2][vseg2]xfade=transition=circleopen:duration=0.650000:offset=3.000000[vjoin2]')
    expect(graph).toContain('[vjoin2]null[basev]')
    expect(graph).toContain('concat=n=3:v=0:a=1')
  })
})
