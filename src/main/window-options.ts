export interface WindowSize {
  width: number
  height: number
}

export function initialWindowSize(compact: boolean): WindowSize {
  return compact ? { width: 1100, height: 720 } : { width: 1500, height: 940 }
}
