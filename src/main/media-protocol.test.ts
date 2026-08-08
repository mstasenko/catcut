import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { byteRange, decodeMediaUrl, mediaResponse, mediaUrl } from './media-protocol'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('media streaming protocol', () => {
  it('round-trips paths containing spaces and unicode', () => {
    const path = '/home/sap/Videos/cat clip ★.mp4'
    expect(decodeMediaUrl(mediaUrl(path))).toBe(path)
  })

  it('parses bounded, open, and suffix byte ranges', () => {
    expect(byteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(byteRange('bytes=5-', 10)).toEqual({ start: 5, end: 9 })
    expect(byteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(byteRange('invalid', 10)).toBeNull()
  })

  it('streams only the requested bytes with a partial-content response', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'catcut-range-'))
    directories.push(directory)
    const path = join(directory, 'video.mp4')
    await writeFile(path, Buffer.from('0123456789'))
    const response = await mediaResponse(new Request(mediaUrl(path), {
      headers: { range: 'bytes=3-6' }
    }), (candidate) => candidate === path)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 3-6/10')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('3456')
  })

  it('rejects paths that were not selected in this session', async () => {
    const response = await mediaResponse(new Request(mediaUrl('/private/video.mp4')), () => false)
    expect(response.status).toBe(403)
  })

  it('serves authorized media only through read-only HTTP methods', async () => {
    const path = '/selected/video.mp4'
    const response = await mediaResponse(new Request(mediaUrl(path), { method: 'POST' }), () => true)
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })
})
