/**
 * useRoxCloudAccount — single polling source for the Rox account snapshot.
 *
 * The shell strip and the account settings page read through this hook so the
 * balance stays current within 30 s and refreshes whenever the window regains
 * focus. During a broker outage the main process keeps serving the last
 * confirmed snapshot; the hook surfaces it with `updating: true` instead of
 * blanking the balance.
 */
import * as React from 'react'
import type { RoxAccountSnapshot } from '@rox/shared/auth'

const ROX_ACCOUNT_POLL_MS = 30_000

export interface RoxCloudAccount {
  account: RoxAccountSnapshot | null
  connected: boolean
  updating: boolean
  lastSyncedAt: number | null
  connectError: string | null
}

export function useRoxCloudAccount(): RoxCloudAccount {
  const [state, setState] = React.useState<RoxCloudAccount>({
    account: null, connected: false, updating: false, lastSyncedAt: null, connectError: null,
  })

  React.useEffect(() => {
    let cancelled = false
    let reading = false
    const read = async () => {
      if (reading) return
      reading = true
      try {
        const cloud = await window.electronAPI.getRoxCloudState()
        if (cancelled) return
        setState({
          account: cloud?.account ?? null,
          connected: Boolean(cloud?.connected),
          updating: Boolean(cloud?.updating),
          lastSyncedAt: cloud?.lastSyncedAt ?? null,
          connectError: cloud?.connectError ?? null,
        })
      } catch {
        // A failed read must not blank a balance the main process already
        // confirmed: keep the previous snapshot and mark it as refreshing.
        if (!cancelled) setState(previous => previous.account
          ? { ...previous, updating: true }
          : { ...previous, connectError: 'ROX_AUTH_REQUEST_FAILED' })
      } finally { reading = false }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, ROX_ACCOUNT_POLL_MS)
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void read() }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  return state
}