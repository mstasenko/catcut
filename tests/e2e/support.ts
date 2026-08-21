import { expect, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

export const projectRoot = resolve(import.meta.dirname, '../..')
export const ffmpeg = join(projectRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg')
export const ffprobe = join(projectRoot, 'node_modules', 'ffprobe-static', 'bin', 'linux', 'x64', 'ffprobe')
export const main = join(projectRoot, 'out', 'main', 'index.js')

export function syntheticVideo(directory: string, black = false): string {
  const path = join(directory, black ? 'black.mp4' : 'game.mp4')
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', black
      ? 'color=c=black:size=320x180:rate=24:duration=6'
      : 'testsrc2=size=320x180:rate=24:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path
  ])
  return path
}

export function mediaDuration(path: string): number {
  const result = JSON.parse(execFileSync(ffprobe, [
    '-v', 'error', '-show_format', '-of', 'json', path
  ], { encoding: 'utf8' })) as { format: { duration: string } }
  return Number(result.format.duration)
}

export function videoFrame(path: string, time: number, crop?: string): Buffer {
  const filters = crop ? ['-vf', `crop=${crop}`] : []
  return execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', path,
    ...filters, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ])
}

export function meanPixelDifference(left: Buffer, right: Buffer): number {
  let sum = 0
  for (let index = 0; index < left.length; index += 1) {
    sum += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
  }
  return sum / Math.max(1, left.length)
}

export async function seekTimeline(page: Page, fraction: number): Promise<void> {
  const timeline = page.locator('.timeline')
  const box = await timeline.boundingBox()
  if (!box) throw new Error('Timeline is not visible')
  await click(timeline, { position: { x: box.width * fraction, y: box.height / 2 } })
}

type ClickOptions = NonNullable<Parameters<Locator['click']>[0]>
type HoverOptions = NonNullable<Parameters<Locator['hover']>[0]>

export async function click(locator: Locator, options: ClickOptions = {}): Promise<void> {
  await locator.waitFor({ state: 'visible' })
  await expect(locator).toBeEnabled()
  // Ubuntu's headless GNOME does not always send the two frame callbacks that
  // Playwright's stability check expects. Local tests retain the full check.
  if (process.env.CI && !options.position) {
    await locator.evaluate((element) => (element as HTMLElement).click())
    return
  }
  await locator.click({ ...options, force: process.env.CI ? true : options.force })
}

export async function hover(locator: Locator, options: HoverOptions = {}): Promise<void> {
  await locator.waitFor({ state: 'visible' })
  await locator.hover({ ...options, force: process.env.CI ? true : options.force })
}

export async function scroll(page: Page, locator: Locator, deltaY: number): Promise<void> {
  await locator.waitFor({ state: 'visible' })
  if (process.env.CI) {
    await locator.evaluate((element, delta) => { element.scrollTop += delta }, deltaY)
    return
  }
  await hover(locator)
  await page.mouse.wheel(0, deltaY)
}

export async function wheel(page: Page, locator: Locator, deltaY: number): Promise<void> {
  await locator.waitFor({ state: 'visible' })
  if (process.env.CI) {
    await locator.dispatchEvent('wheel', { deltaY })
    return
  }
  await hover(locator)
  await page.mouse.wheel(0, deltaY)
}

export function e2eEnvironment(overrides: NodeJS.ProcessEnv = {}): Record<string, string> {
  const environment = {
    ...process.env,
    XDG_SESSION_TYPE: 'wayland',
    ...overrides
  }
  return Object.fromEntries(Object.entries(environment))
}

export async function dismissHardwareWarning(page: Page): Promise<void> {
  const button = page.getByRole('alertdialog', { name: 'Hardware acceleration is unavailable' })
    .getByRole('button', { name: 'Continue' })
  // Headless Weston can keep Electron's focused button in Playwright's "unstable"
  // pointer state indefinitely. Invoking the visible button still exercises the
  // real React handler without weakening actionability checks elsewhere.
  await button.evaluate((element) => (element as HTMLButtonElement).click())
}

export async function dismissHardwareWarningIfNeeded(page: Page): Promise<void> {
  // Command-line video loading and diagnostics start concurrently. Wait for the
  // app's result, then respond to the modal it actually rendered; querying Chromium
  // again can yield a different transient GPU status.
  await page.locator('.app[data-initialized="true"]').waitFor()
  const warning = page.getByRole('alertdialog', { name: 'Hardware acceleration is unavailable' })
  if (await warning.isVisible()) await dismissHardwareWarning(page)
}
