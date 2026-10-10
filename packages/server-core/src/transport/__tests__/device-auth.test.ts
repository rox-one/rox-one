/**
 * e2.2 — pure device-auth verifier.
 *
 * Challenge/verify semantics without sockets: valid, replayed, stale,
 * mismatched-credential, malformed.
 */

import { describe, expect, it } from 'bun:test'
import {
  DEVICE_CHALLENGE_NONCE_BYTES,
  DEVICE_PROOF_HEX_LENGTH,
  DeviceChallengeRegistry,
  computeDeviceProof,
  createDeviceChallenge,
  isDeviceChallengeNonce,
  verifyDeviceProof,
} from '../device-auth'

const CREDENTIAL = 'rox-identity:local:local'
const OTHER_CREDENTIAL = 'rox-identity:intruder:local'
const T0 = 1_000_000

/** A fixed 64-char hex nonce so tests stay deterministic. */
const NONCE = 'ab'.repeat(DEVICE_CHALLENGE_NONCE_BYTES)

function registry(): DeviceChallengeRegistry {
  return new DeviceChallengeRegistry({ ttlMs: 30_000 })
}

describe('device-auth challenge (pure)', () => {
  it('mints a bounded hex nonce and verifies a valid proof', async () => {
    const challenge = createDeviceChallenge(T0, NONCE)
    expect(challenge.nonce).toHaveLength(DEVICE_CHALLENGE_NONCE_BYTES * 2)
    expect(isDeviceChallengeNonce(challenge.nonce)).toBe(true)

    const registryInstance = registry()
    const issued = registryInstance.issue(T0)
    const proof = await computeDeviceProof(issued.nonce, CREDENTIAL)
    expect(proof).toHaveLength(DEVICE_PROOF_HEX_LENGTH)

    const accepted = await verifyDeviceProof({
      registry: registryInstance,
      credential: CREDENTIAL,
      nonce: issued.nonce,
      proof,
      now: T0,
    })
    expect(accepted).toEqual({ ok: true })
  })

  it('refuses a replayed nonce', async () => {
    const registryInstance = registry()
    const issued = registryInstance.issue(T0)
    const proof = await computeDeviceProof(issued.nonce, CREDENTIAL)

    const first = await verifyDeviceProof({ registry: registryInstance, credential: CREDENTIAL, nonce: issued.nonce, proof, now: T0 })
    expect(first).toEqual({ ok: true })

    const replay = await verifyDeviceProof({ registry: registryInstance, credential: CREDENTIAL, nonce: issued.nonce, proof, now: T0 })
    expect(replay).toEqual({ ok: false, reason: 'replayed_nonce' })
  })

  it('refuses a stale nonce outside the freshness window', async () => {
    const registryInstance = registry()
    const issued = registryInstance.issue(T0)
    const proof = await computeDeviceProof(issued.nonce, CREDENTIAL)

    const stale = await verifyDeviceProof({
      registry: registryInstance,
      credential: CREDENTIAL,
      nonce: issued.nonce,
      proof,
      now: T0 + 30_001,
    })
    expect(stale).toEqual({ ok: false, reason: 'stale_nonce' })
  })

  it('refuses a proof keyed by a mismatched credential', async () => {
    const registryInstance = registry()
    const issued = registryInstance.issue(T0)
    const proof = await computeDeviceProof(issued.nonce, OTHER_CREDENTIAL)

    const mismatched = await verifyDeviceProof({
      registry: registryInstance,
      credential: CREDENTIAL,
      nonce: issued.nonce,
      proof,
      now: T0,
    })
    expect(mismatched).toEqual({ ok: false, reason: 'mismatched_credential' })
  })

  it('refuses malformed proofs and a missing challenge', async () => {
    const registryInstance = registry()
    const issued = registryInstance.issue(T0)

    for (const proof of ['', 'not-hex', 'a'.repeat(63), 'a'.repeat(65), 42, null, undefined]) {
      const malformed = await verifyDeviceProof({
        registry: registryInstance,
        credential: CREDENTIAL,
        nonce: issued.nonce,
        proof,
        now: T0,
      })
      expect(malformed).toEqual({ ok: false, reason: 'malformed_proof' })
    }

    const missing = await verifyDeviceProof({
      registry: registryInstance,
      credential: CREDENTIAL,
      nonce: undefined,
      proof: 'a'.repeat(64),
      now: T0,
    })
    expect(missing).toEqual({ ok: false, reason: 'missing_challenge' })
  })

  it('refuses an unknown nonce from another connection', async () => {
    const registryInstance = registry()
    const otherConnection = registry()
    const foreign = otherConnection.issue(T0)
    const proof = await computeDeviceProof(foreign.nonce, CREDENTIAL)

    const unknown = await verifyDeviceProof({
      registry: registryInstance,
      credential: CREDENTIAL,
      nonce: foreign.nonce,
      proof,
      now: T0,
    })
    expect(unknown).toEqual({ ok: false, reason: 'unknown_nonce' })
  })
})