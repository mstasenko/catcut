import { useState } from 'react'
import type { EditSession, GpuDiagnostics, JobProgress, Overlay } from '@shared/types'
import catcutIcon from '../../../catcut-icon.png'
import type { EditorState } from '../model/store'
import { AssetPanel } from './AssetPanel'
import type { AssetCategory } from './AssetPanel'
import { Inspector } from './Inspector'
import { Preview } from './Preview'
import { Timeline } from './Timeline'

function accelerationUnavailable(gpu: GpuDiagnostics): boolean {
  return !gpu.hardwareAcceleration
    || !gpu.videoDecode.startsWith('enabled')
    || !gpu.gpuCompositing.startsWith('enabled')
}

export function GpuWarning({ gpu, dismissed, onDismiss }: {
  gpu: GpuDiagnostics | null
  dismissed: boolean
  onDismiss: () => void
}): React.JSX.Element | null {
  if (!gpu || dismissed || !accelerationUnavailable(gpu)) return null
  return (
    <div className="modal-backdrop">
      <div className="warning-dialog" role="alertdialog" aria-labelledby="gpu-warning-title" aria-describedby="gpu-warning-description">
        <h2 id="gpu-warning-title">Hardware acceleration is unavailable</h2>
        <p id="gpu-warning-description">Playback may use more CPU and feel less smooth.</p>
        <button autoFocus onClick={onDismiss}>Continue</button>
      </div>
    </div>
  )
}

export function StatusBanners({ store }: { store: EditorState }): React.JSX.Element {
  return (
    <div className="status-stack">
      {store.error && <div className="error-banner"><span>{store.error}</span><button onClick={store.clearError}>×</button></div>}
      {store.busy && <div className="busy-banner">{store.busy}</div>}
    </div>
  )
}

function activeExportJob(job: JobProgress | null): JobProgress | null {
  return job?.kind === 'export' && (job.state === 'queued' || job.state === 'running') ? job : null
}

export function ExportProgress({ exporting, job }: {
  exporting: boolean
  job: JobProgress | null
}): React.JSX.Element | null {
  if (!exporting) return null
  const activeJob = activeExportJob(job)
  return (
    <div className="modal-backdrop export-backdrop">
      <div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-progress-title">
        <h2 id="export-progress-title">Exporting video</h2>
        {activeJob
          ? <progress aria-label="Export progress" max="1" value={activeJob.progress} />
          : <progress aria-label="Preparing export" />}
        <p>{activeJob?.message ?? 'Preparing export…'}</p>
        <button autoFocus disabled={!activeJob} onClick={() => activeJob && void window.catcut.cancelJob(activeJob.id)}>Cancel</button>
      </div>
    </div>
  )
}

export function Welcome({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  return (
    <main className="welcome" onClick={onOpen}>
      <div className="welcome-brand"><img src={catcutIcon} alt="" /><strong>CatCut</strong></div>
      <div className="welcome-icon">▶</div>
      <h1>Drop a video</h1>
      <p>or click to choose one</p>
      <small>Your video stays on this computer.</small>
    </main>
  )
}

function SidePanel({ store, selected, duration, exporting, onExport }: {
  store: EditorState
  selected: Overlay | null
  duration: number
  exporting: boolean
  onExport: () => void
}): React.JSX.Element {
  const [assetCategory, setAssetCategory] = useState<AssetCategory | null>(null)
  return (
    <aside className="side-panel">
      <div className="side-brand"><img src={catcutIcon} alt="" /><strong>CatCut</strong></div>
      <div className="project-actions">
        <button onClick={() => void store.loadVideo()}>Open video</button>
        <button className="export-button" disabled={exporting} onClick={onExport}>{exporting ? 'Exporting…' : 'Export video'}</button>
      </div>
      <div className="source-name" title={store.session?.source.name}>{store.session?.source.name}</div>
      {selected
        ? (
            <Inspector
              overlay={selected}
              maxDuration={duration}
              onBack={() => store.selectOverlay(null)}
              onChange={(patch) => store.updateOverlay(selected.id, patch)}
              onRemove={store.removeSelectedOverlay}
            />
          )
        : (
            <AssetPanel
              assets={store.assets}
              category={assetCategory}
              onCategory={setAssetCategory}
              onText={() => { setAssetCategory(null); store.addText() }}
              onNew={() => { setAssetCategory(null); void store.addExternalMedia() }}
              onAsset={(asset) => void store.addAsset(asset)}
              onError={store.showError}
            />
          )}
    </aside>
  )
}

export function EditorWorkspace({
  store,
  session,
  selected,
  duration,
  playing,
  zoom,
  exporting,
  onPlayingChange,
  onZoom,
  onExport
}: {
  store: EditorState
  session: EditSession
  selected: Overlay | null
  duration: number
  playing: boolean
  zoom: number
  exporting: boolean
  onPlayingChange: (value: boolean) => void
  onZoom: (value: number) => void
  onExport: () => void
}): React.JSX.Element {
  return (
    <main className="workspace" inert={exporting}>
      <SidePanel store={store} selected={selected} duration={duration} exporting={exporting} onExport={onExport} />
      <div className="editor-column">
        <Preview
          session={session}
          playing={playing}
          zoom={zoom}
          hasCutPoints={session.cutPoints.length > 0}
          canUndo={store.history.length > 0}
          canRedo={store.future.length > 0}
          onPlayingChange={onPlayingChange}
          onZoom={onZoom}
          onPlayhead={store.setPlayhead}
          onSelect={store.selectOverlay}
          onOverlayChange={store.updateOverlay}
          onSelectPoint={store.selectPoint}
          onDeleteSelection={store.deleteSelection}
          onUndo={store.undo}
          onRedo={store.redo}
        />
        <Timeline
          session={session}
          zoom={zoom}
          onZoom={onZoom}
          onSeek={(time) => { onPlayingChange(false); store.setPlayhead(time) }}
          onSelectOverlay={store.selectOverlay}
          onOverlayChange={store.updateOverlay}
        />
      </div>
    </main>
  )
}
