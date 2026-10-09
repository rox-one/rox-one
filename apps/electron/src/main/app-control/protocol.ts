/**
 * App-control UDS protocol (port row e2.7).
 *
 * Transport: a unix domain socket. Framing: the shared length-prefixed JSON
 * codec (`@rox/shared/local-ipc/framing`). Every request carries an HMAC over
 * `{nonce, ts, payload}`; every response is either `{ok:true, result}` or
 * `{ok:false, error:{code}}`. There are no Electron APIs here — the core runs
 * under plain Node/Bun so it can be unit-tested and reused by helper binaries.
 */

/** Wire version. Bump on any breaking envelope change. */
export const APP_CONTROL_PROTOCOL_VERSION = 1 as const

/** Requests older/newer than this are refused. */
export const APP_CONTROL_TTL_MS = 15_000

/** Typed refusal codes. The client matches on these, never on message text. */
export type AppControlRefusalCode =
  | 'unsupported-version'
  | 'peer-uid-mismatch'
  | 'stale-timestamp'
  | 'bad-token'
  | 'replayed-nonce'
  | 'malformed-frame'
  | 'internal-error'

export interface AppControlAuth {
  nonce: string
  ts: number
  mac: string
}

export interface AppControlRequest<P = unknown> {
  type: 'request'
  v: typeof APP_CONTROL_PROTOCOL_VERSION
  id: string
  method: string
  payload: P
  auth: AppControlAuth
}

export type AppControlResponse<R = unknown> =
  | { type: 'response'; v: typeof APP_CONTROL_PROTOCOL_VERSION; id: string; ok: true; result: R }
  | { type: 'response'; v: typeof APP_CONTROL_PROTOCOL_VERSION; id: string; ok: false; error: { code: AppControlRefusalCode; message: string } }

export interface ParsedAppControlRequest {
  id: string
  v: number
  method: string
  payload: unknown
  auth: AppControlAuth
}

/**
 * Validate an untrusted request frame. Returns `null` (never throws) so the
 * server can map the failure onto the `malformed-frame` refusal code. The
 * wire version is returned for the caller to check separately.
 */
export function parseAppControlRequest(value: unknown): ParsedAppControlRequest | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('type' in value) || value.type !== 'request') return null
  if (!('v' in value) || typeof value.v !== 'number' || !Number.isFinite(value.v)) return null
  if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) return null
  if (!('method' in value) || typeof value.method !== 'string' || value.method.length === 0) return null
  if (!('auth' in value) || typeof value.auth !== 'object' || value.auth === null) return null
  const auth = value.auth
  if (!('nonce' in auth) || typeof auth.nonce !== 'string' || auth.nonce.length === 0) return null
  if (!('ts' in auth) || typeof auth.ts !== 'number' || !Number.isFinite(auth.ts)) return null
  if (!('mac' in auth) || typeof auth.mac !== 'string') return null
  return {
    id: value.id,
    v: value.v,
    method: value.method,
    payload: 'payload' in value ? value.payload : undefined,
    auth: { nonce: auth.nonce, ts: auth.ts, mac: auth.mac },
  }
}

/** Validate an untrusted response frame. Returns `null` on shape failure. */
export function parseAppControlResponse(value: unknown): AppControlResponse | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('type' in value) || value.type !== 'response') return null
  if (!('v' in value) || value.v !== APP_CONTROL_PROTOCOL_VERSION) return null
  if (!('id' in value) || typeof value.id !== 'string') return null
  if (!('ok' in value)) return null
  if (value.ok === true) return { type: 'response', v: 1, id: value.id, ok: true, result: 'result' in value ? value.result : undefined }
  if (value.ok === false) {
    const error = 'error' in value ? value.error : undefined
    if (typeof error !== 'object' || error === null) return null
    if (!('code' in error) || typeof error.code !== 'string' || !(error.code in KNOWN_REFUSAL_CODES)) return null
    if (!('message' in error) || typeof error.message !== 'string') return null
    return { type: 'response', v: 1, id: value.id, ok: false, error: { code: KNOWN_REFUSAL_CODES[error.code], message: error.message } }
  }
  return null
}

export function appControlOk<R>(id: string, result: R): AppControlResponse<R> {
  return { type: 'response', v: APP_CONTROL_PROTOCOL_VERSION, id, ok: true, result }
}

export function appControlError(id: string, code: AppControlRefusalCode, message: string): AppControlResponse<never> {
  return { type: 'response', v: APP_CONTROL_PROTOCOL_VERSION, id, ok: false, error: { code, message } }
}

/** Known refusal codes; used to reject frames carrying an unknown code. */
const KNOWN_REFUSAL_CODES: Record<string, AppControlRefusalCode> = {
  'unsupported-version': 'unsupported-version',
  'peer-uid-mismatch': 'peer-uid-mismatch',
  'stale-timestamp': 'stale-timestamp',
  'bad-token': 'bad-token',
  'replayed-nonce': 'replayed-nonce',
  'malformed-frame': 'malformed-frame',
  'internal-error': 'internal-error',
}

/** An error carrying a refusal code, thrown by the client. */
export class AppControlError extends Error {
  readonly code: AppControlRefusalCode

  constructor(code: AppControlRefusalCode, message: string) {
    super(message)
    this.name = 'AppControlError'
    this.code = code
  }
}