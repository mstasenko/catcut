import { describe, expect, it } from 'vitest'
import { ffmpegProgress } from './progress'

describe('FFmpeg progress parser', () => {
  it('accepts numeric microsecond timestamps and bounds progress', () => {
    expect(ffmpegProgress('out_time_us=5000000', 10)).toBe(0.5)
    expect(ffmpegProgress('out_time_ms=-1', 10)).toBe(0)
    expect(ffmpegProgress('out_time_us=20000000', 10)).toBe(0.99)
  })

  it('ignores startup placeholders and unrelated or unusable values', () => {
    expect(ffmpegProgress('out_time_us=N/A', 10)).toBeNull()
    expect(ffmpegProgress('progress=continue', 10)).toBeNull()
    expect(ffmpegProgress('out_time_us=', 10)).toBeNull()
    expect(ffmpegProgress('out_time_us=1', 0)).toBeNull()
  })
})
