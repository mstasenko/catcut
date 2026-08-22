import { describe, expect, it, vi } from 'vitest'

vi.mock('./binaries', () => ({ ffmpegPath: () => '/bundled/ffmpeg' }))

import { hardwareFfmpegCandidates, rankRenderDevices, softwareEncoder, vaapiProbeArgs } from './export-encoder'

describe('export encoder', () => {
  it('uses the fast high-quality all-core fallback', () => {
    const encoder = softwareEncoder()
    expect(encoder.executable).toBe('/bundled/ffmpeg')
    expect(encoder.output).toContain('veryfast')
    expect(encoder.output).toContain('16')
    expect(encoder.output.slice(encoder.output.indexOf('-threads'))).toEqual(expect.arrayContaining(['0']))
    expect(encoder.hardware).toBe(false)
  })

  it('probes the bundled encoder before system FFmpeg', () => {
    expect(hardwareFfmpegCandidates()).toEqual([
      '/bundled/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'
    ])
  })

  it('probes VAAPI at an AV1-safe video resolution', () => {
    const args = vaapiProbeArgs('/dev/dri/renderD128', 'av1_vaapi')
    expect(args).toContain('color=size=1280x720:duration=0.04')
    expect(args).toEqual(expect.arrayContaining(['-frames:v', '1']))
  })

  it('prefers an Intel discrete GPU, then its iGPU, while retaining every render node', () => {
    expect(rankRenderDevices([
      { path: '/dev/dri/renderD129', vendor: '0x1002\n' },
      { path: '/dev/dri/renderD130', vendor: '0x8086\n', pciSlot: '0000:00:02.0' },
      { path: '/dev/dri/renderD131', vendor: '0x8086\n', pciSlot: '0000:03:00.0' },
      { path: '/dev/dri/renderD128', vendor: '0x10de\n' }
    ]).map((device) => device.path)).toEqual([
      '/dev/dri/renderD131',
      '/dev/dri/renderD130',
      '/dev/dri/renderD128',
      '/dev/dri/renderD129'
    ])
  })
})
