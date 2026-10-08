/** W1-04 (#1501) — ACL route table over the in-memory fact source (no database, no HTTP). */
import { describe, expect, test } from 'bun:test'
import { MemoryAclFacts, type AclPrincipalKind, type AclPrincipalStatus } from '../../../../../../packages/core/src/acl/index.ts'
import type { AuthenticatedActor } from '../../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { allowedMethods, createAclRoutes, matchWorkspaceModuleRoute, type WorkspaceModuleRoute } from '../routes.ts'
import { aclTopicAuthorizer, createWorkspaceAcl } from '../service.ts'

const WS = '11111111-1111-4111-8111-111111111111'
const OTHER_WS = '99999999-9999-4999-8999-999999999999'
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const GUEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const GONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SPACE = '10000000-0000-4000-8000-000000000001'
const GOAL = '10000000-0000-4000-8000-000000000002'
const SECRET = '10000000-0000-4000-8000-000000000003'
const MISSING = '10000000-0000-4000-8000-0000000000ff'

class Facts extends MemoryAclFacts {
  readonly principals = new Map<string, { kind: AclPrincipalKind; status: AclPrincipalStatus }>()
  async principal(id: string) { return this.principals.get(id) ?? null }
}

function actor(principalId: string, workspaces = [WS]): AuthenticatedActor {
  return { principalId, deviceId: 'dev', sessionId: 'sess', authenticatedWorkspaceIds: workspaces, expiresAt: Date.now() + 60_000 }
}

function setup() {
  const facts = new Facts()
  for (const [id, kind] of [[ALICE, 'human'], [BOB, 'human'], [GUEST, 'guest'], [GONE, 'human']] as const) {
    facts.principals.set(id, { kind, status: 'active' })
  }
  facts.setMember(WS, ALICE, { role: 'member', status: 'active' })
  facts.setMember(WS, BOB, { role: 'member', status: 'active' })
  facts.setMember(WS, GUEST, { role: 'member', status: 'active' })
  facts.setMember(WS, GONE, { role: 'member', status: 'removed' })
  facts.setResource({ ref: { kind: 'space', id: SPACE }, workspaceId: WS })
  facts.grant(WS, { kind: 'space', id: SPACE }, { subjectType: 'principal', subjectId: ALICE, role: 'editor' })
  facts.setResource({ ref: { kind: 'goal', id: GOAL }, workspaceId: WS, parents: [{ kind: 'space', id: SPACE }], spaceId: SPACE })
  facts.setResource({ ref: { kind: 'goal', id: SECRET }, workspaceId: WS, privacy: 'invited', championId: BOB })
  const acl = createWorkspaceAcl(facts)
  return { facts, acl, routes: createAclRoutes(acl) }
}

async function call(routes: WorkspaceModuleRoute[], who: AuthenticatedActor, body: unknown, workspaceId = WS) {
  const path = `/v1/workspaces/${workspaceId}/acl/check`
  const match = matchWorkspaceModuleRoute(routes, 'POST', path)
  if (!match) throw new Error('no route')
  return await match.route.handle({ actor: who, workspaceId: match.params.workspaceId!, params: match.params, query: new URLSearchParams(), body }) as {
    action: string; results: { ref: string; allowed: boolean; role: string | null; visibility: string }[]
  }
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; return undefined } catch (error) { return (error as { code?: string }).code }
}

describe('route table helpers', () => {
  test('match extracts decoded params; mismatch → null; allowed methods', () => {
    const { routes } = setup()
    expect(matchWorkspaceModuleRoute(routes, 'POST', `/v1/workspaces/${WS}/acl/check`)?.params).toEqual({ workspaceId: WS })
    expect(matchWorkspaceModuleRoute(routes, 'GET', `/v1/workspaces/${WS}/acl/check`)).toBeNull()
    expect(matchWorkspaceModuleRoute(routes, 'POST', `/v1/workspaces//acl/check`)).toBeNull()
    expect(matchWorkspaceModuleRoute(routes, 'POST', `/v1/workspaces/${WS}/acl/check/extra`)).toBeNull()
    expect(allowedMethods(routes, `/v1/workspaces/${WS}/acl/check`)).toEqual(['POST'])
    expect(() => matchWorkspaceModuleRoute(routes, 'POST', '/v1/workspaces/%E0%A4%A/acl/check')).toThrow()
  })
})

describe('POST /v1/workspaces/:workspaceId/acl/check', () => {
  test('inherited role via space membership', async () => {
    const { routes } = setup()
    const result = await call(routes, actor(ALICE), { action: 'edit', refs: [`goal:${GOAL}`, `space:${SPACE}`] })
    expect(result.results).toEqual([
      { ref: `goal:${GOAL}`, allowed: true, role: 'editor', visibility: 'show' },
      { ref: `space:${SPACE}`, allowed: true, role: 'editor', visibility: 'show' },
    ])
  })

  test('missing and unviewable secret refs are indistinguishable', async () => {
    const { routes } = setup()
    const result = await call(routes, actor(ALICE), { action: 'view', refs: [`goal:${SECRET}`, `goal:${MISSING}`] })
    expect(result.results.map(r => [r.allowed, r.role, r.visibility])).toEqual([[false, null, 'hide'], [false, null, 'hide']])
  })

  test('champion sees the secret goal (contextual tag)', async () => {
    const { routes } = setup()
    const result = await call(routes, actor(BOB), { action: 'view', refs: [`goal:${SECRET}`] })
    expect(result.results[0]).toEqual({ ref: `goal:${SECRET}`, allowed: true, role: 'manager', visibility: 'show' })
  })

  test('guest outside an explicit share is denied but not told the title', async () => {
    const { routes } = setup()
    const result = await call(routes, actor(GUEST), { action: 'view', refs: [`goal:${GOAL}`] })
    expect(result.results[0]!.allowed).toBe(false)
    expect(result.results[0]!.visibility).not.toBe('show')
  })

  test('revoked membership → FORBIDDEN; policy epoch bump re-evaluates', async () => {
    const { routes, facts } = setup()
    expect(await code(call(routes, actor(GONE), { action: 'view', refs: [`goal:${GOAL}`] }))).toBe('FORBIDDEN')
    expect((await call(routes, actor(ALICE), { action: 'view', refs: [`goal:${GOAL}`] })).results[0]!.allowed).toBe(true)
    facts.setMember(WS, ALICE, { role: 'member', status: 'left' })
    expect(await code(call(routes, actor(ALICE), { action: 'view', refs: [`goal:${GOAL}`] }))).toBe('FORBIDDEN')
  })

  test('auth and workspace binding', async () => {
    const { routes } = setup()
    const expired = { ...actor(ALICE), expiresAt: Date.now() - 1 }
    expect(await code(call(routes, expired, { action: 'view', refs: [`goal:${GOAL}`] }))).toBe('UNAUTHENTICATED')
    expect(await code(call(routes, actor(ALICE, [OTHER_WS]), { action: 'view', refs: [`goal:${GOAL}`] }))).toBe('FORBIDDEN')
    expect(await code(call(routes, actor(ALICE), { action: 'view', refs: [`goal:${GOAL}`] }, 'not-a-uuid'))).toBe('INVALID_PAYLOAD')
  })

  test('unknown principal row → FORBIDDEN', async () => {
    const { routes, facts } = setup()
    facts.principals.delete(ALICE)
    expect(await code(call(routes, actor(ALICE), { action: 'view', refs: [`goal:${GOAL}`] }))).toBe('FORBIDDEN')
  })

  test('strict payload validation', async () => {
    const { routes } = setup()
    const bad: unknown[] = [
      null, [], {}, { action: 'view' }, { action: 'fly', refs: [`goal:${GOAL}`] }, { action: 'view', refs: [] },
      { action: 'view', refs: ['nonsense'] }, { action: 'view', refs: [42] }, { action: 'view', refs: [`goal:${GOAL}`], extra: 1 },
      { action: 'view', refs: Array.from({ length: 101 }, () => `goal:${GOAL}`) },
    ]
    for (const body of bad) expect(await code(call(routes, actor(ALICE), body)), JSON.stringify(body)?.slice(0, 60)).toBe('INVALID_PAYLOAD')
  })
})

describe('topic authorizer export', () => {
  test('user topic self-only; entity topics via acl.can view; unknown fails closed', async () => {
    const { acl } = setup()
    const authorize = aclTopicAuthorizer(acl)
    const alice = await acl.principalFor(actor(ALICE), WS)
    expect(await authorize(alice, `user:${ALICE}`)).toBe(true)
    expect(await authorize(alice, `user:${BOB}`)).toBe(false)
    expect(await authorize(alice, `entity:goal:${GOAL}`)).toBe(true)
    expect(await authorize(alice, `entity:goal:${SECRET}`)).toBe(false)
    expect(await authorize(alice, 'presence:everything')).toBe(false)
  })
})
