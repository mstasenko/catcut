import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol
} from 'electron'
import type { ExportRequest, GpuDiagnostics, MediaMetadata } from '../types'
import { categoryFor, displayName, scanAssets } from './assets'
import { exportVideo } from './exporter'
import { jobs } from './jobs'
import { createProxy, mediaNeedsProxy, probeAsset, probeMedia, waveformFor } from './media'
import { mediaResponse, mediaUrl } from './media-protocol'
import { installDesktopIntegration } from './desktop'
import { SessionDirectory } from './session-directory'
import { initialWindowSize } from './window-options'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'catcut-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

app.setName('CatCut')
app.setDesktopName('catcut.desktop')
app.commandLine.appendSwitch('ozone-platform', 'wayland')
app.commandLine.appendSwitch('enable-features', 'AcceleratedVideoDecodeLinuxZeroCopyGL')
const headlessTest = process.env.CATCUT_HEADLESS_TEST === '1'
if (headlessTest) {
  // Headless GNOME reports mapped windows as occluded. Keep Chromium's frame
  // clock active so GUI automation can perform normal actionability checks.
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
}

async function gpuName(): Promise<string> {
  try {
    const info = await app.getGPUInfo('basic') as { gpuDevice?: { vendorString?: string; deviceString?: string }[] }
    const device = info.gpuDevice?.[0]
    return device?.deviceString ?? device?.vendorString ?? 'Unknown GPU'
  } catch {
    return 'Unknown GPU'
  }
}

function environment(name: string): string {
  return process.env[name] ?? ''
}

function gpuFeature(value: string, forcedOff: boolean): string {
  return forcedOff ? 'disabled_off' : value
}

async function gpuDiagnostics(): Promise<GpuDiagnostics> {
  const status = app.getGPUFeatureStatus()
  const forcedOff = process.env.CATCUT_E2E_GPU_OFF === '1'
  return {
    sessionType: environment('XDG_SESSION_TYPE'),
    desktop: environment('XDG_CURRENT_DESKTOP'),
    waylandDisplay: environment('WAYLAND_DISPLAY'),
    hardwareAcceleration: forcedOff ? false : app.isHardwareAccelerationEnabled(),
    videoDecode: gpuFeature(status.video_decode, forcedOff),
    gpuCompositing: gpuFeature(status.gpu_compositing, forcedOff),
    gpuName: await gpuName()
  }
}

function createWindow(): BrowserWindow {
  const windowSize = initialWindowSize(process.env.CATCUT_E2E_COMPACT === '1')
  const windowIcon = app.isPackaged
    ? join(process.resourcesPath, 'resources', 'catcut-icon.png')
    : join(__dirname, '../../src/catcut-icon.png')
  const window = new BrowserWindow({
    ...windowSize,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#101114',
    icon: windowIcon,
    show: false,
    title: 'CatCut',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: !headlessTest
    }
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  const requestedPath = process.argv.find((argument, index) =>
    index > 0 && /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(argument)
  )
  if (requestedPath) {
    window.webContents.once('did-finish-load', () => window.webContents.send('app:open-path', requestedPath))
  }
  return window
}

interface DialogDirectories {
  open: SessionDirectory
  export: SessionDirectory
  media: SessionDirectory
}

const mediaExtensions = [
  'mp4', 'mov', 'mkv', 'webm',
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac',
  'png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'
]

function registerIpc(directories: DialogDirectories): void {
  ipcMain.handle('dialog:open-video', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open a video',
      defaultPath: directories.open.defaultPath(),
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'] }]
    })
    const path = result.filePaths[0]
    if (!path) return null
    directories.open.remember(path)
    return path
  })
  ipcMain.handle('dialog:open-media', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add media',
      defaultPath: directories.media.defaultPath(),
      properties: ['openFile'],
      filters: [{ name: 'Audio, video, GIF, or image', extensions: mediaExtensions }]
    })
    const path = result.filePaths[0]
    if (!path) return null
    const type = categoryFor(path)
    if (!type) return null
    directories.media.remember(path)
    return { path, type, name: displayName(path) }
  })
  ipcMain.handle('dialog:export-path', async (_event, defaultName: string) => {
    if (process.env.CATCUT_E2E_OUTPUT) return process.env.CATCUT_E2E_OUTPUT
    const result = await dialog.showSaveDialog({
      title: 'Export edited video',
      defaultPath: directories.export.defaultPath(defaultName),
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    if (!result.filePath) return null
    directories.export.remember(result.filePath)
    return result.filePath
  })
  ipcMain.handle('media:probe', (_event, path: string) => probeMedia(path))
  ipcMain.handle('media:probe-asset', (_event, path: string) => probeAsset(path))
  ipcMain.handle('media:waveform', (_event, path: string) => waveformFor(path))
  ipcMain.handle('media:should-proxy', (_event, metadata: MediaMetadata) => mediaNeedsProxy(metadata))
  ipcMain.handle('media:create-proxy', (_event, metadata: MediaMetadata) => createProxy(metadata))
  ipcMain.handle('media:url', (_event, path: string) => mediaUrl(path))
  ipcMain.handle('assets:scan', scanAssets)
  ipcMain.handle('export:start', (_event, request: ExportRequest) => exportVideo(request))
  ipcMain.handle('job:cancel', (_event, id: string) => jobs.cancel(id))
  ipcMain.handle('gpu:diagnostics', gpuDiagnostics)
}

async function startApplication(): Promise<void> {
  if (process.env.XDG_SESSION_TYPE !== 'wayland' || !process.env.WAYLAND_DISPLAY) {
    dialog.showErrorBox(
      'CatCut requires GNOME Wayland',
      'Start CatCut from an Ubuntu 26 GNOME Wayland desktop session.'
    )
    app.quit()
    return
  }
  await rm(join(app.getPath('userData'), 'recent-directory.json'), { force: true })
  if (process.env.APPIMAGE) {
    const dataHome = process.env.XDG_DATA_HOME ?? join(app.getPath('home'), '.local', 'share')
    await installDesktopIntegration({
      appImagePath: process.env.APPIMAGE,
      resourcesPath: process.resourcesPath,
      dataHome
    }).catch((error: unknown) => console.warn('Desktop integration unavailable:', error))
  }
  protocol.handle('catcut-media', mediaResponse)
  const downloads = app.getPath('downloads')
  registerIpc({
    open: new SessionDirectory(downloads),
    export: new SessionDirectory(downloads),
    media: new SessionDirectory(downloads)
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

void app.whenReady().then(startApplication)

app.on('window-all-closed', () => app.quit())
