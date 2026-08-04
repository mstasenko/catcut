import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp'), isPackaged: false } }))
vi.mock('./binaries', () => ({ ffmpegPath: () => '/ffmpeg', ffprobePath: () => '/ffprobe' }))
vi.mock('./jobs', () => ({ jobs: { run: vi.fn() } }))

let peaksFromPcm: typeof import('./media').peaksFromPcm

beforeAll(async () => {
  ;({ peaksFromPcm } = await import('./media'))
})

describe('media waveform extraction', () => {
  it('aggregates and normalizes PCM samples into display peaks', () => {
    const samples = [0, 0.25, -0.5, 1]
    const buffer = Buffer.alloc(samples.length * 4)
    samples.forEach((sample, index) => buffer.writeFloatLE(sample, index * 4))
    expect(peaksFromPcm(buffer, 2)).toEqual([0.25, 1])
  })

  it('returns no invented peaks for empty audio', () => {
    expect(peaksFromPcm(Buffer.alloc(0))).toEqual([])
  })
})
