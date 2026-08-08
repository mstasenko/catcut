import { describe, expect, it, vi } from 'vitest'

vi.mock('./binaries', () => ({ ffmpegPath: () => '/bundled/ffmpeg' }))

import { rankRenderDevices, softwareEncoder } from './export-encoder'

describe('export encoder', () => {
  it('uses the fast high-quality all-core fallback', () => {
    const encoder = softwareEncoder()
    expect(encoder.executable).toBe('/bundled/ffmpeg')
    expect(encoder.output).toContain('veryfast')
    expect(encoder.output).toContain('16')
    expect(encoder.output.slice(encoder.output.indexOf('-threads'))).toEqual(expect.arrayContaining(['0']))
    expect(encoder.hardware).toBe(false)
  })

  it('prefers Intel VAAPI while retaining every usable render node', () => {
    expect(rankRenderDevices([
      { path: '/dev/dri/renderD129', vendor: '0x1002\n' },
      { path: '/dev/dri/renderD130', vendor: '0x8086\n' },
      { path: '/dev/dri/renderD128', vendor: '0x10de\n' }
    ]).map((device) => device.path)).toEqual([
      '/dev/dri/renderD130',
      '/dev/dri/renderD128',
      '/dev/dri/renderD129'
    ])
  })
})
