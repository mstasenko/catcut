function sampledPeaks(peaks: number[], start: number, end: number, duration: number, count = 100): number[] {
  if (peaks.length === 0 || duration <= 0) return []
  const first = Math.floor(start / duration * peaks.length)
  const last = Math.max(first + 1, Math.ceil(end / duration * peaks.length))
  const output: number[] = []
  for (let index = 0; index < count; index += 1) {
    const from = first + Math.floor(index / count * (last - first))
    const to = first + Math.max(1, Math.ceil((index + 1) / count * (last - first)))
    output.push(Math.max(...peaks.slice(from, to), 0))
  }
  return output
}

export function waveformPath(peaks: number[], start: number, end: number, duration: number): string {
  const samples = sampledPeaks(peaks, start, end, duration)
  if (samples.length === 0) return ''
  const points = samples.map((peak, index) => [index / (samples.length - 1) * 100, peak * 17] as const)
  const upper = points.map(([x, peak]) => `${x.toFixed(2)},${(20 - peak).toFixed(2)}`)
  const lower = [...points].reverse().map(([x, peak]) => `${x.toFixed(2)},${(20 + peak).toFixed(2)}`)
  return `M${upper.join(' L')} L${lower.join(' L')} Z`
}
