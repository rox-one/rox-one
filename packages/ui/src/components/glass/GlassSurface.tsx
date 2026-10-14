import * as React from 'react'
import { cn } from '../../lib/utils'
import './glass.css'

export interface GlassSurfaceProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'nav' | 'span'
  /** Per-surface override of --glass-intensity (0..1). */
  intensity?: number
  /**
   * Edge refraction (SVG displacement). Only on static surfaces — never on
   * the composer, scrolling or animating content. Ignored on the basic tier.
   */
  refraction?: boolean
}

/** Per-surface hidden filter (unique id), so unmounting one surface never breaks another. */
export function GlassRefractionDefs({ id }: { id: string }) {
  return (
    <svg aria-hidden width="0" height="0" className="glass-defs">
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves={1} seed={3} result="n" />
        <feGaussianBlur in="n" stdDeviation="6" result="m" />
        <feDisplacementMap in="SourceGraphic" in2="m" scale={18} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

export const GlassSurface = React.forwardRef<HTMLElement, GlassSurfaceProps>(function GlassSurface(
  { as = 'div', intensity, refraction = false, className, style, children, ...rest },
  ref,
) {
  const Tag = as as 'div'
  const filterId = `rox-glass-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const vars: Record<string, string> = {}
  if (intensity !== undefined) vars['--glass-intensity'] = String(Math.min(1, Math.max(0, intensity)))
  if (refraction) vars['--glass-filter'] = `url(#${filterId})`
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn('glass-surface', className)}
      data-glass-refraction={refraction ? '' : undefined}
      style={{ ...vars, ...style } as React.CSSProperties}
      {...rest}
    >
      {refraction && <GlassRefractionDefs id={filterId} />}
      {children}
    </Tag>
  )
})
