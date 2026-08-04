import { create } from 'zustand'
import type {
  AssetItem,
  EditSession,
  GpuDiagnostics,
  JobProgress,
  Overlay,
  VideoOverlay
} from '@shared/types'
import {
  clamp,
  createSession,
  cutPointsAfterRemoval,
  defaultTextOverlay,
  makeId,
  deletionRange,
  removeOutputRange,
  timelineDuration
} from './timeline'

export interface EditorState {
  initialized: boolean
  session: EditSession | null
  history: EditSession[]
  future: EditSession[]
  assets: AssetItem[]
  gpu: GpuDiagnostics | null
  job: JobProgress | null
  busy: string | null
  error: string | null
  initialize: () => Promise<void>
  loadVideo: (path?: string) => Promise<void>
  setPlayhead: (time: number) => void
  setPlaybackPath: (path: string) => Promise<void>
  selectPoint: () => void
  clearSelection: () => void
  deleteSelection: () => void
  addText: () => void
  addAsset: (asset: AssetItem) => Promise<void>
  addExternalMedia: () => Promise<void>
  selectOverlay: (id: string | null) => void
  updateOverlay: (id: string, patch: Partial<Overlay>) => void
  removeSelectedOverlay: () => void
  undo: () => void
  redo: () => void
  setJob: (progress: JobProgress) => void
  showError: (message: string) => void
  clearError: () => void
  markExported: () => void
}

function cloneSession(session: EditSession): EditSession {
  return structuredClone(session)
}

function mutation(
  state: EditorState,
  update: (session: EditSession) => EditSession
): Partial<EditorState> {
  if (!state.session) return {}
  const previous = cloneSession(state.session)
  const next = update(cloneSession(state.session))
  next.dirty = true
  return {
    session: next,
    history: [...state.history.slice(-49), previous],
    future: []
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  initialized: false,
  session: null,
  history: [],
  future: [],
  assets: [],
  gpu: null,
  job: null,
  busy: null,
  error: null,

  async initialize() {
    try {
      const [gpu, assets] = await Promise.all([
        window.catcut.getGpuDiagnostics(),
        window.catcut.scanAssets()
      ])
      set({ gpu, assets, initialized: true })
    } catch {
      set({ initialized: true, error: 'CatCut could not finish starting. Close it and try again.' })
    }
  },

  async loadVideo(providedPath) {
    try {
      const path = providedPath ?? await window.catcut.openVideo()
      if (!path) return
      set({ busy: 'Opening video…', error: null })
      const metadata = await window.catcut.probe(path)
      const url = await window.catcut.getPathUrl(path)
      const session = createSession(metadata)
      session.playbackPath = url
      set({ session, history: [], future: [], busy: null })
      if (metadata.hasAudio) {
        void window.catcut.waveform(path).then((waveform) => {
          const current = get().session
          if (current?.source.path === path) set({ session: { ...current, waveform } })
        }).catch(() => undefined)
      }

      if (await window.catcut.shouldProxy(metadata)) {
        set({ busy: 'Preparing video for smooth playback…' })
        void window.catcut.createProxy(metadata).then(async ({ result }) => {
          const proxyUrl = await window.catcut.getPathUrl(result.path)
          const current = get().session
          if (current?.source.path === metadata.path) {
            set({ session: { ...current, playbackPath: proxyUrl }, busy: null })
          }
        }).catch(() => {
          set({ busy: null, error: 'Playback preparation failed. The video will still open, but playback may be slower.' })
        })
      }
    } catch {
      set({ busy: null, error: 'CatCut could not open this video. Try another file.' })
    }
  },

  setPlayhead(time) {
    set((state) => {
      if (!state.session) return state
      const duration = timelineDuration(state.session.segments)
      return { session: { ...state.session, playhead: clamp(time, 0, duration) } }
    })
  },

  async setPlaybackPath(path) {
    const url = await window.catcut.getPathUrl(path)
    set((state) => state.session ? { session: { ...state.session, playbackPath: url } } : state)
  },

  selectPoint() {
    set((state) => {
      if (!state.session) return state
      const duration = timelineDuration(state.session.segments)
      const point = state.session.playhead
      const duplicate = state.session.cutPoints.some((existing) => Math.abs(existing - point) <= 0.0001)
      if (duplicate || point <= 0.0001 || point >= duration - 0.0001) return state
      return mutation(state, (session) => ({
        ...session,
        cutPoints: [...session.cutPoints, point].sort((left, right) => left - right)
      }))
    })
  },

  clearSelection() {
    set((state) => mutation(state, (session) => ({ ...session, cutPoints: [] })))
  },

  deleteSelection() {
    set((state) => {
      if (!state.session) return state
      const range = deletionRange(state.session)
      if (!range) return state
      return mutation(state, (session) => {
        const [start, end] = range
        const result = removeOutputRange(session.segments, session.overlays, start, end)
        const duration = timelineDuration(result.segments)
        return {
          ...session,
          ...result,
          playhead: Math.min(start, duration),
          cutPoints: cutPointsAfterRemoval(session.cutPoints, start, end, duration),
          selectedOverlayId: result.overlays.some((item) => item.id === session.selectedOverlayId)
            ? session.selectedOverlayId
            : null
        }
      })
    })
  },

  addText() {
    set((state) => mutation(state, (session) => {
      const overlay = defaultTextOverlay(session.playhead, session.overlays.length + 1)
      return { ...session, overlays: [...session.overlays, overlay], selectedOverlayId: overlay.id }
    }))
  },

  async addAsset(asset) {
    const session = get().session
    if (!session) return
    try {
      const metadata = await window.catcut.probeAsset(asset.path)
      const remaining = Math.max(0.1, timelineDuration(session.segments) - session.playhead)
      const naturalDuration = metadata.duration > 0 ? metadata.duration : 3
      const duration = asset.type === 'image' ? Math.min(remaining, 3) : naturalDuration
      let overlay: Overlay
      if (asset.type === 'audio') {
        overlay = {
          id: makeId('audio'), type: 'audio', name: asset.name, path: asset.path,
          start: session.playhead, duration, zIndex: session.overlays.length + 1,
          volume: 1, sourceDuration: naturalDuration
        }
      } else if (asset.type === 'video') {
        overlay = {
          id: makeId('video'), type: 'video', name: asset.name, path: asset.path,
          start: session.playhead, duration, zIndex: session.overlays.length + 1,
          x: 0.6, y: 0.06, width: 0.34, height: 0.34,
          opacity: 1, loop: false, audioEnabled: false, hasAudio: metadata.hasAudio,
          volume: 1, sourceDuration: naturalDuration
        }
      } else {
        overlay = {
          id: makeId(asset.type), type: asset.type, name: asset.name, path: asset.path,
          start: session.playhead, duration, zIndex: session.overlays.length + 1,
          x: 0.62, y: 0.08, width: 0.3, height: 0.3, opacity: 1,
          loop: asset.type === 'gif', sourceDuration: asset.type === 'gif' ? naturalDuration : undefined
        }
      }
      set((state) => mutation(state, (current) => ({
        ...current,
        overlays: [...current.overlays, overlay],
        selectedOverlayId: overlay.id
      })))
    } catch {
      set({ error: 'CatCut could not add this item. Try another file.' })
    }
  },

  async addExternalMedia() {
    const selection = await window.catcut.openMedia()
    if (!selection) return
    await get().addAsset({
      id: selection.path,
      type: selection.type,
      name: selection.name,
      path: selection.path,
      source: 'external'
    })
  },

  selectOverlay(id) {
    set((state) => state.session ? { session: { ...state.session, selectedOverlayId: id } } : state)
  },

  updateOverlay(id, patch) {
    set((state) => mutation(state, (session) => ({
      ...session,
      overlays: session.overlays.map((overlay) =>
        overlay.id === id ? ({ ...overlay, ...patch } as Overlay) : overlay
      )
    })))
  },

  removeSelectedOverlay() {
    set((state) => mutation(state, (session) => ({
      ...session,
      overlays: session.overlays.filter((overlay) => overlay.id !== session.selectedOverlayId),
      selectedOverlayId: null
    })))
  },

  undo() {
    set((state) => {
      const previous = state.history.at(-1)
      if (!previous || !state.session) return state
      return {
        session: cloneSession(previous),
        history: state.history.slice(0, -1),
        future: [cloneSession(state.session), ...state.future].slice(0, 50)
      }
    })
  },

  redo() {
    set((state) => {
      const next = state.future[0]
      if (!next || !state.session) return state
      return {
        session: cloneSession(next),
        history: [...state.history, cloneSession(state.session)].slice(-50),
        future: state.future.slice(1)
      }
    })
  },

  setJob(job) { set({ job }) },
  showError(error) { set({ error }) },
  clearError() { set({ error: null }) },
  markExported() {
    set((state) => state.session ? { session: { ...state.session, dirty: false } } : state)
  }
}))

export function selectedOverlay(session: EditSession | null): Overlay | null {
  return session?.overlays.find((overlay) => overlay.id === session.selectedOverlayId) ?? null
}

export function isVideoOverlay(overlay: Overlay | null): overlay is VideoOverlay {
  return overlay?.type === 'video'
}
