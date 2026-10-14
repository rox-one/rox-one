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

/**
 * Scales its child down (never up) so it always fits the available height.
 * The child keeps its natural layout; only a transform is applied, so focus
 * order, hit-testing and accessibility are unchanged.
 */
export function FitToViewport({ children, className }: { children: React.ReactNode; className?: string }) {
  const outerRef = React.useRef<HTMLDivElement>(null)
  const innerRef = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(1)

  React.useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const available = outer.clientHeight
      const natural = inner.offsetHeight
      if (available <= 0 || natural <= 0) return
      const next = Math.min(1, available / natural)
      setScale((prev) => (Math.abs(prev - next) < 0.005 ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={outerRef} className={cn('relative flex min-h-0 w-full flex-1 justify-center overflow-hidden', scale < 1 ? 'items-start' : 'items-center', className)}>
      <div
        ref={innerRef}
        data-fit-scale={scale.toFixed(3)}
        className="w-full shrink-0"
        style={scale < 1 ? { transform: `scale(${scale})`, transformOrigin: 'top center' } : undefined}
      >
        {children}
      </div>
    </div>
  )
}
