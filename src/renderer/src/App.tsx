import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EditSession, Overlay, TextOverlay } from '@shared/types'
import { EditorWorkspace, ExportProgress, GpuWarning, StatusBanners, Welcome } from './components/AppLayout'
import { selectedOverlay, useEditorStore } from './model/store'
import { timelineDuration } from './model/timeline'

function exportName(name: string): string {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}-edited.mp4`
}

function wrapParagraph(context: CanvasRenderingContext2D, paragraph: string, maximumWidth: number): string[] {
  const output: string[] = []
  let line = ''
  for (const word of paragraph.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word
    if (line && context.measureText(candidate).width > maximumWidth) {
      output.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  output.push(line)
  return output
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maximumWidth: number): string[] {
  return text.split('\n').flatMap((paragraph) => wrapParagraph(context, paragraph, maximumWidth))
}

async function renderText(overlay: TextOverlay, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas text renderer is unavailable')
  const pixels = Math.max(12, height * overlay.fontSize / 100)
  await document.fonts.load(`700 ${pixels}px "${overlay.fontFamily}"`)
  context.font = `700 ${pixels}px "${overlay.fontFamily}"`
  context.textBaseline = 'top'
  context.textAlign = overlay.align
  context.globalAlpha = overlay.opacity
  context.fillStyle = overlay.color
  context.strokeStyle = overlay.outlineColor
  context.lineJoin = 'round'
  context.lineWidth = overlay.outlineWidth * Math.max(1, height / 720)
  if (overlay.shadow) {
    context.shadowColor = 'rgba(0,0,0,.8)'
    context.shadowBlur = Math.max(4, height / 100)
    context.shadowOffsetY = Math.max(2, height / 180)
  }
  const boxWidth = width * overlay.width
  const lines = wrapLines(context, overlay.text, boxWidth)
  const x = overlay.align === 'left'
    ? width * overlay.x
    : overlay.align === 'right'
      ? width * (overlay.x + overlay.width)
      : width * (overlay.x + overlay.width / 2)
  const y = height * overlay.y
  lines.forEach((line, index) => {
    const lineY = y + index * pixels * 1.12
    if (overlay.outlineWidth > 0) context.strokeText(line, x, lineY, boxWidth)
    context.fillText(line, x, lineY, boxWidth)
  })
  return canvas.toDataURL('image/png')
}

async function prepareOverlay(overlay: Overlay, session: EditSession): Promise<Overlay> {
  if (overlay.type !== 'text') return overlay
  return {
    ...overlay,
    renderedImageDataUrl: await renderText(overlay, session.source.width, session.source.height)
  }
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
    source: session.source,
    outputPath,
    segments: session.segments,
    overlays
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
    return () => {
      removeJobListener()
      removeOpenListener()
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
    const outputPath = await window.catcut.chooseExportPath(exportName(session.source.name))
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
    await store.loadVideo(window.catcut.getDroppedPath(file))
  }

  return (
    <div className="app" data-initialized={store.initialized} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void dropVideo(event)}>
      <GpuWarning gpu={store.gpu} dismissed={gpuWarningDismissed} onDismiss={() => setGpuWarningDismissed(true)} />
      <StatusBanners store={store} />
      <ExportProgress exporting={exporting} job={store.job} />
      {!session
        ? <Welcome onOpen={() => void store.loadVideo()} />
        : <EditorWorkspace store={store} session={session} selected={selected} duration={duration} playing={playing} zoom={zoom} exporting={exporting} onPlayingChange={setPlaying} onZoom={setZoom} onExport={() => void runExport()} />}
    </div>
  )
}
