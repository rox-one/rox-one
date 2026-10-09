/**
 * c2.7 — the marketplace install path enforces the registry trust verdict.
 *
 * A blocked/review-required assessment must leave the installer cold (no
 * fetch, no clone, no lock write); a clean install records the verdict on the
 * lock record after the content pins verify.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { marketplacePaths, type MarketplaceEntry, type MarketplaceFetch } from '../catalog.ts'
import { readLock } from '../lock.ts'
import { installEntry, sha256FileContent, type ExecFileFn } from '../installer.ts'
import { type RegistryTrustAssessment } from '../trust.ts'

const REF = 'd'.repeat(40)
const BODY = '# Agent Doc'

const DOC_ENTRY: MarketplaceEntry = {
  id: 'trust-doc',
  kind: 'context-doc',
  title: 'Trust Doc',
  descriptionRu: 'Тестовый документ',
  source: { type: 'github', repo: 'owner/docs', ref: REF },
  documents: [{ repoPath: 'AGENTS.md', targetName: 'agents.md' }],
  expectedContentSha256: { 'agents.md': sha256FileContent(BODY) },
}

const CLEAN: RegistryTrustAssessment = { verdict: 'clean', reasons: [] }
const BLOCKED: RegistryTrustAssessment = { verdict: 'blocked', reasons: ['catalog-signature-missing'] }
const REVIEW: RegistryTrustAssessment = { verdict: 'review-required', reasons: ['local-folder-confirmation-required'] }

let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'marketplace-trust-'))
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
})

function coldFetch(): { fetchFn: MarketplaceFetch; calls: () => number } {
  let calls = 0
  return {
    fetchFn: async () => {
      calls += 1
      throw new Error('fetch must not be called for a refused verdict')
    },
    calls: () => calls,
  }
}

describe('installEntry trust gate', () => {
  it('clean install persists the verdict on the lock record', async () => {
    const fetchFn: MarketplaceFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => BODY,
    })

    const result = await installEntry(DOC_ENTRY, {
      configDir,
      fetchFn,
      now: () => 4242,
      trust: CLEAN,
    })
    expect(result.status).toBe('installed')

    const rec = readLock(marketplacePaths(configDir).lockFile).entries['trust-doc']
    expect(rec?.trustVerdict).toBe('clean')
    expect(rec?.trustReasons).toEqual([])
    expect(rec?.assessedAt).toBe(4242)
  })

  it('blocked verdict aborts with REGISTRY_TRUST_BLOCKED and zero work', async () => {
    const fetch = coldFetch()
    let execCalls = 0
    const execFileFn: ExecFileFn = async () => {
      execCalls += 1
      return { stdout: '', stderr: '' }
    }

    let thrown: unknown
    try {
      await installEntry(DOC_ENTRY, {
        configDir,
        fetchFn: fetch.fetchFn,
        execFileFn,
        trust: BLOCKED,
      })
    } catch (err) {
      thrown = err
    }
    expect((thrown as Error | undefined)?.message).toMatch(/REGISTRY_TRUST_BLOCKED|blocked/i)
    expect(fetch.calls()).toBe(0)
    expect(execCalls).toBe(0)
    expect(existsSync(marketplacePaths(configDir).lockFile)).toBe(false)
    expect(existsSync(join(configDir, 'context', 'agents.md'))).toBe(false)
  })

  it('review-required aborts unless the operator confirms', async () => {
    const fetch = coldFetch()
    await expect(
      installEntry(DOC_ENTRY, { configDir, fetchFn: fetch.fetchFn, trust: REVIEW }),
    ).rejects.toThrow(/REGISTRY_TRUST_REVIEW_REQUIRED|confirmation/i)
    expect(fetch.calls()).toBe(0)
    expect(existsSync(marketplacePaths(configDir).lockFile)).toBe(false)
  })

  it('review-required proceeds once confirmed', async () => {
    const fetchFn: MarketplaceFetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => BODY,
    })

    const result = await installEntry(DOC_ENTRY, {
      configDir,
      fetchFn,
      trust: REVIEW,
      confirmReview: true,
    })
    expect(result.status).toBe('installed')
    const rec = readLock(marketplacePaths(configDir).lockFile).entries['trust-doc']
    expect(rec?.trustVerdict).toBe('review-required')
  })
})