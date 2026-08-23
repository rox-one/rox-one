/**
 * useOpenClawAudit — renderer hook for the OpenClaw security audit panel
 * (RX-TSK-0112).
 *
 * Loads the current runtime status and the latest stored audit snapshot for
 * the active workspace, exposes run/accept/revoke actions, and degrades to
 * `available: false` when the connected server has no OpenClaw handlers
 * (headless/remote transports), mirroring useToolchainStatus.
 */

import { useCallback, useEffect, useState } from 'react'
import { RPC_CHANNELS } from '../../shared/types'
import type {
  AuditMode,
  OpenClawRuntimeStatus,
  SecurityAuditSnapshot,
} from '@craft-agent/shared/openclaw'

export interface UseOpenClawAuditResult {
  /** False when OpenClaw handlers are absent on this transport. */
  available: boolean
  isLoading: boolean
  runtimeStatus: OpenClawRuntimeStatus | null
  snapshot: SecurityAuditSnapshot | null
  /** Audit currently running (mode) or null when idle. */
  runningMode: AuditMode | null
  error: string | null
  refresh: () => void
  runAudit: (mode: AuditMode) => Promise<void>
  acceptRisk: (fingerprint: string, rationale: string, expiresAt: number) => Promise<void>
  revokeRisk: (fingerprint: string) => Promise<void>
}

export function useOpenClawAudit(workspaceId: string | undefined): UseOpenClawAuditResult {
  const [available, setAvailable] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [runtimeStatus, setRuntimeStatus] = useState<OpenClawRuntimeStatus | null>(null)
  const [snapshot, setSnapshot] = useState<SecurityAuditSnapshot | null>(null)
  const [runningMode, setRunningMode] = useState<AuditMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const refresh = useCallback(() => setReloadTick((t) => t + 1), [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.isChannelAvailable?.(RPC_CHANNELS.securityAudit.GET_LATEST)) {
      setAvailable(false)
      setIsLoading(false)
      return
    }
    if (!workspaceId) {
      setIsLoading(false)
      return
    }
    setAvailable(true)

    let cancelled = false
    setError(null)

    Promise.all([
      api.getOpenClawRuntimeStatus({ workspaceId }).catch(() => null),
      api.getLatestSecurityAudit({ workspaceId }),
    ])
      .then(([status, latest]) => {
        if (cancelled) return
        setRuntimeStatus(status)
        setSnapshot(latest)
        setIsLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[useOpenClawAudit] load failed:', err)
        setError(err instanceof Error ? err.message : String(err))
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, reloadTick])

  const runAudit = useCallback(
    async (mode: AuditMode) => {
      const api = window.electronAPI
      if (!api || !workspaceId || runningMode) return
      setRunningMode(mode)
      setError(null)
      try {
        const next = await api.runSecurityAudit({ workspaceId, mode })
        setSnapshot(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setRunningMode(null)
      }
    },
    [workspaceId, runningMode],
  )

  const acceptRisk = useCallback(
    async (fingerprint: string, rationale: string, expiresAt: number) => {
      const api = window.electronAPI
      if (!api || !workspaceId) return
      try {
        await api.acceptSecurityRisk({ workspaceId, fingerprint, rationale, expiresAt })
        refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [workspaceId, refresh],
  )

  const revokeRisk = useCallback(
    async (fingerprint: string) => {
      const api = window.electronAPI
      if (!api || !workspaceId) return
      try {
        await api.revokeSecurityRiskAcceptance({ workspaceId, fingerprint })
        refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [workspaceId, refresh],
  )

  return {
    available,
    isLoading,
    runtimeStatus,
    snapshot,
    runningMode,
    error,
    refresh,
    runAudit,
    acceptRisk,
    revokeRisk,
  }
}
