import { expect, test, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { click, dismissHardwareWarningIfNeeded, e2eEnvironment, ffmpeg, ffprobe, hover, main, wheel } from './support'
const applications: ElectronApplication[] = []
const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function launch(
  input: string,
  output?: string,
  overrides: NodeJS.ProcessEnv = {}
): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [main, input],
    env: e2eEnvironment({ ...(output ? { CATCUT_E2E_OUTPUT: output } : {}), ...overrides })
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

function probe(path: string): { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number }[] } {
  const result: unknown = JSON.parse(execFileSync(ffprobe, [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path
  ], { encoding: 'utf8' }))
  return result as { format: { duration: string }; streams: { codec_type: string; width?: number; height?: number }[] }
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

test('shows the source frame under the timeline pointer', async () => {
  const directory = temporaryDirectory('catcut-hover-preview-')
  const input = makeVideo(directory)
  const app = await launch(input)
  const window = await app.firstWindow()
  const timeline = window.locator('.timeline')
  const box = await timeline.boundingBox()
  if (!box) throw new Error('Timeline is not visible')

  await hover(timeline, { position: { x: box.width / 2, y: 20 } })
  const preview = window.locator('.timeline-hover-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('00:03.00')
  await expect.poll(() => preview.locator('video').evaluate((video) => (video as HTMLVideoElement).currentTime))
    .toBeGreaterThan(2.5)

  await hover(window.locator('.transport'))
  await expect(preview).toBeHidden()
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
  await click(window.getByRole('button', { name: 'Export', exact: true }))
  const exportDialog = window.getByRole('dialog', { name: 'Exporting video' })
  await expect(exportDialog).toBeVisible()
  await expect(exportDialog.getByRole('progressbar')).toBeVisible()
  await expect(exportDialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Export', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect(exportDialog).toBeHidden()
  expect(await window.evaluate(() => document.documentElement.dataset.sawNan)).toBe('false')
  const frame = execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', output,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ])
  expect(frame.some((value) => value > 100)).toBe(true)
})

test('renders SVG library images into the exported video', async () => {
  const directory = temporaryDirectory('catcut-svg-')
  const input = makeVideo(directory)
  const output = join(directory, 'output.mp4')
  const app = await launch(input, output)
  const window = await app.firstWindow()
  await expect(window.getByText('black.mp4', { exact: true })).toBeVisible()
  await click(window.getByRole('button', { name: 'Images', exact: true }))
  await click(window.getByRole('button', { name: 'Awesome Face', exact: true }))
  await click(window.getByRole('button', { name: 'Export', exact: true }))
  await expect(window.getByRole('dialog', { name: 'Exporting video' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Export', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect.poll(() => existsSync(output), { timeout: 30_000 }).toBe(true)
  const frame = execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', output,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ])
  expect(frame.some((value) => value > 150)).toBe(true)
})

test('exports WebM video audio together with an OGG effect', async () => {
  const directory = temporaryDirectory('catcut-media-export-')
  const input = makeVideo(directory)
  const output = join(directory, 'output.mp4')
  const app = await launch(input, output)
  const window = await app.firstWindow()
  await click(window.getByRole('button', { name: 'Videos', exact: true }))
  await click(window.getByRole('button', { name: 'Scary Maze Reaction', exact: true }))
  // Native checkbox actionability is flaky in the headless GNOME runner; use
  // the suite's CI-safe click helper, just like the other controls here.
  await click(window.getByRole('checkbox', { name: 'Include audio' }))
  await click(window.getByRole('button', { name: '← Back' }))
  await click(window.getByRole('button', { name: '← Back' }))
  await click(window.getByRole('button', { name: 'Audio', exact: true }))
  await click(window.getByRole('button', { name: 'Wilhelm Scream', exact: true }))
  await click(window.getByRole('button', { name: 'Export', exact: true }))
  await expect(window.getByRole('dialog', { name: 'Exporting video' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Export', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect.poll(() => existsSync(output), { timeout: 30_000 }).toBe(true)
  expect(() => execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', output,
    '-map', '0:v:0', '-map', '0:a:0', '-t', '0.2', '-f', 'null', '-'
  ])).not.toThrow()
})

test('prepares, previews, and exports an external GIF', async () => {
  const directory = temporaryDirectory('catcut-gif-')
  const input = makeVideo(directory)
  const gif = join(directory, 'animated.gif')
  const output = join(directory, 'output.mp4')
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10:duration=1', gif
  ])
  const app = await launch(input, output, { CATCUT_E2E_MEDIA: gif })
  const window = await app.firstWindow()
  await click(window.getByRole('button', { name: 'New', exact: true }))
  await expect(window.getByRole('button', { name: 'animated', exact: true })).toBeVisible({ timeout: 15_000 })
  const gifPreview = window.locator('.visual-overlay video')
  await expect.poll(() => gifPreview.evaluate((video) => (video as HTMLVideoElement).readyState), {
    timeout: 15_000
  }).toBeGreaterThan(0)
  await click(window.getByRole('button', { name: 'Export', exact: true }))
  await expect(window.getByRole('dialog', { name: 'Exporting video' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Export', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect.poll(() => existsSync(output), { timeout: 30_000 }).toBe(true)
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
  await click(window.getByRole('button', { name: 'Export', exact: true }))
  const dialog = window.getByRole('dialog', { name: 'Exporting video' })
  await expect(dialog).toBeVisible()
  const cancel = dialog.getByRole('button', { name: 'Cancel' })
  await expect(cancel).toBeEnabled({ timeout: 10_000 })
  await click(cancel)
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  expect(existsSync(output)).toBe(false)
  await expect(window.getByText('CatCut could not export this video. Check the destination and try again.')).toHaveCount(0)
})

test('ripple-inserts and exports a second main-timeline video', async () => {
  test.setTimeout(60_000)
  const directory = temporaryDirectory('catcut-insert-')
  const first = join(directory, 'first.mp4')
  const second = join(directory, 'second.mp4')
  const output = join(directory, 'combined.mp4')
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', first
  ])
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=red:size=180x320:rate=30:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', second
  ])
  const app = await launch(first, output, { CATCUT_E2E_VIDEO: second })
  const window = await app.firstWindow()
  await click(window.locator('.timeline'), { position: { x: 300, y: 20 } })
  await click(window.getByRole('button', { name: 'Video', exact: true }))
  await window.getByLabel('Into inserted video').selectOption('dissolve')
  await window.getByLabel('Back to timeline').selectOption('circleopen')
  await window.getByLabel('Transition duration').selectOption('1')
  await click(window.getByRole('button', { name: 'Select video', exact: true }))
  await expect(window.locator('.source-segment')).toHaveCount(3)
  await expect(window.locator('.source-segment').nth(1)).toHaveAttribute('data-transition', 'dissolve')
  await expect(window.locator('.source-segment').nth(2)).toHaveAttribute('data-transition', 'circleopen')
  await expect(window.locator('.source-segment').nth(1)).toHaveAttribute('title', /second\.mp4/)
  await expect(window.locator('.preview-source-video[data-transition="dissolve"]')).toBeVisible()
  await expect(window.getByRole('region', { name: 'Video preview' }).getByLabel('Outgoing transition frame')).toBeVisible()

  const timeline = window.locator('.timeline')
  const timelineBox = await timeline.boundingBox()
  const playheadLeft = await window.locator('.playhead').evaluate((element) => parseFloat((element as HTMLElement).style.left))
  if (!timelineBox) throw new Error('Timeline is not visible')
  await hover(timeline, { position: { x: timelineBox.width * (playheadLeft + 3) / 100, y: 20 } })
  const hoverFrame = window.locator('.timeline-hover-frame')
  await expect(hoverFrame.locator('video')).toHaveCount(2)
  await expect(hoverFrame.locator('video[data-transition="dissolve"]')).toBeVisible()
  await hover(window.locator('.transport'))

  const transitionedVideo = window.locator('.preview-source-video:not(.preview-transition-previous)')
  await click(window.getByRole('button', { name: 'Play', exact: true }))
  const renderedOpacities = new Set<string>()
  await expect.poll(async () => {
    renderedOpacities.add(await transitionedVideo.evaluate((video) => (video as HTMLVideoElement).style.opacity))
    return renderedOpacities.size
  }, { intervals: [20], timeout: 5_000 }).toBeGreaterThan(3)
  await click(window.getByRole('button', { name: 'Pause', exact: true }))
  await click(window.getByRole('button', { name: 'Export', exact: true }))
  await expect(window.getByRole('button', { name: 'Export', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect.poll(() => existsSync(output), { timeout: 30_000 }).toBe(true)
  const result = probe(output)
  expect(Number(result.format.duration)).toBeCloseTo(3, 1)
  expect(result.streams.find((stream) => stream.codec_type === 'video')).toMatchObject({ width: 320, height: 180 })
  expect(result.streams.some((stream) => stream.codec_type === 'audio')).toBe(true)
})

test('opens and exports a centered vertical Short project', async () => {
  const directory = temporaryDirectory('catcut-short-')
  const input = makeVideo(directory)
  const output = join(directory, 'short.mp4')
  const app = await launch(input, output, { CATCUT_E2E_VIDEO: input })
  const window = await app.firstWindow()
  await click(window.getByRole('button', { name: 'Open Short', exact: true }))
  await expect(window.locator('.preview-stage')).toHaveCSS('aspect-ratio', '1080 / 1920')
  await click(window.getByRole('button', { name: 'Export', exact: true }))
  await expect(window.getByRole('button', { name: 'Export', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect.poll(() => existsSync(output), { timeout: 30_000 }).toBe(true)
  expect(probe(output).streams.find((stream) => stream.codec_type === 'video')).toMatchObject({ width: 1080, height: 1920 })
})

test('shows the cropped Short frame and active meme overlay in the timeline preview', async () => {
  const directory = temporaryDirectory('catcut-short-hover-')
  const input = makeVideo(directory)
  const app = await launch(input, undefined, { CATCUT_E2E_VIDEO: input })
  const window = await app.firstWindow()
  await click(window.getByRole('button', { name: 'Open Short', exact: true }))
  await click(window.getByRole('button', { name: 'Images', exact: true }))
  const asset = window.locator('.visual-asset').first()
  await expect(asset).toBeVisible()
  await click(asset)

  const timeline = window.locator('.timeline')
  const box = await timeline.boundingBox()
  if (!box) throw new Error('Timeline is not visible')
  await hover(timeline, { position: { x: box.width * 0.1, y: 20 } })
  const preview = window.locator('.timeline-hover-preview')
  await expect(preview).toBeVisible()
  await expect(preview.locator('.timeline-hover-overlay')).toHaveCount(1)
  await expect(preview.locator('.timeline-hover-frame > video')).toHaveCSS('object-fit', 'cover')
  const frame = await preview.locator('.timeline-hover-frame').boundingBox()
  expect(frame).not.toBeNull()
  expect((frame?.width ?? 0) / (frame?.height ?? 1)).toBeCloseTo(9 / 16, 2)
})

test('restores normal-close state and Reset project forgets it', async () => {
  const directory = temporaryDirectory('catcut-restore-')
  const input = makeVideo(directory)
  const first = await launch(input)
  const firstWindow = await first.firstWindow()
  await click(firstWindow.getByRole('button', { name: 'Text', exact: true }))
  await firstWindow.getByRole('textbox', { name: 'Text' }).fill('RESTORED')
  await first.close()

  const restored = await electron.launch({ args: [main], env: e2eEnvironment() })
  applications.push(restored)
  const restoredWindow = await restored.firstWindow()
  await dismissHardwareWarningIfNeeded(restoredWindow)
  await expect(restoredWindow.getByRole('textbox', { name: 'Text' })).toHaveValue('RESTORED')
  await expect(restoredWindow.getByRole('button', { name: 'Undo' })).toBeEnabled()
  await click(restoredWindow.getByRole('button', { name: 'Undo' }))
  await expect(restoredWindow.getByRole('textbox', { name: 'Text' })).toHaveValue('Your text')
  await expect(restoredWindow.getByRole('button', { name: 'Redo' })).toBeEnabled()
  await click(restoredWindow.getByRole('button', { name: 'Redo' }))
  await expect(restoredWindow.getByRole('textbox', { name: 'Text' })).toHaveValue('RESTORED')
  expect(await restored.evaluate(({ Menu }) => {
    const project = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Project')
    return project?.submenu?.items.filter((item) => item.type !== 'separator').map((item) => item.label)
  })).toEqual(['CatCut 0.2.2', 'Reset project'])
  await restoredWindow.evaluate(() => { window.confirm = () => true })
  await restored.evaluate(({ Menu }) => {
    const reset = Menu.getApplicationMenu()?.items
      .find((item) => item.label === 'Project')?.submenu?.items
      .find((item) => item.label === 'Reset project')
    if (!reset) throw new Error('Reset project menu item is missing')
    const activate = reset.click as () => void
    activate()
  })
  await expect(restoredWindow.getByRole('heading', { name: 'Drop a video' })).toBeVisible()
  await restored.close()

  const empty = await electron.launch({ args: [main], env: e2eEnvironment() })
  applications.push(empty)
  const emptyWindow = await empty.firstWindow()
  await dismissHardwareWarningIfNeeded(emptyWindow)
  await expect(emptyWindow.getByRole('heading', { name: 'Drop a video' })).toBeVisible()
})
