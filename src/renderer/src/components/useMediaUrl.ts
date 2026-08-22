import { useEffect, useState } from 'react'

export function useMediaUrl(path?: string): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    setUrl('')
    if (path) void window.replaycat.getPathUrl(path).then((value) => { if (active) setUrl(value) })
    return () => { active = false }
  }, [path])
  return url
}
