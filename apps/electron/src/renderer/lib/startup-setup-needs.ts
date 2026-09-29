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
 * - retry the RPC with a short backoff before giving up;
 * - a definitive answer (`isFullyConfigured`) always wins;
 * - if every attempt failed, a user who already finished the Welcome step
 *   goes to the app (it has its own reconnect UI) instead of onboarding;
 *   only a genuinely new user (no confirmed name) falls back to onboarding.
 */
import type { SetupNeeds } from '../../shared/types'

export type StartupAppState = 'onboarding' | 'workspace-picker' | 'ready'

export const STARTUP_SETUP_NEEDS_RETRY_DELAYS_MS = [300, 700, 1500, 2500, 4000] as const

export type SetupNeedsProbe =
  | { ok: true; needs: SetupNeeds; attempts: number }
  | { ok: false; error: unknown; attempts: number }

export async function probeSetupNeeds(
  fetchNeeds: () => Promise<SetupNeeds>,
  options: {
    delaysMs?: readonly number[]
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<SetupNeedsProbe> {
  const delays = options.delaysMs ?? STARTUP_SETUP_NEEDS_RETRY_DELAYS_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastError: unknown
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const needs = await fetchNeeds()
      return { ok: true, needs, attempts: attempt + 1 }
    } catch (error) {
      lastError = error
      if (attempt < delays.length) await sleep(delays[attempt]!)
    }
  }
  return { ok: false, error: lastError, attempts: delays.length + 1 }
}

export function decideStartupAppState(input: {
  probe: SetupNeedsProbe
  usernameConfirmed: boolean
  workspaceId: string | null | undefined
}): StartupAppState {
  const { probe, usernameConfirmed, workspaceId } = input
  const configured = probe.ok ? probe.needs.isFullyConfigured : usernameConfirmed
  if (!configured || !usernameConfirmed) return 'onboarding'
  return workspaceId ? 'ready' : 'workspace-picker'
}
