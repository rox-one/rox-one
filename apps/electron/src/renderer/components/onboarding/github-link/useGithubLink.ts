/**
 * GitHub account linking — renderer state machine.
 *
 * The dialog owns presentation; this hook owns the flow:
 *   start → open github.com/login/device → poll on the device-flow interval →
 *   linked (profile) or expired/denied. Polling is bounded by the device code's
 *   expiry and a hard poll cap, so a stuck flow cannot poll forever. It never
 *   invents states: an absent client/workspace or an unreachable service
 *   surfaces as `unavailable`.
 *
 * The typed client validates every envelope and rejects any response carrying
 * the device flow's private material; the token never reaches the renderer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GithubLinkError,
  createBridgeGithubLinkClient,
  type GithubLinkClient,
  type GithubLinkErrorCode,
  type GithubLinkProfile,
} from '@rox/shared/identity'

/** Dialog-facing state. */
export type GithubLinkView = 'idle' | 'waiting' | 'linked' | 'expired' | 'unavailable'

export type GithubLinkFailure = GithubLinkErrorCode | 'denied'

export interface UseGithubLinkOptions {
  /** Whether the dialog is open; polling stops when closed. */
  open: boolean
  /** Link client; omit to fall back to the Electron bridge. */
  client?: GithubLinkClient
  /** Workspace the link is scoped to. */
  workspaceId?: string
  /** Opens the verification page (shell.openExternal). */
  openExternal?: (url: string) => void | Promise<void>
  /** Called once when the profile is linked. */
  onLinked?: (profile: GithubLinkProfile) => void
  /** Fallback poll cadence when the flow reports none. */
  pollMs?: number
  /** Hard poll cap; reaching it expires the dialog. */
  maxPolls?: number
  /** Clock seam. */
  now?: () => number
}

export interface UseGithubLink {
  status: GithubLinkView
  /** Begins a link (if needed) and opens the verification page. */
  start: () => Promise<void>
  /** Re-opens the verification page without minting a new flow. */
  reopen: () => void
  /** Linked profile, once `status === 'linked'`. */
  profile: GithubLinkProfile | null
  /** User code to type at github.com/login/device while waiting. */
  userCode: string | null
  /** Verification page opened by `start`; re-openable while waiting. */
  verificationUri: string | null
  /** Milliseconds left before the device code expires (0 when unknown). */
  remainingMs: number
  /** Last failure; cleared on the next attempt. */
  error: GithubLinkFailure | null
}

const DEFAULT_POLL_MS = 5000
const DEFAULT_MAX_POLLS = 200
const DEFAULT_TICK_MS = 1000

function defaultOpenExternal(url: string): void {
  if (typeof window === 'undefined') return
  const api: unknown = window.electronAPI
  if (typeof api === 'object' && api !== null && 'openUrl' in api && typeof api.openUrl === 'function') {
    void Promise.resolve(api.openUrl(url)).catch(() => {})
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function bridgeClient(): GithubLinkClient | undefined {
  if (typeof window === 'undefined') return undefined
  return createBridgeGithubLinkClient(window.electronAPI)
}

export function useGithubLink(options: UseGithubLinkOptions): UseGithubLink {
  const {
    open,
    client,
    workspaceId,
    openExternal,
    onLinked,
    pollMs = DEFAULT_POLL_MS,
    maxPolls = DEFAULT_MAX_POLLS,
    now = Date.now,
  } = options

  const [status, setStatus] = useState<GithubLinkView>('idle')
  const [profile, setProfile] = useState<GithubLinkProfile | null>(null)
  const [userCode, setUserCode] = useState<string | null>(null)
  const [verificationUri, setVerificationUri] = useState<string | null>(null)
  const [remainingMs, setRemainingMs] = useState(0)
  const [error, setError] = useState<GithubLinkFailure | null>(null)

  const flowRef = useRef<{ flowId: string; intervalMs: number; expiresAt: number | null } | null>(null)
  const pollsRef = useRef(0)
  const linkedNotifiedRef = useRef(false)
  const workspaceRef = useRef(workspaceId)
  workspaceRef.current = workspaceId
  const onLinkedRef = useRef(onLinked)
  onLinkedRef.current = onLinked

  const activeClient = useMemo(() => client ?? bridgeClient(), [client])

  const refresh = useCallback(async (): Promise<boolean> => {
    const active = activeClient
    const flow = flowRef.current
    const workspace = workspaceRef.current
    if (!active || !flow || !workspace) return false
    try {
      const next = await active.poll(flow.flowId, workspace)
      pollsRef.current += 1
      if (next.status === 'linked') {
        flowRef.current = null
        setProfile(next.profile)
        setStatus('linked')
        setRemainingMs(0)
        setError(null)
        if (!linkedNotifiedRef.current) {
          linkedNotifiedRef.current = true
          onLinkedRef.current?.(next.profile)
        }
        return false
      }
      if (next.status === 'expired') {
        flowRef.current = null
        setStatus('expired')
        return false
      }
      if (next.status === 'denied') {
        flowRef.current = null
        setStatus('idle')
        setError('denied')
        return false
      }
      if (typeof next.interval === 'number' && next.interval > 0) {
        flow.intervalMs = next.interval * 1000
      }
      setError(null)
      return true
    } catch (failure) {
      // A transient network failure keeps the honest waiting state; a malformed
      // response is surfaced but polling continues until the bounded cap.
      setError(failure instanceof GithubLinkError ? failure.code : 'network')
      return true
    }
  }, [activeClient])

  const start = useCallback(async () => {
    setError(null)
    setProfile(null)
    linkedNotifiedRef.current = false
    const active = activeClient
    const workspace = workspaceRef.current
    if (!active || !workspace) {
      setStatus('unavailable')
      return
    }
    try {
      const started = await active.start()
      flowRef.current = {
        flowId: started.flowId,
        intervalMs: (started.interval > 0 ? started.interval : pollMs / 1000) * 1000,
        expiresAt: typeof started.expiresIn === 'number' && started.expiresIn > 0 ? now() + started.expiresIn * 1000 : null,
      }
      pollsRef.current = 0
      setUserCode(started.userCode)
      setVerificationUri(started.verificationUri)
      setStatus('waiting')
      setRemainingMs(flowRef.current.expiresAt ? Math.max(0, flowRef.current.expiresAt - now()) : 0)
      const opener = openExternal ?? defaultOpenExternal
      try {
        await opener(started.verificationUri)
      } catch {
        // The browser handler is unavailable; the code and link stay visible.
      }
    } catch (failure) {
      if (!(failure instanceof GithubLinkError)) throw failure
      setStatus('unavailable')
      setError(failure.code)
    }
  }, [activeClient, now, openExternal, pollMs])

  /** Re-open the verification page without minting a new flow. */
  const reopen = useCallback(() => {
    const uri = verificationUri
    if (!uri) return
    const opener = openExternal ?? defaultOpenExternal
    try {
      void opener(uri)
    } catch {
      /* The code stays visible; opening is best-effort. */
    }
  }, [openExternal, verificationUri])

  // Bounded polling while waiting.
  useEffect(() => {
    if (!open || status !== 'waiting' || !workspaceId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const delay = flowRef.current?.intervalMs ?? pollMs
      timer = setTimeout(() => { void tick() }, delay)
    }
    const tick = async () => {
      if (cancelled) return
      const flow = flowRef.current
      if (!flow) return
      if (pollsRef.current >= maxPolls) {
        flowRef.current = null
        setStatus('expired')
        return
      }
      if (flow.expiresAt !== null && now() >= flow.expiresAt) {
        flowRef.current = null
        setStatus('expired')
        return
      }
      const keepGoing = await refresh()
      if (!cancelled && keepGoing && flowRef.current) schedule()
    }
    schedule()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, status, workspaceId, pollMs, maxPolls, now, refresh])

  // Countdown tick.
  useEffect(() => {
    if (!open || status !== 'waiting') return
    const tick = setInterval(() => {
      const expiresAt = flowRef.current?.expiresAt
      if (expiresAt === null || expiresAt === undefined) return
      const left = Math.max(0, expiresAt - now())
      setRemainingMs(left)
      if (left === 0) {
        flowRef.current = null
        setStatus('expired')
      }
    }, DEFAULT_TICK_MS)
    return () => clearInterval(tick)
  }, [open, status, now])

  // Reset per-open so a reopened dialog starts clean.
  useEffect(() => {
    if (open) return
    flowRef.current = null
    pollsRef.current = 0
    linkedNotifiedRef.current = false
    setStatus('idle')
    setProfile(null)
    setUserCode(null)
    setVerificationUri(null)
    setRemainingMs(0)
    setError(null)
  }, [open])

  // Reload an existing link so a reopened dialog reflects it without a new flow.
  useEffect(() => {
    if (!open || !workspaceId) return
    const active = activeClient
    if (!active) return
    let cancelled = false
    void Promise.resolve(active.get(workspaceId))
      .then(stored => {
        if (cancelled || !stored) return
        setProfile(stored)
        setStatus('linked')
        if (!linkedNotifiedRef.current) {
          linkedNotifiedRef.current = true
          onLinkedRef.current?.(stored)
        }
      })
      .catch(() => {
        // Reload is best-effort; starting a new flow is still available.
      })
    return () => { cancelled = true }
  }, [open, workspaceId, activeClient])

  return { status, start, reopen, profile, userCode, verificationUri, remainingMs, error }
}