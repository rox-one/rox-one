# CF-1 Recovery Review

- **Date:** 2026-08-11
- **Status:** Normative security erratum for the recovered CF-1 implementation
- **Applies to:** `packages/core/src/platform/identity/credential-types.ts` and `packages/shared/src/credentials/envelope.ts`

## Why this erratum exists

The exported session claimed CF-1 was complete, but the CF-1 files and the specification directory were still untracked in a heavily modified worktree. The separate reviewer did not execute successfully: it failed before inspecting the implementation. The remote `main` branch therefore contains neither the approved specification nor the claimed CF-1 source.

Recovery is based on the approved CF-0 contract and the current remote `main`, not on the transcript's completion flag.

## Security correction

The first uncommitted envelope implementation derived `versionFingerprint` with an unkeyed SHA-256 digest over the canonical secret payload. That conflicts with the threat-model requirement that the digest be non-reversible, bound to credential/provider-version identity, and not directly usable to guess a secret.

The recovered CF-1 contract therefore requires:

1. HMAC-SHA-256, not an unkeyed payload hash.
2. A caller-supplied fingerprint key of at least 32 bytes.
3. A non-empty binding that identifies the stable credential/provider version context.
4. The key and binding context are validated; the key is never serialized into the envelope.
5. A fingerprint is stable only for the same normalized payload, credential kind, key, and binding.
6. Decode fails closed when the key, binding, payload, envelope metadata, or fingerprint is wrong.

This correction does not introduce the provider, importer, broker, runtime lease, WorkGraph, UI, or deployment work reserved for CF-2 and later.

## Additional adversarial invariants

- Metadata registration rejects unknown top-level and nested locator fields, including secret-shaped widening.
- Version fingerprints must be 64 lowercase hexadecimal characters; a raw secret cannot occupy the fingerprint slot.
- A newly registered active version cannot silently replace a newer active version.
- Revoked and invalid versions are terminal.
- `CredentialRef.updatedAt` never moves backwards.
- Envelope payload fields are scalar, allowlisted, bounded, and defensively copied.
- Legacy `StoredCredential` objects are wrapped in memory only; arbitrary raw strings are not guessed to be legacy credentials.
- Oversized, malformed, tampered, or context-mismatched envelopes fail closed.

## Second review pass

An independent adversarial pass against the recovered implementation broke
several of the invariants above. The findings and their resolutions are
normative for CF-1.

### Terminal states were reachable again through an untrimmed id

`registerVersion` checked the duplicate-id guard against the raw input but
stored the trimmed id, so ` ver_1` overwrote `ver_1`. That resurrected revoked
versions and bypassed the older-than-current guard. Identifiers are now
normalized before the collision check.

### Revocation could be blocked indefinitely

Clearing the current version required a caller-supplied timestamp at least as
large as `ref.updatedAt`. A version created with a future `createdAt`, or a
clock that stepped backwards, therefore made a credential permanently
unrevocable. Refusing to retire a compromised credential is a worse outcome
than a timestamp that stands still, so `updatedAt` is now clamped forward and
a status transition is never rejected on timestamp grounds. `updateProvider`
uses the same clamp, which makes monotonicity a property of the ref rather
than a per-call precondition.

### Decode results did not record what they proved

A verified envelope and a wrapped legacy object were structurally identical, so
a caller could treat unauthenticated data as authenticated. Decode results now
carry `provenance: 'verified' | 'legacy'`. The field exists only on the decode
result and is never serialized.

### Remaining hardening

1. Credential ref ids are matched case-sensitively; the identifier type and
   `randomUUID` are both lowercase, so accepting other casings let two
   spellings of one UUID register as distinct refs.
2. Payload fields are read exactly once. Re-reading a caller object let an
   accessor return a conforming value to the validation and a different one to
   the stored copy.
3. The authenticated data covers the codec and envelope version, so a future
   v2 envelope cannot be presented as a v1 one carrying the same digest.
4. Payload size is bounded in total, not only per field; per-field bounds alone
   let a many-field legacy object reach several megabytes.
5. Caller-controlled keys and identifiers interpolated into error messages are
   truncated, so one rejected call cannot write an unbounded string to logs.

## Deferred work

The following remain explicitly outside CF-1:

- destructive or dual-read/single-write local-store migration;
- quarantine, backup, restore, and DEK cutover;
- provider/importer interfaces;
- `CredentialBroker`, grants, leases, and delivery mechanisms;
- WorkGraph entities and affected-closure computation;
- renderer/RPC/UI changes;
- Infisical adapter, packaging, and deployment.
