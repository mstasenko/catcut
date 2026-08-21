import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EditSession, ImageOverlay, Overlay } from '@shared/types'
import { EditorWorkspace, ExportProgress, GpuWarning, StatusBanners, Welcome } from './components/AppLayout'
import { savedSession, selectedOverlay, useEditorStore } from './model/store'
import { clamp, primarySource, timelineDuration } from './model/timeline'
import { stepOutputFrame } from './model/frame'
import { renderTextBitmap } from './model/text-render'

function exportName(name: string): string {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}-edited.mp4`
}

function loadedImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The SVG image could not be loaded'))
    image.src = url
  })
}

async function renderSvg(overlay: ImageOverlay): Promise<string> {
  const image = await loadedImage(await window.catcut.getSvgDataUrl(overlay.path))
  const naturalWidth = Math.max(1, image.naturalWidth)
  const naturalHeight = Math.max(1, image.naturalHeight)
  const scale = Math.min(1, 4096 / naturalWidth, 4096 / naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas image renderer is unavailable')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

function isSvgImage(overlay: Overlay): overlay is ImageOverlay {
  return overlay.type === 'image' && overlay.path.toLowerCase().endsWith('.svg')
}

async function prepareOverlay(overlay: Overlay, session: EditSession): Promise<Overlay> {
  if (overlay.type === 'audio') return overlay
  const opacity = Number.isFinite(overlay.opacity) ? clamp(overlay.opacity, 0, 1) : 1
  if (overlay.type === 'text') {
    return {
      ...overlay,
      opacity,
      renderedTextBitmap: await renderTextBitmap(overlay, session.canvas.width, session.canvas.height)
    }
  }
  return isSvgImage(overlay)
    ? { ...overlay, opacity, renderedImageDataUrl: await renderSvg(overlay) }
    : { ...overlay, opacity }
}

function shortcutId(event: KeyboardEvent): string {
  return `${Number(event.ctrlKey)}:${Number(event.shiftKey)}:${event.code}`
}

function exportWasCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('cancelled')
}

async function exportSession(session: EditSession, outputPath: string): Promise<void> {
  const overlays = await Promise.all(session.overlays.map((overlay) => prepareOverlay(overlay, session)))
  await window.catcut.exportVideo({
    canvas: session.canvas,
    sources: session.sources.map(({ id, metadata }) => ({ id, metadata })),
    outputPath,
    segments: session.segments,
    overlays,
    focusZooms: session.focusZooms
  })
}

function reportExportFailure(error: unknown): void {
  if (exportWasCancelled(error)) return
  useEditorStore.setState({ error: 'CatCut could not export this video. Check the destination and try again.' })
}

export default function App(): React.JSX.Element {
  const store = useEditorStore()
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [gpuWarningDismissed, setGpuWarningDismissed] = useState(false)
  const session = store.session
  const selected = useMemo(() => selectedOverlay(session), [session])
  const duration = session ? timelineDuration(session.segments) : 0

  useEffect(() => {
    void store.initialize()
    const removeJobListener = window.catcut.onJobProgress(store.setJob)
    const removeOpenListener = window.catcut.onOpenPath((path) => void store.loadVideo(path))
    const removeResetListener = window.catcut.onResetProject(() => {
      if (window.confirm('Reset the current project and forget its saved state?')) void store.resetProject()
    })
    const removeSaveListener = window.catcut.onSaveRequest(async () => {
      const current = useEditorStore.getState()
      if (current.session) {
        await window.catcut.saveSession(savedSession(current.session, current.history, current.future))
      }
    })
    return () => {
      removeJobListener()
      removeOpenListener()
      removeResetListener()
      removeSaveListener()
    }
    // Initialize the bridge subscription once; Zustand action identities are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent): void => {
    if (exporting) return
    const target = event.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    const actions: Record<string, () => void> = {
      '0:0:Space': () => setPlaying((value) => !value),
      '0:0:ArrowLeft': () => {
        const current = useEditorStore.getState().session
        if (current) store.setPlayhead(current.playhead - 5)
      },
      '0:0:ArrowRight': () => {
        const current = useEditorStore.getState().session
        if (current) store.setPlayhead(current.playhead + 5)
      },
      '0:1:ArrowLeft': () => {
        const current = useEditorStore.getState().session
        if (current) { setPlaying(false); store.setPlayhead(stepOutputFrame(current, -1)) }
      },
      '0:1:ArrowRight': () => {
        const current = useEditorStore.getState().session
        if (current) { setPlaying(false); store.setPlayhead(stepOutputFrame(current, 1)) }
      },
      '1:0:KeyZ': store.undo,
      '1:1:KeyZ': store.redo,
      '0:0:Delete': () => useEditorStore.getState().session?.selectedOverlayId
        ? store.removeSelectedOverlay()
        : store.deleteSelection()
    }
    const action = actions[shortcutId(event)]
    if (!action) return
    event.preventDefault()
    action()
  }, [exporting, store])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  const runExport = async (): Promise<void> => {
    if (!session || exporting) return
    const outputPath = await window.catcut.chooseExportPath(exportName(primarySource(session).metadata.name))
    if (!outputPath) return
    setPlaying(false)
    setExporting(true)
    try {
      await exportSession(session, outputPath)
      store.markExported()
    } catch (error) {
      reportExportFailure(error)
    } finally {
      setExporting(false)
    }
  }

  const dropVideo = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    if (exporting) return
    const file = event.dataTransfer.files[0]
    if (!file) return
    await store.loadVideo(await window.catcut.getDroppedPath(file))
  }

  return (
    <div className="app" data-initialized={store.initialized} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void dropVideo(event)}>
      <GpuWarning gpu={store.gpu} dismissed={gpuWarningDismissed} onDismiss={() => setGpuWarningDismissed(true)} />
      <StatusBanners store={store} />
      <ExportProgress exporting={exporting} job={store.job} />
      {!session
        ? <Welcome onOpen={() => void store.loadVideo()} />
        : <EditorWorkspace store={store} session={session} selected={selected} duration={duration} playing={playing} zoom={zoom} exporting={exporting} onPlayingChange={setPlaying} onZoom={setZoom} onExport={() => void runExport()} onStep={(direction) => { setPlaying(false); store.setPlayhead(stepOutputFrame(session, direction)) }} />}
    </div>
  )
}
