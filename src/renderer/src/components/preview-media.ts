export const overlaySyncTolerances = {
  audio: 0.04,
  'video-audio': 0.06,
  visual: 0.18
} as const

export type PreviewMediaKind = keyof typeof overlaySyncTolerances

export function previewMediaVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1
  return Math.max(0, Math.min(1, volume))
}

export function overlayNeedsResync(
  currentTime: number,
  expectedTime: number,
  kind: PreviewMediaKind
): boolean {
  return Math.abs(currentTime - expectedTime) > overlaySyncTolerances[kind]
}
