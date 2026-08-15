import { execFile } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { ffmpegPath } from './binaries'

const execFileAsync = promisify(execFile)
const systemFfmpegCandidates = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']
const vaapiCodecs = ['av1_vaapi', 'hevc_vaapi', 'h264_vaapi'] as const
type VaapiCodec = typeof vaapiCodecs[number]

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
  pciSlot?: string
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

function vaapiEncoder(executable: string, renderDevice: string, codec: VaapiCodec): ExportEncoder {
  return {
    executable,
    input: ['-vaapi_device', renderDevice],
    filterSuffix: 'format=nv12,hwupload[hardwarev]',
    videoLabel: () => 'hardwarev',
    output: ['-c:v', codec, '-qp', '18'],
    hardware: true
  }
}

export function rankRenderDevices(devices: RenderDevice[]): RenderDevice[] {
  // Intel's integrated graphics conventionally occupies PCI slot 00:02.0.
  // Prefer another Intel device (such as Arc) while retaining every render node.
  return [...devices].sort((left, right) => {
    const rank = (device: RenderDevice): number => {
      if (device.vendor.trim().toLowerCase() !== '0x8086') return 2
      return device.pciSlot && !device.pciSlot.endsWith(':00:02.0') ? 0 : 1
    }
    return rank(left) - rank(right) || left.path.localeCompare(right.path)
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
        const pciSlot = await readFile(`/sys/class/drm/${entry.name}/device/uevent`, 'utf8')
          .then((value) => /^PCI_SLOT_NAME=(.+)$/m.exec(value)?.[1] ?? '')
          .catch(() => '')
        return { path, vendor, pciSlot }
      }))
    return rankRenderDevices(devices)
  } catch {
    return []
  }
}

export function hardwareFfmpegCandidates(): string[] {
  return [...new Set([ffmpegPath(), ...systemFfmpegCandidates])]
}

export function vaapiProbeArgs(renderDevice: string, codec: VaapiCodec): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-vaapi_device', renderDevice,
    '-f', 'lavfi', '-i', 'color=size=1280x720:duration=0.04',
    '-vf', 'format=nv12,hwupload', '-c:v', codec, '-frames:v', '1', '-f', 'null', '-'
  ]
}

async function availableFfmpegs(): Promise<string[]> {
  const available: string[] = []
  for (const path of hardwareFfmpegCandidates()) {
    try {
      await access(path)
      available.push(path)
    } catch {
      // Try the next trusted system location.
    }
  }
  return available
}

async function vaapiWorks(executable: string, renderDevice: string, codec: VaapiCodec): Promise<boolean> {
  try {
    await access(renderDevice)
    await execFileAsync(executable, vaapiProbeArgs(renderDevice, codec), { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

async function vaapiEncoders(executable: string, devices: RenderDevice[]): Promise<ExportEncoder[]> {
  const encoders: ExportEncoder[] = []
  for (const device of devices) {
    for (const codec of vaapiCodecs) {
      if (await vaapiWorks(executable, device.path, codec)) {
        encoders.push(vaapiEncoder(executable, device.path, codec))
      }
    }
  }
  return encoders
}

async function detectEncoders(): Promise<ExportEncoder[]> {
  const devices = await renderDevices()
  for (const executable of await availableFfmpegs()) {
    const hardware = await vaapiEncoders(executable, devices)
    if (hardware.length) return [...hardware, softwareEncoder()]
  }
  return [softwareEncoder()]
}

let cachedEncoders: Promise<ExportEncoder[]> | null = null

export function exportEncoders(): Promise<ExportEncoder[]> {
  cachedEncoders ??= detectEncoders()
  return cachedEncoders
}
