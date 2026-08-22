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
    expect(parseMediaMetadata({ ...metadata, size: 8 * 1024 * 1024 * 1024 }).size).toBe(8 * 1024 * 1024 * 1024)
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

  it('validates focus zooms and genuine freeze segments', () => {
    const request = {
      canvas: { width: 320, height: 180, fps: 24, fit: 'contain' },
      sources: [{ id: 'source', metadata }], outputPath: '/edited.mp4', overlays: [],
      segments: [{ kind: 'freeze', id: 'freeze', sourceId: 'source', sourceTime: 1, duration: 1, replayGroupId: 'replay-safe_1' }],
      focusZooms: [{ id: 'zoom', start: 0, duration: 1, zoom: 1.5, focusX: 0.75, focusY: 0.25 }]
    }
    expect(parseExportRequest(request)).toEqual(request)
    for (const zoom of [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(parseExportRequest({ ...request, focusZooms: [{ ...request.focusZooms[0], zoom }] }).focusZooms?.[0]?.zoom).toBe(zoom)
    }
    expect(() => parseExportRequest({ ...request, segments: [{ ...request.segments[0], duration: 3 }] })).toThrow('Freeze duration')
    expect(() => parseExportRequest({ ...request, segments: [{ ...request.segments[0], sourceTime: 4 }] })).toThrow('Freeze source time')
    expect(() => parseExportRequest({ ...request, focusZooms: [{ ...request.focusZooms[0], zoom: 1.25 }] })).toThrow('amount')
    expect(() => parseExportRequest({ ...request, focusZooms: [{ ...request.focusZooms[0], focusX: -1 }] })).toThrow('Focus x')
    expect(() => parseExportRequest({ ...request, focusZooms: [request.focusZooms[0], { ...request.focusZooms[0], id: 'overlap' }] })).toThrow('overlap')
    expect(() => parseExportRequest({ ...request, segments: [{ ...request.segments[0], replayGroupId: 'bad replay!' }] })).toThrow('Replay group ID')
  })

  it('validates text presets and prepared local bitmap geometry', () => {
    const text = {
      id: 'text', type: 'text', name: 'Title', start: 0, duration: 2, zIndex: 1,
      x: 0.1, y: 0.1, width: 0.8, height: 0.2, opacity: 1, text: 'Hello',
      fontFamily: 'Anton', fontSize: 7, color: '#fff', outlineColor: '#000',
      outlineWidth: 2, shadow: false, align: 'center', animation: 'pop',
      renderedTextBitmap: { dataUrl: 'data:image/png;base64,AA==', x: 20, y: 10, width: 200, height: 60, anchorX: 160, anchorY: 36 }
    }
    const request = {
      canvas: { width: 320, height: 180, fps: 24, fit: 'contain' },
      sources: [{ id: 'source', metadata }], outputPath: '/edited.mp4',
      segments: [{ id: 'segment', sourceId: 'source', sourceStart: 0, sourceEnd: 3 }], overlays: [text]
    }
    for (const animation of ['none', 'pop', 'fade', 'bounce', 'shake']) {
      expect(parseExportRequest({ ...request, overlays: [{ ...text, animation }] }).overlays[0]).toMatchObject({ animation })
    }
    expect(() => parseExportRequest({ ...request, overlays: [{ ...text, animation: 'spin' }] })).toThrow('Text animation')
    expect(() => parseExportRequest({ ...request, overlays: [{ ...text, renderedTextBitmap: { ...text.renderedTextBitmap, anchorX: 999 } }] })).toThrow('anchor x')
    expect(() => parseExportRequest({ ...request, overlays: [{ ...text, renderedTextBitmap: { ...text.renderedTextBitmap, dataUrl: 'bad' } }] })).toThrow('PNG')
  })

  it('validates optional fades, game sound levels, and boosted volume', () => {
    const overlay = {
      id: 'audio', type: 'audio', name: 'Boom', path: '/boom.wav', start: 0,
      duration: 1, zIndex: 1, volume: 2, sourceIn: 0, sourceDuration: 1,
      fadeIn: 0.25, fadeOut: 1, duckGameAudio: true, gameAudioLevel: 0.3
    }
    const request = {
      canvas: { width: 320, height: 180, fps: 24, fit: 'contain' },
      sources: [{ id: 'source', metadata }], outputPath: '/edited.mp4',
      segments: [{ id: 'segment', sourceId: 'source', sourceStart: 0, sourceEnd: 3 }],
      overlays: [overlay]
    }
    expect(parseExportRequest(request).overlays[0]).toEqual(overlay)
    for (const fade of [0, 0.1, 0.25, 0.5, 1]) {
      expect(() => parseExportRequest({ ...request, overlays: [{ ...overlay, fadeIn: fade }] })).not.toThrow()
    }
    for (const level of [0.5, 0.3, 0.15]) {
      expect(() => parseExportRequest({ ...request, overlays: [{ ...overlay, gameAudioLevel: level }] })).not.toThrow()
    }
    expect(() => parseExportRequest({ ...request, overlays: [{ ...overlay, fadeOut: 0.2 }] })).toThrow('Fade out')
    expect(() => parseExportRequest({ ...request, overlays: [{ ...overlay, gameAudioLevel: 0.2 }] })).toThrow('Game audio level')
    expect(() => parseExportRequest({ ...request, overlays: [{ ...overlay, duckGameAudio: 'yes' }] })).toThrow('Lower game sound')
    const silentVideo = {
      id: 'silent', type: 'video', name: 'Silent', path: '/silent.mp4', start: 0, duration: 1,
      zIndex: 2, x: 0, y: 0, width: 1, height: 1, opacity: 1, loop: false,
      audioEnabled: true, hasAudio: false, volume: 1, sourceIn: 0, sourceDuration: 1
    }
    expect(() => parseExportRequest({ ...request, overlays: [silentVideo] })).toThrow('no audio stream')
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
