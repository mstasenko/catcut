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

export interface SourceSegment {
  id: string
  sourceStart: number
  sourceEnd: number
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
  source: MediaMetadata
  playbackPath: string
  segments: SourceSegment[]
  overlays: Overlay[]
  waveform: number[]
  selectedOverlayId: string | null
  playhead: number
  cutPoints: number[]
  dirty: boolean
}

export interface ExportRequest {
  source: MediaMetadata
  outputPath: string
  segments: SourceSegment[]
  overlays: Overlay[]
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
  cancelJob: (id: string) => Promise<boolean>
  getGpuDiagnostics: () => Promise<GpuDiagnostics>
  getPathUrl: (path: string) => Promise<string>
  getSvgDataUrl: (path: string) => Promise<string>
  getDroppedPath: (file: File) => Promise<string>
  onOpenPath: (callback: (path: string) => void) => () => void
  onJobProgress: (callback: (progress: JobProgress) => void) => () => void
}
