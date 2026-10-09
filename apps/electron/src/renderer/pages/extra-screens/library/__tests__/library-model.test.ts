import { describe, expect, test } from 'bun:test'
import {
  LIBRARY_SECTIONS,
  bundledPackEntries,
  filterLibrarySections,
  groupLibrary,
  isLibrarySectionId,
  librarySection,
  librarySectionCounts,
  marketplaceEntries,
  modelEntries,
  normalizeLibraryQuery,
  searchLibrary,
  skillEntries,
  sourceEntries,
  type LibraryEntry,
} from '../library-model'

function entry(patch: Partial<LibraryEntry> & Pick<LibraryEntry, 'id' | 'section' | 'title'>): LibraryEntry {
  return { ...patch }
}

describe('library model — query normalization', () => {
  test('trims and lowercases', () => {
    expect(normalizeLibraryQuery('  GitHub  ')).toBe('github')
  })
  test('handles Cyrillic case folding', () => {
    expect(normalizeLibraryQuery('НАВЫКИ')).toBe('навыки')
  })
})

describe('library model — section registry', () => {
  test('declares all six sections in the spec order', () => {
    expect(LIBRARY_SECTIONS.map((section) => section.id)).toEqual([
      'skills',
      'sources',
      'mcp',
      'connections',
      'integrations',
      'extensions',
    ])
  })
  test('isLibrarySectionId narrows known ids and rejects unknown', () => {
    expect(isLibrarySectionId('mcp')).toBe(true)
    expect(isLibrarySectionId('nope')).toBe(false)
    expect(isLibrarySectionId(null)).toBe(false)
  })
  test('librarySection falls back to the first section for unknown ids', () => {
    expect(librarySection('mcp').id).toBe('mcp')
    expect(librarySection('missing' as never).id).toBe('skills')
  })
})

describe('library model — search', () => {
  const entries: LibraryEntry[] = [
    entry({ id: 'a', section: 'skills', title: 'Дизайн-критика', subtitle: 'Ревью макетов', keywords: ['design'] }),
    entry({ id: 'b', section: 'sources', title: 'GitHub', subtitle: 'Код', keywords: ['git'] }),
    entry({ id: 'c', section: 'mcp', title: 'Playwright MCP', subtitle: 'Браузер' }),
  ]

  test('empty query returns everything in order', () => {
    expect(searchLibrary(entries, '   ').map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })
  test('matches title case-insensitively', () => {
    expect(searchLibrary(entries, 'github').map((row) => row.id)).toEqual(['b'])
  })
  test('matches Cyrillic title and subtitle', () => {
    expect(searchLibrary(entries, 'макет').map((row) => row.id)).toEqual(['a'])
    expect(searchLibrary(entries, 'браузер').map((row) => row.id)).toEqual(['c'])
  })
  test('matches extra keywords', () => {
    expect(searchLibrary(entries, 'git').map((row) => row.id)).toEqual(['b'])
  })
  test('returns nothing on a miss', () => {
    expect(searchLibrary(entries, 'zzz')).toEqual([])
  })
})

describe('library model — counts and grouping', () => {
  const entries: LibraryEntry[] = [
    entry({ id: 's2', section: 'skills', title: 'Бета' }),
    entry({ id: 's1', section: 'skills', title: 'Альфа' }),
    entry({ id: 'm1', section: 'mcp', title: 'Сервер' }),
  ]

  test('zero-fills every section', () => {
    expect(librarySectionCounts(entries)).toEqual({
      skills: 2,
      sources: 0,
      mcp: 1,
      connections: 0,
      integrations: 0,
      extensions: 0,
    })
  })
  test('groups in registry order and drops empty sections', () => {
    const groups = groupLibrary(entries)
    expect(groups.map((group) => group.section.id)).toEqual(['skills', 'mcp'])
  })
  test('sorts rows alphabetically inside a group', () => {
    const groups = groupLibrary(entries)
    expect(groups[0]!.entries.map((row) => row.id)).toEqual(['s1', 's2'])
  })
  test('empty input yields no groups', () => {
    expect(groupLibrary([])).toEqual([])
  })
})

describe('library model — section nav filter', () => {
  const labelOf = (section: (typeof LIBRARY_SECTIONS)[number]) => section.id

  test('empty query keeps every section', () => {
    expect(filterLibrarySections(LIBRARY_SECTIONS, '', labelOf)).toHaveLength(6)
  })
  test('matches by keyword (bilingual)', () => {
    expect(filterLibrarySections(LIBRARY_SECTIONS, 'маркетплейс', labelOf).map((s) => s.id)).toEqual(['extensions'])
    expect(filterLibrarySections(LIBRARY_SECTIONS, 'tools', labelOf).map((s) => s.id)).toEqual(['mcp'])
  })
  test('matches by injected translated label', () => {
    const labels = { mcp: 'Инструменты MCP' }
    const found = filterLibrarySections(LIBRARY_SECTIONS, 'инструменты', (section) => labels[section.id as 'mcp'] ?? section.id)
    expect(found.map((s) => s.id)).toContain('mcp')
  })
  test('unknown query yields no sections', () => {
    expect(filterLibrarySections(LIBRARY_SECTIONS, 'zzz', labelOf)).toEqual([])
  })
})

describe('library model — adapters', () => {
  test('skills map to the skills section', () => {
    const rows = skillEntries([
      { slug: 'design-critique', source: 'workspace', path: '/w/s', metadata: { name: 'Дизайн-критика', description: 'Ревью' }, content: '' },
    ] as never)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'design-critique', section: 'skills', title: 'Дизайн-критика' })
  })

  test('mcp sources land in the mcp section, other sources in sources', () => {
    const source = (slug: string, type: 'mcp' | 'api' | 'local') =>
      ({ config: { slug, name: slug, type, provider: 'github', tagline: 'tag' } }) as never
    const rows = sourceEntries([source('a', 'mcp'), source('b', 'api'), source('c', 'local')])
    expect(rows.map((row) => [row.id, row.section])).toEqual([
      ['a', 'mcp'],
      ['b', 'sources'],
      ['c', 'sources'],
    ])
  })

  test('model connections surface under sources with a model keyword', () => {
    const rows = modelEntries([{ slug: 'pi', name: 'Pi', providerType: 'pi', defaultModel: 'pi-1' } as never])
    expect(rows[0]).toMatchObject({ id: 'pi', section: 'sources', title: 'Pi', subtitle: 'pi-1' })
    expect(rows[0]!.keywords).toContain('model')
  })

  test('marketplace entries cover packs and tools under extensions', () => {
    const rows = marketplaceEntries({
      packs: [{ id: 'code-intelligence', title: 'Кодовые интеллекты' }],
      tools: [{ id: 'search-code', title: 'Поиск по коду', packId: 'code-intelligence' }],
    })
    expect(rows.every((row) => row.section === 'extensions')).toBe(true)
    const tool = rows.find((row) => row.id === 'tool:search-code')!
    expect(tool.title).toBe('Поиск по коду')
    expect(tool.subtitle).toBe('Кодовые интеллекты')
  })

  test('bundled skill packs project into extension rows', () => {
    const rows = bundledPackEntries([
      { slug: 'superpowers', skills: ['writing-plans'], installed: [], disabled: false, localModified: false },
    ] as never)
    expect(rows[0]).toMatchObject({ id: 'bundled:superpowers', section: 'extensions', title: 'superpowers' })
    expect(rows[0]!.keywords).toContain('writing-plans')
  })
})