import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDesktopEntry, installDesktopIntegration } from './desktop'

describe('AppImage desktop integration', () => {
  it('quotes executable paths and declares video file support', () => {
    const entry = createDesktopEntry('/home/sap/ReplayCat/ReplayCat.AppImage')
    expect(entry).toContain('Name=ReplayCat')
    expect(entry).toContain('Exec="/home/sap/ReplayCat/ReplayCat.AppImage" %F')
    expect(entry).toContain('Icon=replaycat')
    expect(entry).toContain('video/mp4')
  })

  it('installs the user desktop file and icon', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replaycat-desktop-'))
    const resourcesPath = join(root, 'bundle')
    const dataHome = join(root, 'data')
    await mkdir(join(resourcesPath, 'resources'), { recursive: true })
    await writeFile(join(resourcesPath, 'resources', 'replaycat-icon.png'), 'icon')
    await installDesktopIntegration({ appImagePath: '/apps/ReplayCat.AppImage', resourcesPath, dataHome })
    expect(await readFile(join(dataHome, 'applications', 'replaycat.desktop'), 'utf8')).toContain('/apps/ReplayCat.AppImage')
    expect(await readFile(join(dataHome, 'icons', 'hicolor', '512x512', 'apps', 'replaycat.png'), 'utf8')).toBe('icon')
  })
})
