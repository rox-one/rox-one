/**
 * Background feeds for the notification center (top50 #9) that are not
 * pushed by the session event processor: automation runs and the rox.one
 * balance. Mounted once by the bell.
 *
 * Automations: every automation's last-run timestamp is compared with a
 * per-workspace baseline in localStorage, so runs that happened while the app
 * was closed still show up; the very first look only records the baseline.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import * as storage from '@/lib/local-storage'
import { routes } from '@/lib/navigate'
import { parseAutomationsConfig } from '@/components/automations/types'
import { pushNotification } from './notifications'

/**
 * Balance (USD) at or below which the balance counts as low. `getRoxBalance`
 * returns the server's micro-USD ledger as dollars (`availableRox`, 6 decimals);
 * new accounts start with $1, so warn at 20 cents.
 */
export const LOW_BALANCE_USD = 0.2
const BALANCE_POLL_MS = 5 * 60_000
const AUTOMATION_POLL_MS = 60_000

interface Baselines {
  automations?: Record<string, Record<string, number>>
  balanceLow?: boolean
}

function readBaselines(): Baselines {
  const raw = storage.get<unknown>(storage.KEYS.shellNotificationBaselines, {})
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Baselines) : {}
}
function writeBaselines(next: Baselines): void {
  storage.set(storage.KEYS.shellNotificationBaselines, next)
}

export interface AutomationRunDiff { id: string; ts: number; ok: boolean }

/** New runs since the baseline. `null` baseline → first look, nothing is new. */
export function diffAutomationRuns(
  baseline: Record<string, number> | undefined,
  last: Record<string, { ts: number; ok: boolean }>,
): AutomationRunDiff[] {
  if (!baseline) return []
  const out: AutomationRunDiff[] = []
  for (const [id, run] of Object.entries(last)) {
    if (!run || typeof run.ts !== 'number') continue
    if (run.ts > (baseline[id] ?? 0)) out.push({ id, ts: run.ts, ok: run.ok !== false })
  }
  return out.sort((a, b) => a.ts - b.ts)
}

/** Crossing into "low" fires once; recovering above the threshold re-arms it. */
export function nextBalanceLow(prevLow: boolean | undefined, balance: number): { low: boolean; fire: boolean } {
  const low = balance <= LOW_BALANCE_USD + 1e-9
  return { low, fire: low && prevLow !== true }
}

/** `$0.20`-style amount for the low-balance body. */
export function formatUsd(balance: number): string {
  return `$${Math.max(0, balance).toFixed(2)}`
}

export function useNotificationSources(workspaceId: string | null | undefined): void {
  const { t } = useTranslation()
  const tRef = React.useRef(t)
  tRef.current = t

  // Automation runs.
  React.useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI
    if (!workspaceId || typeof api?.getAutomationLastExecuted !== 'function' || typeof api.getAutomations !== 'function') return
    let cancelled = false
    let running = false
    const check = async () => {
      if (running) return
      running = true
      try {
        const last = await api.getAutomationLastExecuted(workspaceId, true)
        if (cancelled || !last || typeof last !== 'object') return
        const baselines = readBaselines()
        const prev = baselines.automations?.[workspaceId]
        const fresh = diffAutomationRuns(prev, last)
        if (fresh.length > 0) {
          let names: Record<string, string> = {}
          try {
            const json = await api.getAutomations(workspaceId)
            names = Object.fromEntries((json ? parseAutomationsConfig(json) : []).map((a) => [a.id, a.name]))
          } catch { /* names are cosmetic */ }
          if (cancelled) return
          for (const run of fresh) {
            const name = names[run.id] ?? run.id
            pushNotification({
              kind: run.ok ? 'automation' : 'error',
              title: tRef.current(run.ok ? 'shell.notifications.automationOk' : 'shell.notifications.automationFailed', { name }),
              at: run.ts,
              workspaceId,
              route: routes.view.automations({ automationId: run.id }),
              dedupeKey: `automation:${workspaceId}:${run.id}:${run.ts}`,
            })
          }
        }
        const nextBaseline: Record<string, number> = { ...(prev ?? {}) }
        for (const [id, run] of Object.entries(last)) if (run && typeof run.ts === 'number') nextBaseline[id] = Math.max(nextBaseline[id] ?? 0, run.ts)
        const latest = readBaselines()
        writeBaselines({ ...latest, automations: { ...(latest.automations ?? {}), [workspaceId]: nextBaseline } })
      } catch {
        /* no automations backend in this build/workspace — nothing to report */
      } finally {
        running = false
      }
    }
    void check()
    const off = typeof api.onAutomationsChanged === 'function'
      ? api.onAutomationsChanged((changed) => { if (changed === workspaceId) void check() })
      : undefined
    const timer = window.setInterval(() => void check(), AUTOMATION_POLL_MS)
    return () => { cancelled = true; off?.(); window.clearInterval(timer) }
  }, [workspaceId])

  // Balance running low (account-wide).
  React.useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI
    if (typeof api?.getRoxBalance !== 'function') return
    let cancelled = false
    const check = async () => {
      try {
        const res = await api.getRoxBalance()
        if (cancelled || res.status !== 'ok' || typeof res.balance !== 'number' || !Number.isFinite(res.balance)) return
        const baselines = readBaselines()
        const { low, fire } = nextBalanceLow(baselines.balanceLow, res.balance)
        if (fire) {
          pushNotification({
            kind: 'balance',
            title: tRef.current('shell.notifications.balanceLow'),
            body: tRef.current('shell.notifications.balanceLowBody', { balance: formatUsd(res.balance) }),
            route: routes.view.settings('account'),
            dedupeKey: 'balance:low',
          })
        }
        if (baselines.balanceLow !== low) writeBaselines({ ...readBaselines(), balanceLow: low })
      } catch { /* offline / not signed in: no signal */ }
    }
    void check()
    const timer = window.setInterval(() => void check(), BALANCE_POLL_MS)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [])
}
