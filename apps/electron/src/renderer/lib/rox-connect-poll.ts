/**
 * Rox Connect poll decisions for the onboarding device flow.
 *
 * Main already times out `waitForRoxDeviceApproval`. The renderer must also
 * stop its GET_ROX_CLOUD_STATE interval on expiry or state-read failure
 * instead of waiting forever.
 */

export const ROX_CONNECT_POLL_MS = 2_000
export const ROX_CONNECT_MIN_TTL_SEC = 60

export type RoxConnectPollDecision =
  | { action: 'continue' }
  | { action: 'connected' }
  | { action: 'expired' }
  | { action: 'failed'; message: string }

export function roxConnectDeadline(expiresIn: number | undefined, now = Date.now()): number {
  return now + Math.max(expiresIn ?? 0, ROX_CONNECT_MIN_TTL_SEC) * 1000
}

export function decideRoxConnectPoll(input: {
  now: number
  deadline: number
  connected?: boolean
  connectError?: string | null
  stateReadFailed?: boolean
  stateReadError?: string
}): RoxConnectPollDecision {
  if (input.connected) return { action: 'connected' }
  if (input.connectError) {
    if (input.connectError === 'DEVICE_CODE_EXPIRED' || input.connectError === 'expired') {
      return { action: 'expired' }
    }
    if (input.connectError === 'ROX_CONNECT_CANCELLED') {
      return { action: 'continue' }
    }
    return { action: 'failed', message: input.connectError }
  }
  if (input.stateReadFailed) {
    return {
      action: 'failed',
      message: input.stateReadError?.trim() || 'Rox Connect poll failed',
    }
  }
  if (input.now >= input.deadline) return { action: 'expired' }
  return { action: 'continue' }
}
