export function ffmpegProgress(line: string, duration: number): number | null {
  const [key, value] = line.split('=', 2)
  if (key !== 'out_time_us' && key !== 'out_time_ms') return null
  if (!value || duration <= 0) return null
  const timestamp = Number(value)
  // FFmpeg reports out_time_us=N/A before some encoders have produced a frame.
  // Ignore that status instead of allowing NaN into the renderer's progress UI.
  if (!Number.isFinite(timestamp)) return null
  return Math.max(0, Math.min(0.99, timestamp / 1_000_000 / duration))
}
