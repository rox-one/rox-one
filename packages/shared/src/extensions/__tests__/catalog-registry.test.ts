import { describe, expect, it } from 'bun:test'
import {
  COMMUNITY_EXTENSION_REGISTRIES,
  createCommunityRegistryProviders,
} from '../community-registries.ts'
import { CraftCuratedProvider, createDefaultCatalogRegistry } from '../catalog.ts'
import type { MarketplaceCatalog } from '../../marketplace/catalog.ts'

const CATALOG: MarketplaceCatalog = {
  catalogVersion: 1,
  entries: [
    {
      id: 'demo-pack',
      kind: 'skillpack',
      title: 'Demo',
      descriptionRu: 'демо',
      source: {
        type: 'github',
        repo: 'acme/demo',
        ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      expectedContentSha256: {
        demo: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    },
  ],
}

describe('default catalog registry (P35-06)', () => {
  it('labels the curated provider Rox Kiro and omits SiYuan Bazaar', () => {
    const curated = new CraftCuratedProvider({ loadCatalog: () => CATALOG })
    expect(curated.label).toBe('Rox Kiro')
    const registry = createDefaultCatalogRegistry(() => CATALOG)
    const ids = registry.listProviders().map((p) => p.id)
    expect(ids).toContain('craft-curated')
    expect(ids).not.toContain('siyuan-bazaar')
    expect(ids.filter((id) => id.startsWith('community-')).sort()).toEqual(
      COMMUNITY_EXTENSION_REGISTRIES.map((r) => r.id).slice().sort(),
    )
  })

  it('stubs community registries with docs URLs and no live tokens', async () => {
    const providers = createCommunityRegistryProviders()
    expect(providers).toHaveLength(6)
    for (const p of providers) {
      expect(p.community).toBe(true)
      expect(p.docsUrl.startsWith('https://')).toBe(true)
      expect(p.docsUrl).not.toMatch(/token|api[_-]?key|secret/i)
      expect(await p.list()).toEqual([])
      expect(await p.fetch('x', '1')).toBeNull()
    }
    const labels = providers.map((p) => p.label)
    expect(labels).toEqual(['Anthropic', 'Codex', 'Cursor', 'Hermes', 'OpenCode', 'OpenClaw'])
  })
})
