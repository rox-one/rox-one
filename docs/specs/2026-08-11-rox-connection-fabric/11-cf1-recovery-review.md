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
- Ref timestamps are monotonic when the current version is cleared.
- Envelope payload fields are scalar, allowlisted, bounded, and defensively copied.
- Legacy `StoredCredential` objects are wrapped in memory only; arbitrary raw strings are not guessed to be legacy credentials.
- Oversized, malformed, tampered, or context-mismatched envelopes fail closed.

## Deferred work

The following remain explicitly outside CF-1:

- destructive or dual-read/single-write local-store migration;
- quarantine, backup, restore, and DEK cutover;
- provider/importer interfaces;
- `CredentialBroker`, grants, leases, and delivery mechanisms;
- WorkGraph entities and affected-closure computation;
- renderer/RPC/UI changes;
- Infisical adapter, packaging, and deployment.
