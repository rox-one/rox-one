/** W1-04 (#1501) — Directory service + routes over the in-memory port, and Postgres row mapping. */
import { describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'
import type { AuthenticatedActor } from '../../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { matchWorkspaceModuleRoute } from '../../acl/routes.ts'
import { MAX_MANAGER_CHAIN, sqlManagerChain } from '../queries.ts'
import { MemoryDirectoryRepository, PostgresDirectoryRepository, entryFromRow, type DirectoryEntry } from '../repository.ts'
import { createDirectoryRoutes } from '../routes.ts'
import { DirectoryService } from '../service.ts'

const WS = '11111111-1111-4111-8111-111111111111'
const OTHER_WS = '99999999-9999-4999-8999-999999999999'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CEO = id(1), VP = id(2), DEV = id(3), GUEST = id(4), GONE = id(5), INVITED = id(6), PLACEHOLDER = id(7), STRANGER = id(8)
const DEPT = id(100)

function entry(principalId: string, overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    principalId, kind: 'human', status: 'active', memberRole: 'member', memberStatus: 'active',
    displayName: `P ${principalId.slice(-2)}`, givenName: null, familyName: null, username: null, avatarUrl: null,
    title: null, managerId: null, timeZone: 'UTC', locale: 'ru', departmentIds: [], ...overrides,
  }
}

function actor(principalId: string, workspaces = [WS]): AuthenticatedActor {
  return { principalId, deviceId: 'd', sessionId: 's', authenticatedWorkspaceIds: workspaces, expiresAt: Date.now() + 60_000 }
}

function setup() {
  const repo = new MemoryDirectoryRepository()
  repo.setEntry(WS, entry(CEO, { memberRole: 'owner' }))
  repo.setEntry(WS, entry(VP, { managerId: CEO, departmentIds: [DEPT] }))
  repo.setEntry(WS, entry(DEV, { managerId: VP, departmentIds: [DEPT] }))
  repo.setEntry(WS, entry(GUEST, { kind: 'guest' }))
  repo.setEntry(WS, entry(GONE, { memberStatus: 'removed', managerId: VP }))
  repo.setEntry(WS, entry(INVITED, { memberStatus: 'invited' }))
  repo.setEntry(WS, entry(PLACEHOLDER, { status: 'placeholder' }))
  repo.setEntry(OTHER_WS, entry(STRANGER))
  repo.setDepartment(WS, { departmentId: DEPT, parentId: null, name: 'Engineering', headId: VP }, [VP, DEV, GONE])
  const service = new DirectoryService(repo)
  return { repo, service, routes: createDirectoryRoutes(service) }
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; return undefined } catch (error) { return (error as { code?: string }).code }
}

describe('DirectoryService', () => {
  test('members lists only active members, paginated, without inventing anyone', async () => {
    const { service } = setup()
    const first = await service.members(actor(DEV), WS, 3)
    expect(first.members.map(m => m.principalId)).toEqual([CEO, VP, DEV])
    expect(first.nextCursor).toBe(DEV)
    const second = await service.members(actor(DEV), WS, 3, first.nextCursor!)
    expect(second.members.map(m => m.principalId)).toEqual([GUEST, PLACEHOLDER])
    expect(second.nextCursor).toBeNull()
  })

  test('guests cannot browse: only their own entry', async () => {
    const { service } = setup()
    expect((await service.principal(actor(GUEST), WS, GUEST)).kind).toBe('guest')
    expect(await code(service.members(actor(GUEST), WS))).toBe('FORBIDDEN')
    expect(await code(service.principal(actor(GUEST), WS, CEO))).toBe('FORBIDDEN')
    expect(await code(service.departments(actor(GUEST), WS))).toBe('FORBIDDEN')
    expect(await code(service.departmentMembers(actor(GUEST), WS, DEPT))).toBe('FORBIDDEN')
    expect(await code(service.managerChain(actor(GUEST), WS, GUEST))).toBe('FORBIDDEN')
    expect(await code(service.directReports(actor(GUEST), WS, GUEST))).toBe('FORBIDDEN')
  })

  test('revoked, invited and placeholder viewers are FORBIDDEN', async () => {
    const { service } = setup()
    for (const who of [GONE, INVITED, PLACEHOLDER, STRANGER]) {
      expect(await code(service.members(actor(who), WS)), who).toBe('FORBIDDEN')
    }
  })

  test('non-active or foreign targets are NOT_FOUND', async () => {
    const { service } = setup()
    expect(await code(service.principal(actor(DEV), WS, GONE))).toBe('NOT_FOUND')
    expect(await code(service.principal(actor(DEV), WS, STRANGER))).toBe('NOT_FOUND')
    expect(await code(service.departmentMembers(actor(DEV), WS, id(999)))).toBe('NOT_FOUND')
  })

  test('auth: expired actor, wrong workspace, bad ids', async () => {
    const { service } = setup()
    expect(await code(service.members({ ...actor(DEV), expiresAt: 0 }, WS))).toBe('UNAUTHENTICATED')
    expect(await code(service.members(actor(DEV, [OTHER_WS]), WS))).toBe('FORBIDDEN')
    expect(await code(service.members(actor(DEV), 'nope'))).toBe('INVALID_PAYLOAD')
    expect(await code(service.principal(actor(DEV), WS, 'nope'))).toBe('INVALID_PAYLOAD')
    expect(await code(service.members(actor(DEV), WS, 10, 'nope'))).toBe('INVALID_PAYLOAD')
  })

  test('departments, members (active only), manager chain and reports', async () => {
    const { service } = setup()
    expect(await service.departments(actor(DEV), WS)).toEqual([{ departmentId: DEPT, parentId: null, name: 'Engineering', headId: VP }])
    expect(await service.departmentMembers(actor(DEV), WS, DEPT)).toEqual([VP, DEV])
    expect(await service.managerChain(actor(DEV), WS, DEV)).toEqual([VP, CEO])
    expect(await service.directReports(actor(DEV), WS, VP)).toEqual([DEV])
  })

  test('manager chain walks and returns only active members', async () => {
    const { repo, service } = setup()
    repo.setEntry(WS, entry(GONE, { memberStatus: 'removed', managerId: CEO }))
    repo.setEntry(WS, entry(DEV, { managerId: GONE }))
    expect(await service.managerChain(actor(DEV), WS, DEV)).toEqual([])
    repo.setEntry(WS, entry(VP, { managerId: INVITED }))
    expect(await service.managerChain(actor(VP), WS, VP)).toEqual([])
  })

  test('manager chain is cycle-safe and bounded', async () => {
    const { repo, service } = setup()
    repo.setEntry(WS, entry(CEO, { managerId: DEV }))
    expect(await service.managerChain(actor(DEV), WS, DEV)).toEqual([VP, CEO])
    for (let n = 0; n < MAX_MANAGER_CHAIN + 10; n++) repo.setEntry(WS, entry(id(1000 + n), { managerId: id(1001 + n) }))
    repo.setEntry(WS, entry(id(1000 + MAX_MANAGER_CHAIN + 10)))
    expect(await service.managerChain(actor(DEV), WS, id(1000))).toHaveLength(MAX_MANAGER_CHAIN)
  })
})

describe('directory routes', () => {
  async function get(routes: ReturnType<typeof setup>['routes'], who: AuthenticatedActor, path: string, query = '') {
    const match = matchWorkspaceModuleRoute(routes, 'GET', path)
    if (!match) throw new Error(`no route ${path}`)
    return await match.route.handle({ actor: who, workspaceId: match.params.workspaceId!, params: match.params, query: new URLSearchParams(query), body: undefined })
  }

  test('every route resolves and returns its payload', async () => {
    const { routes } = setup()
    const base = `/v1/workspaces/${WS}/directory`
    expect(((await get(routes, actor(DEV), `${base}/members`, 'limit=2')) as { members: unknown[] }).members).toHaveLength(2)
    expect(((await get(routes, actor(DEV), `${base}/principals/${VP}`)) as { principal: DirectoryEntry }).principal.principalId).toBe(VP)
    expect(await get(routes, actor(DEV), `${base}/principals/${DEV}/manager-chain`)).toEqual({ principalIds: [VP, CEO] })
    expect(await get(routes, actor(DEV), `${base}/principals/${VP}/reports`)).toEqual({ principalIds: [DEV] })
    expect(((await get(routes, actor(DEV), `${base}/departments`)) as { departments: unknown[] }).departments).toHaveLength(1)
    expect(await get(routes, actor(DEV), `${base}/departments/${DEPT}/members`)).toEqual({ principalIds: [VP, DEV] })
  })

  test('query strings are strict', async () => {
    const { routes } = setup()
    const base = `/v1/workspaces/${WS}/directory`
    for (const [path, query] of [[`${base}/members`, 'limit=0'], [`${base}/members`, 'limit=501'], [`${base}/members`, 'x=1'],
      [`${base}/members`, 'limit=1&limit=2'], [`${base}/departments`, 'q=a'], [`${base}/principals/${VP}`, 'full=1']] as const) {
      expect(await code(get(routes, actor(DEV), path, query)), `${path}?${query}`).toBe('INVALID_PAYLOAD')
    }
  })
})

describe('PostgresDirectoryRepository', () => {
  function fakeDb(responder: (sql: string, params: unknown[]) => unknown[]) {
    const calls: { sql: string; params: unknown[] }[] = []
    return { calls, db: { async unsafe(sql: string, params: unknown[]) { calls.push({ sql, params }); return responder(sql, params) } } as unknown as SQL }
  }

  test('row mapping defaults v2 status columns', () => {
    expect(entryFromRow({
      principal_id: DEV, kind: 'human', status: null, member_role: 'member', member_status: null, display_name: 'Dev',
      given_name: null, family_name: null, username: 'dev', avatar_url: null, title: 'Eng', manager_id: VP, time_zone: 'UTC',
      locale: 'ru', department_ids: null,
    })).toEqual(entry(DEV, { displayName: 'Dev', username: 'dev', title: 'Eng', managerId: VP }))
  })

  test('paginates with limit+1 and never queries for invalid ids', async () => {
    const rows = [CEO, VP, DEV].map(principal_id => ({
      principal_id, kind: 'human', status: 'active', member_role: 'member', member_status: 'active', display_name: 'x',
      given_name: null, family_name: null, username: null, avatar_url: null, title: null, manager_id: null,
      time_zone: null, locale: null, department_ids: [],
    }))
    const { db, calls } = fakeDb(() => rows)
    const repo = new PostgresDirectoryRepository(db, 'tenant')
    const page = await repo.members(WS, 2)
    expect(page.members.map(m => m.principalId)).toEqual([CEO, VP])
    expect(page.nextCursor).toBe(VP)
    expect(calls[0]!.params).toEqual([WS, 3, ''])
    expect(calls[0]!.sql).toContain('"tenant".workspace_member')
    expect(await repo.principal(WS, 'bad')).toBeNull()
    expect(await repo.managerChain('bad', DEV)).toEqual([])
    expect(calls).toHaveLength(1)
    expect(() => new PostgresDirectoryRepository(db, 'Bad-Schema')).toThrow()
  })

  test('manager chain SQL is a bounded recursive CTE with a cycle guard', async () => {
    const sql = sqlManagerChain('"public".')
    expect(sql).toContain('WITH RECURSIVE')
    expect(sql).toContain('NOT (up.manager_id = ANY(c.path))')
    expect(sql).toContain('c.depth < $3')
    expect(sql).toContain("cm.status = 'active'")
    expect(sql).toContain("m.status = 'active'")
    const { db, calls } = fakeDb(() => [{ principal_id: VP, depth: 1 }])
    expect(await new PostgresDirectoryRepository(db).managerChain(WS, DEV)).toEqual([VP])
    expect(calls[0]!.params).toEqual([WS, DEV, MAX_MANAGER_CHAIN])
  })
})
