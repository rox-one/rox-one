/**
 * NIP-01 (Nostr) event primitives — the canonical byte representation, id,
 * BIP-340 schnorr signing/verification and the small validators the relay
 * bridge depends on.
 *
 * Canonical id (NIP-01): `id = sha256(utf8(JSON.stringify([0, pubkey,
 * created_at, kind, tags, content])))`; `sig` is a BIP-340 schnorr signature
 * over the 32 raw id bytes (`@noble/curves` secp256k1). `created_at` is
 * **seconds**, not milliseconds.
 */

import { createHash } from 'node:crypto'
import { schnorr } from '@noble/curves/secp256k1'

/** A fully signed NIP-01 event. */
export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Fields that feed the id computation, before `id`/`sig` exist. */
export type UnsignedNostrEvent = Omit<NostrEvent, 'id' | 'sig'>

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/

export function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value)
}

export function isSignature(value: unknown): value is string {
  return typeof value === 'string' && HEX128.test(value)
}

/** A 32-byte x-only secp256k1 public key. */
export const isPubkey = isHex64
/** A 32-byte event id. */
export const isEventId = isHex64

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('invalid hex')
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

/** sha256 hex of a UTF-8 string or raw bytes. */
export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(typeof value === 'string' ? Buffer.from(value, 'utf8') : value).digest('hex')
}

/** The exact UTF-8 string the id commits to (NIP-01 §"Event Id"). */
export function serializeEventForId(event: UnsignedNostrEvent): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
}

/** `id` of an unsigned event. */
export function computeEventId(event: UnsignedNostrEvent): string {
  return sha256Hex(serializeEventForId(event))
}

/** BIP-340 schnorr signature (hex) over a 32-byte message hash or its hex. */
export function schnorrSign(message: string | Uint8Array, secretKey: string): string {
  const hash = typeof message === 'string' ? hexToBytes(message) : message
  return bytesToHex(schnorr.sign(hash, secretKey))
}

export function schnorrVerify(signature: string, message: string | Uint8Array, pubkey: string): boolean {
  try {
    const hash = typeof message === 'string' ? hexToBytes(message) : message
    return schnorr.verify(hexToBytes(signature), hash, hexToBytes(pubkey))
  } catch {
    return false
  }
}

/** x-only public key (hex) for a 32-byte secret key. */
export function schnorrPublicKey(secretKey: string): string {
  return bytesToHex(schnorr.getPublicKey(secretKey))
}

/** Sign an unsigned event: fills `id` and `sig`. `secretKey` is 32-byte hex. */
export function signEvent(event: UnsignedNostrEvent, secretKey: string): NostrEvent {
  if (!isHex64(secretKey)) throw new Error('invalid secret key: expected 64 hex characters')
  const id = computeEventId(event)
  return { ...event, id, sig: schnorrSign(id, secretKey) }
}

/** True only when the id matches the canonical serialization and `sig` verifies. */
export function verifyEvent(event: NostrEvent): boolean {
  if (!isHex64(event.pubkey) || !isHex64(event.id) || !isSignature(event.sig)) return false
  if (computeEventId(event) !== event.id) return false
  return schnorrVerify(event.sig, event.id, event.pubkey)
}

// ---------------------------------------------------------------------------
// Token proof challenge (rox-im-token:v1)
// ---------------------------------------------------------------------------

/** Prefix of the canonical challenge a `/v1/im/token` caller signs. */
export const IM_TOKEN_CHALLENGE_PREFIX = 'rox-im-token:v1'

export interface ImTokenChallengeInput {
  readonly orgId: string
  readonly principalId: string
  readonly pubkey: string
  readonly issuedAt: number
}

/**
 * Canonical challenge the client signs to prove it holds `pubkey`'s secret key.
 * Newline-joined, documented so both sides derive identical bytes:
 *
 * ```
 * rox-im-token:v1
 * <orgId>
 * <principalId>
 * <pubkey>
 * <issuedAt>
 * ```
 */
export function imTokenChallenge(input: ImTokenChallengeInput): string {
  return [IM_TOKEN_CHALLENGE_PREFIX, input.orgId, input.principalId, input.pubkey, String(input.issuedAt)].join('\n')
}

/** Proof signs sha256(utf8(challenge)) as a 32-byte schnorr message. */
export function hashChallenge(challenge: string): Uint8Array {
  return hexToBytes(sha256Hex(challenge))
}

/** Sign a canonical challenge with the device's 32-byte secret key (hex). */
export function signChallenge(secretKey: string, challenge: string): string {
  return schnorrSign(hashChallenge(challenge), secretKey)
}

/** Verify a challenge proof hex against the claimed pubkey. */
export function verifyChallenge(pubkey: string, challenge: string, proof: string): boolean {
  return schnorrVerify(proof, hashChallenge(challenge), pubkey)
}
