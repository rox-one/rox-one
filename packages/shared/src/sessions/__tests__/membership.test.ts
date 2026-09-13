import { describe, expect, it } from 'bun:test'
import {
  filterProjectContextForViewer,
  membershipsFromSession,
  sessionBelongsToProject,
  sessionProjectIds,
  uniquePortfolioSessionIds,
  unlinkProjectMembership,
  visibleMembershipsForViewer,
  withProjectMembership,
} from '../membership.ts'
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

  it('unlink removes membership without deleting the entity id', () => {
    const memberships = membershipsFromSession({ id: 's1', projectId: 'p1', projectIds: ['p1', 'p2'] })
    const remaining = unlinkProjectMembership(memberships, 's1', 'p1')
    expect(remaining.map((item) => item.projectId)).toEqual(['p2'])
    expect(remaining[0]?.entityId).toBe('s1')
    expect(remaining[0]?.linkRole).toBe('primary')
  })

  it('portfolio counts a shared session once', () => {
    const memberships = [
      ...membershipsFromSession({ id: 's1', projectId: 'p1', projectIds: ['p1', 'p2'] }),
      ...membershipsFromSession({ id: 's2', projectId: 'p2' }),
    ]
    expect(uniquePortfolioSessionIds(memberships)).toEqual(['s1', 's2'])
  })

  it('closed project context is not leaked through a shared session', () => {
    const memberships = membershipsFromSession({ id: 's1', projectId: 'open', projectIds: ['open', 'closed'] })
    const projects = [
      { id: 'open', name: 'Open' },
      { id: 'closed', name: 'Secret', closedAt: 1, details: 'classified' },
    ]
    const visible = visibleMembershipsForViewer({ memberships, viewerProjectId: 'open', projects })
    expect(visible.map((item) => item.projectId)).toEqual(['open'])
    expect(filterProjectContextForViewer(projects, 'open').map((project) => project.id)).toEqual(['open'])
  })
})
