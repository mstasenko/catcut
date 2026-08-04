import { expect, test, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { click, dismissHardwareWarningIfNeeded, e2eEnvironment, ffmpeg, main, wheel } from './support'
const applications: ElectronApplication[] = []
const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function launch(input: string, output?: string): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [main, input],
    env: e2eEnvironment(output ? { CATCUT_E2E_OUTPUT: output } : {})
  })
  applications.push(app)
  await dismissHardwareWarningIfNeeded(await app.firstWindow())
  return app
}

test.afterEach(async () => {
  for (const app of applications.splice(0)) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function makeVideo(directory: string): string {
  const input = join(directory, 'black.mp4')
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=black:size=320x180:rate=24:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input
  ])
  return input
}

async function seek(window: import('@playwright/test').Page, fraction: number): Promise<void> {
  const timeline = window.locator('.timeline')
  const box = await timeline.boundingBox()
  if (!box) throw new Error('Timeline is not visible')
  await click(timeline, { position: { x: box.width * fraction, y: box.height / 2 } })
}

test('plays from the point selected on the timeline', async () => {
  const directory = temporaryDirectory('catcut-seek-')
  const input = makeVideo(directory)
  const app = await launch(input)
  const window = await app.firstWindow()
  const preview = window.locator('.preview-stage > video')
  await expect.poll(() => preview.evaluate((video) => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await seek(window, 0.5)
  await click(window.getByRole('button', { name: 'Cut point', exact: true }))
  await click(window.getByRole('button', { name: 'Play', exact: true }))
  await expect.poll(() => preview.evaluate((video) => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(3)
})

test('moves five seconds with arrow keys while paused or playing', async () => {
  const directory = temporaryDirectory('catcut-arrows-')
  const input = makeVideo(directory)
  const app = await launch(input)
  const window = await app.firstWindow()
  const preview = window.locator('.preview-stage > video')
  await expect.poll(() => preview.evaluate((video) => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1)
  await seek(window, 0)
  await window.keyboard.press('ArrowRight')
  await expect.poll(() => preview.evaluate((video) => (video as HTMLVideoElement).currentTime)).toBeCloseTo(5, 0)
  await click(window.getByRole('button', { name: 'Play', exact: true }))
  await window.keyboard.press('ArrowLeft')
  await expect(window.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect.poll(() => preview.evaluate((video) => (video as HTMLVideoElement).currentTime)).toBeLessThan(2)
})

test('keeps timeline and zoom controls on the transport row', async () => {
  const directory = temporaryDirectory('catcut-zoom-')
  const input = makeVideo(directory)
  const app = await launch(input)
  const window = await app.firstWindow()
  const timeline = window.locator('.timeline')
  const transport = window.locator('.transport')
  await expect(transport.getByText('Timeline', { exact: true })).toBeVisible()
  await expect(window.locator('.timeline-toolbar')).toHaveCount(0)
  expect(await transport.locator(':scope > *').evaluateAll((elements) => elements.map((element) => (
    element.getAttribute('aria-label') ?? element.textContent.trim()
  )))).toEqual(['Play', 'Cut point', 'Cut', 'Undo', 'Redo', 'Timeline', '00:00.00 / 00:06.00', 'Zoom out', 'Zoom in'])
  const playBox = await window.getByRole('button', { name: 'Play', exact: true }).boundingBox()
  const cutPointBox = await window.getByRole('button', { name: 'Cut point', exact: true }).boundingBox()
  expect(playBox?.width ?? 0).toBeGreaterThan(cutPointBox?.width ?? 0)
  await click(window.getByRole('button', { name: 'Zoom in' }))
  await expect.poll(() => timeline.evaluate((element) => (element as HTMLElement).style.width)).toBe('125%')
  await wheel(window, window.locator('.timeline-scroll'), -100)
  await expect.poll(() => timeline.evaluate((element) => (element as HTMLElement).style.width)).toBe('150%')
  await click(window.getByRole('button', { name: 'Zoom out' }))
  await expect.poll(() => timeline.evaluate((element) => (element as HTMLElement).style.width)).toBe('125%')
})

test('highlights and cuts the chosen side of one cut point without a popup', async () => {
  const directory = temporaryDirectory('catcut-one-point-')
  const input = makeVideo(directory)
  const app = await launch(input)
  const window = await app.firstWindow()
  await seek(window, 0.4)
  await click(window.getByRole('button', { name: 'Cut point', exact: true }))
  const selection = window.locator('.timeline-selection')
  await expect(selection).toBeVisible()
  await click(window.getByRole('button', { name: 'Undo', exact: true }))
  await expect(selection).toHaveCount(0)
  await click(window.getByRole('button', { name: 'Redo', exact: true }))
  await expect(selection).toBeVisible()
  await expect.poll(() => selection.evaluate((element) => parseFloat((element as HTMLElement).style.left))).toBe(0)
  await seek(window, 0.6)
  await expect.poll(() => selection.evaluate((element) => parseFloat((element as HTMLElement).style.left))).toBeCloseTo(40, 1)
  await seek(window, 0.2)
  await expect.poll(() => selection.evaluate((element) => parseFloat((element as HTMLElement).style.left))).toBe(0)
  await expect(window.getByRole('dialog')).toHaveCount(0)
  await click(window.getByRole('button', { name: 'Cut', exact: true }))
  await expect(selection).toHaveCount(0)
  await expect(window.getByRole('button', { name: 'Cut point', exact: true })).toBeVisible()
})

test('supports more than two cut points and selects the partition at the playhead', async () => {
  const directory = temporaryDirectory('catcut-two-points-')
  const input = makeVideo(directory)
  const app = await launch(input)
  const window = await app.firstWindow()
  await seek(window, 0.25)
  await click(window.getByRole('button', { name: 'Cut point', exact: true }))
  await seek(window, 0.5)
  await click(window.getByRole('button', { name: 'Cut point', exact: true }))
  await seek(window, 0.75)
  await click(window.getByRole('button', { name: 'Cut point', exact: true }))
  await expect(window.locator('.selection-point')).toHaveCount(3)
  await expect(window.getByRole('button', { name: 'Cut point', exact: true })).toHaveText('Cut point')
  await seek(window, 0.625)
  const selection = window.locator('.timeline-selection')
  await expect.poll(() => selection.evaluate((element) => ({
    left: parseFloat((element as HTMLElement).style.left),
    width: parseFloat((element as HTMLElement).style.width)
  }))).toEqual({ left: 50, width: 25 })
  await seek(window, 0.9)
  await expect.poll(() => selection.evaluate((element) => ({
    left: parseFloat((element as HTMLElement).style.left),
    width: parseFloat((element as HTMLElement).style.width)
  }))).toEqual({ left: 75, width: 25 })
})

test('keeps the preview healthy after repeated editing operations', async () => {
  const directory = temporaryDirectory('catcut-edit-')
  const input = makeVideo(directory)
  const app = await launch(input)
  const window = await app.firstWindow()
  const preview = window.locator('.preview-stage > video')
  await expect.poll(() => preview.evaluate((video) => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await seek(window, 0.2)
  await click(window.getByRole('button', { name: 'Cut point', exact: true }))
  await seek(window, 0.7)
  await click(window.getByRole('button', { name: 'Cut point', exact: true }))
  await expect(window.locator('.timeline-selection')).toBeVisible()
  await click(window.getByRole('button', { name: 'Cut', exact: true }))
  await click(window.getByRole('button', { name: 'Text', exact: true }))
  await click(window.getByRole('button', { name: 'Undo', exact: true }))
  await click(window.getByRole('button', { name: 'Redo', exact: true }))
  await click(window.getByRole('button', { name: 'Play', exact: true }))
  await expect(window.locator('.preview-error')).toBeHidden()
  await expect.poll(() => preview.evaluate((video) => (video as HTMLVideoElement).error?.code ?? 0)).toBe(0)
  await expect.poll(() => window.locator('.waveform path').evaluateAll((paths) => (
    paths.length > 0 && paths.every((path) => (path.getAttribute('d') ?? '').length > 0)
  ))).toBe(true)
})

test('renders added text into the exported video', async () => {
  const directory = temporaryDirectory('catcut-text-')
  const input = makeVideo(directory)
  const output = join(directory, 'output.mp4')
  const app = await launch(input, output)
  const window = await app.firstWindow()
  await expect(window.getByText('black.mp4', { exact: true })).toBeVisible()
  await click(window.getByRole('button', { name: 'Text', exact: true }))
  const textBox = window.getByRole('textbox', { name: 'Text' })
  await expect(textBox).toBeFocused()
  await textBox.fill('VISIBLE TEXT')
  await window.evaluate(() => {
    const root = document.documentElement
    root.dataset.sawNan = 'false'
    new MutationObserver(() => {
      if (document.body.innerText.includes('NaN')) root.dataset.sawNan = 'true'
    }).observe(document.body, { childList: true, characterData: true, subtree: true })
  })
  await click(window.getByRole('button', { name: 'Export video' }))
  const exportDialog = window.getByRole('dialog', { name: 'Exporting video' })
  await expect(exportDialog).toBeVisible()
  await expect(exportDialog.getByRole('progressbar')).toBeVisible()
  await expect(exportDialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Export video' })).toBeEnabled({ timeout: 30_000 })
  await expect(exportDialog).toBeHidden()
  expect(await window.evaluate(() => document.documentElement.dataset.sawNan)).toBe('false')
  const frame = execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', output,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ])
  expect(frame.some((value) => value > 100)).toBe(true)
})

test('blocks editing and removes partial output when export is cancelled', async () => {
  const directory = temporaryDirectory('catcut-cancel-')
  const input = join(directory, 'long.mp4')
  const output = join(directory, 'cancelled.mp4')
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input
  ])
  const app = await launch(input, output)
  const window = await app.firstWindow()
  await expect(window.getByText('long.mp4', { exact: true })).toBeVisible()
  await click(window.getByRole('button', { name: 'Text', exact: true }))
  await click(window.getByRole('button', { name: 'Export video' }))
  const dialog = window.getByRole('dialog', { name: 'Exporting video' })
  await expect(dialog).toBeVisible()
  const cancel = dialog.getByRole('button', { name: 'Cancel' })
  await expect(cancel).toBeEnabled({ timeout: 10_000 })
  await click(cancel)
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  expect(existsSync(output)).toBe(false)
  await expect(window.getByText('CatCut could not export this video. Check the destination and try again.')).toHaveCount(0)
})
