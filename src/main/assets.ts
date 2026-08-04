import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { AssetItem } from '../types'
import { bundledMemePath } from './binaries'

const categories = ['video', 'audio', 'image', 'gif'] as const
type AssetCategory = (typeof categories)[number]

const extensions: Record<AssetCategory, Set<string>> = {
  video: new Set(['.mp4', '.mov', '.mkv', '.webm']),
  audio: new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']),
  image: new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']),
  gif: new Set(['.gif'])
}

export function categoryFor(path: string): AssetCategory | null {
  const extension = extname(path).toLowerCase()
  return categories.find((category) => extensions[category].has(extension)) ?? null
}

export function displayName(path: string): string {
  return basename(path, extname(path))
    .replace(/^\d+[\s._-]*/, '')
    .replaceAll(/[-_]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

async function collectFiles(directory: string, depth = 0): Promise<string[]> {
  if (depth > 3) return []
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const results = await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return collectFiles(path, depth + 1)
      return entry.isFile() ? [path] : []
    }))
    return results.flat()
  } catch {
    return []
  }
}

export async function scanAssets(): Promise<AssetItem[]> {
  const assets: AssetItem[] = []
  for (const path of await collectFiles(bundledMemePath())) {
    const type = categoryFor(path)
    if (!type) continue
    const id = createHash('sha1').update(path).digest('hex')
    assets.push({ id, type, name: displayName(path), path, source: 'bundled' })
  }
  return assets.sort((left, right) => left.name.localeCompare(right.name))
}
