import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatCutApi, MediaMetadata } from '@shared/types'
import { isVideoOverlay, savedSession, selectedOverlay, useEditorStore } from './store'
import { createSession } from './timeline'

const metadata: MediaMetadata = {
  path: '/source.mp4', name: 'source.mp4', size: 100, modifiedAt: 1, duration: 10,
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
    loadSession: vi.fn().mockResolvedValue(null),
    saveSession: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn().mockResolvedValue(undefined),
    cancelJob: vi.fn().mockResolvedValue(true),
    getGpuDiagnostics: vi.fn().mockResolvedValue({ sessionType: 'wayland', desktop: 'GNOME', waylandDisplay: 'wayland-0', hardwareAcceleration: true, videoDecode: 'enabled', gpuCompositing: 'enabled', gpuName: 'Intel' }),
    getPathUrl: vi.fn((path: string) => Promise.resolve(`catcut:${path}`)),
    getSvgDataUrl: vi.fn((path: string) => Promise.resolve(`data:image/svg+xml,${path}`)),
    getDroppedPath: vi.fn().mockResolvedValue('/drop.mp4'),
    onOpenPath: vi.fn(() => () => undefined),
    onResetProject: vi.fn(() => () => undefined),
    onJobProgress: vi.fn(() => () => undefined),
    onSaveRequest: vi.fn(() => () => undefined)
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'catcut', { value: api(), configurable: true })
  useEditorStore.setState({
    initialized: false, session: null, history: [], future: [], gesture: null, assets: [],
    gpu: null, job: null, busy: null, error: null
  })
})

describe('editor store', () => {
  it('initializes diagnostics and assets', async () => {
    await useEditorStore.getState().initialize()
    expect(useEditorStore.getState().initialized).toBe(true)
    expect(useEditorStore.getState().gpu?.videoDecode).toBe('enabled')
  })

  it('restores a saved multi-source project and reloads its waveform', async () => {
    const session = createSession(metadata)
    const inserted = { ...metadata, path: '/inserted.mp4', name: 'inserted.mp4' }
    session.sources.push({ id: 'inserted', metadata: inserted, playbackPath: inserted.path, waveform: [] })
    vi.mocked(window.catcut.loadSession).mockResolvedValue(savedSession(session))
    await useEditorStore.getState().initialize()
    await vi.waitFor(() => expect(useEditorStore.getState().session?.sources[0]?.waveform).toEqual([0.1, 0.8]))
    expect(useEditorStore.getState().session?.sources.map((source) => source.playbackPath)).toEqual([
      'catcut:/source.mp4', 'catcut:/inserted.mp4'
    ])
  })

  it('restores bounded undo and redo history', async () => {
    const previous = createSession(metadata)
    const current = structuredClone(previous)
    current.cutPoints = [2]
    const future = structuredClone(current)
    future.cutPoints = [2, 4]
    vi.mocked(window.catcut.loadSession).mockResolvedValue(savedSession(current, [previous], [future]))

    await useEditorStore.getState().initialize()
    expect(useEditorStore.getState()).toMatchObject({ history: [{ cutPoints: [] }], future: [{ cutPoints: [2, 4] }] })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().session?.cutPoints).toEqual([])
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().session?.cutPoints).toEqual([2])
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().session?.cutPoints).toEqual([2, 4])
  })

  it('inserts a video at the playhead and undoes the ripple edit', async () => {
    await useEditorStore.getState().loadVideo('/source.mp4')
    useEditorStore.getState().setPlayhead(4)
    const inserted = { ...metadata, path: '/inserted.mp4', name: 'inserted.mp4', duration: 2 }
    vi.mocked(window.catcut.openVideo).mockResolvedValue('/inserted.mp4')
    vi.mocked(window.catcut.probe).mockResolvedValueOnce(inserted)
    await useEditorStore.getState().insertVideo({
      into: { effect: 'dissolve', duration: 0.5 },
      back: { effect: 'slideleft', duration: 0.75 }
    })
    const session = useEditorStore.getState().session
    expect(session?.sources).toHaveLength(2)
    expect(session?.segments.map((segment) => segment.sourceEnd - segment.sourceStart)).toEqual([4, 2, 6])
    expect(session?.segments[1]?.sourceId).toBe(session?.sources[1]?.id)
    expect(session?.segments[1]?.transition).toEqual({ effect: 'dissolve', duration: 0.5 })
    expect(session?.segments[2]?.transition).toEqual({ effect: 'slideleft', duration: 0.75 })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().session?.segments).toHaveLength(1)
  })

  it('handles cancelled, proxied, and failed insertions', async () => {
    vi.mocked(window.catcut.openVideo).mockResolvedValueOnce(null)
    await useEditorStore.getState().insertVideo()
    expect(useEditorStore.getState().session).toBeNull()

    await useEditorStore.getState().loadVideo('/source.mp4')
    const inserted = { ...metadata, path: '/inserted.mp4', name: 'inserted.mp4', duration: 2 }
    vi.mocked(window.catcut.openVideo).mockResolvedValue('/inserted.mp4')
    vi.mocked(window.catcut.probe).mockResolvedValueOnce(inserted)
    vi.mocked(window.catcut.shouldProxy).mockResolvedValueOnce(true)
    vi.mocked(window.catcut.createProxy).mockResolvedValueOnce({
      jobId: 'insert-proxy', result: { path: '/insert-proxy.mp4', cacheHit: false }
    })
    await useEditorStore.getState().insertVideo()
    await vi.waitFor(() => expect(useEditorStore.getState().session?.sources[1]?.playbackPath).toBe('catcut:/insert-proxy.mp4'))

    vi.mocked(window.catcut.probe).mockRejectedValueOnce(new Error('bad video'))
    await useEditorStore.getState().insertVideo()
    expect(useEditorStore.getState().error).toBe('CatCut could not insert this video. Try another file.')
  })

  it('opens a Short project and resets saved and in-memory state', async () => {
    await useEditorStore.getState().openShort()
    expect(useEditorStore.getState().session?.canvas).toEqual({ width: 1080, height: 1920, fps: 30, fit: 'cover' })
    await useEditorStore.getState().resetProject()
    expect(window.catcut.resetSession).toHaveBeenCalledOnce()
    expect(useEditorStore.getState().session).toBeNull()
  })

  it('loads media, edits the timeline, and supports undo/redo', async () => {
    const store = useEditorStore.getState()
    await store.loadVideo()
    expect(useEditorStore.getState().session?.sources[0]?.playbackPath).toBe('catcut:/source.mp4')
    await vi.waitFor(() => expect(useEditorStore.getState().session?.sources[0]?.waveform).toEqual([0.1, 0.8]))
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

  it('records a drag as one undoable history transaction', async () => {
    await useEditorStore.getState().loadVideo('/source.mp4')
    useEditorStore.getState().addText()
    const overlay = useEditorStore.getState().session?.overlays[0]
    if (!overlay) throw new Error('missing overlay')
    const historyBefore = useEditorStore.getState().history.length
    useEditorStore.getState().beginOverlayGesture()
    for (let x = 0.2; x <= 0.5; x += 0.1) {
      useEditorStore.getState().updateOverlayGesture(overlay.id, { x })
    }
    useEditorStore.getState().commitOverlayGesture()
    expect(useEditorStore.getState().history).toHaveLength(historyBefore + 1)
    expect(useEditorStore.getState().session?.overlays[0]).toMatchObject({ x: 0.5 })
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().session?.overlays[0]).toMatchObject({ x: 0.15 })
  })

  it('cancels gesture previews and ignores empty transactions', async () => {
    const empty = useEditorStore.getState()
    empty.beginOverlayGesture()
    empty.updateOverlayGesture('missing', { start: 2 })
    empty.commitOverlayGesture()
    empty.cancelOverlayGesture()
    await empty.loadVideo('/source.mp4')
    useEditorStore.getState().addText()
    const overlay = useEditorStore.getState().session?.overlays[0]
    if (!overlay) throw new Error('missing overlay')
    const historyBefore = useEditorStore.getState().history.length
    useEditorStore.getState().beginOverlayGesture()
    useEditorStore.getState().commitOverlayGesture()
    expect(useEditorStore.getState().history).toHaveLength(historyBefore)
    useEditorStore.getState().beginOverlayGesture()
    useEditorStore.getState().updateOverlayGesture(overlay.id, { x: 0.7 })
    useEditorStore.getState().cancelOverlayGesture()
    expect(useEditorStore.getState().session?.overlays[0]).toMatchObject({ x: 0.15 })
  })

  it('switches to an automatically generated proxy', async () => {
    vi.mocked(window.catcut.shouldProxy).mockResolvedValue(true)
    await useEditorStore.getState().loadVideo('/source.mp4')
    await vi.waitFor(() => expect(useEditorStore.getState().session?.sources[0]?.playbackPath).toBe('catcut:/proxy.mp4'))
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
    expect(useEditorStore.getState().session?.sources[0]?.playbackPath).toBe('catcut:/manual-proxy.mp4')
    vi.mocked(window.catcut.probeAsset)
      .mockResolvedValueOnce({ duration: 2, width: 320, height: 180, hasAudio: false })
      .mockResolvedValueOnce({ duration: 2, width: 320, height: 180, hasAudio: false, playbackPath: '/gif-preview.mp4' })
    await useEditorStore.getState().addAsset({ id: 'i', type: 'image', name: 'Image', path: '/image.png', source: 'external' })
    await useEditorStore.getState().addAsset({ id: 'g', type: 'gif', name: 'GIF', path: '/image.gif', source: 'external' })
    expect(useEditorStore.getState().session?.overlays.map((item) => item.type)).toEqual(['image', 'gif'])
    expect(useEditorStore.getState().session?.overlays[1]).toMatchObject({ playbackPath: '/gif-preview.mp4' })
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
      audioEnabled: false, hasAudio: false, volume: 1, sourceIn: 0, sourceDuration: 1
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
    expect(useEditorStore.getState().session?.sources[0]?.playbackPath).toBe('catcut:/source.mp4')

    vi.mocked(window.catcut.probeAsset).mockRejectedValueOnce(new Error('bad asset'))
    await useEditorStore.getState().addAsset({ id: 'x', type: 'image', name: 'Bad', path: '/bad.png', source: 'external' })
    expect(useEditorStore.getState().error).toBe('CatCut could not add this item. Try another file.')

  })
})
