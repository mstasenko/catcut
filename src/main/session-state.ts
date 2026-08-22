import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SavedSession } from '../types'
import { parseSavedSession } from './validation'

export async function loadSessionFile(path: string): Promise<SavedSession | null> {
  try {
    return parseSavedSession(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}

export async function saveSessionFile(path: string, value: unknown): Promise<void> {
  const session = parseSavedSession(value)
  const temporary = `${path}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporary, JSON.stringify(session))
  // Same-directory rename prevents a normal shutdown from leaving partial JSON.
  await rename(temporary, path)
}

export function resetSessionFile(path: string): Promise<void> {
  return rm(path, { force: true })
}
