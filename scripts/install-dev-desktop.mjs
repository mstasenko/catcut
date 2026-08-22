import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
const applicationsDirectory = join(dataHome, 'applications')
const iconsDirectory = join(dataHome, 'icons', 'hicolor', '512x512', 'apps')
const desktopPath = join(applicationsDirectory, 'replaycat.desktop')
const iconPath = join(projectRoot, 'src', 'replaycat-icon.png')

await Promise.all([
  mkdir(applicationsDirectory, { recursive: true }),
  mkdir(iconsDirectory, { recursive: true })
])
await copyFile(iconPath, join(iconsDirectory, 'replaycat.png'))
await writeFile(desktopPath, `[Desktop Entry]
Type=Application
Name=ReplayCat
Comment=Turn gameplay into highlights.
Icon=replaycat
Exec=/usr/bin/false
Terminal=false
NoDisplay=true
Categories=AudioVideo;Video;
StartupWMClass=replaycat
`, { mode: 0o644 })
