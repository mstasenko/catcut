import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AssetItem,
  AssetMetadata,
  ReplayCatApi,
  ExternalMedia,
  ExportRequest,
  GpuDiagnostics,
  JobProgress,
  MediaMetadata,
  ProxyResult,
  SavedSession
} from './types'

const api: ReplayCatApi = {
  openVideo: () => ipcRenderer.invoke('dialog:open-video') as Promise<string | null>,
  openMedia: () => ipcRenderer.invoke('dialog:open-media') as Promise<ExternalMedia | null>,
  probe: (path: string) => ipcRenderer.invoke('media:probe', path) as Promise<MediaMetadata>,
  probeAsset: (path: string) => ipcRenderer.invoke('media:probe-asset', path) as Promise<AssetMetadata>,
  waveform: (path: string) => ipcRenderer.invoke('media:waveform', path) as Promise<number[]>,
  shouldProxy: (metadata: MediaMetadata) =>
    ipcRenderer.invoke('media:should-proxy', metadata) as Promise<boolean>,
  createProxy: (metadata: MediaMetadata) =>
    ipcRenderer.invoke('media:create-proxy', metadata) as Promise<{ jobId: string; result: ProxyResult }>,
  scanAssets: () => ipcRenderer.invoke('assets:scan') as Promise<AssetItem[]>,
  chooseExportPath: (defaultName: string) =>
    ipcRenderer.invoke('dialog:export-path', defaultName) as Promise<string | null>,
  exportVideo: (request: ExportRequest) =>
    ipcRenderer.invoke('export:start', request) as Promise<{ jobId: string; outputPath: string }>,
  loadSession: () => ipcRenderer.invoke('session:load') as Promise<SavedSession | null>,
  saveSession: (session: SavedSession) => ipcRenderer.invoke('session:save', session) as Promise<void>,
  resetSession: () => ipcRenderer.invoke('session:reset') as Promise<void>,
  cancelJob: (id: string) => ipcRenderer.invoke('job:cancel', id) as Promise<boolean>,
  getGpuDiagnostics: () => ipcRenderer.invoke('gpu:diagnostics') as Promise<GpuDiagnostics>,
  getPathUrl: (path: string) => ipcRenderer.invoke('media:url', path) as Promise<string>,
  getSvgDataUrl: (path: string) => ipcRenderer.invoke('media:svg-data', path) as Promise<string>,
  getDroppedPath: (file: File) => {
    const path = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('media:authorize-drop', path) as Promise<string>
  },
  onOpenPath: (callback: (path: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
    ipcRenderer.on('app:open-path', listener)
    return () => ipcRenderer.removeListener('app:open-path', listener)
  },
  onResetProject: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('project:reset-request', listener)
    return () => ipcRenderer.removeListener('project:reset-request', listener)
  },
  onJobProgress: (callback: (progress: JobProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: JobProgress): void => callback(progress)
    ipcRenderer.on('job:progress', listener)
    return () => ipcRenderer.removeListener('job:progress', listener)
  },
  onSaveRequest: (callback: () => Promise<void>) => {
    const listener = (): void => {
      void callback()
        .then(() => ipcRenderer.send('session:close-ready'))
        .catch((error: unknown) => ipcRenderer.send(
          'session:close-failed',
          error instanceof Error ? error.message : String(error)
        ))
    }
    ipcRenderer.on('session:save-request', listener)
    return () => ipcRenderer.removeListener('session:save-request', listener)
  }
}

contextBridge.exposeInMainWorld('replaycat', api)
