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
      'openwiki',
      'understand-anything',
      'codegraph',
      'archify',
      'graphify',
      'groma',
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
    // Rejected code-intel tools stay out of the installable inventory.
    expect(ids).not.toContain('codewiki')
    expect(ids).not.toContain('deepwiki')
    expect(CAPABILITY_PACKS.every((pack) => pack.toolIds.length > 0)).toBe(true)
    expect(CAPABILITY_TOOLS.every((tool) => tool.default === 'available')).toBe(true)
    // Pins are never synthesized: a declared pin is a real 40/64-hex value and
    // tools without an authoritative upstream commit or digest carry null.
    expect(CAPABILITY_TOOLS.every((tool) => tool.gitRef === null || /^[a-f0-9]{40}$/.test(tool.gitRef))).toBe(true)
    expect(CAPABILITY_TOOLS.every((tool) => tool.checksum === null || /^[a-f0-9]{64}$/.test(tool.checksum))).toBe(true)
    expect(CAPABILITY_TOOLS.every((tool) => tool.checksum === null)).toBe(true)
  })

  it('records real sources, licenses and pins for the six Developer Space tools', () => {
    expect(getCapabilityTool('openwiki')!).toMatchObject({
      sourceRepo: 'langchain-ai/openwiki', license: 'MIT', version: '0.7.1',
      gitRef: '0db6dcf0ca16e81c93ff1125312be0ad6f70df6a',
    })
    expect(getCapabilityTool('understand-anything')!).toMatchObject({
      sourceRepo: 'Egonex-AI/Understand-Anything', license: 'MIT',
      gitRef: '1d7418b8abfa543744ae029e63a482aee03f9022',
    })
    expect(getCapabilityTool('codegraph')!).toMatchObject({
      sourceRepo: 'CodeGraphContext/CodeGraphContext', license: 'MIT', version: '0.6.13', gitRef: null,
    })
    expect(getCapabilityTool('archify')!).toMatchObject({
      sourceRepo: 'tt-a1i/archify', license: 'MIT', version: '3.0.1', gitRef: null,
    })
    expect(getCapabilityTool('graphify')!).toMatchObject({
      sourceRepo: 'Graphify-Labs/graphify', license: 'Apache-2.0', version: '0.9.82',
      gitRef: '5b74d7d74911cf435c8f1636b6f96ea202cc6246',
    })
    expect(getCapabilityTool('groma')!).toMatchObject({
      sourceRepo: 'MrLesk/groma.md', license: 'MIT', version: '0.6.6',
      gitRef: '9c5b6adc8e1d192198809d0566f596fe4da92d69',
    })
    const d4 = ['openwiki', 'understand-anything', 'codegraph', 'archify', 'graphify', 'groma']
    expect(CAPABILITY_TOOLS.filter((tool) => d4.includes(tool.id)).map((tool) => tool.sourceRepo.startsWith('example/'))).toEqual([false, false, false, false, false, false])
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
            ref: 'a'.repeat(40),
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

  it('emits an offline capability report without synthesized checksums', () => {
    const report = buildOfflineCapabilityReport({ installedIds: ['syft'], online: false, generatedAt: 7 })
    expect(report).toContain('online: no')
    expect(report).toContain('security-sbom/syft')
    expect(report).toContain(getCapabilityTool('syft')!.version)
    expect(report).not.toContain('a'.repeat(40))
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
