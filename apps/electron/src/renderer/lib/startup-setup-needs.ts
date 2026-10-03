/**
 * Startup gate: decide between onboarding and the app without letting a
 * transient transport/RPC failure masquerade as "not configured".
 *
 * Before this, App.tsx showed onboarding whenever the first
 * `getSetupNeeds()` call threw (server still booting, handshake timeout, a
 * reconnect, or a sibling instance holding ~/.rox/.server.lock). An already
 * set-up user then landed on «Как вы хотите подключиться?» even though their
 * config (connection + setupDeferred) was intact.
 *
 * Rules:
 * - retry the startup RPCs with a short backoff, bounded by an overall
 *   deadline (a hung request cannot stretch startup to minutes);
 * - provider/account readiness does not replace the name-only Welcome;
 * - if every attempt failed, App waits for the transport to reconnect and
 *   probes once more; only then does a user who already finished the Welcome
 *   step go to the app (never onboarding). A genuinely new user (no confirmed
 *   name) falls back to onboarding.
 */
import type { SetupNeeds } from '../../shared/types'

export type StartupAppState = 'onboarding' | 'workspace-picker' | 'ready'

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
      if (error instanceof ProbeDeadlineError) break
      if (attempt < delays.length) await sleep(Math.min(delays[attempt]!, Math.max(0, deadline - now())))
    }
  }
  return { ok: false, error: lastError ?? new ProbeDeadlineError(), attempts }
}

export function probeSetupNeeds(fetchNeeds: () => Promise<SetupNeeds>, options: ProbeOptions = {}): Promise<SetupNeedsProbe> {
  return probeWithRetry(fetchNeeds, options)
}

export function decideStartupAppState(input: {
  probe: SetupNeedsProbe
  usernameConfirmed: boolean
  workspaceId: string | null | undefined
}): StartupAppState {
  const { usernameConfirmed, workspaceId } = input
  if (!usernameConfirmed) return 'onboarding'
  return workspaceId ? 'ready' : 'workspace-picker'
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
