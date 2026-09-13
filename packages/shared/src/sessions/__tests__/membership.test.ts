import { describe, expect, it } from 'bun:test'
import { sessionBelongsToProject, sessionProjectIds, withProjectMembership } from '../membership.ts'
import { filterSessionMeta, type CollectionFilters, type CollectionSessionMeta } from '../collection-query.ts'

describe('session project membership (issue 335)', () => {
  it('unions legacy projectId with extra projectIds', () => {
    expect(sessionProjectIds({ projectId: 'p1', projectIds: ['p2', 'p1'] })).toEqual(['p1', 'p2'])
    expect(sessionBelongsToProject({ projectId: 'p1', projectIds: ['p2'] }, 'p2')).toBe(true)
    expect(withProjectMembership(['p2', 'p1', 'p2'])).toEqual({ projectId: 'p2', projectIds: ['p2', 'p1'] })
  })

  it('filters collection views against any membership', () => {
    const session: CollectionSessionMeta = {
      id: 's1',
      projectId: 'p1',
      projectIds: ['p2'],
      lastMessageAt: 0,
      createdAt: 0,
    }
    const filters: CollectionFilters = { projectId: ['p2'] }
    expect(filterSessionMeta(session, filters, { showCompleted: true })).toBe(true)
    expect(filterSessionMeta(session, { projectId: ['p3'] }, { showCompleted: true })).toBe(false)
  })
})
