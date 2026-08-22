import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadSessionFile, resetSessionFile, saveSessionFile } from './session-state'

const directories: string[] = []

async function statePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'replaycat-state-test-'))
  directories.push(directory)
  return join(directory, 'nested', 'editor-state.json')
}

const metadata = {
  path: '/video.mp4', name: 'video.mp4', size: 10, modifiedAt: 100, duration: 3,
  width: 320, height: 180, fps: 24, videoCodec: 'h264', audioCodec: 'aac',
  hasAudio: true, rotation: 0, pixelFormat: 'yuv420p'
}
const session = {
  canvas: { width: 320, height: 180, fps: 24, fit: 'contain' },
  sources: [{ id: 'source', metadata }],
  segments: [
    { id: 'first', sourceId: 'source', sourceStart: 0, sourceEnd: 1 },
    {
      id: 'segment', sourceId: 'source', sourceStart: 1, sourceEnd: 3,
      transition: { effect: 'wipeleft', duration: 0.5 }
    }
  ],
  overlays: [], selectedOverlayId: null, playhead: 1, cutPoints: [1], dirty: true
}
const persistedSession = {
  ...session,
  history: [{ ...session, playhead: 0, cutPoints: [], dirty: false }],
  future: [{ ...session, playhead: 2, cutPoints: [1, 2] }]
}

afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('saved editor state', () => {
  it('atomically saves, loads, and resets a valid session', async () => {
    const path = await statePath()
    await saveSessionFile(path, persistedSession)
    expect(await loadSessionFile(path)).toEqual(persistedSession)
    await resetSessionFile(path)
    expect(await loadSessionFile(path)).toBeNull()
  })

  it('ignores missing, malformed, and invalid state', async () => {
    const path = await statePath()
    expect(await loadSessionFile(path)).toBeNull()
    await saveSessionFile(path, persistedSession)
    await writeFile(path, '{')
    expect(await loadSessionFile(path)).toBeNull()
    await expect(saveSessionFile(path, { ...persistedSession, playhead: 99 })).rejects.toThrow('Playhead')
  })
})
