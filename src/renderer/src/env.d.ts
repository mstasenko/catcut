/// <reference types="vite/client" />

import type { ReplayCatApi } from '../../types'

declare global {
  interface Window {
    replaycat: ReplayCatApi
  }
}

export {}
