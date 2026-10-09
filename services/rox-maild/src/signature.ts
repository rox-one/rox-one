/**
 * HMAC-SHA256 verification of the `X-Rox-Signature` header sent by the
 * Cloudflare Email Worker. The signature is the hex digest of the raw request
 * body (the exact bytes on the wire), never of a re-serialised JSON value.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'x-rox-signature'

export function hmacHex(secret: string, body: Uint8Array): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

/** Constant-time comparison; false for any malformed header. */
export function verifySignature(secret: string, body: Uint8Array, header: string | null | undefined): boolean {
  if (!header) return false
  const candidate = header.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(candidate)) return false
  const expected = hmacHex(secret, body)
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(candidate, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}