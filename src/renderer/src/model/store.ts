import { create } from 'zustand'
import type { EditSession, Overlay, TimelineSource, VideoOverlay } from '@shared/types'
import type { EditorState } from './editor-state'
import {
  clamp,
  createSession,
  cutPointsAfterRemoval,
  defaultTextOverlay,
  deletionRange,
  makeId,
  primarySource,
  removeOutputRange,
  timelineDuration,
  positionAtOutputTime,
  isFreezeSegment
} from './timeline'
import { insertSourceAtOutputTime } from './segment-ranges'
import { applySpeedToOutputRange } from './speed'
import { addFocusZoom, removeFocusZoomFromRange } from './focus-zoom'
import { insertFreezeFrame, removeFreezeFrame } from './freeze'
import { timedRangesAfterRemoval } from './timed-ranges'
import { insertReplay as insertReplayEdit, removeReplayAtPlayhead, replayEligibility } from './replay'
import {
  cloneSession,
  mutation,
  patchedOverlaySession,
  restoredEditorState
} from './store-session'

export type { EditorState } from './editor-state'

export { savedSession } from './store-session'

export const useEditorStore = create<EditorState>((set, get) => {
  let proxyGeneration = 0

  const patchSource = (id: string, patch: Partial<TimelineSource>): void => set((state) => state.session ? {
    session: {
      ...state.session,
      sources: state.session.sources.map((source) => source.id === id ? { ...source, ...patch } : source)
    }
  } : state)

  const loadWaveform = (source: TimelineSource): void => {
    if (!source.metadata.hasAudio || source.waveform.length > 0) return
    void window.replaycat.waveform(source.metadata.path)
      .then((waveform) => patchSource(source.id, { waveform }))
      .catch(() => undefined)
  }

  const prepareProxy = async (source: TimelineSource, busy: string | null, error: string): Promise<void> => {
    const generation = proxyGeneration
    try {
      if (!await window.replaycat.shouldProxy(source.metadata)) return
      if (generation !== proxyGeneration) return
      if (busy) set({ busy })
      const { result } = await window.replaycat.createProxy(source.metadata)
      const playbackPath = await window.replaycat.getPathUrl(result.path)
      if (generation !== proxyGeneration) return
      patchSource(source.id, { playbackPath })
      if (busy) set({ busy: null })
    } catch {
      if (generation === proxyGeneration) set({ busy: null, error })
    }
  }

  return ({
  initialized: false,
  session: null,
  history: [],
  future: [],
  gesture: null,
  assets: [],
  gpu: null,
  job: null,
  busy: null,
  error: null,

  async initialize() {
    try {
      const [gpu, assets, saved] = await Promise.all([
        window.replaycat.getGpuDiagnostics(),
        window.replaycat.scanAssets(),
        window.replaycat.loadSession()
      ])
      const restored = saved ? await restoredEditorState(saved) : null
      set({
        gpu,
        assets,
        session: restored?.session ?? null,
        history: restored?.history ?? [],
        future: restored?.future ?? [],
        initialized: true
      })
      restored?.session.sources.forEach(loadWaveform)
    } catch {
      set({ initialized: true, error: 'ReplayCat could not finish starting. Close it and try again.' })
    }
  },
  async loadVideo(providedPath, short = false) {
    try {
      const path = providedPath ?? await window.replaycat.openVideo()
      if (!path) return
      proxyGeneration += 1
      set({ busy: 'Opening video…', error: null })
      const metadata = await window.replaycat.probe(path)
      const url = await window.replaycat.getPathUrl(path)
      const session = createSession(metadata, short)
      const source = primarySource(session)
      source.playbackPath = url
      set({ session, history: [], future: [], gesture: null, busy: null })
      loadWaveform(source)
      await prepareProxy(
        source,
        'Preparing video for smooth playback…',
        'Playback preparation failed. The video will still open, but playback may be slower.'
      )
    } catch {
      set({ busy: null, error: 'ReplayCat could not open this video. Try another file.' })
    }
  },
  async openShort() {
    await get().loadVideo(undefined, true)
  },
  async insertVideo(transitions = {}) {
    const path = await window.replaycat.openVideo()
    if (!path || !get().session) return
    try {
      set({ busy: 'Inserting video…', error: null })
      const [metadata, playbackPath] = await Promise.all([
        window.replaycat.probe(path),
        window.replaycat.getPathUrl(path)
      ])
      const sourceId = makeId('source')
      const source: TimelineSource = { id: sourceId, metadata, playbackPath, waveform: [] }
      set((state) => {
        if (!state.session) return { busy: null }
        return {
          ...mutation(state, (session) => insertSourceAtOutputTime(
            session,
            source,
            session.playhead,
            transitions
          )),
          busy: null
        }
      })
      loadWaveform(source)
      await prepareProxy(source, null, 'Playback preparation failed for the inserted video. It may play less smoothly.')
    } catch {
      set({ busy: null, error: 'ReplayCat could not insert this video. Try another file.' })
    }
  },
  async resetProject() {
    await window.replaycat.resetSession()
    proxyGeneration += 1
    set({ session: null, history: [], future: [], gesture: null, job: null, busy: null, error: null })
  },
  setPlayhead(time) {
    set((state) => {
      if (!state.session) return state
      const duration = timelineDuration(state.session.segments)
      return { session: { ...state.session, playhead: clamp(time, 0, duration) } }
    })
  },
  async setPlaybackPath(path) {
    const url = await window.replaycat.getPathUrl(path)
    set((state) => state.session ? {
      session: {
        ...state.session,
        sources: state.session.sources.map((source, index) => index === 0 ? { ...source, playbackPath: url } : source)
      }
    } : state)
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
      if (!range) {
        const position = positionAtOutputTime(state.session.segments, state.session.playhead)
        return position && isFreezeSegment(position.segment)
          ? mutation(state, (session) => removeFreezeFrame(session, position.segment.id))
          : state
      }
      return mutation(state, (session) => {
        const [start, end] = range
        const result = removeOutputRange(session.segments, session.overlays, start, end)
        const duration = timelineDuration(result.segments)
        return {
          ...session,
          ...result,
          playhead: Math.min(start, duration),
          cutPoints: cutPointsAfterRemoval(session.cutPoints, start, end, duration),
          focusZooms: timedRangesAfterRemoval(session.focusZooms, start, end),
          selectedOverlayId: result.overlays.some((item) => item.id === session.selectedOverlayId)
            ? session.selectedOverlayId
            : null
        }
      })
    })
  },
  setSpeed(rate) {
    set((state) => {
      if (!state.session) return state
      const range = deletionRange(state.session)
      if (!range || range[1] - range[0] <= 0.0001) return state
      return mutation(state, (session) => applySpeedToOutputRange(session, range[0], range[1], rate))
    })
  },
  addFocusZoom(zoom, focusX, focusY) {
    set((state) => {
      if (!state.session) return state
      const range = deletionRange(state.session)
      if (!range) return state
      return mutation(state, (session) => addFocusZoom(session, range[0], range[1], zoom, focusX, focusY))
    })
  },
  removeFocusZoom() {
    set((state) => {
      if (!state.session) return state
      const range = deletionRange(state.session)
      return range ? mutation(state, (session) => removeFocusZoomFromRange(session, range[0], range[1])) : state
    })
  },
  insertFreeze(duration) {
    set((state) => mutation(state, (session) => insertFreezeFrame(session, session.playhead, duration)))
  },
  removeFreeze() {
    set((state) => {
      if (!state.session) return state
      const position = positionAtOutputTime(state.session.segments, state.session.playhead)
      if (!position || !isFreezeSegment(position.segment)) return state
      return mutation(state, (session) => removeFreezeFrame(session, position.segment.id))
    })
  },
  insertReplay() {
    set((state) => {
      if (!state.session) return state
      const eligibility = replayEligibility(state.session)
      if (!eligibility.range) return state
      const [start, end] = eligibility.range
      return mutation(state, (session) => insertReplayEdit(session, start, end))
    })
  },
  removeReplay() {
    set((state) => {
      if (!state.session || !replayEligibility(state.session).removableGroupId) return state
      return mutation(state, removeReplayAtPlayhead)
    })
  },
  setTextAnimation(id, preset) {
    set((state) => mutation(state, (session) => patchedOverlaySession(session, id, { animation: preset } as Partial<Overlay>)))
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
      const metadata = await window.replaycat.probeAsset(asset.path)
      const remaining = Math.max(0.1, timelineDuration(session.segments) - session.playhead)
      const naturalDuration = metadata.duration > 0 ? metadata.duration : 3
      const duration = asset.type === 'image' ? Math.min(remaining, 3) : naturalDuration
      let overlay: Overlay
      if (asset.type === 'audio') {
        overlay = {
          id: makeId('audio'), type: 'audio', name: asset.name, path: asset.path,
          start: session.playhead, duration, zIndex: session.overlays.length + 1,
          volume: 1, sourceIn: 0, sourceDuration: naturalDuration
        }
      } else if (asset.type === 'video') {
        overlay = {
          id: makeId('video'), type: 'video', name: asset.name, path: asset.path,
          start: session.playhead, duration, zIndex: session.overlays.length + 1,
          x: 0.6, y: 0.06, width: 0.34, height: 0.34,
          opacity: 1, loop: false, audioEnabled: false, hasAudio: metadata.hasAudio,
          volume: 1, sourceIn: 0, sourceDuration: naturalDuration
        }
      } else if (asset.type === 'gif') {
        overlay = {
          id: makeId('gif'), type: 'gif', name: asset.name, path: asset.path,
          playbackPath: metadata.playbackPath,
          start: session.playhead, duration, zIndex: session.overlays.length + 1,
          x: 0.62, y: 0.08, width: 0.3, height: 0.3, opacity: 1,
          loop: true, sourceIn: 0, sourceDuration: naturalDuration
        }
      } else {
        overlay = {
          id: makeId('image'), type: 'image', name: asset.name, path: asset.path,
          start: session.playhead, duration, zIndex: session.overlays.length + 1,
          x: 0.62, y: 0.08, width: 0.3, height: 0.3, opacity: 1, loop: false
        }
      }
      set((state) => mutation(state, (current) => ({
        ...current,
        overlays: [...current.overlays, overlay],
        selectedOverlayId: overlay.id
      })))
    } catch {
      set({ error: 'ReplayCat could not add this item. Try another file.' })
    }
  },
  async addExternalMedia() {
    const selection = await window.replaycat.openMedia()
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
    set((state) => mutation(state, (session) => patchedOverlaySession(session, id, patch)))
  },
  beginOverlayGesture() {
    set((state) => state.session && !state.gesture
      ? { gesture: cloneSession(state.session) }
      : state)
  },
  updateOverlayGesture(id, patch) {
    set((state) => state.session
      ? { session: patchedOverlaySession(state.session, id, patch) }
      : state)
  },
  commitOverlayGesture() {
    set((state) => {
      if (!state.gesture || !state.session) return state
      if (JSON.stringify(state.gesture.overlays) === JSON.stringify(state.session.overlays)) {
        return { gesture: null }
      }
      return {
        gesture: null,
        history: [...state.history.slice(-49), state.gesture],
        future: []
      }
    })
  },

  cancelOverlayGesture() {
    set((state) => state.gesture
      ? { session: state.gesture, gesture: null }
      : state)
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
        gesture: null,
        history: state.history.slice(0, -1),
        future: [cloneSession(state.session), ...state.future].slice(0, 50)
      }
    })
    get().session?.sources.forEach(loadWaveform)
  },

  redo() {
    set((state) => {
      const next = state.future[0]
      if (!next || !state.session) return state
      return {
        session: cloneSession(next),
        gesture: null,
        history: [...state.history, cloneSession(state.session)].slice(-50),
        future: state.future.slice(1)
      }
    })
    get().session?.sources.forEach(loadWaveform)
  },

  setJob(job) {
    if (job.kind === 'export') set({ job })
  },
  showError(error) { set({ error }) },
  clearError() { set({ error: null }) },
  markExported() {
    set((state) => state.session ? { session: { ...state.session, dirty: false } } : state)
  }
  })
})

export function selectedOverlay(session: EditSession | null): Overlay | null {
  return session?.overlays.find((overlay) => overlay.id === session.selectedOverlayId) ?? null
}

export function isVideoOverlay(overlay: Overlay | null): overlay is VideoOverlay {
  return overlay?.type === 'video'
}
