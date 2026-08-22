import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp'), isPackaged: false } }))
vi.mock('./binaries', () => ({ ffmpegPath: () => '/ffmpeg', ffprobePath: () => '/ffprobe' }))
vi.mock('./jobs', () => ({ jobs: { run: vi.fn() } }))

let peaksFromPcm: typeof import('./media').peaksFromPcm
let displayDimensions: typeof import('./media').displayDimensions
let pruneProxyCache: typeof import('./media').pruneProxyCache
let proxyCacheKey: typeof import('./media').proxyCacheKey
let firstPositiveNumber: typeof import('./media').firstPositiveNumber
let firstFrameRate: typeof import('./media').firstFrameRate
let proxyVideoFilter: typeof import('./media').proxyVideoFilter
const directories: string[] = []

beforeAll(async () => {
  ;({
    peaksFromPcm, displayDimensions, pruneProxyCache, proxyCacheKey,
    firstPositiveNumber, firstFrameRate, proxyVideoFilter
  } = await import('./media'))
})

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
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

  it('uses display dimensions for rotated phone video', () => {
    expect(displayDimensions(1920, 1080, 90)).toEqual({ width: 1080, height: 1920, rotation: 90 })
    expect(displayDimensions(1920, 1080, -90)).toEqual({ width: 1080, height: 1920, rotation: 270 })
    expect(displayDimensions(1920, 1080, 180)).toEqual({ width: 1920, height: 1080, rotation: 180 })
  })

  it('bounds proxy storage while preserving the newly generated proxy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'replaycat-proxies-'))
    directories.push(directory)
    const oldProxy = join(directory, 'old.mp4')
    const newestProxy = join(directory, 'new.mp4')
    await writeFile(oldProxy, Buffer.alloc(20))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await writeFile(newestProxy, Buffer.alloc(20))
    await pruneProxyCache(directory, 20, newestProxy)
    expect(await readdir(directory)).toEqual(['new.mp4'])
  })

  it('invalidates a proxy when the source file modification time changes', () => {
    const metadata = {
      path: '/video.mp4', name: 'video.mp4', size: 100, modifiedAt: 1, duration: 10,
      width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac',
      hasAudio: true, rotation: 0, pixelFormat: 'yuv420p'
    }
    expect(proxyCacheKey(metadata)).not.toBe(proxyCacheKey({ ...metadata, modifiedAt: 2 }))
  })

  it('skips unusable probe candidates and bounds portrait proxies', () => {
    expect(firstPositiveNumber('N/A', '12.5')).toBe(12.5)
    expect(firstPositiveNumber(null, 1234)).toBe(1234)
    expect(firstFrameRate('0/0', '60/1')).toBe(60)
    expect(proxyVideoFilter()).toBe('scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2')
  })
})
