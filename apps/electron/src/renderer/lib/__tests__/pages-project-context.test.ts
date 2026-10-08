import { describe, expect, test } from 'bun:test'
import { pagesContextFilter, pagesCreationProject, pagesProjectContext } from '../pages-project-context'

describe('Pages project selection', () => {
  const unassigned = '__unassigned__'
  test('global project choices select one library project and all-project resets the filter', () => {
    expect(pagesContextFilter('project-a')).toEqual(['project-a'])
    expect(pagesContextFilter(null)).toEqual([])
    expect(pagesContextFilter(undefined)).toEqual([])
  })
  test('one real library project becomes global context while advanced filters keep global all-project scope', () => {
    expect(pagesProjectContext(['project-a'], unassigned)).toBe('project-a')
    expect(pagesProjectContext(['project-a', 'project-a'], unassigned)).toBe('project-a')
    for (const ids of [[], [unassigned], ['project-a', 'project-b'], ['project-a', unassigned]]) expect(pagesProjectContext(ids, unassigned)).toBeNull()
  })
  test('creation binds only a real loaded project and ignores stale or unassigned IDs', () => {
    expect(pagesCreationProject([unassigned, 'deleted', 'project-b'], ['project-a', 'project-b'])).toBe('project-b')
    expect(pagesCreationProject([unassigned, 'deleted'], ['project-a'])).toBeUndefined()
    expect(pagesCreationProject(['project-a'], [])).toBeUndefined()
  })
})
