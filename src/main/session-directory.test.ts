import { describe, expect, it } from 'vitest'
import { SessionDirectory } from './session-directory'

describe('session file directory', () => {
  it('starts in Videos and remembers locations only in memory', () => {
    const recent = new SessionDirectory('/home/sap/Videos')
    expect(recent.defaultPath('video.mp4')).toBe('/home/sap/Videos/video.mp4')
    recent.remember('/home/sap/Videos/source.mp4')
    expect(recent.defaultPath()).toBe('/home/sap/Videos')
    recent.remember('/media/library', true)
    expect(recent.defaultPath()).toBe('/media/library')
  })

  it('does not restore a previous application session', () => {
    const previous = new SessionDirectory('/downloads')
    previous.remember('/videos/old.mp4')
    expect(new SessionDirectory('/downloads').defaultPath()).toBe('/downloads')
  })

  it('keeps Open, Export, and New locations independent', () => {
    const open = new SessionDirectory('/videos')
    const exportDirectory = new SessionDirectory('/videos')
    const media = new SessionDirectory('/downloads')
    open.remember('/videos/source.mp4')
    expect(open.defaultPath()).toBe('/videos')
    expect(exportDirectory.defaultPath('output.mp4')).toBe('/videos/output.mp4')
    expect(media.defaultPath()).toBe('/downloads')
  })
})
