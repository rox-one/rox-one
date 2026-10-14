import { describe, expect, test } from 'bun:test'
import { pagesCreationProject } from '../pages-project-context'

describe('Pages project selection', () => {
  const unassigned = '__unassigned__'
  test('creation binds only a real loaded project and ignores stale or unassigned IDs', () => {
    expect(pagesCreationProject([unassigned, 'deleted', 'project-b'], ['project-a', 'project-b'])).toBe('project-b')
    expect(pagesCreationProject([unassigned, 'deleted'], ['project-a'])).toBeUndefined()
    expect(pagesCreationProject(['project-a'], [])).toBeUndefined()
  })
})
