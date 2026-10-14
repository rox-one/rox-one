import { describe, expect, it } from 'bun:test'
import { filterRecent, filterThemes } from '../omnibox-extra-sections'
import { pushRecent } from '../../lib/recent-routes'

describe('⌘K recent + themes (#6)', () => {
  it('pushRecent dedupes, keeps most recent first, caps', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b'], 'z', 2)).toEqual(['z', 'a'])
  })
  it('recent excludes the active route and filters by title', () => {
    const rows = [{ route: 'feed', title: 'Feed' }, { route: 'docs/x', title: 'Notes', subtitle: 'x' }]
    expect(filterRecent(rows, '', 'feed').map((r) => r.route)).toEqual(['docs/x'])
    expect(filterRecent(rows, 'not', null).map((r) => r.route)).toEqual(['docs/x'])
  })
  it('themes show only when asked', () => {
    const rows = [{ id: 'dracula', title: 'Dracula', active: false }, { id: 'nord', title: 'Nord', active: true }]
    expect(filterThemes(rows, '')).toEqual([])
    expect(filterThemes(rows, 't')).toEqual([])
    expect(filterThemes(rows, 'theme').length).toBe(2)
    expect(filterThemes(rows, 'тема nord').map((r) => r.id)).toEqual(['nord'])
    expect(filterThemes(rows, 'drac').map((r) => r.id)).toEqual(['dracula'])
  })
})
