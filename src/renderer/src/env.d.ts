/// <reference types="vite/client" />

import type { CatCutApi } from '../../types'

declare global {
  interface Window {
    catcut: CatCutApi
  }
}

export {}
