/**
 * `POST /api/inbound` — accept one message from the Cloudflare Email Worker
 * and hand it to the local Stalwart over SMTP.
 *
 * Order of checks: size → HMAC signature → payload shape → base64 size →
 * idempotency → SMTP delivery. A message id is remembered only after a
 * successful SMTP hand-off, so a retry after failure is allowed.
 */
import { createHash } from 'node:crypto'
import type { Config } from './config.ts'
import type { IdempotencyCache } from './idempotency.ts'
import { bareAddress, SmtpError, type SmtpTarget } from './smtp.ts'
import { SIGNATURE_HEADER, verifySignature } from './signature.ts'

export interface InboundPayload {
  from: string
  to: string
  rawB64: string
  messageId?: string
  receivedAt?: string
}

export interface InboundResult {
  status: 200 | 400 | 401 | 413 | 502
  body: Record<string, unknown>
}

export interface InboundDeps {
  config: Config
  dedupe: IdempotencyCache<string>
  /** Test seam: replaces the SMTP hand-off. */
  deliver: (target: SmtpTarget, mailFrom: string, rcptTo: string, raw: Buffer) => Promise<void>
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/
const MAX_MESSAGE_ID_LENGTH = 998

export function decodeRawBase64(rawB64: string): Buffer | null {
  const compact = rawB64.replace(/[\r\n\t ]/g, '')
  if (compact.length === 0) return null
  const padding = compact.length % 4 === 0 ? '' : '='.repeat(4 - (compact.length % 4))
  const padded = compact + padding
  if (!BASE64_RE.test(padded)) return null
  const buffer = Buffer.from(padded, 'base64')
  // Re-encode to reject non-canonical input that silently decodes to garbage.
  if (buffer.toString('base64').replace(/=+$/, '') !== compact.replace(/=+$/, '')) return null
  return buffer
}

export function dedupeKey(payload: InboundPayload, raw: Buffer): string {
  const id = payload.messageId?.trim().slice(0, MAX_MESSAGE_ID_LENGTH)
  return id ? `mid:${id}` : `sha:${createHash('sha256').update(raw).digest('hex')}`
}

async function parsePayload(raw: Buffer): Promise<InboundPayload | null> {
  let value: unknown
  try {
    value = JSON.parse(raw.toString('utf8'))
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const from = record.from
  const to = record.to
  const rawB64 = record.rawB64
  const messageId = record.messageId
  const receivedAt = record.receivedAt
  if (typeof from !== 'string' || typeof to !== 'string' || typeof rawB64 !== 'string') return null
  if (messageId !== undefined && typeof messageId !== 'string') return null
  if (receivedAt !== undefined && typeof receivedAt !== 'string') return null
  return {
    from,
    to,
    rawB64,
    ...(messageId !== undefined ? { messageId } : {}),
    ...(receivedAt !== undefined ? { receivedAt } : {}),
  }
}

export async function handleInbound(request: Request, raw: Buffer, deps: InboundDeps): Promise<InboundResult> {
  const { config } = deps
  if (!verifySignature(config.inboundSecret, raw, request.headers.get(SIGNATURE_HEADER))) {
    return { status: 401, body: { error: 'invalid_signature' } }
  }
  const payload = await parsePayload(raw)
  if (!payload) return { status: 400, body: { error: 'invalid_payload' } }

  const mailFrom = bareAddress(payload.from)
  const rcptTo = bareAddress(payload.to)
  if (!mailFrom || !rcptTo) return { status: 400, body: { error: 'invalid_envelope' } }

  const message = decodeRawBase64(payload.rawB64)
  if (!message) return { status: 400, body: { error: 'invalid_base64' } }
  if (message.byteLength > config.maxInboundBytes) {
    return { status: 413, body: { error: 'payload_too_large', limitBytes: config.maxInboundBytes } }
  }

  const key = dedupeKey(payload, message)
  try {
    const { duplicate } = await deps.dedupe.once(key, async () => {
      await deps.deliver(
        { host: config.smtp.host, port: config.smtp.port, timeoutMs: config.smtp.timeoutMs, helo: config.smtp.helo },
        mailFrom,
        rcptTo,
        message,
      )
      return key
    })
    return { status: 200, body: { ok: true, messageId: payload.messageId ?? null, duplicate } }
  } catch (error) {
    const detail = error instanceof SmtpError ? error.message : 'SMTP delivery failed'
    return { status: 502, body: { error: 'smtp_delivery_failed', detail } }
  }
}