import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/render-profile-motion'
import {
  requestDictationToggle,
  useDictationLevel,
  useDictationSession,
} from '../voice-dictation-state'

/**
 * Default capture cap assumed by the deck's countdown. No product-defined
 * dictation limit exists in the renderer today, so the strip exposes it as a
 * prop and this constant only seeds the accessory build.
 */
export const DICTATION_DEFAULT_LIMIT_SECONDS = 300

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Live microphone level, 20-bar canvas. Caller supplies a real RMS level. */
function DictationWave({ level, active }: { level: number; active: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const historyRef = React.useRef<number[]>(new Array<number>(20).fill(0))
  const reducedMotion = usePrefersReducedMotion()

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const value = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
    const history = historyRef.current
    if (!active) {
      for (let i = 0; i < history.length; i += 1) history[i] = 0
    } else if (reducedMotion) {
      for (let i = 0; i < history.length; i += 1) history[i] = value
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
    ctx.fillStyle = getComputedStyle(canvas).color || 'currentColor'
    ctx.globalAlpha = active ? 0.9 : 0.35
    const gap = 2
    const barWidth = Math.max(1, (width - gap * (history.length - 1)) / history.length)
    for (let i = 0; i < history.length; i += 1) {
      const barHeight = Math.max(1, (history[i] ?? 0) * height)
      ctx.fillRect(i * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight)
    }
  }, [level, active, reducedMotion])

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none size-full select-none" />
}

export interface DictationStripProps {
  /** Capture cap used for the remaining-time readout. */
  limitSeconds?: number
  /** Keyboard order for the stop affordance. */
  focusOrder?: number
  /** Stop capture; defaults to the registered control's own toggle. */
  onStop?: () => void
  className?: string
}

/**
 * Composer deck dictation strip (G5). Renders only while capture is running:
 * a live level meter, the «Слушаю» label, the remaining time and an in-place
 * stop affordance. It owns no capture state — it subscribes to the shared
 * session store published by `VoiceDictationControl`.
 */
export function DictationStrip({
  limitSeconds = DICTATION_DEFAULT_LIMIT_SECONDS,
  focusOrder,
  onStop,
  className,
}: DictationStripProps) {
  const { t } = useTranslation()
  const session = useDictationSession()
  const level = useDictationLevel()
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!session.active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [session.active])

  if (!session.active) return null

  const elapsed = session.startedAt ? Math.max(0, (now - session.startedAt) / 1000) : 0
  const remaining = Math.max(0, limitSeconds - elapsed)

  return (
    <div
      data-g05-dictation="active"
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-2.5 border-b border-border-subtle px-3 py-1.5',
        'motion-safe:transition-colors motion-safe:duration-[var(--motion-fast)] motion-reduce:transition-none',
        className,
      )}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-status-danger motion-safe:animate-pulse motion-reduce:animate-none" />
      <span className="shrink-0 text-caption font-medium text-text-primary">
        {t('composer.deck.dictation.listening', { defaultValue: 'Слушаю' })}
      </span>
      <span aria-hidden className="h-4 w-14 shrink-0 text-status-danger">
        <DictationWave level={level} active />
      </span>
      <span className="min-w-0 flex-1" />
      <span className="shrink-0 text-caption numeric text-text-secondary">
        {t('composer.deck.dictation.remaining', { defaultValue: 'осталось {{time}}', time: formatClock(remaining) })}
      </span>
      <button
        type="button"
        data-focus-order={focusOrder}
        onClick={onStop ?? requestDictationToggle}
        aria-label={t('composer.deck.dictation.stopAria', { defaultValue: 'Остановить диктовку' })}
        className="inline-flex min-h-[28px] shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 text-caption font-medium text-[var(--destructive-text)] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[length:var(--ring-width)] focus-visible:ring-focus-ring"
      >
        <Square className="icon-caption" />
        {t('composer.deck.dictation.stop', { defaultValue: 'Остановить' })}
      </button>
    </div>
  )
}