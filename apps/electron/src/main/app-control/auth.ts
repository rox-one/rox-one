/**
 * App-control authentication: a shared secret read from a 0600 token file,
 * HMAC-SHA256 over the authenticated fields, a short replay window, and a
 * bounded nonce cache. No Electron APIs.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { APP_CONTROL_TTL_MS } from './protocol.ts'

/** Size of the generated shared secret. */
export const APP_CONTROL_TOKEN_BYTES = 32

/** Fields bound by the MAC, in this exact shape. */
export interface AppControlAuthFields {
  nonce: string
  ts: number
  payload: unknown
}

export function createAppControlToken(): string {
  return randomBytes(APP_CONTROL_TOKEN_BYTES).toString('hex')
}

/**
 * HMAC-SHA256 over the canonical `{nonce, ts, payload}` object, hex-encoded.
 * Both ends serialize the same parsed object, so key order is identical.
 */
export function computeAppControlMac(secret: string, fields: AppControlAuthFields): string {
  const canonical = JSON.stringify({ nonce: fields.nonce, ts: fields.ts, payload: fields.payload })
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')
}

/** Constant-time MAC comparison, tolerant of malformed hex. */
export function appControlMacMatches(expectedHex: string, providedHex: string): boolean {
  if (typeof providedHex !== 'string' || providedHex.length !== expectedHex.length) return false
  const expected = Buffer.from(expectedHex, 'utf8')
  const provided = Buffer.from(providedHex, 'utf8')
  return timingSafeEqual(expected, provided)
}

/**
 * Bounded, self-expiring nonce cache. `accept` records a nonce and returns
 * false if it was already used within the TTL. Expired entries are pruned on
 * every call so the map never grows past the TTL's traffic.
 */
export class NonceCache {
  private readonly seen = new Map<string, number>()

  constructor(private readonly ttlMs: number = APP_CONTROL_TTL_MS) {}

  accept(nonce: string, ts: number, now: number): boolean {
    this.prune(now)
    if (this.seen.has(nonce)) return false
    this.seen.set(nonce, ts)
    return true
  }

  private prune(now: number): void {
    for (const [nonce, ts] of this.seen) {
      if (now - ts > this.ttlMs) this.seen.delete(nonce)
    }
  }
}