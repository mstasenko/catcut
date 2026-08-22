import { StrictMode, act, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreviewAudioMixer } from './usePreviewAudioMixer'

class MockNode {
  constructor(readonly context: MockAudioContext) {}
  connect = vi.fn((target: MockNode) => {
    if (target.context !== this.context) throw new Error('Nodes belong to different contexts')
  })
  disconnect = vi.fn()
}

function parameter(): AudioParam {
  return {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn()
  } as unknown as AudioParam
}

class MockAudioContext {
  static instances: MockAudioContext[] = []
  state: AudioContextState = 'suspended'
  currentTime = 0
  destination = new MockNode(this)
  createMediaElementSource = vi.fn(() => new MockNode(this))
  createGain = vi.fn(() => Object.assign(new MockNode(this), { gain: parameter() }))
  createDynamicsCompressor = vi.fn(() => Object.assign(new MockNode(this), {
    threshold: parameter(), knee: parameter(), ratio: parameter(),
    attack: parameter(), release: parameter()
  }))
  resume = vi.fn(() => { this.state = 'running'; return Promise.resolve() })
  close = vi.fn(() => { this.state = 'closed'; return Promise.resolve() })

  constructor() { MockAudioContext.instances.push(this) }
}

function MixerHarness(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const mixer = usePreviewAudioMixer()
  useEffect(() => {
    const video = videoRef.current
    return video ? mixer.register(video) : undefined
  }, [mixer])
  return <video ref={videoRef} />
}

beforeEach(() => {
  vi.useFakeTimers()
  MockAudioContext.instances = []
  vi.stubGlobal('AudioContext', MockAudioContext)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('preview audio mixer', () => {
  it('keeps one media context through the development Strict Mode effect replay', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => { root.render(<StrictMode><MixerHarness /></StrictMode>) })
    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockAudioContext.instances[0]?.createMediaElementSource).toHaveBeenCalledTimes(1)
    act(() => { root.unmount() })
    await vi.runAllTimersAsync()
    expect(MockAudioContext.instances[0]?.close).toHaveBeenCalledTimes(1)
  })
})
