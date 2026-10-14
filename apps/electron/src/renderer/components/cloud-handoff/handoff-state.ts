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

/** A key is needed from the user only when neither theirs nor the shared default exists. */
export function needsUserKey(config: CloudHandoffConfig | null): boolean {
  return !!config && !config.userKeyConfigured && !config.serverDefaultKeyAvailable
}

/** Only https session links are ever opened. */
export function safeSessionUrl(status: CloudHandoffStatus | null | undefined): string | null {
  const raw = status?.phase === 'ready' ? status.sessionUrl : undefined
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
