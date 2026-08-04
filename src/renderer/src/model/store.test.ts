import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatCutApi, MediaMetadata } from '@shared/types'
import { isVideoOverlay, selectedOverlay, useEditorStore } from './store'

const metadata: MediaMetadata = {
  path: '/source.mp4', name: 'source.mp4', size: 100, duration: 10,
  width: 1280, height: 720, fps: 30, videoCodec: 'h264', audioCodec: 'aac',
  hasAudio: true, rotation: 0, pixelFormat: 'yuv420p'
}

function api(): CatCutApi {
  return {
    openVideo: vi.fn().mockResolvedValue('/source.mp4'),
    openMedia: vi.fn().mockResolvedValue({ path: '/effect.ogg', type: 'audio', name: 'Effect' }),
    probe: vi.fn().mockResolvedValue(metadata),
    probeAsset: vi.fn().mockResolvedValue({ duration: 2, width: 320, height: 180, hasAudio: true }),
    waveform: vi.fn().mockResolvedValue([0.1, 0.8]),
    shouldProxy: vi.fn().mockResolvedValue(false),
    createProxy: vi.fn().mockResolvedValue({ jobId: 'proxy', result: { path: '/proxy.mp4', cacheHit: false } }),
    scanAssets: vi.fn().mockResolvedValue([]),
    chooseExportPath: vi.fn().mockResolvedValue('/output.mp4'),
    exportVideo: vi.fn().mockResolvedValue({ jobId: 'export', outputPath: '/output.mp4' }),
    cancelJob: vi.fn().mockResolvedValue(true),
    getGpuDiagnostics: vi.fn().mockResolvedValue({ sessionType: 'wayland', desktop: 'GNOME', waylandDisplay: 'wayland-0', hardwareAcceleration: true, videoDecode: 'enabled', gpuCompositing: 'enabled', gpuName: 'Intel' }),
    getPathUrl: vi.fn((path: string) => Promise.resolve(`catcut:${path}`)),
    getDroppedPath: vi.fn(() => '/drop.mp4'),
    onOpenPath: vi.fn(() => () => undefined),
    onJobProgress: vi.fn(() => () => undefined)
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'catcut', { value: api(), configurable: true })
  useEditorStore.setState({
    initialized: false, session: null, history: [], future: [], assets: [],
    gpu: null, job: null, busy: null, error: null
  })
})

describe('editor store', () => {
  it('initializes diagnostics and assets', async () => {
    await useEditorStore.getState().initialize()
    expect(useEditorStore.getState().initialized).toBe(true)
    expect(useEditorStore.getState().gpu?.videoDecode).toBe('enabled')
  })

  it('loads media, edits the timeline, and supports undo/redo', async () => {
    const store = useEditorStore.getState()
    await store.loadVideo()
    expect(useEditorStore.getState().session?.playbackPath).toBe('catcut:/source.mp4')
    await vi.waitFor(() => expect(useEditorStore.getState().session?.waveform).toEqual([0.1, 0.8]))
    useEditorStore.getState().setPlayhead(4)
    useEditorStore.getState().selectPoint()
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().session?.cutPoints).toEqual([])
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().session?.cutPoints).toEqual([4])
    useEditorStore.getState().setPlayhead(6)
    useEditorStore.getState().selectPoint()
    useEditorStore.getState().deleteSelection()
    expect(useEditorStore.getState().session?.segments[0]?.sourceEnd).toBe(4)
    expect(useEditorStore.getState().session?.dirty).toBe(true)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().session?.segments).toHaveLength(1)
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().session?.segments).toHaveLength(2)
  })

  it('adds and edits text and video overlays', async () => {
    await useEditorStore.getState().loadVideo('/source.mp4')
    useEditorStore.getState().addText()
    const text = useEditorStore.getState().session?.overlays[0]
    expect(text?.type).toBe('text')
    if (!text) throw new Error('missing overlay')
    useEditorStore.getState().updateOverlay(text.id, { duration: 5 })
    expect(useEditorStore.getState().session?.overlays[0]?.duration).toBe(5)
    await useEditorStore.getState().addAsset({ id: 'v', type: 'video', name: 'Meme', path: '/meme.mp4', source: 'external' })
    const video = useEditorStore.getState().session?.overlays.at(-1)
    expect(video).toMatchObject({ type: 'video', audioEnabled: false, sourceDuration: 2 })
    useEditorStore.getState().removeSelectedOverlay()
    expect(useEditorStore.getState().session?.overlays).toHaveLength(1)
  })

  it('switches to an automatically generated proxy', async () => {
    vi.mocked(window.catcut.shouldProxy).mockResolvedValue(true)
    await useEditorStore.getState().loadVideo('/source.mp4')
    await vi.waitFor(() => expect(useEditorStore.getState().session?.playbackPath).toBe('catcut:/proxy.mp4'))
  })

  it('adds external audio assets', async () => {
    await useEditorStore.getState().loadVideo('/source.mp4')
    await useEditorStore.getState().addExternalMedia()
    expect(useEditorStore.getState().session?.overlays[0]?.type).toBe('audio')
    expect(useEditorStore.getState().session?.overlays[0]).toMatchObject({ name: 'Effect', duration: 2 })
  })

  it('covers image, GIF, selection, and playback actions', async () => {
    const empty = useEditorStore.getState()
    empty.setPlayhead(4)
    empty.selectPoint()
    empty.clearSelection()
    empty.deleteSelection()
    empty.addText()
    empty.selectOverlay('none')
    empty.removeSelectedOverlay()
    empty.undo()
    empty.redo()
    await empty.setPlaybackPath('/unused.mp4')
    expect(useEditorStore.getState().session).toBeNull()

    await useEditorStore.getState().loadVideo('/source.mp4')
    useEditorStore.getState().setPlayhead(3)
    useEditorStore.getState().selectPoint()
    useEditorStore.getState().setPlayhead(1)
    useEditorStore.getState().deleteSelection()
    expect(useEditorStore.getState().session?.segments[0]?.sourceStart).toBe(3)
    useEditorStore.getState().setPlayhead(5)
    useEditorStore.getState().selectPoint()
    useEditorStore.getState().clearSelection()
    expect(useEditorStore.getState().session?.cutPoints).toEqual([])
    await useEditorStore.getState().setPlaybackPath('/manual-proxy.mp4')
    expect(useEditorStore.getState().session?.playbackPath).toBe('catcut:/manual-proxy.mp4')
    await useEditorStore.getState().addAsset({ id: 'i', type: 'image', name: 'Image', path: '/image.png', source: 'external' })
    await useEditorStore.getState().addAsset({ id: 'g', type: 'gif', name: 'GIF', path: '/image.gif', source: 'external' })
    expect(useEditorStore.getState().session?.overlays.map((item) => item.type)).toEqual(['image', 'gif'])
    const current = selectedOverlay(useEditorStore.getState().session)
    expect(current?.type).toBe('gif')
    expect(isVideoOverlay(current)).toBe(false)
    expect(isVideoOverlay(null)).toBe(false)
    useEditorStore.getState().selectOverlay(null)
    expect(selectedOverlay(useEditorStore.getState().session)).toBeNull()
  })

  it('updates status helpers', async () => {
    useEditorStore.getState().setJob({ id: 'j', kind: 'export', state: 'running', progress: 0.5, message: '50%' })
    expect(useEditorStore.getState().job?.progress).toBe(0.5)
    useEditorStore.setState({ error: 'oops' })
    useEditorStore.getState().clearError()
    expect(useEditorStore.getState().error).toBeNull()
    await useEditorStore.getState().loadVideo('/source.mp4')
    useEditorStore.getState().addText()
    expect(useEditorStore.getState().session?.dirty).toBe(true)
    useEditorStore.getState().markExported()
    expect(useEditorStore.getState().session?.dirty).toBe(false)
    expect(isVideoOverlay({
      id: 'v', type: 'video', name: 'v', path: '/v', start: 0, duration: 1, zIndex: 1,
      x: 0, y: 0, width: 1, height: 1, opacity: 1, loop: false,
      audioEnabled: false, hasAudio: false, volume: 1, sourceDuration: 1
    })).toBe(true)
  })

  it('reports API and proxy failures without losing the source', async () => {
    vi.mocked(window.catcut.getGpuDiagnostics).mockRejectedValueOnce(new Error('GPU failure'))
    await useEditorStore.getState().initialize()
    expect(useEditorStore.getState().error).toBe('CatCut could not finish starting. Close it and try again.')

    vi.mocked(window.catcut.probe).mockRejectedValueOnce('probe failure')
    await useEditorStore.getState().loadVideo('/bad.mp4')
    expect(useEditorStore.getState().error).toBe('CatCut could not open this video. Try another file.')

    vi.mocked(window.catcut.shouldProxy).mockResolvedValueOnce(true)
    vi.mocked(window.catcut.createProxy).mockRejectedValueOnce(new Error('encoder unavailable'))
    await useEditorStore.getState().loadVideo('/source.mp4')
    await vi.waitFor(() => expect(useEditorStore.getState().error).toContain('Playback preparation failed'))
    expect(useEditorStore.getState().session?.playbackPath).toBe('catcut:/source.mp4')

    vi.mocked(window.catcut.probeAsset).mockRejectedValueOnce(new Error('bad asset'))
    await useEditorStore.getState().addAsset({ id: 'x', type: 'image', name: 'Bad', path: '/bad.png', source: 'external' })
    expect(useEditorStore.getState().error).toBe('CatCut could not add this item. Try another file.')

  })
})
