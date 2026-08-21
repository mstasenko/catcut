import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetItem, EditSession, FocusZoomAmount, FreezeDuration, InsertTransitions, TransitionEffect, VideoSpeed } from '@shared/types'
import { focusZoomAmounts, freezeDurations, videoSpeeds } from '@shared/types'
import { deletionRange, isFreezeSegment, positionAtOutputTime, segmentPlaybackRate } from '../model/timeline'
import { transitionAtOutputTime } from '../model/transitions'
import { replayEligibility } from '../model/replay'
import { segmentsForOutputRange } from '../model/segment-ranges'
import { useMediaUrl } from './useMediaUrl'

export type AssetCategory = Exclude<AssetItem['type'], 'gif'>

interface AssetPanelProps {
  assets: AssetItem[]
  session: EditSession
  category: AssetCategory | null
  onCategory: (category: AssetCategory | null) => void
  onText: () => void
  onNew: () => void
  onInsert: (transitions: InsertTransitions) => void
  onAsset: (asset: AssetItem) => void
  onError: (message: string) => void
  onSpeed: (rate: VideoSpeed) => void
  onFocusPick: (zoom: FocusZoomAmount) => void
  onRemoveFocusZoom: () => void
  onFreeze: (duration: FreezeDuration) => void
  onRemoveFreeze: () => void
  onReplay: () => void
  onRemoveReplay: () => void
}

type EffectView = 'speed' | 'zoom' | 'freeze'

const categoryNames: Record<AssetCategory, string> = {
  image: 'Images', video: 'Videos', audio: 'Audio'
}

const transitionOptions: { value: TransitionEffect | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Soft dissolve' },
  { value: 'wipeleft', label: 'Wipe left' },
  { value: 'wiperight', label: 'Wipe right' },
  { value: 'slideleft', label: 'Slide left' },
  { value: 'slideright', label: 'Slide right' },
  { value: 'circleopen', label: 'Circle reveal' },
  { value: 'zoomin', label: 'Zoom in' },
  { value: 'hblur', label: 'Blur' }
]

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

function HoverPreview({ asset }: { asset: AssetItem | null }): React.JSX.Element | null {
  const url = useMediaUrl(asset?.path)
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

function AddMenu({ onCategory, onText, onNew, onInsert, onEffect, session, onReplay, onRemoveReplay }: Pick<AssetPanelProps, 'onCategory' | 'onText' | 'onNew' | 'session' | 'onReplay' | 'onRemoveReplay'> & {
  onInsert: () => void
  onEffect: (effect: EffectView) => void
}): React.JSX.Element {
  const replay = replayEligibility(session)
  const selection = deletionRange(session)
  return (
    <section className="asset-panel add-menu">
      <div className="panel-heading"><strong>Insert</strong></div>
      <button className="wide-button" onClick={onInsert}>Video</button>
      <div className="panel-heading add-heading"><strong>Add</strong></div>
      <div className="quick-add">
        <button onClick={onText}>Text</button>
        <button onClick={() => onCategory('image')}>Images</button>
        <button onClick={() => onCategory('video')}>Videos</button>
        <button onClick={() => onCategory('audio')}>Audio</button>
        <button onClick={onNew}>New</button>
      </div>
      <div className="panel-heading add-heading"><strong>Effects</strong></div>
      <div className="effect-add">
        <button disabled={!selection} onClick={() => onEffect('speed')}>Speed</button>
        <button disabled={Boolean(replay.reason)} onClick={replay.removableGroupId ? onRemoveReplay : onReplay}>
          {replay.removableGroupId ? 'Remove Replay' : 'Replay'}
        </button>
        <button disabled={!selection} title="Focus Zoom" onClick={() => onEffect('zoom')}>Zoom</button>
        <button title="Freeze Frame" onClick={() => onEffect('freeze')}>Freeze</button>
      </div>
      {replay.reason && <p className="empty-note">{replay.reason}</p>}
    </section>
  )
}

function speedLabel(rate: VideoSpeed): string {
  if (rate === 0.25) return '¼×'
  if (rate === 0.5) return '½×'
  return `${rate}×`
}

function currentSpeed(session: EditSession): VideoSpeed {
  const position = positionAtOutputTime(session.segments, session.playhead)
  return position ? segmentPlaybackRate(position.segment) : 1
}

function EffectHeading({ title, onBack }: { title: string; onBack: () => void }): React.JSX.Element {
  return <div className="panel-heading"><button onClick={onBack}>← Back</button><strong>{title}</strong></div>
}

function SpeedOptions({ session, onBack, onSpeed }: Pick<AssetPanelProps, 'session' | 'onSpeed'> & { onBack: () => void }): React.JSX.Element {
  const range = deletionRange(session)
  const disabled = !range || segmentsForOutputRange(session.segments, range[0], range[1]).every(isFreezeSegment)
  const current = currentSpeed(session)
  return <section className="asset-panel effect-menu"><EffectHeading title="Speed" onBack={onBack} />
    <p className="empty-note">Changes the highlighted video moment.</p>
    <div className="effect-options">{videoSpeeds.map((rate) => <button className={rate === current ? 'selected-effect' : undefined} disabled={disabled} key={rate} onClick={() => onSpeed(rate)}>{speedLabel(rate)}</button>)}</div>
    {disabled && <p className="empty-note">Speed does not change a freeze frame.</p>}
  </section>
}

function ZoomOptions(props: Pick<AssetPanelProps, 'session' | 'onFocusPick' | 'onRemoveFocusZoom'> & { onBack: () => void }): React.JSX.Element {
  const range = deletionRange(props.session)
  const active = Boolean(range && props.session.focusZooms.some((effect) => effect.start < range[1] && effect.start + effect.duration > range[0]))
  return <section className="asset-panel effect-menu"><EffectHeading title="Focus Zoom" onBack={props.onBack} />
    <p className="empty-note">Choose a zoom, then click what to focus on.</p>
    <div className="effect-options">{focusZoomAmounts.map((zoom) => <button disabled={!range} key={zoom} onClick={() => props.onFocusPick(zoom)}>{zoom}×</button>)}</div>
    {active && <button className="wide-button" onClick={props.onRemoveFocusZoom}>Zoom off</button>}
  </section>
}

function FreezeOptions(props: Pick<AssetPanelProps, 'session' | 'onFreeze' | 'onRemoveFreeze'> & { onBack: () => void }): React.JSX.Element {
  const position = positionAtOutputTime(props.session.segments, props.session.playhead)
  const frozen = Boolean(position && isFreezeSegment(position.segment))
  const transition = transitionAtOutputTime(props.session.segments, props.session.playhead) !== null
  return <section className="asset-panel effect-menu"><EffectHeading title="Freeze Frame" onBack={props.onBack} />
    <p className="empty-note">Holds the exact frame at the playhead.</p>
    {frozen
      ? <button className="wide-button" onClick={props.onRemoveFreeze}>Remove freeze</button>
      : <div className="effect-options">{freezeDurations.map((duration) => <button className={duration === 1 ? 'selected-effect' : undefined} disabled={transition} key={duration} onClick={() => props.onFreeze(duration)}>{duration}s</button>)}</div>}
    {transition && <p className="empty-note">Move the playhead outside the transition to add a freeze frame.</p>}
  </section>
}

function EffectOptions({ effect, onBack, ...props }: AssetPanelProps & { effect: EffectView; onBack: () => void }): React.JSX.Element {
  if (effect === 'speed') return <SpeedOptions session={props.session} onBack={onBack} onSpeed={props.onSpeed} />
  if (effect === 'zoom') return <ZoomOptions session={props.session} onBack={onBack} onFocusPick={props.onFocusPick} onRemoveFocusZoom={props.onRemoveFocusZoom} />
  return <FreezeOptions session={props.session} onBack={onBack} onFreeze={props.onFreeze} onRemoveFreeze={props.onRemoveFreeze} />
}

function TransitionSelect({ label, value, onChange }: {
  label: string
  value: TransitionEffect | 'none'
  onChange: (effect: TransitionEffect | 'none') => void
}): React.JSX.Element {
  return (
    <label className="stacked-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as TransitionEffect | 'none')}>
        {transitionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function InsertVideoPanel({ onBack, onInsert }: {
  onBack: () => void
  onInsert: AssetPanelProps['onInsert']
}): React.JSX.Element {
  const [into, setInto] = useState<TransitionEffect | 'none'>('none')
  const [back, setBack] = useState<TransitionEffect | 'none'>('none')
  const [duration, setDuration] = useState(0.65)
  const transitionsEnabled = into !== 'none' || back !== 'none'

  const selectVideo = (): void => {
    onInsert({
      ...(into === 'none' ? {} : { into: { effect: into, duration } }),
      ...(back === 'none' ? {} : { back: { effect: back, duration } })
    })
  }

  return (
    <section className="asset-panel insert-menu">
      <div className="panel-heading">
        <button onClick={onBack}>← Back</button>
        <strong>Insert video</strong>
      </div>
      <p className="empty-note">Choose optional transitions for both sides of the inserted clip.</p>
      <TransitionSelect label="Into inserted video" value={into} onChange={setInto} />
      <TransitionSelect label="Back to timeline" value={back} onChange={setBack} />
      <label className="stacked-control">
        <span>Transition duration</span>
        <select
          disabled={!transitionsEnabled}
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
        >
          <option value={0.35}>0.35 seconds</option>
          <option value={0.65}>0.65 seconds</option>
          <option value={1}>1 second</option>
          <option value={1.5}>1.5 seconds</option>
        </select>
      </label>
      <button className="wide-button select-video-button" onClick={selectVideo}>Select video</button>
    </section>
  )
}

export function AssetPanel(props: AssetPanelProps): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [inserting, setInserting] = useState(false)
  const [effect, setEffect] = useState<EffectView | null>(null)
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

  if (inserting) {
    return <InsertVideoPanel onBack={() => setInserting(false)} onInsert={props.onInsert} />
  }
  if (effect) return <EffectOptions {...props} effect={effect} onBack={() => setEffect(null)} />
  if (!props.category) {
    return <AddMenu
      onCategory={props.onCategory}
      onText={props.onText}
      onNew={props.onNew}
      onInsert={() => setInserting(true)}
      onEffect={setEffect}
      session={props.session}
      onReplay={props.onReplay}
      onRemoveReplay={props.onRemoveReplay}
    />
  }
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
