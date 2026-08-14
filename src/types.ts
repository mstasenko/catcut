export type OverlayKind = 'text' | 'image' | 'gif' | 'video' | 'audio'

export interface MediaMetadata {
  path: string
  name: string
  size: number
  modifiedAt: number
  duration: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  hasAudio: boolean
  rotation: number
  pixelFormat: string
}

export interface AssetMetadata {
  duration: number
  width: number
  height: number
  hasAudio: boolean
  playbackPath?: string
}

export const transitionEffects = [
  'fade', 'dissolve', 'wipeleft', 'wiperight', 'slideleft',
  'slideright', 'circleopen', 'zoomin', 'hblur'
] as const

export type TransitionEffect = typeof transitionEffects[number]

export interface VideoTransition {
  effect: TransitionEffect
  duration: number
}

export interface InsertTransitions {
  into?: VideoTransition
  back?: VideoTransition
}

export interface SourceSegment {
  id: string
  sourceId: string
  sourceStart: number
  sourceEnd: number
  /** Transition from the preceding segment into this segment. */
  transition?: VideoTransition
}

export interface ExportSource {
  id: string
  metadata: MediaMetadata
}

export interface TimelineSource extends ExportSource {
  playbackPath: string
  waveform: number[]
}

export interface ProjectCanvas {
  width: number
  height: number
  fps: number
  fit: 'contain' | 'cover'
}

interface OverlayBase {
  id: string
  type: OverlayKind
  name: string
  start: number
  duration: number
  zIndex: number
}

export interface VisualOverlayBase extends OverlayBase {
  x: number
  y: number
  width: number
  height: number
  opacity: number
}

export interface TextOverlay extends VisualOverlayBase {
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  color: string
  outlineColor: string
  outlineWidth: number
  shadow: boolean
  align: 'left' | 'center' | 'right'
  renderedImageDataUrl?: string
}

export interface ImageOverlay extends VisualOverlayBase {
  type: 'image'
  path: string
  loop: boolean
  renderedImageDataUrl?: string
}

export interface GifOverlay extends VisualOverlayBase {
  type: 'gif'
  path: string
  playbackPath?: string
  loop: boolean
  sourceIn: number
  sourceDuration: number
}

export interface VideoOverlay extends VisualOverlayBase {
  type: 'video'
  path: string
  loop: boolean
  audioEnabled: boolean
  hasAudio: boolean
  volume: number
  sourceIn: number
  sourceDuration: number
}

export interface AudioOverlay extends OverlayBase {
  type: 'audio'
  path: string
  volume: number
  sourceIn: number
  sourceDuration: number
}

export type Overlay = TextOverlay | ImageOverlay | GifOverlay | VideoOverlay | AudioOverlay

export interface EditSession {
  canvas: ProjectCanvas
  sources: TimelineSource[]
  segments: SourceSegment[]
  overlays: Overlay[]
  selectedOverlayId: string | null
  playhead: number
  cutPoints: number[]
  dirty: boolean
}

export interface ExportRequest {
  canvas: ProjectCanvas
  sources: ExportSource[]
  outputPath: string
  segments: SourceSegment[]
  overlays: Overlay[]
}

export interface SavedSessionSnapshot {
  canvas: ProjectCanvas
  sources: ExportSource[]
  segments: SourceSegment[]
  overlays: Overlay[]
  selectedOverlayId: string | null
  playhead: number
  cutPoints: number[]
  dirty: boolean
}

export interface SavedSession extends SavedSessionSnapshot {
  history?: SavedSessionSnapshot[]
  future?: SavedSessionSnapshot[]
}

export type JobKind = 'proxy' | 'export' | 'thumbnail' | 'waveform' | 'asset-pack'

export interface JobProgress {
  id: string
  kind: JobKind
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
  progress: number
  message: string
  outputPath?: string
  error?: string
}

export interface ProxyResult {
  path: string
  cacheHit: boolean
}

export interface AssetItem {
  id: string
  type: Exclude<OverlayKind, 'text'>
  name: string
  path: string
  source: 'bundled' | 'external'
  duration?: number
  license?: string
}

export interface ExternalMedia {
  path: string
  type: Exclude<OverlayKind, 'text'>
  name: string
}

export interface GpuDiagnostics {
  sessionType: string
  desktop: string
  waylandDisplay: string
  hardwareAcceleration: boolean
  videoDecode: string
  gpuCompositing: string
  gpuName: string
}

export interface CatCutApi {
  openVideo: () => Promise<string | null>
  openMedia: () => Promise<ExternalMedia | null>
  probe: (path: string) => Promise<MediaMetadata>
  probeAsset: (path: string) => Promise<AssetMetadata>
  waveform: (path: string) => Promise<number[]>
  shouldProxy: (metadata: MediaMetadata) => Promise<boolean>
  createProxy: (metadata: MediaMetadata) => Promise<{ jobId: string; result: ProxyResult }>
  scanAssets: () => Promise<AssetItem[]>
  chooseExportPath: (defaultName: string) => Promise<string | null>
  exportVideo: (request: ExportRequest) => Promise<{ jobId: string; outputPath: string }>
  loadSession: () => Promise<SavedSession | null>
  saveSession: (session: SavedSession) => Promise<void>
  resetSession: () => Promise<void>
  cancelJob: (id: string) => Promise<boolean>
  getGpuDiagnostics: () => Promise<GpuDiagnostics>
  getPathUrl: (path: string) => Promise<string>
  getSvgDataUrl: (path: string) => Promise<string>
  getDroppedPath: (file: File) => Promise<string>
  onOpenPath: (callback: (path: string) => void) => () => void
  onResetProject: (callback: () => void) => () => void
  onJobProgress: (callback: (progress: JobProgress) => void) => () => void
  onSaveRequest: (callback: () => Promise<void>) => () => void
}
