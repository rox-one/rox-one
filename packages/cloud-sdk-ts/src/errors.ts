/**
 * One error type for everything the SDK can fail with, so a caller catches
 * `RoxApiError` and nothing else.
 *
 * Server failures keep the API's own `code`, `type`, Russian `message` and
 * `request_id`. Two codes are local: `network_error` (no HTTP answer arrived)
 * and `invalid_response` (an answer arrived but did not match the contract).
 */

/** Every code a `RoxApiError` can carry. */
export type RoxErrorCode =
  | 'invalid_request'
  | 'idempotency_key_required'
  | 'provider_unknown'
  | 'capability_unavailable'
  | 'sandbox_too_large'
  | 'authentication_required'
  | 'entitlement_required'
  | 'insufficient_balance'
  | 'budget_exceeded'
  | 'payment_required'
  | 'permission_denied'
  | 'not_found'
  | 'conflict'
  | 'kill_switch_active'
  | 'concurrency_exceeded'
  | 'monthly_cap_exceeded'
  | 'rate_limited'
  | 'provider_error'
  | 'network_error'
  | 'invalid_response'

export interface RoxApiErrorInit {
  /** HTTP status, or 0 when no response arrived. */
  status: number
  /** Error family, e.g. `authentication_error`; `network_error` or `invalid_response` locally. */
  type: string
  code: RoxErrorCode
  message: string
  /** The API request id, the same value the error envelope repeats. */
  requestId: string | null
}

export class RoxApiError extends Error {
  /** HTTP status, or 0 when the request never got an answer. */
  readonly status: number
  /** Error family reported by the API (or by the SDK for a local failure). */
  readonly type: string
  /** Stable machine-readable code; branch on this, not on the message. */
  readonly code: RoxErrorCode
  /** Request id to quote in a support ticket. */
  readonly requestId: string | null

  constructor(init: RoxApiErrorInit) {
    super(init.message)
    this.name = 'RoxApiError'
    this.status = init.status
    this.type = init.type
    this.code = init.code
    this.requestId = init.requestId
  }
}

/**
 * Replace the presented API key wherever it shows up in text. A key belongs in
 * one header and nowhere else, so an error message can never echo it.
 */
export function redactSecret(text: string, secret: string): string {
  if (secret.length === 0) return text
  return text.split(secret).join('[REDACTED]')
}

/** No HTTP answer arrived: DNS, socket, TLS or a local timeout. */
export function networkError(detail: string, apiKey: string): RoxApiError {
  return new RoxApiError({
    status: 0,
    type: 'network_error',
    code: 'network_error',
    message: redactSecret(detail, apiKey),
    requestId: null,
  })
}

/** An answer arrived but its body is not what the contract promises. */
export function invalidResponseError(
  status: number,
  requestId: string | null,
  detail: string,
  apiKey: string,
): RoxApiError {
  return new RoxApiError({
    status,
    type: 'invalid_response',
    code: 'invalid_response',
    message: redactSecret(detail, apiKey),
    requestId,
  })
}
