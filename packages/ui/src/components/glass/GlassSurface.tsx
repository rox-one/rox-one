import * as React from 'react'
import { cn } from '../../lib/utils'
import './glass.css'
import { EDGE_MAP } from './edge-map'

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
      {/* Region padded past the box so displaced edge samples never read transparent. */}
      <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
        <feImage href={EDGE_MAP} x="0%" y="0%" width="100%" height="100%" preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale={16} xChannelSelector="R" yChannelSelector="G" />
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
  if (intensity !== undefined && Number.isFinite(intensity)) vars['--glass-intensity'] = String(Math.min(1, Math.max(0, intensity)))
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
