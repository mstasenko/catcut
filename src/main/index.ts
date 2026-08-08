import { join, resolve } from 'node:path'
import { rm } from 'node:fs/promises'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol
} from 'electron'
import type { ExportRequest, GpuDiagnostics, Overlay } from '../types'
import { categoryFor, displayName, scanAssets } from './assets'
import { exportVideo } from './exporter'
import { jobs } from './jobs'
import { createProxy, mediaNeedsProxy, probeAsset, probeMedia, waveformFor } from './media'
import { mediaResponse, mediaUrl } from './media-protocol'
import { installDesktopIntegration } from './desktop'
import { SessionDirectory } from './session-directory'
import { initialWindowSize } from './window-options'
import { SessionPathRegistry } from './path-registry'
import { svgDataUrl } from './svg'
import {
  parseDefaultName,
  parseExportRequest,
  parseJobId,
  parseMediaMetadata,
  parsePath
} from './validation'

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

function createWindow(paths: SessionPathRegistry): BrowserWindow {
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
    window.webContents.once('did-finish-load', () => {
      void paths.allowRead(resolve(requestedPath)).then((path) => window.webContents.send('app:open-path', path))
    })
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

async function authorizedAssets(paths: SessionPathRegistry): Promise<Awaited<ReturnType<typeof scanAssets>>> {
  const assets = await scanAssets()
  const authorized = await Promise.all(assets.map(async (asset) => {
    try {
      return { ...asset, path: await paths.allowRead(asset.path) }
    } catch {
      return null
    }
  }))
  return authorized.filter((asset) => asset !== null)
}

function authorizeOverlay(overlay: Overlay, paths: SessionPathRegistry): Overlay {
  if (overlay.type === 'text') return overlay
  return { ...overlay, path: paths.assertReadable(overlay.path) }
}

async function trustedExport(value: unknown, paths: SessionPathRegistry): Promise<ExportRequest> {
  const supplied = parseExportRequest(value)
  const sourcePath = paths.assertReadable(supplied.source.path)
  const request = parseExportRequest({ ...supplied, source: await probeMedia(sourcePath) })
  return {
    ...request,
    outputPath: paths.assertWritable(request.outputPath),
    overlays: request.overlays.map((overlay) => authorizeOverlay(overlay, paths))
  }
}

async function trustedAssetMetadata(path: string, paths: SessionPathRegistry): Promise<Awaited<ReturnType<typeof probeAsset>>> {
  const metadata = await probeAsset(path)
  if (categoryFor(path) !== 'gif') return metadata
  const proxy = await createProxy(await probeMedia(path))
  return { ...metadata, playbackPath: await paths.allowRead(proxy.result.path) }
}

function registerIpc(directories: DialogDirectories, paths: SessionPathRegistry): void {
  ipcMain.handle('dialog:open-video', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open a video',
      defaultPath: directories.open.defaultPath(),
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'] }]
    })
    const selected = result.filePaths[0]
    if (!selected) return null
    const path = await paths.allowRead(selected)
    directories.open.remember(path)
    return path
  })
  ipcMain.handle('dialog:open-media', async () => {
    const testSelection = process.env.CATCUT_E2E_MEDIA
    const result = testSelection
      ? { filePaths: [testSelection] }
      : await dialog.showOpenDialog({
          title: 'Add media',
          defaultPath: directories.media.defaultPath(),
          properties: ['openFile'],
          filters: [{ name: 'Audio, video, GIF, or image', extensions: mediaExtensions }]
        })
    const selected = testSelection ?? result.filePaths[0]
    if (!selected) return null
    const type = categoryFor(selected)
    if (!type) return null
    const path = await paths.allowRead(selected)
    directories.media.remember(path)
    return { path, type, name: displayName(path) }
  })
  ipcMain.handle('dialog:export-path', async (_event, value: unknown) => {
    const defaultName = parseDefaultName(value)
    if (process.env.CATCUT_E2E_OUTPUT) return paths.allowWrite(process.env.CATCUT_E2E_OUTPUT)
    const result = await dialog.showSaveDialog({
      title: 'Export edited video',
      defaultPath: directories.export.defaultPath(defaultName),
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    if (!result.filePath) return null
    const path = await paths.allowWrite(result.filePath)
    directories.export.remember(path)
    return path
  })
  ipcMain.handle('media:authorize-drop', async (_event, value: unknown) => {
    const path = parsePath(value)
    if (categoryFor(path) !== 'video') throw new Error('Only video files can be opened here')
    return paths.allowRead(path)
  })
  ipcMain.handle('media:probe', (_event, value: unknown) => probeMedia(paths.assertReadable(parsePath(value))))
  ipcMain.handle('media:probe-asset', (_event, value: unknown) => {
    const path = paths.assertReadable(parsePath(value))
    return trustedAssetMetadata(path, paths)
  })
  ipcMain.handle('media:waveform', (_event, value: unknown) => waveformFor(paths.assertReadable(parsePath(value))))
  ipcMain.handle('media:should-proxy', (_event, value: unknown) => {
    const metadata = parseMediaMetadata(value)
    paths.assertReadable(metadata.path)
    return mediaNeedsProxy(metadata)
  })
  ipcMain.handle('media:create-proxy', async (_event, value: unknown) => {
    const supplied = parseMediaMetadata(value)
    const metadata = await probeMedia(paths.assertReadable(supplied.path))
    const result = await createProxy(metadata)
    await paths.allowRead(result.result.path)
    return result
  })
  ipcMain.handle('media:url', (_event, value: unknown) => mediaUrl(paths.assertReadable(parsePath(value))))
  ipcMain.handle('media:svg-data', (_event, value: unknown) => svgDataUrl(paths.assertReadable(parsePath(value))))
  ipcMain.handle('assets:scan', () => authorizedAssets(paths))
  ipcMain.handle('export:start', async (_event, value: unknown) => exportVideo(await trustedExport(value, paths)))
  ipcMain.handle('job:cancel', (_event, value: unknown) => jobs.cancel(parseJobId(value)))
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
  const paths = new SessionPathRegistry()
  protocol.handle('catcut-media', (request) => mediaResponse(request, (path) => paths.canRead(path)))
  const downloads = app.getPath('downloads')
  const videos = app.getPath('videos')
  registerIpc({
    open: new SessionDirectory(videos),
    export: new SessionDirectory(videos),
    media: new SessionDirectory(downloads)
  }, paths)
  createWindow(paths)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(paths)
  })
}

void app.whenReady().then(startApplication)

app.on('window-all-closed', () => app.quit())
