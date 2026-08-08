import { execFile } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { ffmpegPath } from './binaries'

const execFileAsync = promisify(execFile)
const ffmpegCandidates = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']

export interface ExportEncoder {
  executable: string
  input: string[]
  filterSuffix: string
  videoLabel: (softwareLabel: string) => string
  output: string[]
  hardware: boolean
}

export interface RenderDevice {
  path: string
  vendor: string
}

export function softwareEncoder(): ExportEncoder {
  return {
    executable: ffmpegPath(),
    input: [],
    filterSuffix: '',
    videoLabel: (label) => label,
    output: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-threads', '0', '-pix_fmt', 'yuv420p'],
    hardware: false
  }
}

function vaapiEncoder(executable: string, renderDevice: string): ExportEncoder {
  return {
    executable,
    input: ['-vaapi_device', renderDevice],
    filterSuffix: 'format=nv12,hwupload[hardwarev]',
    videoLabel: () => 'hardwarev',
    output: ['-c:v', 'h264_vaapi', '-qp', '18'],
    hardware: true
  }
}

export function rankRenderDevices(devices: RenderDevice[]): RenderDevice[] {
  // Intel is the preferred iGPU for this Ubuntu target, but every render node is
  // probed so device numbering and mixed-GPU machines do not dictate selection.
  return [...devices].sort((left, right) => {
    const leftIntel = left.vendor.trim().toLowerCase() === '0x8086' ? 0 : 1
    const rightIntel = right.vendor.trim().toLowerCase() === '0x8086' ? 0 : 1
    return leftIntel - rightIntel || left.path.localeCompare(right.path)
  })
}

async function renderDevices(): Promise<RenderDevice[]> {
  try {
    const entries = await readdir('/dev/dri', { withFileTypes: true })
    const devices = await Promise.all(entries
      .filter((entry) => entry.isCharacterDevice() && /^renderD\d+$/.test(entry.name))
      .map(async (entry) => {
        const path = `/dev/dri/${entry.name}`
        const vendor = await readFile(`/sys/class/drm/${entry.name}/device/vendor`, 'utf8').catch(() => '')
        return { path, vendor }
      }))
    return rankRenderDevices(devices)
  } catch {
    return []
  }
}

async function systemFfmpeg(): Promise<string | null> {
  for (const path of ffmpegCandidates) {
    try {
      await access(path)
      return path
    } catch {
      // Try the next trusted system location.
    }
  }
  return null
}

async function vaapiWorks(executable: string, renderDevice: string): Promise<boolean> {
  try {
    await access(renderDevice)
    await execFileAsync(executable, [
      '-hide_banner', '-loglevel', 'error', '-vaapi_device', renderDevice,
      '-f', 'lavfi', '-i', 'color=size=64x64:duration=0.04',
      '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-'
    ], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

async function detectEncoder(): Promise<ExportEncoder> {
  const executable = await systemFfmpeg()
  if (!executable) return softwareEncoder()
  for (const device of await renderDevices()) {
    if (await vaapiWorks(executable, device.path)) return vaapiEncoder(executable, device.path)
  }
  return softwareEncoder()
}

let cachedEncoder: Promise<ExportEncoder> | null = null

export function exportEncoder(): Promise<ExportEncoder> {
  cachedEncoder ??= detectEncoder()
  return cachedEncoder
}
