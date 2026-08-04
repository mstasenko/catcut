import { app } from 'electron'
import { dirname, join } from 'node:path'

export function ffmpegPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', 'ffmpeg')
    : join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')
}

export function ffprobePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', 'ffprobe')
    : join(process.cwd(), 'node_modules', 'ffprobe-static', 'bin', 'linux', 'x64', 'ffprobe')
}

export function sidecarMemePath(executablePath: string, appImagePath?: string): string {
  return join(dirname(appImagePath ?? executablePath), 'meme')
}

export function bundledMemePath(): string {
  if (!app.isPackaged) return join(process.cwd(), 'dist', 'meme-pack')
  return sidecarMemePath(app.getPath('exe'), process.env.APPIMAGE)
}
