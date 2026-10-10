/**
 * e2.2 residual — device-auth challenge semantics (pure core).
 *
 * Server issues a per-connection `connect.challenge` nonce; the client answers
 * with a `deviceProof` — an HMAC-SHA256 over that nonce, keyed by the ROX
 * identity credential. The server verifies BEFORE emitting `handshake_ack`.
 *
 * This module holds ONLY the pure challenge/verify logic (no sockets, no fs):
 * nonce minting, single-use consumption with a freshness window, proof
 * computation and constant-time verification. Transport wiring lives in
 * `server.ts` / `client.ts`; the ROX identity credential is resolved from the
 * existing identity store by the caller (`identity-credential.ts`) — no new key
 * material is invented here.
 *
 * Isomorphic: uses WebCrypto (`globalThis.crypto.subtle`) so the same proof
 * implementation runs in Node/Bun and in the renderer, keeping both sides in
 * lockstep.
 */

/** Nonce entropy (bytes); encoded as hex, so the wire nonce is 64 chars. */
export const DEVICE_CHALLENGE_NONCE_BYTES = 32
/** Freshness window: a nonce older than this is stale and refused. */
export const DEVICE_CHALLENGE_TTL_MS = 30_000
/** Upper bound on retained challenges so a flood cannot grow the registry. */
export const DEVICE_CHALLENGE_MAX_TRACKED = 1_024
/** HMAC-SHA256 output as lowercase hex. */
export const DEVICE_PROOF_HEX_LENGTH = 64

const NONCE_HEX_LENGTH = DEVICE_CHALLENGE_NONCE_BYTES * 2
const NONCE_PATTERN = /^[0-9a-f]+$/
const PROOF_PATTERN = /^[0-9a-f]+$/

export interface DeviceChallenge {
  /** Server-minted, bounded, single-use nonce (hex). */
  readonly nonce: string
  /** Epoch ms the nonce was issued; drives the freshness window. */
  readonly issuedAt: number
}

/**
 * Why a device-auth answer was refused. The transport renders every reason as
 * the same typed `AUTH_FAILED` (no oracle), while tests and logs read this
 * discriminant directly.
 */
export type DeviceAuthRefusal =
  | 'missing_challenge'
  | 'malformed_proof'
  | 'unknown_nonce'
  | 'replayed_nonce'
  | 'stale_nonce'
  | 'mismatched_credential'

export type DeviceAuthResult = { readonly ok: true } | { readonly ok: false; readonly reason: DeviceAuthRefusal }

const OK: DeviceAuthResult = { ok: true }

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** Default nonce source: WebCrypto CSPRNG (present in Node, Bun and browsers). */
function randomNonce(): string {
  const bytes = new Uint8Array(DEVICE_CHALLENGE_NONCE_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  return hex(bytes)
}

/** Mint a bounded challenge nonce. `nonce` is injectable for deterministic tests. */
export function createDeviceChallenge(now: number = Date.now(), nonce?: string): DeviceChallenge {
  const value = nonce ?? randomNonce()
  if (typeof value !== 'string' || value.length !== NONCE_HEX_LENGTH || !NONCE_PATTERN.test(value)) {
    throw new Error('Invalid device challenge nonce')
  }
  return { nonce: value, issuedAt: now }
}

/** Shape check for a wire-supplied nonce (bounded length, hex). */
export function isDeviceChallengeNonce(value: unknown): value is string {
  return typeof value === 'string' && value.length === NONCE_HEX_LENGTH && NONCE_PATTERN.test(value)
}

/** Shape check for a wire-supplied proof (bounded length, hex). */
export function isDeviceProof(value: unknown): value is string {
  return typeof value === 'string' && value.length === DEVICE_PROOF_HEX_LENGTH && PROOF_PATTERN.test(value)
}

/**
 * HMAC-SHA256(`nonce`) keyed by the ROX identity credential, lowercase hex.
 * Deterministic and isomorphic — the server recomputes it from its own copy of
 * the credential and never trusts a client-supplied key.
 */
export async function computeDeviceProof(nonce: string, credential: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(credential),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(nonce))
  return hex(new Uint8Array(signature))
}

/** Length-independent, branch-free comparison of two equal-length hex strings. */
function proofMatches(expected: string, received: string): boolean {
  if (expected.length !== received.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i)
  }
  return diff === 0
}

interface RetainedChallenge {
  readonly issuedAt: number
  consumed: boolean
}

/**
 * Per-connection (or per-server) table of issued challenges. Enforces
 * single-use and the freshness window and keeps a bounded footprint: expired
 * entries are pruned on every issue, and the oldest is evicted past the cap.
 */
export class DeviceChallengeRegistry {
  private readonly ttlMs: number
  private readonly maxTracked: number
  private readonly challenges = new Map<string, RetainedChallenge>()

  constructor(options?: { ttlMs?: number; maxTracked?: number }) {
    this.ttlMs = options?.ttlMs ?? DEVICE_CHALLENGE_TTL_MS
    this.maxTracked = options?.maxTracked ?? DEVICE_CHALLENGE_MAX_TRACKED
  }

  /** Mint and retain a fresh challenge for the caller to send on the wire. */
  issue(now: number = Date.now()): DeviceChallenge {
    this.prune(now)
    while (this.challenges.size >= this.maxTracked) {
      const oldest = this.challenges.keys().next()
      if (oldest.done) break
      this.challenges.delete(oldest.value)
    }
    const challenge = createDeviceChallenge(now)
    this.challenges.set(challenge.nonce, { issuedAt: challenge.issuedAt, consumed: false })
    return challenge
  }

  /** Drop expired entries (and their consumed tombstones). */
  prune(now: number = Date.now()): void {
    for (const [nonce, entry] of this.challenges) {
      if (now - entry.issuedAt > this.ttlMs) this.challenges.delete(nonce)
    }
  }

  /**
   * Single-use consumption. Returns `ok` only for a known, unconsumed, fresh
   * nonce; a consumed nonce is retained as a tombstone so a replay is refused
   * as `replayed_nonce` rather than falling through to `unknown_nonce`.
   */
  consume(nonce: string, now: number = Date.now()): 'ok' | DeviceAuthRefusal {
    const entry = this.challenges.get(nonce)
    if (!entry) return 'unknown_nonce'
    if (entry.consumed) return 'replayed_nonce'
    if (now - entry.issuedAt > this.ttlMs) {
      this.challenges.delete(nonce)
      return 'stale_nonce'
    }
    entry.consumed = true
    return 'ok'
  }
}

export interface VerifyDeviceProofInput {
  readonly registry: DeviceChallengeRegistry
  readonly credential: string
  /** Nonce echoed by the client on the handshake (may be absent). */
  readonly nonce: unknown
  /** Proof carried on the handshake (may be absent/malformed). */
  readonly proof: unknown
  readonly now?: number
}

/**
 * Pure verifier for a handshake's device-auth answer. Refuses (typed) an absent
 * challenge, a malformed/oversized proof, an unknown/replayed/stale nonce, or a
 * proof that does not match the credential. Never throws.
 */
export async function verifyDeviceProof(input: VerifyDeviceProofInput): Promise<DeviceAuthResult> {
  const { registry, credential, nonce, proof } = input
  const now = input.now ?? Date.now()
  if (nonce === undefined || nonce === null) return { ok: false, reason: 'missing_challenge' }
  if (!isDeviceChallengeNonce(nonce)) return { ok: false, reason: 'malformed_proof' }
  if (!isDeviceProof(proof)) return { ok: false, reason: 'malformed_proof' }
  const consumed = registry.consume(nonce, now)
  if (consumed !== 'ok') return { ok: false, reason: consumed }
  const expected = await computeDeviceProof(nonce, credential)
  if (!proofMatches(expected, proof)) return { ok: false, reason: 'mismatched_credential' }
  return OK
}