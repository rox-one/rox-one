import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/render-profile-motion'

/** Number of bars in the wave. Short enough to read as a level meter. */
const BAR_COUNT = 20

function clampLevel(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export interface VoiceLevelWaveProps {
  /** Latest microphone loudness, 0..1. */
  level: number
  /** Whether capture is running; inactive clears the meter. */
  active: boolean
  className?: string
}

/**
 * Live microphone level meter rendered as canvas bars. The component is
 * presentation-only: the caller supplies a real RMS level and decides where it
 * appears. With `prefers-reduced-motion` the history scroll is dropped and the
 * bars show the current level directly, so the indication stays visible.
 */
export function VoiceLevelWave({ level, active, className }: VoiceLevelWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const historyRef = useRef<number[]>(new Array<number>(BAR_COUNT).fill(0))
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const value = clampLevel(level)
    const history = historyRef.current
    if (!active) {
      for (let i = 0; i < BAR_COUNT; i += 1) history[i] = 0
    } else if (reducedMotion) {
      for (let i = 0; i < BAR_COUNT; i += 1) history[i] = value
    } else {
      history.shift()
      history.push(value)
    }

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    const pixelWidth = Math.round(width * dpr)
    const pixelHeight = Math.round(height * dpr)
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const color = getComputedStyle(canvas).color || 'currentColor'
    ctx.fillStyle = color
    ctx.globalAlpha = active ? 0.9 : 0.35

    const gap = 2
    const barWidth = Math.max(1, (width - gap * (BAR_COUNT - 1)) / BAR_COUNT)
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const barHeight = Math.max(1, clampLevel(history[i] ?? 0) * height)
      const x = i * (barWidth + gap)
      ctx.fillRect(x, (height - barHeight) / 2, barWidth, barHeight)
    }
  }, [level, active, reducedMotion])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('pointer-events-none select-none', className)}
    />
  )
}