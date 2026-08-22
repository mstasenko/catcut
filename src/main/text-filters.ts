import type { TextAnimationPreset, TextOverlay } from '../types'

interface AnimationExpressions {
  opacity: string
  scale: string
  x: string
  y: string
}

function decimal(value: number): string {
  return Math.max(0, value).toFixed(6)
}

function smooth(expression: string): string {
  const progress = `min(1,max(0,${expression}))`
  return `(${progress})*(${progress})*(3-2*(${progress}))`
}

function entranceExpressions(preset: 'pop' | 'bounce', duration: number, time: string): AnimationExpressions {
  const entrance = Math.min(preset === 'pop' ? 0.28 : 0.38, duration / 2)
  const split = entrance * (preset === 'pop' ? 0.65 : 0.6)
  const first = smooth(`${time}/${decimal(split)}`)
  const settle = smooth(`(${time}-${decimal(split)})/${decimal(entrance - split)}`)
  if (preset === 'pop') {
    return {
      opacity: `if(lt(${time},${decimal(split)}),${first},1)`,
      scale: `if(lt(${time},${decimal(split)}),0.65+0.47*${first},if(lt(${time},${decimal(entrance)}),1.12-0.12*${settle},1))`,
      x: '0', y: '0'
    }
  }
  return {
    opacity: `if(lt(${time},${decimal(split)}),${first},1)`,
    scale: `if(lt(${time},${decimal(split)}),0.92+0.11*${first},if(lt(${time},${decimal(entrance)}),1.03-0.03*${settle},1))`,
    x: '0',
    y: `if(lt(${time},${decimal(split)}),0.2-0.26*${first},if(lt(${time},${decimal(entrance)}),-0.06+0.06*${settle},0))`
  }
}

function fadeExpressions(duration: number, time: string): AnimationExpressions {
  const ramp = decimal(Math.min(0.22, duration / 2))
  return { opacity: `min(${smooth(`${time}/${ramp}`)},${smooth(`(${decimal(duration)}-${time})/${ramp}`)})`, scale: '1', x: '0', y: '0' }
}

function shakeExpressions(duration: number, time: string): AnimationExpressions {
  const window = Math.min(0.55, duration)
  const progress = `min(1,max(0,${time}/${decimal(window)}))`
  const amplitude = `pow(1-${progress},2)`
  return {
    opacity: '1', scale: '1',
    x: `if(lt(${time},${decimal(window)}),0.025*${amplitude}*sin(9*PI*${progress}),0)`,
    y: `if(lt(${time},${decimal(window)}),0.012*${amplitude}*sin(13*PI*${progress}),0)`
  }
}

function presetExpressions(preset: TextAnimationPreset, duration: number, time: string): AnimationExpressions {
  switch (preset) {
    case 'none': return { opacity: '1', scale: '1', x: '0', y: '0' }
    case 'fade': return fadeExpressions(duration, time)
    case 'pop': return entranceExpressions('pop', duration, time)
    case 'bounce': return entranceExpressions('bounce', duration, time)
    case 'shake': return shakeExpressions(duration, time)
  }
}

export function textAnimationFilterExpressions(preset: TextAnimationPreset | undefined, duration: number, time = 't'): AnimationExpressions {
  if (preset === undefined) return { opacity: '1', scale: '1', x: '0', y: '0' }
  return presetExpressions(preset, duration, time)
}

function addStaticTextFilters(
  filters: string[], overlay: TextOverlay, inputIndex: number, order: number, inputLabel: string
): string {
  const outputLabel = `vout${order}`
  const x = overlay.renderedTextBitmap?.x ?? 0
  const y = overlay.renderedTextBitmap?.y ?? 0
  filters.push(
    `[${inputIndex}:v:0]trim=duration=${decimal(overlay.duration)},setpts=PTS-STARTPTS+${decimal(overlay.start)}/TB,format=rgba,colorchannelmixer=aa=${overlay.opacity}[ov${order}]`,
    `[${inputLabel}][ov${order}]overlay=x=${x}:y=${y}:eof_action=pass:repeatlast=1:enable='between(t,${decimal(overlay.start)},${decimal(overlay.start + overlay.duration)})'[${outputLabel}]`
  )
  return outputLabel
}

function addAnimatedTextFilters(
  filters: string[], overlay: TextOverlay & { renderedTextBitmap: NonNullable<TextOverlay['renderedTextBitmap']> },
  inputIndex: number, order: number, inputLabel: string, canvas: { width: number; height: number }
): string {
  const outputLabel = `vout${order}`
  const bitmap = overlay.renderedTextBitmap
  const expression = textAnimationFilterExpressions(overlay.animation, overlay.duration)
  const alphaExpression = textAnimationFilterExpressions(overlay.animation, overlay.duration, 'T')
  const outputExpression = textAnimationFilterExpressions(overlay.animation, overlay.duration, `(t-${decimal(overlay.start)})`)
  const width = `max(2,2*round(iw*(${expression.scale})/2))`
  const height = `max(2,2*round(ih*(${expression.scale})/2))`
  const alpha = `${overlay.opacity}*(${alphaExpression.opacity})`
  const x = `${bitmap.anchorX}-overlay_w/2+(${outputExpression.x})*${canvas.width * overlay.width}`
  const y = `${bitmap.anchorY}-overlay_h/2+(${outputExpression.y})*${canvas.height * overlay.height}`
  filters.push(
    `[${inputIndex}:v:0]trim=duration=${decimal(overlay.duration)},setpts=PTS-STARTPTS,scale=w='${width}':h='${height}':eval=frame,format=rgba,` +
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${alpha})',setpts=PTS-STARTPTS+${decimal(overlay.start)}/TB[ov${order}]`,
    `[${inputLabel}][ov${order}]overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:repeatlast=1:` +
      `enable='between(t,${decimal(overlay.start)},${decimal(overlay.start + overlay.duration)})'[${outputLabel}]`
  )
  return outputLabel
}

export function addTextOverlayFilters(
  filters: string[],
  overlay: TextOverlay,
  inputIndex: number,
  order: number,
  inputLabel: string,
  canvas: { width: number; height: number }
): string {
  const bitmap = overlay.renderedTextBitmap
  if (!bitmap || !overlay.animation || overlay.animation === 'none') {
    return addStaticTextFilters(filters, overlay, inputIndex, order, inputLabel)
  }
  return addAnimatedTextFilters(filters, { ...overlay, renderedTextBitmap: bitmap }, inputIndex, order, inputLabel, canvas)
}
