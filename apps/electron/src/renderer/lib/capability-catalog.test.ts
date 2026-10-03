import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoadedSource, LoadedSkill, BundledSkillPackStatus } from '../../shared/types'
import { buildCapabilityCatalog, filterCapabilityCatalog, setCatalogPackEnabled, sourceCatalogStatus } from './capability-catalog'
import { ensureBundledSkills, listBundledSkillPacks } from '@rox/shared/skills/bundled'
import { loadSource, saveSourceConfig } from '@rox/shared/sources/storage'

function source(slug: string, provider = 'github', overrides: Partial<LoadedSource['config']> = {}): LoadedSource {
  return { config: { id: slug, slug, name: 'Same name', type: 'mcp', provider, enabled: true, mcp: { url: 'https://example.test/mcp', authType: 'oauth' }, ...overrides }, guide: null, folderPath: `/w/sources/${slug}`, workspaceRootPath: '/w', workspaceId: 'w' }
}
function skill(slug: string, source: LoadedSkill['source'] = 'workspace'): LoadedSkill {
  return { slug, source, path: `/w/${source}/skills/${slug}`, metadata: { name: slug, description: 'Instructions', requiredSources: ['github'] }, content: 'body' }
}
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('capability catalog identity, status and filters', () => {
  it('keeps same-name sources and skill scopes separate; missing usage stays unknown', () => {
    const rows = buildCapabilityCatalog({ sources: [source('one'), source('two')], skills: [skill('review'), skill('review', 'omp')] })
    expect(new Set(rows.map(r => r.key)).size).toBe(4)
    expect(rows.filter(r => r.ref.kind === 'skill').map(r => r.promptHits)).toEqual([undefined, undefined])
    expect(rows.filter(r => r.ref.kind === 'skill').map(r => r.ref.scope)).toEqual(['workspace', 'omp'])
  })
  it('never turns saved/anonymous credentials into a tested connection', () => {
    expect(sourceCatalogStatus(source('a', 'github', { isAuthenticated: true }))).toBe('untested')
    expect(sourceCatalogStatus(source('a', 'github', { mcp: { url: 'https://example.test', authType: 'none' } }))).toBe('untested')
    expect(sourceCatalogStatus(source('a', 'github', { connectionStatus: 'connected', isAuthenticated: false }))).toBe('needs_auth')
    expect(sourceCatalogStatus(source('a', 'github', { connectionStatus: 'failed', isAuthenticated: true }))).toBe('failed')
    expect(sourceCatalogStatus(source('a', 'github', { enabled: false, connectionStatus: 'connected' }))).toBe('local_disabled')
  })
  it('intersects semantic category, transport and status without losing unknown resources', () => {
    const rows = buildCapabilityCatalog({ sources: [source('a', 'github', { connectionStatus: 'connected', isAuthenticated: true }), source('b', 'custom', { type: 'api' }), source('c', 'slack')] })
    expect(filterCapabilityCatalog(rows, { category: 'code', technicalType: 'mcp', connectedOnly: true }).map(r => r.ref.id)).toEqual(['a'])
    expect(filterCapabilityCatalog(rows, { category: 'other' }).map(r => r.ref.id)).toEqual(['b'])
    expect(filterCapabilityCatalog(rows, { query: 'Same name' })).toHaveLength(3)
  })
  it('uses verified bundled membership for skill aliases without categorizing display-name lookalikes', () => {
    const pack: BundledSkillPackStatus = { slug: 'impeccable', origin: null, commit: 'pinned', disabled: false, localModified: false, skills: ['design-alias'], installed: ['design-alias'], conflicts: [] }
    const rows = buildCapabilityCatalog({ skills: [skill('design-alias'), skill('custom')], packs: [pack] })
    expect(rows[0]?.categories).toEqual(['design'])
    expect(rows[1]?.categories).toEqual(['other'])
  })
  it('retains recorded prompt hits without inventing assigned agents or runtime usage', () => {
    const row = buildCapabilityCatalog({ skills: [skill('review')], usage: { review: { used: 4, lastUsedAt: '2026-01-01' } } })[0]!
    expect(row.promptHits).toBe(4)
    expect(row.usedInRun).toBe(false)
    expect(row.author).toBeUndefined()
    expect(row.updatedAt).toBeUndefined()
  })
  it('expired model credentials and disabled native tools do not appear connected', () => {
    const model = { slug: 'expired', name: 'Expired', providerType: 'omp' as const, authType: 'none' as const, createdAt: 1, isAuthenticated: true, oauthExpiresAt: 1 }
    expect(buildCapabilityCatalog({ models: [model] })[0]?.status).toBe('needs_auth')
    expect(sourceCatalogStatus(source('native', 'custom', { mcp: { transport: 'stdio', command: 'echo', authType: 'none' } }), false)).toBe('local_disabled')
  })
  it('model credentials remain distinct from MCP transport and source identities', () => {
    const rows = buildCapabilityCatalog({ sources: [source('rox')], models: [{ slug: 'rox', name: 'Same name', providerType: 'omp', authType: 'none', createdAt: 1, isAuthenticated: true }] })
    expect(rows.map(r => r.technicalType)).toEqual(['mcp', 'model'])
    expect(rows[1]?.status).toBe('authenticated')
    expect(filterCapabilityCatalog(rows, { connectedOnly: true })).toHaveLength(0)
  })
})

describe('catalog store mutations with actual readback', () => {
  it('enables a real bundled pack and reads the installed files back', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-catalog-')); dirs.push(root)
    const bundleRoot = join(root, 'bundle'); const targetRoot = join(root, 'target')
    mkdirSync(join(bundleRoot, 'sample', 'alpha'), { recursive: true })
    writeFileSync(join(bundleRoot, 'sample', 'alpha', 'SKILL.md'), '---\nname: Alpha\ndescription: Test skill\n---\nInstructions')
    let disabled = ['sample']
    const api = {
      listBundledSkillPacks: async () => listBundledSkillPacks({ bundleRoot, targetRoot, disabled }),
      setBundledSkillsDisabled: async (next: string[]) => { disabled = next; ensureBundledSkills({ bundleRoot, targetRoot, disabled, linksRoot: null }) },
    }
    const initial = await api.listBundledSkillPacks()
    const result = await setCatalogPackEnabled(api, initial, 'sample', true)
    expect(result.packs[0]?.disabled).toBe(false)
    expect(result.packs[0]?.installed).toEqual(['alpha'])
    expect(result.failures).toEqual([])
  })
  it('reports partial install and mismatched readback without claiming success', async () => {
    const pack: BundledSkillPackStatus = { slug: 'sample', disabled: true, origin: null, commit: null, localModified: false, skills: ['a', 'b'], installed: ['a'], conflicts: [] }
    const api = { setBundledSkillsDisabled: async () => {}, listBundledSkillPacks: async () => [{ ...pack, disabled: false, error: 'disk full' }] }
    const result = await setCatalogPackEnabled(api, [pack], 'sample', true)
    expect(result.failures).toEqual(['disk full', 'b'])
    await expect(setCatalogPackEnabled({ ...api, listBundledSkillPacks: async () => [pack] }, [pack], 'sample', true)).rejects.toThrow('readback')
  })
  it('source config write/readback preserves failed/revoked state and workspace identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-catalog-source-')); dirs.push(root)
    const config = source('github', 'github', { isAuthenticated: false, connectionStatus: 'needs_auth' }).config
    saveSourceConfig(root, config)
    const read = loadSource(root, 'github')!
    expect(read.config.slug).toBe('github')
    expect(sourceCatalogStatus(read)).toBe('needs_auth')
    saveSourceConfig(root, { ...config, isAuthenticated: true, connectionStatus: 'failed' })
    expect(sourceCatalogStatus(loadSource(root, 'github')!)).toBe('failed')
  })
})
