import { describe, expect, it } from 'vitest'
import { waveformPath } from './waveform'

describe('audio waveform', () => {
  it('renders actual peaks for the retained source range', () => {
    const quiet = waveformPath([0, 0, 0, 0], 0, 2, 4)
    const loud = waveformPath([0, 0, 1, 1], 2, 4, 4)
    expect(quiet).toContain('20.00')
    expect(loud).toContain('3.00')
    expect(loud).toContain('37.00')
  })

  it('does not invent a waveform when audio data is unavailable', () => {
    expect(waveformPath([], 0, 1, 1)).toBe('')
  })
})
