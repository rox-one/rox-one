/**
 * Live TOTP display: the code is computed in the main process and refreshed
 * when it rotates — this component only renders it and ticks the countdown.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeeperTotpCode } from '../../../../shared/types'
import { formatTotpCode, totpSecondsLeft } from './vault-model'

export function TotpCountdown({ code, onExpire }: { code: KeeperTotpCode; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const notified = useRef<number>(0)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  const left = totpSecondsLeft(code.expiresAt, now)
  const ratio = code.period > 0 ? left / code.period : 0

  useEffect(() => {
    if (left > 0 || notified.current === code.expiresAt) return
    notified.current = code.expiresAt
    onExpire()
  }, [left, code.expiresAt, onExpire])

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-title numeric tracking-widest text-foreground">{formatTotpCode(code.code)}</span>
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
        <svg viewBox="0 0 36 36" className="h-7 w-7 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" className="stroke-border-subtle" />
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0, Math.min(1, ratio)) * 94.2} 94.2`}
            className="stroke-accent"
          />
        </svg>
        <span className="absolute text-caption numeric text-muted-foreground">{left}</span>
      </span>
    </div>
  )
}