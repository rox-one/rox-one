import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { marketplacePaths, type MarketplaceEntry, type MarketplaceFetch } from '../marketplace/catalog.ts'
import { readLock } from '../marketplace/lock.ts'
import { generateAgentsMdHeuristics, buildOfflineCapabilityReport } from './agents-md.ts'
import {
  buildProvenanceManifest,
  installCapability,
  selectCapabilityTools,
  uninstallCapability,
} from './install.ts'
import {
  CAPABILITY_PACK_IDS,
  CAPABILITY_PACKS,
  CAPABILITY_TOOLS,
  getCapabilityTool,
  isHighRiskCapability,
} from './packs.ts'
import { estimateProviderTokens, providerFamilyFromType, reconcileTokenUsage } from './tokens.ts'

const REF = 'd'.repeat(40)

const DOC_ENTRY: MarketplaceEntry = {
  id: 'soul-pack',
  kind: 'context-doc',
  title: 'Soul Pack',
  descriptionRu: 'Тестовый документ',
  source: { type: 'github', repo: 'owner/docs', ref: REF },
  documents: [{ repoPath: 'AGENTS.md', targetName: 'agents.md' }],
}

const docFetch: MarketplaceFetch = async (url) => {
  if (!url.includes(`/${REF}/`)) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' }
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => '# Agent Doc' }
}

describe('capability packs', () => {
  it('groups the requested tools into the six packs', () => {
    expect(CAPABILITY_PACK_IDS).toEqual([
      'code-intelligence',
      'browser',
      'documents',
      'reminders',
      'security-sbom',
      'research',
    ])
    const ids = CAPABILITY_TOOLS.map((tool) => tool.id)
    for (const required of [
      'syft',
      'codewiki',
      'deepwiki',
      'understand-anything',
      'codegraph',
      'graphify',
      'archify',
      'visual-explainer',
      'summarize',
      'fs-safe',
      'agent-scripts',
      'cua',
      'remindctl',
      'tokentally',
      'sweetcookie',
      'sweetlink',
      'firecrawl',
      'document-tooling',
    ]) {
      expect(ids).toContain(required)
    }
    expect(CAPABILITY_PACKS.every((pack) => pack.toolIds.length > 0)).toBe(true)
    expect(CAPABILITY_TOOLS.every((tool) => tool.default === 'available')).toBe(true)
    expect(CAPABILITY_TOOLS.every((tool) => /^[a-f0-9]{40}$/.test(tool.gitRef))).toBe(true)
    expect(CAPABILITY_TOOLS.every((tool) => /^[a-f0-9]{64}$/.test(tool.checksum))).toBe(true)
  })

  it('does not auto-enable high-risk tools', () => {
    expect(isHighRiskCapability('cua')).toBe(true)
    expect(isHighRiskCapability('sweetcookie')).toBe(true)
    expect(isHighRiskCapability('firecrawl')).toBe(true)
    expect(isHighRiskCapability('syft')).toBe(false)
    expect(getCapabilityTool('cua')?.highRisk).toBe(true)
  })
})

describe('install/uninstall idempotency', () => {
  let home: string
  let configDir: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'capability-install-'))
    configDir = join(home, '.craft')
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('installs once and reports already-installed on repeat', async () => {
    const first = await installCapability(DOC_ENTRY, { configDir, fetchFn: docFetch, now: () => 1 })
    expect(first.status).toBe('installed')
    const second = await installCapability(DOC_ENTRY, { configDir, fetchFn: docFetch, now: () => 2 })
    expect(second.status).toBe('already-installed')
    expect(readLock(marketplacePaths(configDir).lockFile).entries['soul-pack']?.installedAt).toBe(1)
  })

  it('skips high-risk tools unless allowHighRisk is set', async () => {
    const risky: MarketplaceEntry = {
      ...DOC_ENTRY,
      id: 'cua',
    }
    const skipped = await installCapability(risky, { configDir, fetchFn: docFetch, allowHighRisk: false })
    expect(skipped.status).toBe('skipped-high-risk')
    expect(readLock(marketplacePaths(configDir).lockFile).entries['cua']).toBeUndefined()
  })

  it('uninstall is idempotent', async () => {
    await installCapability(DOC_ENTRY, { configDir, fetchFn: docFetch })
    expect(uninstallCapability('soul-pack', { configDir }).status).toBe('removed')
    expect(uninstallCapability('soul-pack', { configDir }).status).toBe('not-installed')
  })
})

describe('provenance and selection fixtures', () => {
  it('builds a provenance manifest with pins and enabled flags', () => {
    const manifest = buildProvenanceManifest(
      {
        version: 1,
        entries: {
          syft: {
            id: 'syft',
            kind: 'tool',
            repo: 'anchore/syft',
            ref: getCapabilityTool('syft')!.gitRef,
            installedAt: 9,
            status: 'installed',
            targets: [],
          },
        },
      },
      42,
    )
    expect(manifest.generatedAt).toBe(42)
    const sbom = manifest.packs.find((pack) => pack.id === 'security-sbom')
    const syft = sbom?.tools.find((tool) => tool.id === 'syft')
    expect(syft?.enabled).toBe(true)
    expect(syft?.checksum).toBe(getCapabilityTool('syft')!.checksum)
    expect(sbom?.tools.find((tool) => tool.id === 'fs-safe')?.enabled).toBe(false)
  })

  it('selects the smallest installed code-intelligence tool for a repository task', () => {
    const selected = selectCapabilityTools(
      { kind: 'repository' },
      ['codegraph', 'visual-explainer', 'cua', 'firecrawl'],
    )
    expect(selected.map((tool) => tool.id)).toEqual(['visual-explainer'])
    expect(selected[0]?.expectedOutput).toContain('Diagram')
  })

  it('does not select high-risk research tools for a URL task', () => {
    expect(selectCapabilityTools({ kind: 'url' }, ['firecrawl']).map((tool) => tool.id)).toEqual([])
    expect(selectCapabilityTools({ kind: 'url' }, ['tokentally']).map((tool) => tool.id)).toEqual(['tokentally'])
  })
})

describe('AGENTS.md heuristics and offline report', () => {
  it('writes when-to-activate, expected output, permission, and unusual-use', () => {
    const md = generateAgentsMdHeuristics(['visual-explainer', 'cua'])
    expect(md).toContain('## code-intelligence')
    expect(md).toContain('When to activate:')
    expect(md).toContain('Expected output:')
    expect(md).toContain('Permission:')
    expect(md).toContain('Unusual use:')
    expect(md).toContain('High-risk: do not auto-enable.')
  })

  it('emits an offline capability report with checksums', () => {
    const report = buildOfflineCapabilityReport({ installedIds: ['syft'], online: false, generatedAt: 7 })
    expect(report).toContain('online: no')
    expect(report).toContain('security-sbom/syft')
    expect(report).toContain(getCapabilityTool('syft')!.checksum)
    expect(report).toContain('installed')
  })
})

describe('provider-aware tokenizer', () => {
  it('matches the shared heuristic for Rox/OpenAI and reconciles actual usage', () => {
    const text = 'abcd'.repeat(25)
    expect(estimateProviderTokens(text, 'rox')).toBe(25)
    expect(providerFamilyFromType('omp')).toBe('rox')
    expect(providerFamilyFromType('anthropic')).toBe('anthropic')
    expect(estimateProviderTokens(text, 'anthropic')).toBeGreaterThan(estimateProviderTokens(text, 'rox'))
    expect(reconcileTokenUsage(100, 120)).toEqual({
      estimated: 100,
      actual: 120,
      delta: 20,
      driftRatio: 0.2,
    })
  })
})
