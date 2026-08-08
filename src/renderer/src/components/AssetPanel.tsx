import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetItem } from '@shared/types'

export type AssetCategory = Exclude<AssetItem['type'], 'gif'>

interface AssetPanelProps {
  assets: AssetItem[]
  category: AssetCategory | null
  onCategory: (category: AssetCategory | null) => void
  onText: () => void
  onNew: () => void
  onAsset: (asset: AssetItem) => void
  onError: (message: string) => void
}

const categoryNames: Record<AssetCategory, string> = {
  image: 'Images', video: 'Videos', audio: 'Audio'
}

function inCategory(asset: AssetItem, category: AssetCategory | null): boolean {
  if (category === 'video') return asset.type === 'video' || asset.type === 'gif'
  return asset.type === category
}

function AssetRow({ asset, previewing, onPreview, onAsset, onHover }: {
  asset: AssetItem
  previewing: boolean
  onPreview: () => void
  onAsset: () => void
  onHover: (asset: AssetItem | null) => void
}): React.JSX.Element {
  if (asset.type === 'audio') {
    return (
      <div className="audio-asset">
        <button className="audio-preview" onClick={onPreview} aria-label={`${previewing ? 'Pause' : 'Play'} ${asset.name}`}>{previewing ? 'Ⅱ' : '▶'}</button>
        <button className="asset-name" onClick={onAsset} title={asset.name}>{asset.name}</button>
      </div>
    )
  }
  return (
    <button
      className="visual-asset"
      onClick={onAsset}
      onMouseEnter={() => onHover(asset)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(asset)}
      onBlur={() => onHover(null)}
      title={asset.name}
    >
      {asset.name}
    </button>
  )
}

function useAssetUrl(asset: AssetItem | null): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    // Do not briefly show the previous card's media while the next protocol URL
    // is resolving. The active flag also prevents a late hover from winning.
    setUrl('')
    if (!asset) {
      return
    }
    void window.catcut.getPathUrl(asset.path).then((pathUrl) => {
      if (active) setUrl(pathUrl)
    })
    return () => { active = false }
  }, [asset])
  return url
}

function HoverPreview({ asset }: { asset: AssetItem | null }): React.JSX.Element | null {
  const url = useAssetUrl(asset)
  if (!asset || asset.type === 'audio' || !url) return null
  return (
    <aside className="asset-hover-card" aria-label={`Preview of ${asset.name}`}>
      <strong title={asset.name}>{asset.name}</strong>
      {asset.type === 'video'
        ? <video src={url} autoPlay muted loop playsInline preload="metadata" />
        : <img src={url} alt="" />}
    </aside>
  )
}

function AddMenu({ onCategory, onText, onNew }: Pick<AssetPanelProps, 'onCategory' | 'onText' | 'onNew'>): React.JSX.Element {
  return (
    <section className="asset-panel add-menu">
      <div className="panel-heading"><strong>Add</strong></div>
      <div className="quick-add">
        <button onClick={onText}>Text</button>
        <button onClick={() => onCategory('image')}>Images</button>
        <button onClick={() => onCategory('video')}>Videos</button>
        <button onClick={() => onCategory('audio')}>Audio</button>
        <button onClick={onNew}>New</button>
      </div>
    </section>
  )
}

export function AssetPanel(props: AssetPanelProps): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [hovered, setHovered] = useState<AssetItem | null>(null)
  const preview = useRef<HTMLAudioElement | null>(null)
  const visible = useMemo(() => props.assets.filter((asset) =>
    inCategory(asset, props.category) && asset.name.toLowerCase().includes(filter.toLowerCase())
  ), [props.assets, filter, props.category])

  useEffect(() => () => preview.current?.pause(), [])

  const togglePreview = async (asset: AssetItem): Promise<void> => {
    if (previewing === asset.id) {
      preview.current?.pause()
      preview.current = null
      setPreviewing(null)
      return
    }
    try {
      preview.current?.pause()
      const audio = new Audio(await window.catcut.getPathUrl(asset.path))
      preview.current = audio
      audio.onended = () => setPreviewing(null)
      await audio.play()
      setPreviewing(asset.id)
    } catch {
      preview.current = null
      setPreviewing(null)
      props.onError('CatCut could not preview this audio.')
    }
  }

  if (!props.category) return <AddMenu onCategory={props.onCategory} onText={props.onText} onNew={props.onNew} />
  const goBack = (): void => {
    setFilter('')
    setHovered(null)
    props.onCategory(null)
  }
  return (
    <section className="asset-panel category-menu">
      <div className="panel-heading">
        <button onClick={goBack}>← Back</button>
        <strong>{categoryNames[props.category]}</strong>
      </div>
      <input autoFocus className="asset-search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={`Search ${categoryNames[props.category].toLowerCase()}`} />
      <div className="asset-list">
        {visible.length === 0 && <p className="empty-note">No media here. Place the meme folder next to CatCut.</p>}
        {visible.map((asset) => (
          <AssetRow
            key={asset.id}
            asset={asset}
            previewing={previewing === asset.id}
            onPreview={() => void togglePreview(asset)}
            onAsset={() => props.onAsset(asset)}
            onHover={setHovered}
          />
        ))}
      </div>
      <HoverPreview asset={hovered} />
    </section>
  )
}
