import { basename } from 'node:path'
import type { ExportRequest, MediaMetadata, Overlay, SourceSegment } from '../types'

type UnknownRecord = Record<string, unknown>

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as UnknownRecord
}

function text(value: unknown, label: string, maximumLength = 4096): string {
  if (typeof value !== 'string' || !value || value.length > maximumLength) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function identifier(value: unknown, label: string): string {
  const id = text(value, label, 128)
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`${label} contains unsafe characters`)
  return id
}

function number(value: unknown, label: string, minimum = 0, maximum = 1e9): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside its allowed range`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false`)
  return value
}

function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${label} is not supported`)
  return value as T
}

export function parsePath(value: unknown): string {
  return text(value, 'Path')
}

export function parseJobId(value: unknown): string {
  return text(value, 'Job ID', 128)
}

export function parseDefaultName(value: unknown): string {
  const name = text(value, 'Export name', 255)
  if (basename(name) !== name || !name.toLowerCase().endsWith('.mp4')) {
    throw new Error('Export name must be an MP4 filename')
  }
  return name
}

export function parseMediaMetadata(value: unknown): MediaMetadata {
  const input = record(value, 'Media metadata')
  return {
    path: parsePath(input.path),
    name: text(input.name, 'Media name', 1024),
    size: number(input.size, 'Media size'),
    modifiedAt: number(input.modifiedAt, 'Modification time', 0, 1e14),
    duration: number(input.duration, 'Media duration', 0.001, 1e8),
    width: number(input.width, 'Media width', 1, 100_000),
    height: number(input.height, 'Media height', 1, 100_000),
    fps: number(input.fps, 'Frame rate', 0, 1000),
    videoCodec: text(input.videoCodec, 'Video codec', 128),
    audioCodec: input.audioCodec === null ? null : text(input.audioCodec, 'Audio codec', 128),
    hasAudio: boolean(input.hasAudio, 'Audio presence'),
    rotation: number(input.rotation, 'Rotation', -3600, 3600),
    pixelFormat: text(input.pixelFormat, 'Pixel format', 128)
  }
}

function parseSegment(value: unknown, sourceDuration: number): SourceSegment {
  const input = record(value, 'Timeline segment')
  const sourceStart = number(input.sourceStart, 'Segment start', 0, sourceDuration)
  const sourceEnd = number(input.sourceEnd, 'Segment end', 0, sourceDuration)
  if (sourceEnd <= sourceStart) throw new Error('Timeline segments must have positive duration')
  return { id: identifier(input.id, 'Segment ID'), sourceStart, sourceEnd }
}

function validateOverlayBase(input: UnknownRecord, timelineDuration: number): void {
  identifier(input.id, 'Overlay ID')
  text(input.name, 'Overlay name', 1024)
  number(input.start, 'Overlay start', 0, timelineDuration)
  number(input.duration, 'Overlay duration', 0.001, 1e8)
  number(input.zIndex, 'Overlay order', 0, 1e6)
}

function validateVisual(input: UnknownRecord): void {
  const x = number(input.x, 'Overlay x', 0, 1)
  const y = number(input.y, 'Overlay y', 0, 1)
  const width = number(input.width, 'Overlay width', 0.001, 1)
  const height = number(input.height, 'Overlay height', 0.001, 1)
  if (x + width > 1.001 || y + height > 1.001) throw new Error('Overlay geometry is outside the frame')
  number(input.opacity, 'Overlay opacity', 0, 1)
}

function validateTimedSource(input: UnknownRecord): void {
  number(input.sourceIn, 'Source start', 0, 1e8)
  number(input.sourceDuration, 'Source duration', 0.001, 1e8)
}

function validateTextOverlay(input: UnknownRecord): void {
  text(input.text, 'Text content', 100_000)
  text(input.fontFamily, 'Font family', 256)
  number(input.fontSize, 'Font size', 0.1, 1000)
  text(input.color, 'Text color', 64)
  text(input.outlineColor, 'Outline color', 64)
  number(input.outlineWidth, 'Outline width', 0, 100)
  boolean(input.shadow, 'Text shadow')
  oneOf(input.align, ['left', 'center', 'right'] as const, 'Text alignment')
  validateRenderedImage(input)
}

function validateRenderedImage(input: UnknownRecord): void {
  if (input.renderedImageDataUrl === undefined) return
  const rendered = text(input.renderedImageDataUrl, 'Rendered image', 128 * 1024 * 1024)
  if (!rendered.startsWith('data:image/png;base64,')) throw new Error('Rendered content must be a PNG image')
}

function validateImageOverlay(input: UnknownRecord): void {
  validateVisual(input)
  parsePath(input.path)
  boolean(input.loop, 'Image loop')
  validateRenderedImage(input)
}

function validateGifOverlay(input: UnknownRecord): void {
  validateVisual(input)
  parsePath(input.path)
  boolean(input.loop, 'Media loop')
  validateTimedSource(input)
}

function validateVideoOverlay(input: UnknownRecord): void {
  validateGifOverlay(input)
  boolean(input.audioEnabled, 'Video audio')
  boolean(input.hasAudio, 'Video audio stream')
  number(input.volume, 'Video volume', 0, 2)
}

function validateAudioOverlay(input: UnknownRecord): void {
  parsePath(input.path)
  validateTimedSource(input)
  number(input.volume, 'Audio volume', 0, 2)
}

function validateOverlay(value: unknown, timelineDuration: number): Overlay {
  const input = record(value, 'Overlay')
  const type = oneOf(input.type, ['text', 'image', 'gif', 'video', 'audio'] as const, 'Overlay type')
  validateOverlayBase(input, timelineDuration)
  switch (type) {
    case 'text':
      validateVisual(input)
      validateTextOverlay(input)
      break
    case 'image':
      validateImageOverlay(input)
      break
    case 'gif':
      validateGifOverlay(input)
      break
    case 'video':
      validateVideoOverlay(input)
      break
    case 'audio':
      validateAudioOverlay(input)
  }
  return value as Overlay
}

export function parseExportRequest(value: unknown): ExportRequest {
  const input = record(value, 'Export request')
  const source = parseMediaMetadata(input.source)
  if (!Array.isArray(input.segments) || input.segments.length > 10_000) {
    throw new Error('Timeline segments must be an array')
  }
  const segments = input.segments.map((segment) => parseSegment(segment, source.duration))
  const timelineDuration = segments.reduce((total, segment) => total + segment.sourceEnd - segment.sourceStart, 0)
  if (!Array.isArray(input.overlays) || input.overlays.length > 10_000) {
    throw new Error('Overlays must be an array')
  }
  const overlays = input.overlays.map((overlay) => validateOverlay(overlay, timelineDuration))
  return { source, outputPath: parsePath(input.outputPath), segments, overlays }
}
