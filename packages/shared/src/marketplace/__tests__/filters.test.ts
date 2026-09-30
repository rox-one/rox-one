import { describe, expect, it } from 'bun:test'

import type { MarketplaceEntry } from '../catalog.ts'
import { filterMarketplaceEntries } from '../filters.ts'

const catalog: MarketplaceEntry[] = [
  {
    id: 'notes-helper',
    kind: 'skillpack',
    title: 'Notes helper',
    descriptionRu: 'Search and organize notes',
    source: { type: 'github', repo: 'rox/notes-helper', ref: 'a'.repeat(40) },
    tags: ['knowledge', 'local'],
  },
  {
    id: 'web-helper',
    kind: 'skillpack',
    title: 'Web helper',
    descriptionRu: 'Read web pages',
    source: { type: 'github', repo: 'rox/web-helper', ref: 'b'.repeat(40) },
    tags: ['browser', 'local'],
  },
  {
    id: 'notes-tool',
    kind: 'tool',
    title: 'Notes tool',
    descriptionRu: 'Manage notes',
    source: { type: 'github', repo: 'rox/notes-tool', ref: 'c'.repeat(40) },
    tags: ['knowledge', 'service'],
  },
]

describe('marketplace entry filtering', () => {
  it('intersects search, kind, multiple tags, installed state, and a saved group', () => {
    const result = filterMarketplaceEntries(catalog, {
      query: 'NOTES',
      kind: 'skillpack',
      tags: ['knowledge', 'local'],
      installedOnly: true,
      installedIds: new Set(['notes-helper', 'notes-tool']),
      groupIds: new Set(['notes-helper', 'web-helper']),
    })

    expect(result.map(({ id }) => id)).toEqual(['notes-helper'])
  })

  it('orders ties by title and id so refreshes do not reshuffle equal-ranked entries', () => {
    const result = filterMarketplaceEntries(catalog, {
      sort: 'stars',
      stats: {
        'notes-helper': { id: 'notes-helper', stars: 4, fetchedAt: 0, stale: false },
        'web-helper': { id: 'web-helper', stars: 4, fetchedAt: 0, stale: false },
        'notes-tool': { id: 'notes-tool', stars: 4, fetchedAt: 0, stale: false },
      },
    })

    expect(result.map(({ id }) => id)).toEqual(['notes-helper', 'notes-tool', 'web-helper'])
  })
})
