import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { ExportRequest, Overlay, TextOverlay, VisualOverlayBase } from '../types'
import { ffmpegPath, ffprobePath } from './binaries'
import { exportEncoder, softwareEncoder } from './export-encoder'
import { jobs } from './jobs'

const execFileAsync = promisify(execFile)

interface PreparedInput {
  overlay: Overlay
  index: number
}

function seconds(value: number): string {
  return Math.max(0, value).toFixed(6)
}

async function prepareRenderedImage(
  overlay: Pick<TextOverlay, 'id' | 'name' | 'renderedImageDataUrl'>,
  directory: string
): Promise<string> {
  if (!overlay.renderedImageDataUrl?.startsWith('data:image/png;base64,')) {
    throw new Error(`Overlay “${overlay.name}” was not rendered before export`)
  }
  const path = join(directory, `${overlay.id}.png`)
  const encoded = overlay.renderedImageDataUrl.slice('data:image/png;base64,'.length)
  await writeFile(path, Buffer.from(encoded, 'base64'))
  return path
}

async function prepareVisualPath(overlay: Overlay, directory: string): Promise<string> {
  if (overlay.type === 'text') return prepareRenderedImage(overlay, directory)
  if (overlay.type === 'audio') throw new Error('Audio overlays do not have a visual path')
  if (extname(overlay.path).toLowerCase() !== '.svg') return overlay.path
  return prepareRenderedImage(overlay, directory)
}

function visualGeometry(overlay: VisualOverlayBase, width: number, height: number): {
  width: number
  height: number
  x: number
  y: number
} {
  return {
    width: Math.max(2, Math.round(width * overlay.width / 2) * 2),
    height: Math.max(2, Math.round(height * overlay.height / 2) * 2),
    x: Math.round(width * overlay.x),
    y: Math.round(height * overlay.y)
  }
}

export function buildFilterGraph(request: ExportRequest, inputs: PreparedInput[]): {
  graph: string
  videoLabel: string
  audioLabel: string
} {
  const filters: string[] = []
  const { videoSegments, audioSegments } = addSegmentFilters(filters, request)
  addBaseFilters(filters, videoSegments, audioSegments, request)
  const videoLabel = addVisualFilters(filters, inputs, request)
  addAudioFilters(filters, inputs)
  return { graph: filters.join(';'), videoLabel, audioLabel: 'aout' }
}

function addSegmentFilters(filters: string[], request: ExportRequest): {
  videoSegments: string[]
  audioSegments: string[]
} {
  const videoSegments: string[] = []
  const audioSegments: string[] = []
  request.segments.forEach((segment, index) => {
    const inputIndex = request.sources.findIndex((source) => source.id === segment.sourceId)
    const source = request.sources[inputIndex]?.metadata
    if (inputIndex < 0 || !source) throw new Error('A timeline video source is missing')
    const segmentDuration = segment.sourceEnd - segment.sourceStart
    const { width, height, fps, fit } = request.canvas
    // FFmpeg concat requires every clip to have matching video and audio formats.
    const scaleAndCrop = fit === 'cover'
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
    filters.push(
      `[${inputIndex}:v:0]trim=start=${seconds(segment.sourceStart)}:end=${seconds(segment.sourceEnd)},` +
      `setpts=PTS-STARTPTS,${scaleAndCrop},setsar=1,fps=${fps},format=yuv420p[vseg${index}]`
    )
    videoSegments.push(`[vseg${index}]`)
    if (source.hasAudio) {
      filters.push(
        `[${inputIndex}:a:0]atrim=start=${seconds(segment.sourceStart)}:end=${seconds(segment.sourceEnd)},` +
        `asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aseg${index}]`
      )
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000:d=${seconds(segmentDuration)}[aseg${index}]`)
    }
    audioSegments.push(`[aseg${index}]`)
  })
  return { videoSegments, audioSegments }
}

function addBaseFilters(
  filters: string[],
  videoSegments: string[],
  audioSegments: string[],
  request: ExportRequest
): void {
  if (request.segments.length === 1) {
    filters.push(`${videoSegments[0]}null[basev]`)
    filters.push(`${audioSegments[0]}anull[basea]`)
  } else {
    filters.push(`${videoSegments.join('')}concat=n=${request.segments.length}:v=1:a=0[basev]`)
    filters.push(`${audioSegments.join('')}concat=n=${request.segments.length}:v=0:a=1[basea]`)
  }
}

function visualFilter(
  filters: string[],
  overlay: Exclude<Overlay, { type: 'audio' }>,
  index: number,
  order: number,
  inputLabel: string,
  request: ExportRequest
): string {
  const outputLabel = `vout${order}`
  if (overlay.type === 'text') {
    filters.push(
      `[${index}:v:0]trim=duration=${seconds(overlay.duration)},` +
      `setpts=PTS-STARTPTS+${seconds(overlay.start)}/TB,format=rgba,colorchannelmixer=aa=${overlay.opacity}[ov${order}]`,
      `[${inputLabel}][ov${order}]overlay=x=0:y=0:eof_action=pass:repeatlast=1:` +
      `enable='between(t,${seconds(overlay.start)},${seconds(overlay.start + overlay.duration)})'[${outputLabel}]`
    )
    return outputLabel
  }
  const { canvas } = request
  const geometry = visualGeometry(overlay, canvas.width, canvas.height)
  const fullScreen = fillsFrame(overlay)
  const scale = visualScale(fullScreen, geometry, canvas.width, canvas.height)
  const position = fullScreen ? { x: 0, y: 0 } : geometry
  const trim = 'sourceIn' in overlay
    ? `trim=start=${seconds(overlay.sourceIn)}:end=${seconds(overlay.sourceIn + overlay.duration)}`
    : `trim=duration=${seconds(overlay.duration)}`
  filters.push(
    `[${index}:v:0]${trim},setpts=PTS-STARTPTS+${seconds(overlay.start)}/TB,` +
    `${scale},colorchannelmixer=aa=${overlay.opacity}[ov${order}]`,
    `[${inputLabel}][ov${order}]overlay=x=${position.x}:y=${position.y}:` +
    `eof_action=pass:repeatlast=1:enable='between(t,${seconds(overlay.start)},${seconds(overlay.start + overlay.duration)})'` +
    `[${outputLabel}]`
  )
  return outputLabel
}

function fillsFrame(overlay: VisualOverlayBase): boolean {
  return overlay.width >= 0.999 && overlay.height >= 0.999
}

function visualScale(fullScreen: boolean, geometry: ReturnType<typeof visualGeometry>, width: number, height: number): string {
  if (!fullScreen) {
    return `scale=${geometry.width}:${geometry.height}:force_original_aspect_ratio=decrease,format=rgba,` +
      `pad=${geometry.width}:${geometry.height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
  }
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `format=rgba,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
}

function addVisualFilters(filters: string[], inputs: PreparedInput[], request: ExportRequest): string {
  let videoLabel = 'basev'
  const visualInputs = inputs
    .filter(({ overlay }) => overlay.type !== 'audio')
    .sort((left, right) => left.overlay.zIndex - right.overlay.zIndex)
  visualInputs.forEach(({ overlay, index }, order) => {
    if (overlay.type === 'audio') return
    videoLabel = visualFilter(filters, overlay, index, order, videoLabel, request)
  })
  return videoLabel
}

function addAudioFilters(filters: string[], inputs: PreparedInput[]): void {
  const audioInputs = inputs.filter(({ overlay }) =>
    overlay.type === 'audio' || (overlay.type === 'video' && overlay.audioEnabled)
  )
  const audioLabels = ['[basea]']
  audioInputs.forEach(({ overlay, index }, order) => {
    const delay = Math.round(overlay.start * 1000)
    const volume = overlay.type === 'audio' || overlay.type === 'video' ? overlay.volume : 1
    const sourceIn = overlay.type === 'audio' || overlay.type === 'video' ? overlay.sourceIn : 0
    filters.push(
      `[${index}:a:0]atrim=start=${seconds(sourceIn)}:end=${seconds(sourceIn + overlay.duration)},asetpts=PTS-STARTPTS,` +
      `volume=${volume},adelay=${delay}|${delay}[aov${order}]`
    )
    audioLabels.push(`[aov${order}]`)
  })

  if (audioLabels.length > 1) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95[aout]`)
  } else {
    filters.push('[basea]alimiter=limit=0.95[aout]')
  }
}

async function keyframes(path: string): Promise<number[]> {
  const { stdout } = await execFileAsync(
    ffprobePath(),
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-skip_frame', 'nokey',
      '-show_entries', 'frame=best_effort_timestamp_time',
      '-of', 'csv=p=0',
      path
    ],
    { maxBuffer: 32 * 1024 * 1024 }
  )
  return stdout.split(/\r?\n/).map(Number).filter(Number.isFinite)
}

function nearKeyframe(time: number, frames: number[], tolerance: number, duration: number): boolean {
  if (time <= tolerance || Math.abs(duration - time) <= tolerance) return true
  return frames.some((frame) => Math.abs(frame - time) <= tolerance)
}

function soleTimelineSource(request: ExportRequest): ExportRequest['sources'][number] | null {
  const sourceId = request.segments[0]?.sourceId
  if (!sourceId || request.segments.some((segment) => segment.sourceId !== sourceId)) return null
  return request.sources.find((source) => source.id === sourceId) ?? null
}

function preservesSourceFormat(request: ExportRequest, source: ExportRequest['sources'][number]['metadata']): boolean {
  return request.canvas.fit === 'contain'
    && request.canvas.width === source.width
    && request.canvas.height === source.height
    && Math.abs(request.canvas.fps - source.fps) <= 0.01
}

function segmentsAreKeyframeSafe(request: ExportRequest, frames: number[], tolerance: number, duration: number): boolean {
  return request.segments.every((segment) =>
    nearKeyframe(segment.sourceStart, frames, tolerance, duration)
    && nearKeyframe(segment.sourceEnd, frames, tolerance, duration)
  )
}

function frameTolerance(fps: number): number {
  return Math.max(0.05, fps > 0 ? 1 / fps : 0.05)
}

async function canStreamCopy(request: ExportRequest): Promise<boolean> {
  if (request.overlays.length > 0) return false
  const timelineSource = soleTimelineSource(request)
  if (!timelineSource) return false
  const source = timelineSource.metadata
  if (!['h264', 'hevc', 'av1', 'vp9'].includes(source.videoCodec)) return false
  if (!preservesSourceFormat(request, source)) return false
  const frames = await keyframes(source.path)
  return segmentsAreKeyframeSafe(request, frames, frameTolerance(source.fps), source.duration)
}

function concatPath(path: string): string {
  return path.replaceAll("'", "'\\''")
}

async function ensureDiskSpace(request: ExportRequest): Promise<void> {
  const available = await statfs(dirname(request.outputPath))
  const free = available.bavail * available.bsize
  const sourceSize = request.sources.reduce((sum, source) => sum + source.metadata.size, 0)
  const estimated = Math.max(512 * 1024 * 1024, sourceSize * 1.5)
  if (free < estimated) {
    throw new Error(`Not enough free disk space. Approximately ${Math.ceil(estimated / 1024 / 1024)} MB is required.`)
  }
}

export async function exportVideo(request: ExportRequest): Promise<{ jobId: string; outputPath: string }> {
  if (request.segments.length === 0) throw new Error('The timeline is empty')
  await mkdir(dirname(request.outputPath), { recursive: true })
  await ensureDiskSpace(request)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'catcut-export-'))
  const temporaryOutput = join(dirname(request.outputPath), `.${randomUUID()}.catcut.mp4`)
  const duration = request.segments.reduce((sum, segment) => sum + segment.sourceEnd - segment.sourceStart, 0)
  const jobId = randomUUID()

  try {
    await writeExport(request, temporaryDirectory, temporaryOutput, duration, jobId)
    await rename(temporaryOutput, request.outputPath)
    return { jobId, outputPath: request.outputPath }
  } catch (error) {
    await rm(temporaryOutput, { force: true })
    throw error
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function writeExport(
  request: ExportRequest,
  directory: string,
  output: string,
  duration: number,
  jobId: string
): Promise<void> {
  if (!await canStreamCopy(request)) {
    await encodeVideo(request, directory, output, duration, jobId)
    return
  }
  try {
    await streamCopy(request, directory, output, duration, jobId)
  } catch (error) {
    if (isCancellation(error)) throw error
    // A keyframe-safe remux can still fail on an incompatible container stream.
    // Remove its partial output and use the normal encode path transparently.
    await rm(output, { force: true })
    await encodeVideo(request, directory, output, duration, jobId)
  }
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('cancelled')
}

async function streamCopy(
  request: ExportRequest,
  directory: string,
  output: string,
  duration: number,
  jobId: string
): Promise<void> {
  const concatFile = join(directory, 'segments.ffconcat')
  const lines = ['ffconcat version 1.0']
  for (const segment of request.segments) {
    const source = request.sources.find((candidate) => candidate.id === segment.sourceId)
    if (!source) throw new Error('A timeline video source is missing')
    lines.push(`file '${concatPath(source.metadata.path)}'`)
    lines.push(`inpoint ${seconds(segment.sourceStart)}`)
    lines.push(`outpoint ${seconds(segment.sourceEnd)}`)
  }
  await writeFile(concatFile, `${lines.join('\n')}\n`)
  await jobs.run(ffmpegPath(), streamCopyArguments(concatFile, output), 'export', duration, request.outputPath, jobId)
}

export function streamCopyArguments(concatFile: string, output: string): string[] {
  return [
    '-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-c', 'copy',
    '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', output
  ]
}

async function prepareInputs(request: ExportRequest, directory: string): Promise<{
  inputArgs: string[]
  preparedInputs: PreparedInput[]
}> {
  const inputArgs = ['-hide_banner', '-y']
  for (const source of request.sources) inputArgs.push('-i', source.metadata.path)
  const preparedInputs: PreparedInput[] = []
  for (const [offset, overlay] of request.overlays.entries()) {
    inputArgs.push(...await overlayInputArgs(overlay, directory))
    preparedInputs.push({ overlay, index: offset + request.sources.length })
  }
  return { inputArgs, preparedInputs }
}

function needsAudioValidation(overlay: Overlay): boolean {
  return overlay.type === 'video' && overlay.audioEnabled && !overlay.hasAudio
}

function loopsInput(overlay: Overlay): boolean {
  return overlay.type === 'gif' || (overlay.type === 'video' && overlay.loop)
}

function stillInput(overlay: Overlay): boolean {
  return overlay.type === 'image' || overlay.type === 'text'
}

async function overlayInputArgs(overlay: Overlay, directory: string): Promise<string[]> {
  if (needsAudioValidation(overlay)) throw new Error(`Video clip has no audio stream: ${overlay.name}`)
  const path = overlay.type === 'audio' ? overlay.path : await prepareVisualPath(overlay, directory)
  const options: string[] = []
  if (stillInput(overlay)) options.push('-loop', '1')
  if (loopsInput(overlay)) options.push('-stream_loop', '-1')
  return [...options, '-i', path]
}

async function encodeVideo(
  request: ExportRequest,
  directory: string,
  output: string,
  duration: number,
  jobId: string
): Promise<void> {
  const { inputArgs, preparedInputs } = await prepareInputs(request, directory)
  const filter = buildFilterGraph(request, preparedInputs)
  const encoder = await exportEncoder()
  const graph = encoder.filterSuffix
    ? `${filter.graph};[${filter.videoLabel}]${encoder.filterSuffix}`
    : filter.graph
  const args = encoderArgs(encoder, inputArgs, filter, graph, duration, output)
  try {
    await jobs.run(encoder.executable, args, 'export', duration, request.outputPath, jobId)
  } catch (error) {
    if (!encoder.hardware || isCancellation(error)) throw error
    // A short VAAPI probe cannot predict every real filter graph or driver
    // failure, so software encoding is the reliability fallback for this job.
    await rm(output, { force: true })
    const fallback = softwareEncoder()
    await jobs.run(
      fallback.executable,
      encoderArgs(fallback, inputArgs, filter, filter.graph, duration, output),
      'export', duration, request.outputPath, jobId
    )
  }
}

function encoderArgs(
  encoder: Awaited<ReturnType<typeof exportEncoder>>,
  inputArgs: string[],
  filter: ReturnType<typeof buildFilterGraph>,
  graph: string,
  duration: number,
  output: string
): string[] {
  return [
    ...encoder.input, ...inputArgs,
    '-filter_complex_threads', '0', '-filter_complex', graph,
    '-map', `[${encoder.videoLabel(filter.videoLabel)}]`, '-map', `[${filter.audioLabel}]`,
    '-t', seconds(duration), ...encoder.output,
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', output
  ]
}
