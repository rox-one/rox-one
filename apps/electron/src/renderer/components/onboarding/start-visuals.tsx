/**
 * Start-screen visuals shared by the first-run onboarding steps: the animated
 * Rox logo, the eye mark used inside the primary button, and a fit-to-viewport
 * wrapper that scales a step down instead of letting the page scroll.
 *
 * All motion lives in onboarding-start.css and is switched off under
 * `prefers-reduced-motion` and the low-power render profile.
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import roxEyeMark from '@/assets/rox-eye-mark.png'

export function AnimatedRoxLogo({ className }: { className?: string }) {
  return (
    <div className={cn('onb-logo', className)} data-testid="onboarding-animated-logo">
      <span className="onb-logo-glow" aria-hidden="true" />
      <span className="onb-logo-ring" aria-hidden="true" />
      <span className="onb-logo-orbit" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span className="onb-logo-plate">
        <CraftAgentsSymbol className="size-[52px]" />
      </span>
    </div>
  )
}

/** The grayscale Rox eye (the app-icon crop), round, for buttons. */
export function RoxEyeMark({ className }: { className?: string }) {
  return (
    <img
      src={roxEyeMark}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('onb-eye shrink-0 rounded-full', className)}
    />
  )
}

/** Smallest transform scale before the start screens fall back to a thin scroll. */
export const FIT_MIN_SCALE = 0.75

/**
 * Scales its child down (never up) so it always fits the available height.
 * The child keeps its natural layout; only a transform is applied, so focus
 * order, hit-testing and accessibility are unchanged. Below `minScale` the
 * text would become unreadable, so the scale is clamped and the frame shows a
 * visible thin scrollbar instead of clipping silently.
 */
export function FitToViewport({
  children,
  className,
  minScale = FIT_MIN_SCALE,
}: {
  children: React.ReactNode
  className?: string
  minScale?: number
}) {
  const outerRef = React.useRef<HTMLDivElement>(null)
  const innerRef = React.useRef<HTMLDivElement>(null)
  const [fit, setFit] = React.useState({ scale: 1, natural: 0, overflow: false })

  React.useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const available = outer.clientHeight
      const natural = inner.offsetHeight
      if (available <= 0 || natural <= 0) return
      const ideal = Math.min(1, available / natural)
      const scale = Math.max(minScale, ideal)
      const overflow = ideal < minScale
      setFit((prev) =>
        Math.abs(prev.scale - scale) < 0.005 && prev.overflow === overflow && Math.abs(prev.natural - natural) < 1
          ? prev
          : { scale, natural, overflow },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [minScale])

  const { scale, natural, overflow } = fit
  return (
    <div
      ref={outerRef}
      data-fit-overflow={overflow ? 'true' : undefined}
      className={cn(
        'relative flex min-h-0 w-full flex-1 justify-center',
        overflow ? 'onb-thin-scroll overflow-y-auto overflow-x-hidden' : 'overflow-hidden',
        scale < 1 ? 'items-start' : 'items-center',
        className,
      )}
    >
      {/* Reserves the scaled height so a clamped frame scrolls exactly to the end. */}
      <div className="w-full shrink-0" style={overflow ? { height: natural * scale } : undefined}>
        <div
          ref={innerRef}
          data-fit-scale={scale.toFixed(3)}
          className="w-full"
          style={scale < 1 ? { transform: `scale(${scale})`, transformOrigin: 'top center' } : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Small animated check shown on every selectable chip, card and tag of the
 * start screens. Space is always reserved so selecting never shifts layout.
 */
export function ChipCheck({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('onb-check onb-check-sm', className)} data-checked={checked ? 'true' : 'false'}>
      <svg viewBox="0 0 16 16"><path d="M3.5 8.4l3 3 6-6.6" /></svg>
    </span>
  )
}
