/**
 * Registry trust gate for marketplace installs (wave-3 c2.7).
 *
 * A pure decision function: given the provider, the catalog entry, and whether
 * the catalog body was Ed25519-verified, it returns a fail-closed verdict
 * BEFORE the installer does any clone/fetch work. `assertTrustAllowsInstall`
 * turns the verdict into a typed `CodedError` for the RPC boundary.
 *
 * Verdicts: `clean` | `review-required` | `blocked`.
 *
 * OpenClaw's `review-recommended` is deliberately collapsed here: that tier
 * came from a hosted verdict service that does not exist in this build, so a
 * signal we cannot substantiate must not become a soft "probably fine".
 * Anything OpenClaw would have marked review-recommended is treated as
 * `blocked` (fail-closed) unless the provider itself is curated, signed and
 * content-pinned — in which case it is `clean`.
 *
 * Non-negotiables:
 * - missing evidence is NEVER `clean` (no signature, no pin, no pinned ref,
 *   unknown provider → `blocked`);
 * - `clean` requires a curated provider, a signature-verified catalog, a
 *   pinned 40-hex (or 64-hex) commit ref and, for pinned kinds, content pins;
 * - this gate never replaces the existing pins: the installer's content-SHA
 *   check must still hold independently (both gates must pass);
 * - the SiYuan bazaar stays fail-closed (`oem-allowlist-empty`) — no OEM
 *   allowlist is provisioned in this build.
 */

import { CodedError } from '../protocol/types.ts'

export type RegistryTrustVerdict = 'clean' | 'review-required' | 'blocked'

/** Machine-readable reasons attached to a verdict (empty for a clean catalog entry). */
export type RegistryTrustReason =
  | 'catalog-signature-missing'
  | 'invalid-ref'
  | 'missing-content-pin'
  | 'provider-unverified'
  | 'oem-allowlist-empty'
  | 'local-folder-confirmation-required'
  | 'unverified-evidence'

/** Install providers this gate knows how to judge. */
export type RegistryTrustProvider = 'catalog' | 'local-folder' | 'siyuan-bazaar'

const KNOWN_PROVIDERS: Record<RegistryTrustProvider, true> = {
  catalog: true,
  'local-folder': true,
  'siyuan-bazaar': true,
}

/**
 * Structural subset of a marketplace entry the gate needs. A `MarketplaceEntry`
 * satisfies this without the trust module depending on the catalog module.
 */
export interface RegistryTrustEntry {
  kind?: string
  source?: { type?: string; repo?: string; ref?: string }
  expectedContentSha256?: Record<string, unknown>
}

export interface RegistryTrustInput {
  provider: RegistryTrustProvider | string
  /** The catalog entry being installed (undefined is a fail-closed block). */
  entry?: RegistryTrustEntry
  /** True only when the catalog body passed Ed25519 verification. */
  catalogSignatureVerified: boolean
}

export interface RegistryTrustAssessment {
  verdict: RegistryTrustVerdict
  reasons: RegistryTrustReason[]
}

/** Kinds whose content must be pinned by `expectedContentSha256`. */
const PINNED_KINDS: Record<string, true> = { skillpack: true, 'context-doc': true }

const REF_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i
const SHA256_RE = /^[0-9a-f]{64}$/i

/**
 * Reasons the entry's own evidence (pinned commit ref + content pins) is
 * insufficient. Shared by every provider branch so the same evidence cannot
 * pass one path and fail another.
 */
function entryEvidenceReasons(entry: RegistryTrustEntry): RegistryTrustReason[] {
  const reasons: RegistryTrustReason[] = []
  const ref = entry.source?.ref
  if (typeof ref !== 'string' || !REF_RE.test(ref)) reasons.push('invalid-ref')

  if (PINNED_KINDS[entry.kind ?? ''] === true) {
    const pins = entry.expectedContentSha256
    const values = pins && typeof pins === 'object' && !Array.isArray(pins) ? Object.values(pins) : []
    const pinsValid =
      values.length > 0 &&
      values.every((value) => typeof value === 'string' && SHA256_RE.test(value))
    if (!pinsValid) reasons.push('missing-content-pin')
  }
  return reasons
}

/**
 * Decide whether an install may proceed. Fail-closed: every missing or
 * unrecognised piece of evidence produces `blocked`.
 */
export function assessRegistryTrust(input: RegistryTrustInput): RegistryTrustAssessment {
  const provider = typeof input.provider === 'string' ? input.provider : ''

  // `Object.hasOwn`, not `in`: the prototype chain is not a provider list.
  if (!Object.hasOwn(KNOWN_PROVIDERS, provider)) {
    return { verdict: 'blocked', reasons: ['provider-unverified'] }
  }

  // SiYuan bazaar: OEM allowlist is not provisioned in this build → fail-closed.
  if (provider === 'siyuan-bazaar') {
    return { verdict: 'blocked', reasons: ['oem-allowlist-empty'] }
  }

  const entry = input.entry
  if (!entry || typeof entry !== 'object') {
    return { verdict: 'blocked', reasons: ['unverified-evidence'] }
  }

  // Local folder: not from the curated catalog, so an operator must confirm.
  // A malformed ref/pin still blocks outright — confirmation cannot launder it.
  if (provider === 'local-folder') {
    const evidence = entryEvidenceReasons(entry)
    if (evidence.length > 0) return { verdict: 'blocked', reasons: evidence }
    return { verdict: 'review-required', reasons: ['local-folder-confirmation-required'] }
  }

  // Curated catalog: every piece of evidence must be present.
  const reasons: RegistryTrustReason[] = []
  if (!input.catalogSignatureVerified) reasons.push('catalog-signature-missing')
  reasons.push(...entryEvidenceReasons(entry))
  if (reasons.length > 0) return { verdict: 'blocked', reasons }
  return { verdict: 'clean', reasons: [] }
}

/**
 * Throw a typed `CodedError` unless the verdict allows the install.
 * `blocked` never proceeds; `review-required` proceeds only with an explicit
 * operator confirmation flag.
 */
export function assertTrustAllowsInstall(
  verdict: RegistryTrustVerdict,
  options: { confirmReview?: boolean } = {},
): void {
  if (verdict === 'blocked') {
    throw new CodedError(
      'REGISTRY_TRUST_BLOCKED',
      'Registry trust gate blocked this install: the catalog evidence is missing or unverified',
    )
  }
  if (verdict === 'review-required' && options.confirmReview !== true) {
    throw new CodedError(
      'REGISTRY_TRUST_REVIEW_REQUIRED',
      'Registry trust gate requires explicit operator confirmation before this install',
    )
  }
}