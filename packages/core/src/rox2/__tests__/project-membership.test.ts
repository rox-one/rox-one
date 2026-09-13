import { describe, expect, test } from 'bun:test'
import { formatRox2EntityId, isAllowedRox2Relation } from '../platform-contract.ts'
import {
  compatiblePrimaryProjectId,
  emptyProjectMembershipStore,
  entityIdsForProject,
  linkEntityToProject,
  parseProjectMembershipStore,
  portfolioEntityIds,
  unlinkEntityFromProject,
  visibleProjectsForEntity,
} from '../project-membership.ts'

const session = formatRox2EntityId('session', 'alpha')
const work = 'proj-work'
const home = 'proj-home'
const closed = 'proj-closed'

const vis = [
  { id: work, readable: true },
  { id: home, readable: true },
  { id: closed, readable: true, archived: true },
] as const

describe('ROX2 project membership', () => {
  test('member-of allows session→project and forbids project→session', () => {
    expect(isAllowedRox2Relation('member-of', 'session', 'project')).toBe(true)
    expect(isAllowedRox2Relation('member-of', 'note', 'project')).toBe(true)
    expect(isAllowedRox2Relation('member-of', 'project', 'session')).toBe(false)
  })

  test('one session can belong to two projects without copying history', () => {
    let store = emptyProjectMembershipStore()
    store = linkEntityToProject(store, session, work, 'primary')
    store = linkEntityToProject(store, session, home, 'member')
    expect(entityIdsForProject(store, work, vis)).toEqual([session])
    expect(entityIdsForProject(store, home, vis)).toEqual([session])
    expect(compatiblePrimaryProjectId(store, session)).toBe(work)
    expect(portfolioEntityIds(store, vis)).toEqual([session])
  })

  test('unlink removes the edge and keeps the entity pointer for remaining projects', () => {
    let store = emptyProjectMembershipStore()
    store = linkEntityToProject(store, session, work, 'primary')
    store = linkEntityToProject(store, session, home, 'member')
    store = unlinkEntityFromProject(store, session, work)
    expect(entityIdsForProject(store, work, vis)).toEqual([])
    expect(entityIdsForProject(store, home, vis)).toEqual([session])
    expect(compatiblePrimaryProjectId(store, session)).toBe(home)
    expect(session.startsWith('session:')).toBe(true)
  })

  test('archived project is not disclosed through a shared session', () => {
    let store = emptyProjectMembershipStore()
    store = linkEntityToProject(store, session, work, 'primary')
    store = linkEntityToProject(store, session, closed, 'member')
    expect(entityIdsForProject(store, closed, vis)).toEqual([])
    expect(visibleProjectsForEntity(store, session, vis)).toEqual([work])
    expect(visibleProjectsForEntity(store, session, [{ id: work, readable: false }])).toEqual([])
  })

  test('unknown schema versions keep the original payload', () => {
    const future = { schemaVersion: 9, memberships: [{ extra: true }] }
    expect(parseProjectMembershipStore(future)).toEqual({
      ok: false,
      code: 'unsupported-version',
      preserved: future,
    })
    expect(parseProjectMembershipStore({ schemaVersion: 1, memberships: 'nope' }).ok).toBe(false)
    const parsed = parseProjectMembershipStore({
      schemaVersion: 1,
      memberships: [{ entityId: session, projectId: work, linkRole: 'primary' }],
      primaryProjectId: { [session]: work },
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.store.memberships).toHaveLength(1)
  })
})
