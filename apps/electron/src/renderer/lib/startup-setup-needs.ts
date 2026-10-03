/** Bounded startup reads. Transport failure never substitutes for caller identity
 * or authoritative workspace readback; provider readiness stays in Settings. */
import type { SetupNeeds } from '../../shared/types'

export type StartupAppState = 'onboarding' | 'workspace-picker' | 'ready' | 'transport-unavailable'

export const STARTUP_RETRY_DELAYS_MS = [300, 700, 1500, 2500, 4000] as const
/** Overall budget for one probe (all attempts + backoff). */
export const STARTUP_PROBE_DEADLINE_MS = 12_000

export type ProbeResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: unknown; attempts: number }

export type SetupNeedsProbe = ProbeResult<SetupNeeds>

export interface ProbeOptions {
  delaysMs?: readonly number[]
  deadlineMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

class ProbeDeadlineError extends Error {
  constructor() {
    super('startup probe deadline exceeded')
    this.name = 'ProbeDeadlineError'
  }
}

/** Terminal authority denial cannot recover through a cached profile or retry. */
export function isStartupAuthorityDenial(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  const message = error instanceof Error ? error.message : String(error)
  return ['AUTH_FAILED', 'FORBIDDEN', 'UNAUTHENTICATED', 'UNAUTHORIZED'].includes(code)
    || /\b(?:AUTH_FAILED|FORBIDDEN|UNAUTHENTICATED|UNAUTHORIZED)\b/.test(message)
}

/** Retry `fn` with backoff; every attempt is raced against the remaining deadline. */
export async function probeWithRetry<T>(fn: () => Promise<T>, options: ProbeOptions = {}): Promise<ProbeResult<T>> {
  const delays = options.delaysMs ?? STARTUP_RETRY_DELAYS_MS
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const deadline = now() + (options.deadlineMs ?? STARTUP_PROBE_DEADLINE_MS)
  let lastError: unknown
  let attempts = 0
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const remaining = deadline - now()
    if (remaining <= 0) break
    attempts++
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      const value = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ProbeDeadlineError()), remaining)
        }),
      ]).finally(() => { if (timer) clearTimeout(timer) })
      return { ok: true, value, attempts }
    } catch (error) {
      lastError = error
      if (error instanceof ProbeDeadlineError || isStartupAuthorityDenial(error)) break
      if (attempt < delays.length) await sleep(Math.min(delays[attempt]!, Math.max(0, deadline - now())))
    }
  }
  return { ok: false, error: lastError ?? new ProbeDeadlineError(), attempts }
}

export function probeSetupNeeds(fetchNeeds: () => Promise<SetupNeeds>, options: ProbeOptions = {}): Promise<SetupNeedsProbe> {
  return probeWithRetry(fetchNeeds, options)
}

export function decideStartupAppState(input: {
  identityProbe: ProbeResult<{ authority: 'native' | 'local'; name?: string } | null>
  workspaceProbe: ProbeResult<string | null>
  cloudProbe?: ProbeResult<{ required: boolean; connected: boolean }>
}): StartupAppState {
  const { identityProbe, workspaceProbe } = input
  if (!identityProbe.ok || !workspaceProbe.ok) return 'transport-unavailable'
  const identity = identityProbe.value
  if (!identity || identity.authority !== 'native' && identity.authority !== 'local') return 'transport-unavailable'
  if (input.cloudProbe) {
    if (!input.cloudProbe.ok) return 'transport-unavailable'
    if (input.cloudProbe.value.required && !input.cloudProbe.value.connected) return 'onboarding'
  } else if (!identity.name?.trim()) return 'onboarding'
  return workspaceProbe.value ? 'ready' : 'workspace-picker'
}

/** Re-read an unavailable workspace after a successful setup RPC establishes transport recovery.
 * An authoritative null workspace remains a real picker decision, never an error fallback. */
export async function recoverStartupWorkspace(
  workspaceProbe: ProbeResult<string | null>,
  setupProbe: SetupNeedsProbe,
  fetchWorkspace: () => Promise<string | null>,
  options: ProbeOptions = {},
): Promise<ProbeResult<string | null>> {
  if (workspaceProbe.ok || !setupProbe.ok) return workspaceProbe
  return probeWithRetry(fetchWorkspace, options)
}
