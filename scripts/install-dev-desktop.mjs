import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
const applicationsDirectory = join(dataHome, 'applications')
const desktopPath = join(applicationsDirectory, 'catcut.desktop')
const iconPath = join(projectRoot, 'src', 'catcut-icon.png')

await mkdir(applicationsDirectory, { recursive: true })
await writeFile(desktopPath, `[Desktop Entry]
Type=Application
Name=CatCut
Comment=Fast, focused video editing
Icon=${iconPath}
Exec=/usr/bin/false
Terminal=false
NoDisplay=true
Categories=AudioVideo;Video;
StartupWMClass=catcut
`, { mode: 0o644 })
