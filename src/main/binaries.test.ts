import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: vi.fn(() => '/tmp/app') } }))

import { sidecarMemePath } from './binaries'

describe('media sidecar location', () => {
  it('places the meme directory beside the AppImage', () => {
    expect(sidecarMemePath('/tmp/mounted/catcut', '/home/sap/Downloads/CatCut.AppImage'))
      .toBe('/home/sap/Downloads/meme')
  })
})
