import type { Overlay } from '@shared/types'
import { formatTime } from '../model/timeline'

const fonts = ['Anton', 'Bangers', 'Bebas Neue', 'Comic Neue', 'Lobster', 'Oswald', 'Permanent Marker', 'Roboto']

interface InspectorProps {
  overlay: Overlay | null
  maxDuration: number
  framesPerSecond: number
  onBack: () => void
  onChange: (patch: Partial<Overlay>) => void
  onRemove: () => void
}

function NumberControl({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="control-row">
      <span>{label}</span>
      <input type="number" value={Number(value.toFixed(3))} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function TextControls({ overlay, onChange }: Pick<InspectorProps, 'onChange'> & { overlay: Overlay }): React.JSX.Element | null {
  if (overlay.type !== 'text') return null
  return (
    <>
      <label className="stacked-control"><span>Text</span><textarea autoFocus value={overlay.text} onFocus={(event) => event.currentTarget.select()} onChange={(e) => onChange({ text: e.target.value } as Partial<Overlay>)} /></label>
      <label className="control-row"><span>Font</span><select value={overlay.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value } as Partial<Overlay>)}>{fonts.map((font) => <option key={font}>{font}</option>)}</select></label>
      <NumberControl label="Text size" value={overlay.fontSize} min={1} max={30} step={0.5} onChange={(fontSize) => onChange({ fontSize } as Partial<Overlay>)} />
      <label className="control-row"><span>Color</span><input type="color" value={overlay.color} onChange={(e) => onChange({ color: e.target.value } as Partial<Overlay>)} /></label>
      <label className="control-row"><span>Outline</span><input type="color" value={overlay.outlineColor} onChange={(e) => onChange({ outlineColor: e.target.value } as Partial<Overlay>)} /></label>
      <NumberControl label="Outline width" value={overlay.outlineWidth} min={0} max={12} step={1} onChange={(outlineWidth) => onChange({ outlineWidth } as Partial<Overlay>)} />
      <label className="control-row"><span>Shadow</span><input type="checkbox" checked={overlay.shadow} onChange={(e) => onChange({ shadow: e.target.checked } as Partial<Overlay>)} /></label>
    </>
  )
}

function VisualControls({ overlay, onChange }: Pick<InspectorProps, 'onChange'> & { overlay: Overlay }): React.JSX.Element | null {
  if (overlay.type === 'audio') return null
  return <NumberControl label="Opacity" value={overlay.opacity} min={0} max={1} step={0.05} onChange={(opacity) => onChange({ opacity } as Partial<Overlay>)} />
}

function AudioControls({ overlay, onChange }: Pick<InspectorProps, 'onChange'> & { overlay: Overlay }): React.JSX.Element | null {
  if (overlay.type !== 'video' && overlay.type !== 'audio') return null
  return <NumberControl label="Volume" value={overlay.volume} min={0} max={2} step={0.05} onChange={(volume) => onChange({ volume } as Partial<Overlay>)} />
}

function VideoControls({ overlay, onChange }: Pick<InspectorProps, 'onChange'> & { overlay: Overlay }): React.JSX.Element | null {
  if (overlay.type !== 'video') return null
  return (
    <>
      <label className="control-row"><span>Include audio</span><input type="checkbox" checked={overlay.audioEnabled} disabled={!overlay.hasAudio} onChange={(e) => onChange({ audioEnabled: e.target.checked } as Partial<Overlay>)} /></label>
      <label className="control-row"><span>Loop clip</span><input type="checkbox" checked={overlay.loop} onChange={(e) => onChange({ loop: e.target.checked } as Partial<Overlay>)} /></label>
    </>
  )
}

function DurationControl({
  overlay, maxDuration, framesPerSecond, onChange
}: Pick<InspectorProps, 'maxDuration' | 'framesPerSecond' | 'onChange'> & { overlay: Overlay }): React.JSX.Element {
  if (overlay.type === 'audio' || overlay.type === 'video' || overlay.type === 'gif') {
    return <div className="control-row"><span>Length</span><output>{formatTime(overlay.duration, framesPerSecond)}</output></div>
  }
  return <NumberControl label="Visible for" value={overlay.duration} min={0.1} max={maxDuration} step={0.05} onChange={(duration) => onChange({ duration })} />
}

export function Inspector({ overlay, maxDuration, framesPerSecond, onBack, onChange, onRemove }: InspectorProps): React.JSX.Element {
  if (!overlay) return <section className="inspector"><p className="empty-note">Select text, a picture, or a clip to edit it.</p></section>
  return (
    <section className="inspector">
      <div className="panel-heading"><button onClick={onBack}>← Back</button><strong>{overlay.name}</strong></div>
      <NumberControl label={overlay.type === 'audio' ? 'Starts at' : 'Appears at'} value={overlay.start} min={0} max={maxDuration} step={0.05} onChange={(start) => onChange({ start })} />
      <DurationControl overlay={overlay} maxDuration={maxDuration} framesPerSecond={framesPerSecond} onChange={onChange} />
      <TextControls overlay={overlay} onChange={onChange} />
      <VisualControls overlay={overlay} onChange={onChange} />
      <AudioControls overlay={overlay} onChange={onChange} />
      <VideoControls overlay={overlay} onChange={onChange} />
      <button className="wide-button danger" onClick={onRemove}>Remove from video</button>
    </section>
  )
}
