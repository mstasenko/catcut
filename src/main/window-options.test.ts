import { describe, expect, it } from 'vitest'
import { initialWindowSize } from './window-options'

describe('initial window options', () => {
  it('keeps the normal window large and uses valid compact test dimensions', () => {
    expect(initialWindowSize(false)).toEqual({ width: 1500, height: 940 })
    expect(initialWindowSize(true)).toEqual({ width: 1100, height: 720 })
  })
})
