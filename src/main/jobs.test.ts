import { beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send } }]
  }
}))

import { JobManager } from './jobs'

beforeEach(() => send.mockClear())

describe('media job progress', () => {
  it('ignores FFmpeg N/A timestamps before reporting numeric progress', async () => {
    const script = "process.stdout.write('out_time_us=N/A\\nout_time_us=5000000\\n')"
    await new JobManager().run(process.execPath, ['-e', script], 'export', 10)

    const updates = send.mock.calls.map((call) => call[1] as { progress: number; message: string })
    expect(updates.map(({ message }) => message)).toEqual(['Queued', 'Starting', '50%', 'Complete'])
    expect(updates.every(({ progress }) => Number.isFinite(progress))).toBe(true)
  })
})
