import type { EditSession, Overlay, SavedSession, SavedSessionSnapshot } from '@shared/types'
import type { EditorState } from './editor-state'
import { clamp } from './timeline'

export function cloneSession(session: EditSession): EditSession {
  return structuredClone(session)
}

export function mutation(
  state: EditorState,
  update: (session: EditSession) => EditSession
): Partial<EditorState> {
  if (!state.session) return {}
  // Model edits are pure, so only the snapshot retained for Undo needs cloning.
  const previous = cloneSession(state.session)
  const next = update(state.session)
  if (JSON.stringify(next) === JSON.stringify(previous)) return {}
  next.dirty = true
  return {
    session: next,
    history: [...state.history.slice(-49), previous],
    future: []
  }
}

export function normalizeOverlay(overlay: Overlay): Overlay {
  if (overlay.type === 'audio') return overlay
  const opacity = Number.isFinite(overlay.opacity) ? clamp(overlay.opacity, 0, 1) : 1
  return { ...overlay, opacity }
}

export function patchedOverlaySession(
  session: EditSession,
  id: string,
  patch: Partial<Overlay>
): EditSession {
  const overlays = session.overlays.map((overlay) =>
    overlay.id === id ? normalizeOverlay({ ...overlay, ...patch } as Overlay) : overlay
  )
  return JSON.stringify(overlays) === JSON.stringify(session.overlays)
    ? session
    : { ...session, dirty: true, overlays }
}

function savedSnapshot(session: EditSession): SavedSessionSnapshot {
  return {
    canvas: session.canvas,
    sources: session.sources.map(({ id, metadata }) => ({ id, metadata })),
    segments: session.segments,
    overlays: session.overlays.map(normalizeOverlay),
    selectedOverlayId: session.selectedOverlayId,
    playhead: session.playhead,
    cutPoints: session.cutPoints,
    dirty: session.dirty,
    focusZooms: session.focusZooms
  }
}

export function savedSession(
  session: EditSession,
  history: EditSession[] = [],
  future: EditSession[] = []
): SavedSession {
  return {
    ...savedSnapshot(session),
    history: history.slice(-50).map(savedSnapshot),
    future: future.slice(0, 50).map(savedSnapshot)
  }
}

async function restoredSession(
  saved: SavedSessionSnapshot,
  pathUrl: (path: string) => Promise<string>
): Promise<EditSession> {
  const sources = await Promise.all(saved.sources.map(async (source) => ({
    ...source,
    playbackPath: await pathUrl(source.metadata.path),
    waveform: []
  })))
  return { ...saved, sources, focusZooms: saved.focusZooms ?? [] }
}

export async function restoredEditorState(saved: SavedSession): Promise<{
  session: EditSession
  history: EditSession[]
  future: EditSession[]
}> {
  const urls = new Map<string, Promise<string>>()
  const pathUrl = (path: string): Promise<string> => {
    const existing = urls.get(path)
    if (existing) return existing
    const pending = window.replaycat.getPathUrl(path)
    urls.set(path, pending)
    return pending
  }
  const [session, history, future] = await Promise.all([
    restoredSession(saved, pathUrl),
    Promise.all((saved.history ?? []).map((snapshot) => restoredSession(snapshot, pathUrl))),
    Promise.all((saved.future ?? []).map((snapshot) => restoredSession(snapshot, pathUrl)))
  ])
  return { session, history, future }
}
