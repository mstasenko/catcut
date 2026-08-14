import { describe, expect, it } from 'vitest'
import { parseDefaultName, parseExportRequest, parseMediaMetadata, parseSavedSession } from './validation'

const metadata = {
  path: '/video.mp4', name: 'video.mp4', size: 10, modifiedAt: 100, duration: 3,
  width: 320, height: 180, fps: 24, videoCodec: 'h264', audioCodec: 'aac',
  hasAudio: true, rotation: 0, pixelFormat: 'yuv420p'
}

describe('IPC input validation', () => {
  it('accepts bounded media metadata and rejects invalid values', () => {
    expect(parseMediaMetadata(metadata)).toEqual(metadata)
    expect(() => parseMediaMetadata({ ...metadata, duration: Number.NaN })).toThrow('duration')
    expect(() => parseMediaMetadata({ ...metadata, width: -1 })).toThrow('width')
  })

  it('validates the complete export structure', () => {
    const request = {
      canvas: { width: metadata.width, height: metadata.height, fps: metadata.fps, fit: 'contain' },
      sources: [{ id: 'source', metadata }],
      outputPath: '/edited.mp4',
      segments: [
        { id: 'first', sourceId: 'source', sourceStart: 0, sourceEnd: 1 },
        {
          id: 'segment', sourceId: 'source', sourceStart: 1, sourceEnd: 3,
          transition: { effect: 'dissolve', duration: 0.65 }
        }
      ],
      overlays: [{
        id: 'audio', type: 'audio', name: 'Effect', path: '/effect.wav',
        start: 1, duration: 1, zIndex: 1, volume: 1, sourceIn: 0.5, sourceDuration: 2
      }]
    }
    expect(parseExportRequest(request)).toEqual(request)
    expect(() => parseExportRequest({ ...request, segments: [{ id: 'bad', sourceId: 'source', sourceStart: 2, sourceEnd: 1 }] })).toThrow('positive')
    expect(() => parseExportRequest({
      ...request,
      segments: [request.segments[0], { ...request.segments[1], transition: { effect: 'spin', duration: 1 } }]
    })).toThrow('Transition effect')
    expect(() => parseExportRequest({
      ...request,
      segments: [request.segments[0], { ...request.segments[1], transition: { effect: 'fade', duration: 4 } }]
    })).toThrow('Transition duration')
    expect(() => parseExportRequest({
      ...request,
      segments: [{ ...request.segments[0], transition: { effect: 'fade', duration: 0.5 } }]
    })).toThrow('first timeline segment')
    expect(() => parseExportRequest({
      ...request,
      overlays: [{ ...request.overlays[0], volume: 5 }]
    })).toThrow('volume')
  })

  it('rejects invalid canvases and segment source references', () => {
    const request = {
      canvas: { width: 1080, height: 1920, fps: 24, fit: 'cover' },
      sources: [{ id: 'source', metadata }],
      outputPath: '/edited.mp4',
      segments: [{ id: 'segment', sourceId: 'missing', sourceStart: 0, sourceEnd: 1 }],
      overlays: []
    }
    expect(() => parseExportRequest(request)).toThrow('unknown video source')
    expect(() => parseExportRequest({ ...request, canvas: { ...request.canvas, fit: 'stretch' } })).toThrow('Canvas fit')
    expect(() => parseExportRequest({
      ...request,
      sources: [{ id: 'source', metadata }, { id: 'source', metadata }]
    })).toThrow('unique')
  })

  it('validates restorable editor state', () => {
    const saved = {
      canvas: { width: 320, height: 180, fps: 24, fit: 'contain' },
      sources: [{ id: 'source', metadata }],
      segments: [
        { id: 'first', sourceId: 'source', sourceStart: 0, sourceEnd: 1 },
        {
          id: 'segment', sourceId: 'source', sourceStart: 1, sourceEnd: 3,
          transition: { effect: 'circleopen', duration: 0.5 }
        }
      ],
      overlays: [], selectedOverlayId: null, playhead: 1, cutPoints: [1, 2], dirty: true
    }
    expect(parseSavedSession(saved)).toEqual(saved)
    const savedWithHistory = {
      ...saved,
      history: [{ ...saved, playhead: 0, cutPoints: [], dirty: false }],
      future: [{ ...saved, playhead: 2 }]
    }
    expect(parseSavedSession(savedWithHistory)).toEqual(savedWithHistory)
    expect(() => parseSavedSession({ ...saved, history: Array(51).fill(saved) })).toThrow('Undo history')
    expect(() => parseSavedSession({ ...saved, playhead: 4 })).toThrow('Playhead')
    expect(() => parseSavedSession({ ...saved, cutPoints: 'bad' })).toThrow('Cut points')
  })

  it('allows only plain MP4 export names', () => {
    expect(parseDefaultName('holiday-edited.mp4')).toBe('holiday-edited.mp4')
    expect(() => parseDefaultName('../escape.mp4')).toThrow('MP4 filename')
    expect(() => parseDefaultName('video.mkv')).toThrow('MP4 filename')
  })
})
