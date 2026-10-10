/**
 * Web-only entry-mode resolution (R16).
 *
 * The web entry offers two modes: «Быстрый чат» (the chat surface) and
 * «Облачная ВМ» (agent work on a remote machine). The chat mode is always
 * available; the cloud-VM mode is offered only when the host reports a usable
 * cloud-runs provider, and otherwise carries the concrete reason it is not —
 * never a fabricated success and never a dead button.
 *
 * Deliberately free of React/DOM imports so the resolution is unit-testable in
 * isolation and can be reused by any web entry.
 */

export type WebEntryModeId = 'chat' | 'cloud-vm'

/**
 * Validate a raw `?mode=` deep-link value. Only the two known ids are accepted;
 * anything else (missing, empty, a typo, an unknown future mode) is ignored so
 * the caller keeps its default entry flow rather than guessing.
 */
export function parseWebEntryMode(value: string | null | undefined): WebEntryModeId | undefined {
  return value === 'chat' || value === 'cloud-vm' ? value : undefined
}

export type CloudVmUnavailableReason =
  | 'runs-disabled'
  | 'local-provider'
  | 'provider-key-missing'
  | 'host-unavailable'

export type CloudVmState =
  | { status: 'loading' }
  | { status: 'available'; provider: string }
  | { status: 'unavailable'; reason: CloudVmUnavailableReason; provider?: string }
  | { status: 'error'; reason: 'probe-failed' }

/** Providers that execute on a remote machine (an actual cloud VM). */
const CLOUD_PROVIDERS: Record<string, true> = { daytona: true, native: true }

/**
 * Resolve the cloud-VM mode from the host's `cloudRuns.getCloudRunsConfig`
 * payload (see packages/server-core/src/handlers/rpc/cloud-runs.ts).
 *
 * The host may answer the not-live short-circuit `{ enabled: false,
 * tokenConfigured: false }` with no provider at all, so every field is
 * validated rather than assumed.
 */
export function resolveCloudVmState(config: unknown): Exclude<CloudVmState, { status: 'loading' }> {
  if (config === null || config === undefined) {
    return { status: 'unavailable', reason: 'host-unavailable' }
  }
  if (typeof config !== 'object') {
    return { status: 'error', reason: 'probe-failed' }
  }
  const enabled = 'enabled' in config ? config.enabled : undefined
  const provider = 'provider' in config ? config.provider : undefined
  const tokenConfigured = 'tokenConfigured' in config ? config.tokenConfigured : undefined
  const providerId = typeof provider === 'string' && provider ? provider : undefined

  if (enabled !== true) {
    return { status: 'unavailable', reason: 'runs-disabled', ...(providerId ? { provider: providerId } : {}) }
  }
  // Enabled but the host did not name a provider: the payload is not the
  // documented shape, so treat it as a failed probe rather than guess.
  if (!providerId) {
    return { status: 'error', reason: 'probe-failed' }
  }
  if (CLOUD_PROVIDERS[providerId] !== true) {
    // `local` runs on the host itself — that is the chat mode, not a cloud VM.
    return { status: 'unavailable', reason: 'local-provider', provider: providerId }
  }
  if (tokenConfigured !== true) {
    return { status: 'unavailable', reason: 'provider-key-missing', provider: providerId }
  }
  return { status: 'available', provider: providerId }
}

/** Minimal dependency surface so tests (and the web adapter) can inject a host. */
export interface CloudRunsProbeHost {
  getCloudRunsConfig(): Promise<unknown>
}

/**
 * Probe the host for cloud-VM availability. A missing host or a rejected RPC
 * is an `error` state — the landing then offers a retry instead of a dead
 * button or a fake success.
 */
export async function probeCloudVmState(
  host: CloudRunsProbeHost | undefined,
): Promise<Exclude<CloudVmState, { status: 'loading' }>> {
  if (!host) return { status: 'error', reason: 'probe-failed' }
  try {
    return resolveCloudVmState(await host.getCloudRunsConfig())
  } catch {
    return { status: 'error', reason: 'probe-failed' }
  }
}

/** i18n key explaining a resolved cloud-VM state. */
export function cloudVmStateMessageKey(state: Exclude<CloudVmState, { status: 'loading' }>): string {
  if (state.status === 'available') return 'webui.modes.cloudAvailable'
  if (state.status === 'error') return 'webui.modes.cloudReasonProbeFailed'
  switch (state.reason) {
    case 'runs-disabled': return 'webui.modes.cloudReasonDisabled'
    case 'local-provider': return 'webui.modes.cloudReasonLocal'
    case 'provider-key-missing': return 'webui.modes.cloudReasonKeyMissing'
    case 'host-unavailable': return 'webui.modes.cloudReasonHostUnavailable'
  }
}

/**
 * The mode landing is offered strictly to web sessions. `authMode` is present
 * on every `/api/auth/me` response (per-user Rox ID `oidc` or the legacy
 * `password`), so an unrecognized payload keeps the desktop-like flow.
 */
export function isWebSession(payload: unknown): payload is { authMode: 'oidc' | 'password' } {
  if (typeof payload !== 'object' || payload === null) return false
  if (!('authMode' in payload)) return false
  return payload.authMode === 'oidc' || payload.authMode === 'password'
}

/**
 * Read the operator's landing switch from the `GET /api/config` payload
 * (`modesLanding`, published by http-server from `ROX_WEBUI_MODES_LANDING`).
 * The flag defaults to enabled: an unreadable or unrecognized config keeps the
 * documented default (the landing is offered) rather than silently changing the
 * entry flow, and only an explicit `false` disables it.
 */
export function isModesLandingEnabled(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return true
  if (!('modesLanding' in payload)) return true
  return payload.modesLanding !== false
}