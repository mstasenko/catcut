import type { ChildProcessByStdio } from 'node:child_process'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { Readable } from 'node:stream'
import type { JobKind, JobProgress } from '../types'
import { ffmpegProgress } from './progress'

interface ActiveJob {
  child: ChildProcessByStdio<null, Readable, Readable>
  kind: JobKind
  cancelled: boolean
}

interface JobContext {
  id: string
  kind: JobKind
  duration: number
  outputPath?: string
}

function broadcast(progress: JobProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('job:progress', progress)
  }
}

function consumeProgress(buffer: string, chunk: string, context: JobContext): string {
  const lines = `${buffer}${chunk}`.split(/\r?\n/)
  const remainder = lines.pop() ?? ''
  for (const line of lines) {
    const progress = ffmpegProgress(line, context.duration)
    if (progress === null) continue
    broadcast({
      id: context.id,
      kind: context.kind,
      state: 'running',
      progress,
      message: `${Math.round(progress * 100)}%`,
      outputPath: context.outputPath
    })
  }
  return remainder
}

function failureDetail(code: number | null, stderr: string): string {
  return stderr.trim().split('\n').slice(-8).join('\n') || `Exited with code ${code}`
}

function cancelled(job: ActiveJob, signal: NodeJS.Signals | null): boolean {
  return job.cancelled || signal === 'SIGINT' || signal === 'SIGKILL'
}

export class JobManager {
  private readonly active = new Map<string, ActiveJob>()

  cancel(id: string): boolean {
    const job = this.active.get(id)
    if (!job) return false
    job.cancelled = true
    job.child.kill('SIGINT')
    const timer = setTimeout(() => {
      if (this.active.get(id) === job) job.child.kill('SIGKILL')
    }, 3_000)
    timer.unref()
    return true
  }

  async run(
    executable: string,
    args: string[],
    kind: JobKind,
    duration: number,
    outputPath?: string,
    forcedId?: string
  ): Promise<{ id: string; stderr: string }> {
    const id = forcedId ?? randomUUID()
    broadcast({ id, kind, state: 'queued', progress: 0, message: 'Queued', outputPath })

    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const job: ActiveJob = { child, kind, cancelled: false }
      this.active.set(id, job)
      let stderr = ''
      let stdoutBuffer = ''
      const context = { id, kind, duration, outputPath }

      broadcast({ id, kind, state: 'running', progress: 0, message: 'Starting', outputPath })

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer = consumeProgress(stdoutBuffer, chunk, context)
      })

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-64_000)
      })

      child.on('error', (error) => {
        this.active.delete(id)
        broadcast({
          id,
          kind,
          state: 'failed',
          progress: 0,
          message: 'Could not start media processor',
          outputPath,
          error: error.message
        })
        reject(error)
      })

      child.on('close', (code, signal) => {
        this.active.delete(id)
        if (cancelled(job, signal)) {
          const error = new Error('Job cancelled')
          broadcast({ id, kind, state: 'cancelled', progress: 0, message: 'Cancelled', outputPath })
          reject(error)
          return
        }
        if (code !== 0) {
          const detail = failureDetail(code, stderr)
          broadcast({
            id,
            kind,
            state: 'failed',
            progress: 0,
            message: 'Media processing failed',
            outputPath,
            error: detail
          })
          reject(new Error(detail))
          return
        }
        broadcast({ id, kind, state: 'completed', progress: 1, message: 'Complete', outputPath })
        resolve({ id, stderr })
      })
    })
  }
}

export const jobs = new JobManager()
