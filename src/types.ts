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

export const videoSpeeds = [0.25, 0.5, 1, 2, 4] as const
export const focusZoomAmounts = [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export const freezeDurations = [0.5, 1, 2] as const
export const textAnimationPresets = ['none', 'pop', 'fade', 'bounce', 'shake'] as const
export const audioFadeDurations = [0, 0.1, 0.25, 0.5, 1] as const
export const gameAudioLevels = [0.5, 0.3, 0.15] as const
export type VideoSpeed = typeof videoSpeeds[number]
export type FocusZoomAmount = typeof focusZoomAmounts[number]
export type FreezeDuration = typeof freezeDurations[number]
export type TextAnimationPreset = typeof textAnimationPresets[number]
export type AudioFadeDuration = typeof audioFadeDurations[number]
export type GameAudioLevel = typeof gameAudioLevels[number]

export interface FocusZoomEffect {
  id: string
  start: number
  duration: number
  zoom: FocusZoomAmount
  focusX: number
  focusY: number
}

export interface InsertTransitions {
  into?: VideoTransition
  back?: VideoTransition
}

export interface VideoSegment {
  kind?: 'video'
  id: string
  sourceId: string
  sourceStart: number
  sourceEnd: number
  /** Playback speed for this segment; omitted means normal speed. */
  playbackRate?: VideoSpeed
  /** Transition from the preceding segment into this segment. */
  transition?: VideoTransition
  /** Ordinary timeline segments copied by one Replay action share this ID. */
  replayGroupId?: string
}

export interface FreezeSegment {
  kind: 'freeze'
  id: string
  sourceId: string
  sourceTime: number
  duration: number
  replayGroupId?: string
}

export type SourceSegment = VideoSegment | FreezeSegment

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
  animation?: TextAnimationPreset
  renderedImageDataUrl?: string
  renderedTextBitmap?: RenderedTextBitmap
}

export interface RenderedTextBitmap {
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
  anchorX: number
  anchorY: number
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

export interface AudioOverlaySettings {
  volume: number
  fadeIn?: AudioFadeDuration
  fadeOut?: AudioFadeDuration
  duckGameAudio?: boolean
  gameAudioLevel?: GameAudioLevel
}

export interface VideoOverlay extends VisualOverlayBase, AudioOverlaySettings {
  type: 'video'
  path: string
  loop: boolean
  audioEnabled: boolean
  hasAudio: boolean
  sourceIn: number
  sourceDuration: number
}

export interface AudioOverlay extends OverlayBase, AudioOverlaySettings {
  type: 'audio'
  path: string
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
  focusZooms: FocusZoomEffect[]
}

export interface ExportRequest {
  canvas: ProjectCanvas
  sources: ExportSource[]
  outputPath: string
  segments: SourceSegment[]
  overlays: Overlay[]
  focusZooms?: FocusZoomEffect[]
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
  focusZooms?: FocusZoomEffect[]
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
