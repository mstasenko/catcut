import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'
import { ffmpegPath } from './binaries'

const execFileAsync = promisify(execFile)
const systemFfmpeg = '/usr/bin/ffmpeg'
const renderDevice = '/dev/dri/renderD128'

export interface ExportEncoder {
  executable: string
  input: string[]
  filterSuffix: string
  videoLabel: (softwareLabel: string) => string
  output: string[]
}

export function softwareEncoder(): ExportEncoder {
  return {
    executable: ffmpegPath(),
    input: [],
    filterSuffix: '',
    videoLabel: (label) => label,
    output: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-threads', '0', '-pix_fmt', 'yuv420p']
  }
}

function vaapiEncoder(): ExportEncoder {
  return {
    executable: systemFfmpeg,
    input: ['-vaapi_device', renderDevice],
    filterSuffix: 'format=nv12,hwupload[hardwarev]',
    videoLabel: () => 'hardwarev',
    output: ['-c:v', 'h264_vaapi', '-qp', '18']
  }
}

async function vaapiWorks(): Promise<boolean> {
  try {
    await Promise.all([access(systemFfmpeg), access(renderDevice)])
    await execFileAsync(systemFfmpeg, [
      '-hide_banner', '-loglevel', 'error', '-vaapi_device', renderDevice,
      '-f', 'lavfi', '-i', 'color=size=64x64:duration=0.04',
      '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-'
    ], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

let cachedEncoder: Promise<ExportEncoder> | null = null

export function exportEncoder(): Promise<ExportEncoder> {
  cachedEncoder ??= vaapiWorks().then((available) => available ? vaapiEncoder() : softwareEncoder())
  return cachedEncoder
}
