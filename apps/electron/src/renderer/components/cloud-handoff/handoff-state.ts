/** Pure view-model helpers for the «В облако» button (unit-tested). */
import type { CloudHandoffConfig, CloudHandoffPhase, CloudHandoffStatus } from '../../../shared/types'

export const HANDOFF_POLL_MS = 1_500

export function isHandoffInFlight(status: CloudHandoffStatus | null | undefined): boolean {
  if (!status) return false
  return status.phase !== 'ready' && status.phase !== 'failed' && status.phase !== 'cancelled'
}

export function phaseLabelKey(phase: CloudHandoffPhase): string {
  return `cloudHandoff.phase.${phase}`
}

const KNOWN_FAILURES = new Set([
  'disabled', 'no_key', 'sign_in_required', 'sso_not_configured', 'too_large',
  'quota_exceeded', 'provider_error', 'start_timeout', 'cancelled',
])

export function failureLabelKey(code: string | undefined): string {
  return `cloudHandoff.error.${code && KNOWN_FAILURES.has(code) ? code : 'provider_error'}`
}

/** A personal key is needed when the user has none and no Rox broker is configured. */
export function needsUserKey(config: CloudHandoffConfig | null): boolean {
  return !!config && !config.userKeyConfigured && !config.brokerConfigured
}

/** A live cloud session exists for this chat (link can be (re)issued, can be ended). */
export function hasLiveSession(status: CloudHandoffStatus | null | undefined): boolean {
  return status?.phase === 'ready' && !status.ended
}

/** Links are bearer credentials: keep them out of component state. */
export function withoutLink(status: CloudHandoffStatus | null): CloudHandoffStatus | null {
  if (!status) return null
  const { sessionUrl: _url, ...rest } = status
  return rest
}

/** Only https session links are ever opened. */
export function safeSessionUrl(status: CloudHandoffStatus | null | undefined): string | null {
  const raw = hasLiveSession(status) ? status?.sessionUrl : undefined
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
