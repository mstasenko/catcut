import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ExportRequest, Overlay, SourceSegment, TextOverlay, VisualOverlayBase } from '../types'
import { exportEncoders } from './export-encoder'
import { jobs } from './jobs'
import { addTextOverlayFilters } from './text-filters'
import { addAudioOverlayFilters } from './audio-filters'
import { segmentOutputDuration, segmentPlaybackRate } from '../segment-time'

type Encoder = Awaited<ReturnType<typeof exportEncoders>>[number]

interface PreparedInput {
  overlay: Overlay
  index: number
}

function seconds(value: number): string {
  return Math.max(0, value).toFixed(6)
}

function focusZoomExpression(request: ExportRequest): { zoom: string; x: string; y: string } | null {
  const effects = request.focusZooms ?? []
  if (effects.length === 0) return null
  const time = `on/${request.canvas.fps}`
  let zoom = '1'
  let x = '0'
  let y = '0'
  for (const effect of [...effects].reverse()) {
    const end = effect.start + effect.duration
    const ramp = Math.min(0.18, effect.duration / 3)
    const local = `((${time})-${seconds(effect.start)})`
    const easedIn = `pow(min(1,max(0,${local}/${seconds(ramp)})),2)*(3-2*min(1,max(0,${local}/${seconds(ramp)})))`
    const easedOut = `pow(min(1,max(0,(${seconds(end)}-(${time}))/${seconds(ramp)})),2)*(3-2*min(1,max(0,(${seconds(end)}-(${time}))/${seconds(ramp)})))`
    const activeZoom = `(1+${effect.zoom - 1}*min(${easedIn},${easedOut}))`
    const active = `between(${time},${seconds(effect.start)},${seconds(end)})`
    zoom = `if(${active},${activeZoom},${zoom})`
    x = `if(${active},max(0,min(iw-iw/zoom,${effect.focusX}*iw-iw/(2*zoom))),${x})`
    y = `if(${active},max(0,min(ih-ih/zoom,${effect.focusY}*ih-ih/(2*zoom))),${y})`
  }
  return { zoom, x, y }
}

function audioTempoFilter(rate: number): string {
  if (rate === 1) return 'anull'
  const factors = rate === 0.25 ? [0.5, 0.5] : rate === 4 ? [2, 2] : [rate]
  return factors.map((factor) => `atempo=${factor}`).join(',')
}

async function prepareRenderedImage(
  overlay: Pick<TextOverlay, 'id' | 'name' | 'renderedImageDataUrl' | 'renderedTextBitmap'>,
  directory: string
): Promise<string> {
  const dataUrl = overlay.renderedTextBitmap?.dataUrl ?? overlay.renderedImageDataUrl
  if (!dataUrl?.startsWith('data:image/png;base64,')) {
    throw new Error(`Overlay “${overlay.name}” was not rendered before export`)
  }
  const path = join(directory, `${overlay.id}.png`)
  const encoded = dataUrl.slice('data:image/png;base64,'.length)
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
  const cameraLabel = addFocusZoomFilters(filters, request)
  const videoLabel = addVisualFilters(filters, inputs, request, cameraLabel)
  const duration = request.segments.reduce((sum, segment) => sum + segmentOutputDuration(segment), 0)
  addAudioOverlayFilters(filters, inputs, duration)
  return { graph: filters.join(';'), videoLabel, audioLabel: 'aout' }
}

function addFocusZoomFilters(filters: string[], request: ExportRequest): string {
  const expression = focusZoomExpression(request)
  if (!expression) return 'basev'
  const { width, height, fps } = request.canvas
  filters.push(`[basev]zoompan=z='${expression.zoom}':x='${expression.x}':y='${expression.y}':d=1:s=${width}x${height}:fps=${fps}[camera]`)
  return 'camera'
}

function addSegmentFilters(filters: string[], request: ExportRequest): {
  videoSegments: string[]
  audioSegments: string[]
} {
  const videoSegments: string[] = []
  const audioSegments: string[] = []
  request.segments.forEach((segment, index) => addSegmentFilter(filters, request, segment, index, videoSegments, audioSegments))
  return { videoSegments, audioSegments }
}

function addSegmentFilter(filters: string[], request: ExportRequest, segment: SourceSegment, index: number, videoSegments: string[], audioSegments: string[]): void {
    const { inputIndex, source } = exportSegmentSource(request, segment)
    const playbackRate = segmentPlaybackRate(segment)
    const segmentDuration = segmentOutputDuration(segment)
    const { fps } = request.canvas
    const scaleAndCrop = exportScaleAndCrop(request)
    if (segment.kind === 'freeze') {
      filters.push(`[${inputIndex}:v:0]trim=start=${seconds(segment.sourceTime)},setpts=PTS-STARTPTS,select='eq(n,0)',tpad=stop_mode=clone:stop_duration=${seconds(segment.duration)},trim=duration=${seconds(segment.duration)},${scaleAndCrop},setsar=1,fps=${fps},settb=AVTB,format=yuv420p[vseg${index}]`)
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000:d=${seconds(segment.duration)}[aseg${index}]`)
      videoSegments.push(`[vseg${index}]`)
      audioSegments.push(`[aseg${index}]`)
      return
    }
    filters.push(
      `[${inputIndex}:v:0]trim=start=${seconds(segment.sourceStart)}:end=${seconds(segment.sourceEnd)},` +
      `setpts=(PTS-STARTPTS)/${playbackRate},${scaleAndCrop},setsar=1,fps=${fps},settb=AVTB,format=yuv420p[vseg${index}]`
    )
    videoSegments.push(`[vseg${index}]`)
    if (source.hasAudio) {
      filters.push(
        `[${inputIndex}:a:0]atrim=start=${seconds(segment.sourceStart)}:end=${seconds(segment.sourceEnd)},` +
        `asetpts=PTS-STARTPTS,${audioTempoFilter(playbackRate)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aseg${index}]`
      )
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000:d=${seconds(segmentDuration)}[aseg${index}]`)
    }
    audioSegments.push(`[aseg${index}]`)
}

function exportSegmentSource(request: ExportRequest, segment: SourceSegment): { inputIndex: number; source: ExportRequest['sources'][number]['metadata'] } {
  const inputIndex = request.sources.findIndex((source) => source.id === segment.sourceId)
  const source = request.sources[inputIndex]?.metadata
  if (inputIndex < 0 || !source) throw new Error('A timeline video source is missing')
  return { inputIndex, source }
}

function exportScaleAndCrop(request: ExportRequest): string {
  const { width, height, fit } = request.canvas
  return fit === 'cover'
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
}

function addBaseFilters(
  filters: string[],
  videoSegments: string[],
  audioSegments: string[],
  request: ExportRequest
): void {
  addVideoBaseFilters(filters, videoSegments, request)
  if (request.segments.length === 1) {
    filters.push(`${audioSegments[0]}anull[basea]`)
  } else {
    filters.push(`${audioSegments.join('')}concat=n=${request.segments.length}:v=0:a=1[basea]`)
  }
}

function addVideoBaseFilters(
  filters: string[],
  videoSegments: string[],
  request: ExportRequest
): void {
  let currentLabel = required(videoSegments[0], 'The timeline is empty')
  const firstSegment = required(request.segments[0], 'The timeline is empty')
  let outputDuration = segmentOutputDuration(firstSegment)

  for (let index = 1; index < request.segments.length; index += 1) {
    const segment = required(request.segments[index], 'A timeline video segment is missing')
    const nextLabel = required(videoSegments[index], 'A timeline video segment is missing')
    const joinedLabel = `[vjoin${index}]`
    if (segment.kind !== 'freeze' && segment.transition) {
      const heldLabel = `[vhold${index}]`
      filters.push(
        `${currentLabel}tpad=stop_mode=clone:stop_duration=${seconds(segment.transition.duration)}${heldLabel}`,
        `${heldLabel}${nextLabel}xfade=transition=${segment.transition.effect}:` +
        `duration=${seconds(segment.transition.duration)}:offset=${seconds(outputDuration)}${joinedLabel}`
      )
    } else {
      filters.push(`${currentLabel}${nextLabel}concat=n=2:v=1:a=0${joinedLabel}`)
    }
    currentLabel = joinedLabel
    outputDuration += segmentOutputDuration(segment)
  }
  filters.push(`${currentLabel}null[basev]`)
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
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
    return addTextOverlayFilters(filters, overlay, index, order, inputLabel, request.canvas)
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

function addVisualFilters(filters: string[], inputs: PreparedInput[], request: ExportRequest, inputLabel = 'basev'): string {
  let videoLabel = inputLabel
  const visualInputs = inputs
    .filter(({ overlay }) => overlay.type !== 'audio')
    .sort((left, right) => left.overlay.zIndex - right.overlay.zIndex)
  visualInputs.forEach(({ overlay, index }, order) => {
    if (overlay.type === 'audio') return
    videoLabel = visualFilter(filters, overlay, index, order, videoLabel, request)
  })
  return videoLabel
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
  const duration = request.segments.reduce((sum, segment) => sum + segmentOutputDuration(segment), 0)
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
  await encodeVideo(request, directory, output, duration, jobId)
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('cancelled')
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

function encoderGraph(encoder: Encoder, softwareGraph: string, videoLabel: string): string {
  return encoder.filterSuffix
    ? `${softwareGraph};[${videoLabel}]${encoder.filterSuffix}`
    : softwareGraph
}

function canRetryEncoding(error: unknown, index: number, count: number): boolean {
  return !isCancellation(error) && index < count - 1
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
  const encoders = await exportEncoders()
  for (const [index, encoder] of encoders.entries()) {
    const graph = encoderGraph(encoder, filter.graph, filter.videoLabel)
    try {
      await jobs.run(
        encoder.executable, encoderArgs(encoder, inputArgs, filter, graph, duration, output),
        'export', duration, request.outputPath, jobId
      )
      return
    } catch (error) {
      if (!canRetryEncoding(error, index, encoders.length)) throw error
      // The probe cannot predict every real filter graph or driver failure.
      await rm(output, { force: true })
    }
  }
}

function encoderArgs(
  encoder: Encoder,
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
