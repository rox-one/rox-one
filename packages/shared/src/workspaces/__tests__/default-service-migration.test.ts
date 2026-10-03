import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../storage.ts'
import { loadSource, saveSourceConfig } from '../../sources/storage.ts'

describe('existing workspace default service migration', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rox-default-services-workspace-'))
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      id: 'fixture-ws', name: 'Existing Workspace', slug: 'existing',
      defaults: { enabledSourceSlugs: ['custom-service'] }, createdAt: 1, updatedAt: 1,
    }))
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })
  it('adds all four service tools to existing workspace session defaults and preserves custom providers', () => {
    const config = loadWorkspaceConfig(root)!
    expect(config.defaults?.enabledSourceSlugs?.sort()).toEqual(['brave', 'custom-service', 'e2b', 'exa', 'firecrawl'])
    const persisted = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
    expect(persisted.defaults.enabledSourceSlugs.sort()).toEqual(config.defaults?.enabledSourceSlugs?.sort())
    for (const slug of ['exa', 'firecrawl', 'brave', 'e2b']) expect(loadSource(root, slug)?.config.enabled).toBe(true)
  })
  it('never restores services explicitly disabled after their first migration', () => {
    const config = loadWorkspaceConfig(root)!
    const source = loadSource(root, 'exa')!
    saveSourceConfig(root, { ...source.config, enabled: false })
    config.defaults!.enabledSourceSlugs = config.defaults!.enabledSourceSlugs!.filter((slug) => slug !== 'exa')
    saveWorkspaceConfig(root, config)
    const reloaded = loadWorkspaceConfig(root)!
    expect(reloaded.defaults!.enabledSourceSlugs).not.toContain('exa')
    expect(loadSource(root, 'exa')!.config.enabled).toBe(false)
  })
})
