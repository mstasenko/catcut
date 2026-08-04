import { expect, type Locator, type Page } from '@playwright/test'
import { join, resolve } from 'node:path'

export const projectRoot = resolve(import.meta.dirname, '../..')
export const ffmpeg = join(projectRoot, 'node_modules', 'ffmpeg-static', 'ffmpeg')
export const main = join(projectRoot, 'out', 'main', 'index.js')

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
