import { describe, expect, it } from 'vitest'
import { parseDefaultName, parseExportRequest, parseMediaMetadata } from './validation'

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
      source: metadata,
      outputPath: '/edited.mp4',
      segments: [{ id: 'segment', sourceStart: 0, sourceEnd: 3 }],
      overlays: [{
        id: 'audio', type: 'audio', name: 'Effect', path: '/effect.wav',
        start: 1, duration: 1, zIndex: 1, volume: 1, sourceIn: 0.5, sourceDuration: 2
      }]
    }
    expect(parseExportRequest(request)).toEqual(request)
    expect(() => parseExportRequest({ ...request, segments: [{ id: 'bad', sourceStart: 2, sourceEnd: 1 }] })).toThrow('positive')
    expect(() => parseExportRequest({
      ...request,
      overlays: [{ ...request.overlays[0], volume: 5 }]
    })).toThrow('volume')
  })

  it('allows only plain MP4 export names', () => {
    expect(parseDefaultName('holiday-edited.mp4')).toBe('holiday-edited.mp4')
    expect(() => parseDefaultName('../escape.mp4')).toThrow('MP4 filename')
    expect(() => parseDefaultName('video.mkv')).toThrow('MP4 filename')
  })
})
