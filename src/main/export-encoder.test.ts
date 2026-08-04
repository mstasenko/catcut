import { describe, expect, it, vi } from 'vitest'

vi.mock('./binaries', () => ({ ffmpegPath: () => '/bundled/ffmpeg' }))

import { softwareEncoder } from './export-encoder'

describe('export encoder', () => {
  it('uses the fast high-quality all-core fallback', () => {
    const encoder = softwareEncoder()
    expect(encoder.executable).toBe('/bundled/ffmpeg')
    expect(encoder.output).toContain('veryfast')
    expect(encoder.output).toContain('16')
    expect(encoder.output.slice(encoder.output.indexOf('-threads'))).toEqual(expect.arrayContaining(['0']))
  })
})
