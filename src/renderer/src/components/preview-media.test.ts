import { describe, expect, it } from 'vitest'
import { overlayNeedsResync, overlaySyncTolerances, previewMediaVolume } from './preview-media'

describe('preview media', () => {
  it('keeps browser volume in its valid range while export gain may exceed one', () => {
    expect(previewMediaVolume(2)).toBe(1)
    expect(previewMediaVolume(0.5)).toBe(0.5)
    expect(previewMediaVolume(-1)).toBe(0)
    expect(previewMediaVolume(Number.NaN)).toBe(1)
  })

  it('corrects overlay drift before short effects become visibly late', () => {
    expect(overlaySyncTolerances.audio).toBe(0.04)
    expect(overlayNeedsResync(1, 1.039, 'audio')).toBe(false)
    expect(overlayNeedsResync(1, 1.041, 'audio')).toBe(true)
    expect(overlayNeedsResync(1, 1.061, 'video-audio')).toBe(true)
    expect(overlayNeedsResync(1, 1.16, 'visual')).toBe(false)
  })
})
