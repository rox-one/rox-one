/**
 * Lazy thinking-orbs (MIT © 2026 Jakub Antalik) behind FxGate.
 * The orb chunk is only fetched once an orb actually needs to render.
 */
import * as React from 'react'
import { lazy, useMemo } from 'react'
import type { OrbSize, OrbState } from 'thinking-orbs'
import { FxGate } from './FxGate'

const LazyThinkingOrb = lazy(() => import('thinking-orbs').then((m) => ({ default: m.ThinkingOrb })))

export interface ThinkingOrbFxProps {
  state?: OrbState
  size?: OrbSize
  fallback: React.ReactNode
  /** Accessible label; decorative (aria-hidden) when omitted. */
  label?: string
  className?: string
}

export function ThinkingOrbFx({ state = 'working', size = 20, fallback, label, className }: ThinkingOrbFxProps) {
  const ink = useMemo(readAccentInk, [])
  return (
    <FxGate kind="canvas" fallback={fallback} className={className}>
      {({ paused }) => (
        <LazyThinkingOrb
          state={state}
          size={size}
          paused={paused}
          theme="auto"
          color={ink}
          aria-label={label}
          aria-hidden={label ? undefined : true}
        />
      )}
    </FxGate>
  )
}

/**
 * Arc Glass / theme accent (`--accent`, an oklch() token) resolved to rgb()
 * for the canvas ink — the orb only accepts #hex or rgb(). Rasterizes one
 * pixel so any CSS color syntax the engine understands works.
 */
export function readAccentInk(): string | undefined {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return undefined
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  if (!raw) return undefined
  try {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx) return undefined
    ctx.fillStyle = raw
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return a ? `rgb(${r}, ${g}, ${b})` : undefined
  } catch {
    return undefined
  }
}
