import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { AssetMetadata, MediaMetadata, ProxyResult } from '../types'
import { ffmpegPath, ffprobePath } from './binaries'
import { jobs } from './jobs'

const execFileAsync = promisify(execFile)
const waveformCache = new Map<string, Promise<number[]>>()

interface ProbeStream {
  codec_type: 'video' | 'audio'
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  pix_fmt?: string
  duration?: string
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number }[]
}

interface ProbeResult {
  format: { duration?: string; size?: string; filename?: string }
  streams: ProbeStream[]
}

function parseRate(rate?: string): number {
  if (!rate || rate === '0/0') return 0
  const [numerator, denominator] = rate.split('/').map(Number)
  if (!numerator || !denominator) return 0
  return numerator / denominator
}

async function readProbe(path: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    ffprobePath(),
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path],
    { maxBuffer: 16 * 1024 * 1024 }
  )
  return JSON.parse(stdout) as ProbeResult
}

function stream(result: ProbeResult, type: ProbeStream['codec_type']): ProbeStream | undefined {
  return result.streams.find((item) => item.codec_type === type)
}

function firstNumber(...values: (string | number | undefined)[]): number {
  const value = values.find((item) => item !== undefined)
  return Number(value ?? 0)
}

function textOr(value: string | undefined, fallback: string): string {
  return value ?? fallback
}

function firstText(primary: string | undefined, fallback: string | undefined): string | undefined {
  return primary ?? fallback
}

function rotationOf(video: ProbeStream): number {
  const sideData = video.side_data_list?.find((item) => typeof item.rotation === 'number')
  return firstNumber(sideData?.rotation, video.tags?.rotate)
}

export function displayDimensions(width: number, height: number, rotation: number): {
  width: number
  height: number
  rotation: number
} {
  const normalized = ((Math.round(rotation) % 360) + 360) % 360
  return normalized === 90 || normalized === 270
    ? { width: height, height: width, rotation: normalized }
    : { width, height, rotation: normalized }
}

export async function probeMedia(path: string): Promise<MediaMetadata> {
  const result = await readProbe(path)
  const video = stream(result, 'video')
  if (!video) throw new Error('This file is not a video.')
  const audio = stream(result, 'audio')
  const fileStat = await stat(path)
  const dimensions = displayDimensions(
    firstNumber(video.width),
    firstNumber(video.height),
    rotationOf(video)
  )

  return {
    path,
    name: basename(path),
    size: firstNumber(result.format.size, fileStat.size),
    modifiedAt: fileStat.mtimeMs,
    duration: firstNumber(result.format.duration, video.duration),
    width: dimensions.width,
    height: dimensions.height,
    fps: parseRate(firstText(video.avg_frame_rate, video.r_frame_rate)),
    videoCodec: textOr(video.codec_name, 'unknown'),
    audioCodec: audio ? textOr(audio.codec_name, 'unknown') : null,
    hasAudio: Boolean(audio),
    rotation: dimensions.rotation,
    pixelFormat: textOr(video.pix_fmt, 'unknown')
  }
}

export async function probeAsset(path: string): Promise<AssetMetadata> {
  const result = await readProbe(path)
  const video = stream(result, 'video')
  const audio = stream(result, 'audio')
  return {
    duration: firstNumber(result.format.duration, video?.duration, audio?.duration, 3),
    width: firstNumber(video?.width),
    height: firstNumber(video?.height),
    hasAudio: Boolean(audio)
  }
}

export function mediaNeedsProxy(metadata: MediaMetadata): boolean {
  const browserCodecs = new Set(['h264', 'vp8', 'vp9', 'av1'])
  return metadata.size > 500 * 1024 * 1024
    || metadata.duration > 20 * 60
    || metadata.width > 1920
    || metadata.height > 1080
    || !browserCodecs.has(metadata.videoCodec)
}

export function proxyCacheKey(metadata: MediaMetadata): string {
  return createHash('sha256')
    .update(`${metadata.path}\0${metadata.size}\0${metadata.modifiedAt}\0${metadata.duration}`)
    .digest('hex')
    .slice(0, 24)
}

async function validProxy(path: string): Promise<boolean> {
  try {
    const [file, probe] = await Promise.all([stat(path), readProbe(path)])
    return file.size > 1024 && Boolean(stream(probe, 'video')) && firstNumber(probe.format.duration) > 0
  } catch {
    return false
  }
}

export async function pruneProxyCache(
  directory: string,
  maximumBytes = 10 * 1024 ** 3,
  preservedPath?: string
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = (await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mp4'))
    .map(async (entry) => {
      const path = join(directory, entry.name)
      const details = await stat(path)
      return { path, size: details.size, modifiedAt: details.mtimeMs }
    })))
    .sort((left, right) => left.modifiedAt - right.modifiedAt)
  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files) {
    if (total <= maximumBytes) break
    if (file.path === preservedPath) continue
    await rm(file.path, { force: true })
    total -= file.size
  }
}

export async function createProxy(metadata: MediaMetadata): Promise<{
  jobId: string
  result: ProxyResult
}> {
  const cacheRoot = process.env.XDG_CACHE_HOME ?? join(app.getPath('home'), '.cache')
  const cacheDirectory = join(cacheRoot, 'catcut', 'proxies')
  await mkdir(cacheDirectory, { recursive: true })
  const key = proxyCacheKey(metadata)
  const outputPath = join(cacheDirectory, `${key}.mp4`)
  if (await validProxy(outputPath)) {
    return { jobId: `cache-${key}`, result: { path: outputPath, cacheHit: true } }
  }
  await rm(outputPath, { force: true })

  const jobId = randomUUID()
  const temporaryPath = join(cacheDirectory, `.${key}.${jobId}.partial.mp4`)
  const frameRate = metadata.fps > 0 ? Math.max(24, Math.round(metadata.fps)) : 30
  const args = [
    '-hide_banner',
    '-y',
    '-i',
    metadata.path,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    "scale='min(1280,iw)':-2",
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(frameRate),
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    temporaryPath
  ]
  try {
    await jobs.run(ffmpegPath(), args, 'proxy', metadata.duration, outputPath, jobId)
    // Never expose the cache filename until FFprobe accepts the completed temp
    // file. Rename on the same filesystem makes the cache update atomic.
    if (!await validProxy(temporaryPath)) throw new Error('The generated playback proxy is invalid')
    await rename(temporaryPath, outputPath)
    await pruneProxyCache(cacheDirectory, 10 * 1024 ** 3, outputPath)
    return { jobId, result: { path: outputPath, cacheHit: false } }
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export function defaultExportName(sourceName: string): string {
  const extension = extname(sourceName)
  return `${sourceName.slice(0, extension ? -extension.length : undefined)}-edited.mp4`
}

export function peaksFromPcm(buffer: Buffer, bucketCount = 400): number[] {
  const sampleCount = Math.floor(buffer.byteLength / 4)
  if (sampleCount === 0) return []
  const peaks = Array.from({ length: Math.min(bucketCount, sampleCount) }, () => 0)
  for (let index = 0; index < sampleCount; index += 1) {
    const bucket = Math.min(peaks.length - 1, Math.floor(index / sampleCount * peaks.length))
    const sample = Math.abs(buffer.readFloatLE(index * 4))
    peaks[bucket] = Math.max(peaks[bucket] ?? 0, Number.isFinite(sample) ? sample : 0)
  }
  const maximum = Math.max(...peaks, 0.01)
  return peaks.map((peak) => Math.min(1, peak / maximum))
}

async function createWaveform(path: string): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync(ffmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-i', path, '-map', '0:a:0',
      '-vn', '-ac', '1', '-ar', '100', '-f', 'f32le', 'pipe:1'
    ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
    return peaksFromPcm(stdout)
  } catch {
    return []
  }
}

export function waveformFor(path: string): Promise<number[]> {
  const pending = waveformCache.get(path) ?? createWaveform(path)
  waveformCache.set(path, pending)
  return pending
}
