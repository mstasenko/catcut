import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplayCatApi } from './types'

const listeners = new Map<string, () => void>()
const send = vi.fn()
let exposedApi: ReplayCatApi
let exposedName = ''

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, api: ReplayCatApi) => {
    exposedName = name
    exposedApi = api
  } },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn((channel: string, listener: () => void) => listeners.set(channel, listener)),
    removeListener: vi.fn(),
    send
  },
  webUtils: { getPathForFile: vi.fn() }
}))

beforeAll(async () => { await import('./preload') })
beforeEach(() => send.mockClear())

describe('close-time session saving', () => {
  it('exposes the ReplayCat bridge name', () => {
    expect(exposedName).toBe('replaycat')
  })

  it('approves closing only after persistence succeeds', async () => {
    exposedApi.onSaveRequest(() => Promise.resolve())
    listeners.get('session:save-request')?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(send).toHaveBeenCalledWith('session:close-ready')
    expect(send).not.toHaveBeenCalledWith('session:close-failed', expect.anything())
  })

  it('does not approve closing when persistence fails', async () => {
    exposedApi.onSaveRequest(() => Promise.reject(new Error('disk full')))
    listeners.get('session:save-request')?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(send).not.toHaveBeenCalledWith('session:close-ready')
    expect(send).toHaveBeenCalledWith('session:close-failed', 'disk full')
  })
})
