import { describe, expect, it } from 'bun:test'

import { CodedError } from '../../protocol/types.ts'
import {
  assessRegistryTrust,
  assertTrustAllowsInstall,
  type RegistryTrustEntry,
} from '../trust.ts'

const REF = 'a'.repeat(40)
const PIN = 'b'.repeat(64)

const skillpack = (overrides: Partial<RegistryTrustEntry> = {}): RegistryTrustEntry => ({
  kind: 'skillpack',
  source: { type: 'github', repo: 'owner/pack', ref: REF },
  expectedContentSha256: { 'mega-pack': PIN },
  ...overrides,
})

describe('assessRegistryTrust — verdict table', () => {
  it('curated + signed + pinned → clean', () => {
    expect(
      assessRegistryTrust({ provider: 'catalog', entry: skillpack(), catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'clean', reasons: [] })
  })

  it('catalog-signature-missing blocks a signed-catalog entry', () => {
    expect(
      assessRegistryTrust({ provider: 'catalog', entry: skillpack(), catalogSignatureVerified: false }),
    ).toEqual({ verdict: 'blocked', reasons: ['catalog-signature-missing'] })
  })

  it('invalid-ref blocks a floating (non-pinned) ref', () => {
    const entry = skillpack({ source: { type: 'github', repo: 'owner/pack', ref: 'main' } })
    expect(
      assessRegistryTrust({ provider: 'catalog', entry, catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'blocked', reasons: ['invalid-ref'] })
  })

  it('missing-content-pin blocks a pinned kind without pins', () => {
    const entry = skillpack({ expectedContentSha256: undefined })
    expect(
      assessRegistryTrust({ provider: 'catalog', entry, catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'blocked', reasons: ['missing-content-pin'] })
  })

  it('context-doc is also a pinned kind', () => {
    const entry: RegistryTrustEntry = {
      kind: 'context-doc',
      source: { type: 'github', repo: 'owner/docs', ref: REF },
    }
    expect(
      assessRegistryTrust({ provider: 'catalog', entry, catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'blocked', reasons: ['missing-content-pin'] })
  })

  it('tool does not require content pins', () => {
    const entry: RegistryTrustEntry = {
      kind: 'tool',
      source: { type: 'github', repo: 'owner/tool', ref: REF },
    }
    expect(
      assessRegistryTrust({ provider: 'catalog', entry, catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'clean', reasons: [] })
  })

  it('accumulates every catalog evidence failure', () => {
    const entry = skillpack({
      source: { type: 'github', repo: 'owner/pack', ref: 'nope' },
      expectedContentSha256: undefined,
    })
    expect(
      assessRegistryTrust({ provider: 'catalog', entry, catalogSignatureVerified: false }),
    ).toEqual({
      verdict: 'blocked',
      reasons: ['catalog-signature-missing', 'invalid-ref', 'missing-content-pin'],
    })
  })

  it('provider-unverified blocks an unknown provider (fail-closed default)', () => {
    expect(
      assessRegistryTrust({ provider: 'npm-unofficial', entry: skillpack(), catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'blocked', reasons: ['provider-unverified'] })
  })

  it('prototype-chain names are not providers (Object.hasOwn, not `in`)', () => {
    expect(
      assessRegistryTrust({ provider: 'toString', entry: skillpack(), catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'blocked', reasons: ['provider-unverified'] })
    expect(
      assessRegistryTrust({ provider: 'constructor', entry: skillpack(), catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'blocked', reasons: ['provider-unverified'] })
  })

  it('oem-allowlist-empty keeps the SiYuan bazaar fail-closed', () => {
    expect(
      assessRegistryTrust({ provider: 'siyuan-bazaar', entry: skillpack(), catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'blocked', reasons: ['oem-allowlist-empty'] })
  })

  it('missing entry evidence is a fail-closed block', () => {
    expect(
      assessRegistryTrust({ provider: 'catalog', entry: undefined, catalogSignatureVerified: true }),
    ).toEqual({ verdict: 'blocked', reasons: ['unverified-evidence'] })
  })

  it('local-folder needs explicit confirmation (review-required)', () => {
    expect(
      assessRegistryTrust({ provider: 'local-folder', entry: skillpack(), catalogSignatureVerified: false }),
    ).toEqual({ verdict: 'review-required', reasons: ['local-folder-confirmation-required'] })
  })

  it('local-folder with malformed evidence still blocks outright', () => {
    const entry = skillpack({ source: { type: 'github', repo: 'owner/pack', ref: '' } })
    expect(
      assessRegistryTrust({ provider: 'local-folder', entry, catalogSignatureVerified: false }),
    ).toEqual({ verdict: 'blocked', reasons: ['invalid-ref'] })
  })
})

describe('assertTrustAllowsInstall', () => {
  it('passes clean through', () => {
    expect(() => assertTrustAllowsInstall('clean')).not.toThrow()
  })

  it('throws REGISTRY_TRUST_BLOCKED for blocked', () => {
    let thrown: unknown
    try {
      assertTrustAllowsInstall('blocked')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CodedError)
    if (thrown instanceof CodedError) expect(thrown.code).toBe('REGISTRY_TRUST_BLOCKED')
  })

  it('throws REGISTRY_TRUST_REVIEW_REQUIRED without operator confirmation', () => {
    let thrown: unknown
    try {
      assertTrustAllowsInstall('review-required')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CodedError)
    if (thrown instanceof CodedError) expect(thrown.code).toBe('REGISTRY_TRUST_REVIEW_REQUIRED')
    expect(() => assertTrustAllowsInstall('review-required', { confirmReview: true })).not.toThrow()
  })
})