import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/render-profile-motion'

/**
 * Rox coins celebration.
 *
 * Plays only after a reward is CONFIRMED (`confirmed` prop): falling gold
 * coins plus a centred "+N Rox coins" pop, then auto-dismisses. Under reduced
 * motion it degrades to a static, non-animated notice. The currency name is
 * always the literal brand "Rox coins"; only the optional `reason` label is
 * translated.
 */

export const COINS_BURST_DEFAULT_DURATION_MS = 1800

/** Coins drawn per burst. Kept small so the overlay stays lightweight. */
export const COINS_BURST_COIN_COUNT = 9

const COIN_SIZE_CLASS = ['size-4', 'size-5', 'size-6'] as const
const CURRENCY_NAME = 'Rox coins'

export type CoinsBurstProps = {
  /** Rox coins granted for this award. */
  count: number
  /** Step id used to resolve the translated reason label. */
  reason?: string
  /** Only a server-confirmed award animates. */
  confirmed: boolean
  /** Override the OS/render-profile reduced-motion detection. */
  reducedMotion?: boolean
  durationMs?: number
  onDismiss?: () => void
  className?: string
}

export function RoxCoinIcon({ className }: { className?: string }) {
  const gradientId = `rox-coin-gold-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="6" y1="2" x2="18" y2="22" gradientUnits="userSpaceOnUse">
          {/* Warm gold from the status scale — light → mid → deep, no raw hex. */}
          <stop stopColor="color-mix(in oklab, var(--status-warning) 35%, white)" />
          <stop offset="0.5" stopColor="var(--status-warning)" />
          <stop offset="1" stopColor="color-mix(in oklab, var(--status-warning) 82%, black)" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9.25" fill={`url(#${gradientId})`} stroke="currentColor" strokeOpacity="0.35" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeOpacity="0.3" />
      <path
        d="M12 7.6l1.32 2.68 2.96.43-2.14 2.09.5 2.95L12 14.35l-2.64 1.4.5-2.95-2.14-2.09 2.96-.43Z"
        fill="currentColor"
        fillOpacity="0.55"
      />
    </svg>
  )
}

export function CoinsBurst({
  count,
  reason,
  confirmed,
  reducedMotion,
  durationMs = COINS_BURST_DEFAULT_DURATION_MS,
  onDismiss,
  className,
}: CoinsBurstProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(true)
  const burstRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const reduced = reducedMotion ?? prefersReducedMotion

  useEffect(() => {
    setVisible(true)
  }, [count, confirmed])

  useEffect(() => {
    if (!confirmed || count <= 0) return
    const timer = setTimeout(() => {
      setVisible(false)
      onDismiss?.()
    }, durationMs)
    return () => clearTimeout(timer)
  }, [confirmed, count, durationMs, onDismiss])

  // Motion plays the burst through the Web Animations API. When an overlay is
  // torn down mid-flight the in-flight animation is cancelled and its
  // `finished` promise rejects with an AbortError; left unhandled that crashes
  // consumers (and tests). Swallow those rejections — the running animation is
  // untouched — both once the animations have started and again on teardown.
  useEffect(() => {
    const root = burstRef.current
    if (!root) return
    const swallowCancellations = () => {
      const nodes: Element[] = [root, ...Array.from(root.querySelectorAll('*'))]
      for (const node of nodes) {
        const animations = node.getAnimations?.()
        if (!animations) continue
        for (const animation of animations) animation.finished?.catch(() => {})
      }
    }
    swallowCancellations()
    // Motion may only register the WAAPI animations on the next frame.
    const frame = requestAnimationFrame(swallowCancellations)
    return () => {
      cancelAnimationFrame(frame)
      swallowCancellations()
    }
  })

  if (!confirmed || count <= 0) return null

  const amount = `+${count}`
  const label = reason ? t(`onboarding.rewards.reason.${reason}`) : undefined
  const ariaLabel = t('onboarding.rewards.burstAria', { count })

  if (reduced) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={ariaLabel}
        data-testid="onboarding-coins-static"
        className={cn(
          // eslint-disable-next-line rox/prefer-primitives -- non-interactive celebration layer (pointer-events-none, role=status); a modal Dialog/Sheet would trap focus and block the app
          'pointer-events-none fixed inset-0 z-toast flex items-center justify-center',
          className,
        )}
      >
        <div className="flex flex-col items-center gap-1 rounded-lg border border-status-warning/40 bg-background/95 px-4 py-3 shadow-modal-small">
          <div className="flex items-center gap-2 text-foreground">
            <RoxCoinIcon className="size-6 text-status-warning" />
            <span className="text-lg font-semibold tabular-nums">{amount}</span>
            <span className="text-sm font-medium">{CURRENCY_NAME}</span>
          </div>
          {label && <span className="text-xs text-muted-foreground">{label}</span>}
        </div>
      </div>
    )
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          ref={burstRef}
          role="status"
          aria-live="polite"
          aria-label={ariaLabel}
          data-testid="onboarding-coins-burst"
          data-count={count}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            // eslint-disable-next-line rox/prefer-primitives -- non-interactive celebration layer (pointer-events-none, role=status); a modal Dialog/Sheet would trap focus and block the app
            'pointer-events-none fixed inset-0 z-toast overflow-hidden',
            className,
          )}
        >
          {Array.from({ length: COINS_BURST_COIN_COUNT }, (_, index) => (
            <motion.span
              key={index}
              aria-hidden="true"
              className="absolute top-0 text-status-warning"
              style={{ left: `${((index * 37) % 92) + 4}%` } as CSSProperties}
              initial={{ y: '-12vh', opacity: 0, rotate: 0 }}
              animate={{ y: '112vh', opacity: [0, 1, 1, 0], rotate: 360 * (index % 2 === 0 ? 1 : -1) }}
              transition={{
                duration: 1.1 + (index % 3) * 0.18,
                delay: (index % 5) * 0.07,
                ease: 'easeIn',
              }}
            >
              <RoxCoinIcon className={COIN_SIZE_CLASS[index % COIN_SIZE_CLASS.length]} />
            </motion.span>
          ))}

          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
          >
            <div className="flex flex-col items-center gap-1 rounded-lg border border-status-warning/50 bg-background/95 px-5 py-3 shadow-modal-small">
              <div className="flex items-center gap-2 text-foreground">
                <RoxCoinIcon className="size-6 text-status-warning" />
                <span className="text-xl font-semibold tabular-nums">{amount}</span>
                <span className="text-sm font-medium">{CURRENCY_NAME}</span>
              </div>
              {label && <span className="text-xs text-muted-foreground">{label}</span>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}