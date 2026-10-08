/** W1-04 (#1501) — PostgresAclRepository row mapping against a fake SQL client (no database). */
import { describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'
import { PostgresAclRepository, resourceFromRow, type ResourceRow } from '../repository.ts'
import { RESOURCE_LOADERS, aclStoredResourceTypes, sqlSpaceMembers } from '../queries.ts'
import type { AclEntryFact } from '../../../../../../packages/core/src/acl/index.ts'

const WS = '11111111-1111-4111-8111-111111111111'
const P = '22222222-2222-4222-8222-222222222222'
const G = '33333333-3333-4333-8333-333333333333'
const C = '44444444-4444-4444-8444-444444444444'

type Responder = (sql: string, params: unknown[]) => unknown[]

function fakeDb(responder: Responder) {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = {
    async unsafe(sql: string, params: unknown[]) {
      calls.push({ sql, params })
      return responder(sql, params)
    },
  }
  return { db: db as unknown as SQL, calls }
}

function row(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: G, workspace_id: WS, deleted: false, parent_refs: [], space_id: null, owner_id: null, champion_id: null,
    reviewer_id: null, contributor_ids: [], assignee_ids: [], has_children: false, secret: false,
    implicit_workspace_role: null, link_token: null, ...overrides,
  }
}

const workspaceViewer = (role: AclEntryFact['role'] = 'viewer'): AclEntryFact[] => [{ subjectType: 'workspace', subjectId: WS, role }]

describe('resourceFromRow', () => {
  test('maps parents, tags and privacy (a secret row drops its implicit workspace entry)', () => {
    const node = resourceFromRow({ kind: 'goal', id: G }, row({
      parent_refs: [`goal:${C}`, 'bogus', 'nokind:1', `space:${WS}`], champion_id: P, contributor_ids: null,
      secret: true, implicit_workspace_role: 'viewer', has_children: true,
    }))
    expect(node.parents).toEqual([{ kind: 'goal', id: C }, { kind: 'space', id: WS }])
    expect(node.privacy).toBe('invited')
    expect(node.championId).toBe(P)
    expect(node.contributorIds).toEqual([])
    expect(node.hasChildren).toBe(true)
    expect(node.implicitEntries).toEqual([])
    expect(resourceFromRow({ kind: 'goal', id: G }, row({ implicit_workspace_role: 'viewer' })).implicitEntries).toEqual(workspaceViewer())
  })

  test('a secret row never carries the synthetic workspace entry', () => {
    expect(resourceFromRow({ kind: 'goal', id: G }, row({ secret: true, implicit_workspace_role: 'viewer' })).implicitEntries).toEqual([])
  })

  test('a public chat carries a minimal workspace entry (see and join only)', () => {
    expect(resourceFromRow({ kind: 'channel', id: C }, row({ implicit_workspace_role: 'minimal' })).implicitEntries).toEqual(workspaceViewer('minimal'))
  })

  test('maps the space chat id, chat visibility and company-wide flag', () => {
    const node = resourceFromRow({ kind: 'space', id: G }, row({ chat_id: C, chat_public: true, company_wide: false }))
    expect(node).toMatchObject({ chatId: C, chatPublic: true, companyWide: false })
    expect(resourceFromRow({ kind: 'goal', id: G }, row())).not.toHaveProperty('chatPublic')
  })

  test('maps secrecy-only ancestors separately from role parents', () => {
    const node = resourceFromRow({ kind: 'folder', id: G }, row({ parent_refs: [], ancestor_refs: [`goal:${C}`] }))
    expect(node.parents).toEqual([])
    expect(node.ancestors).toEqual([{ kind: 'goal', id: C }])
  })

  test('unknown implicit roles are dropped (fail closed)', () => {
    expect(resourceFromRow({ kind: 'goal', id: G }, row({ implicit_workspace_role: 'owner' })).implicitEntries).toEqual([])
  })

  test('a doc public_token becomes the row-derived default link policy', () => {
    expect(resourceFromRow({ kind: 'note', id: G }, row({ link_token: 'pub' })).defaultPolicy).toEqual({
      defaultSubject: 'link', defaultRole: 'viewer', linkToken: 'pub', linkExpiresAt: null,
    })
    expect(resourceFromRow({ kind: 'note', id: G }, row()).defaultPolicy).toBeNull()
  })
})

describe('loader SQL (review 2 owner decisions)', () => {
  const sql = (kind: keyof typeof RESOURCE_LOADERS) => RESOURCE_LOADERS[kind]!('"public".')

  const parentsOf = (text: string) => text.slice(text.indexOf('FROM ('), text.indexOf('AS parent_refs'))
  const ancestorsOf = (text: string) => text.slice(text.lastIndexOf('AS chat_id'), text.indexOf('AS ancestor_refs', text.lastIndexOf('AS chat_id')))

  test('goals and projects do not list their parent goal at all (own privacy: no inheritance, no secrecy)', () => {
    for (const kind of ['goal', 'project'] as const) {
      expect(parentsOf(sql(kind))).not.toContain('parent_goal_id')
      expect(ancestorsOf(sql(kind))).not.toContain('parent_goal_id')
    }
  })

  test('personal content is owner-only secret unless shared', () => {
    expect(sql('note')).toContain('d.folder_id IS NULL AND d.wiki_space_id IS NULL AND d.space_id IS NULL AND d.parent_ref IS NULL AND d.public_token IS NULL')
    expect(sql('folder')).toContain("f.owner_type = 'user' AND NOT")
    expect(sql('calendar')).toContain("k.owner_type = 'principal' AND NOT")
    expect(sql('task')).toContain('w.project_id IS NULL AND w.space_id IS NULL AND w.parent_id IS NULL AND w.milestone_id IS NULL')
    for (const kind of ['note', 'folder', 'calendar', 'task'] as const) {
      expect(sql(kind), kind).toContain('rp.default_role IS NOT NULL')
      expect(sql(kind), kind).toContain(`(ae.subject_type = 'workspace' AND ae.subject_id = $2::uuid::text) OR (ae.subject_type = 'space' AND EXISTS (SELECT 1 FROM "public".space s WHERE s.space_id::text = ae.subject_id AND s.workspace_id = $2::uuid AND s.deleted_at IS NULL))`)
      expect(sql(kind), kind).toContain("ae.role IN ('owner', 'manager', 'editor', 'commenter', 'viewer', 'guest')")
      expect(sql(kind), kind).toContain('ae.workspace_id = $2::uuid')
    }
  })

  test('personalShared (review 5): sub-viewer grants, role-less / space presets and expired links do not un-secret', () => {
    for (const kind of ['note', 'folder', 'calendar', 'task'] as const) {
      expect(sql(kind), kind).not.toMatch(/ae\.role IN \([^)]*'(minimal|free_busy|follower)'/)
      expect(sql(kind), kind).not.toContain("rp.default_subject = 'space'")
    }
    // Only docs are link-shareable; the link preset needs a token that has not expired.
    expect(sql('note')).toContain("rp.default_subject = 'link' AND COALESCE(rp.policy->>'link_token', '') <> ''")
    expect(sql('note')).toContain('jsonb_path_exists_tz(rp.policy')
    for (const kind of ['folder', 'calendar', 'task'] as const) expect(sql(kind), kind).not.toContain("'link'")
    // Calendars also count calendar_member shares ≥ viewer, never free_busy.
    expect(sql('calendar')).toContain("calendar_member km WHERE km.calendar_id = k.calendar_id AND km.role IN ('owner', 'editor', 'viewer')")
    // Review 6: a space share counts only while the space exists in this workspace and is not deleted.
    expect(sql('calendar')).toContain(`km.subject_type = 'space' AND EXISTS (SELECT 1 FROM "public".space ks WHERE ks.space_id = km.subject_id AND ks.workspace_id = $2::uuid AND ks.deleted_at IS NULL)`)
    for (const kind of ['note', 'folder', 'calendar', 'task'] as const) expect(sql(kind), kind).not.toMatch(/OR [a-z]{2}\.subject_type = 'space'\)/)
  })

  test("task lists in 'private' or 'members' mode are secret for user / project / space owners (review 5)", () => {
    expect(sql('task-list')).toContain("l.share_mode = 'private' OR (l.share_mode = 'members' AND l.owner_type IN ('user', 'project', 'space'))")
  })

  test('goal-owned folders and members-mode lists keep their cut parents as secrecy ancestors', () => {
    expect(parentsOf(sql('folder'))).not.toContain("'goal'")
    expect(ancestorsOf(sql('folder'))).toContain("f.owner_type = 'goal'")
    expect(ancestorsOf(sql('task-list'))).toContain("l.share_mode NOT IN ('space', 'workspace')")
  })

  test('goal owner: creator only for personal goals, otherwise the current champion', () => {
    expect(sql('goal')).toContain("CASE WHEN g.scope = 'personal' THEN g.creator_id::text ELSE g.champion_id::text END AS owner_id")
  })

  test('milestones and tasks of a deleted project are deleted', () => {
    expect(sql('milestone')).toContain('pj.deleted_at IS NULL')
    expect(sql('task')).toContain('pj.deleted_at IS NULL')
  })

  test('spaces expose chat_public / company_wide for the join rule', () => {
    expect(sql('space')).toContain('sc.workspace_id = $2::uuid AND sc.visibility')
    // A deleted public chat stays public for the join rule (its members never count anyway).
    expect(sql('space')).toContain("sc.visibility = 'public') AS chat_public")
    expect(sql('space')).toContain("(s.is_company_space OR s.default_access <> 'members') AS company_wide")
  })

  test('a members project is workspace-visible only when legacy (no space) and without a policy row', () => {
    expect(sql('project')).toContain("pj.visibility = 'members' AND pj.space_id IS NULL AND NOT EXISTS")
  })

  test('chats carry no owner and public chats only minimal', () => {
    expect(sql('channel')).not.toContain('created_by')
    expect(sql('channel')).toContain("CASE WHEN c.visibility = 'public' AND (c.space_id IS NULL OR EXISTS")
    // Only company-wide, non-secret spaces may have a workspace-visible chat.
    expect(sql('channel')).toContain("(cs.is_company_space OR cs.default_access <> 'members') AND NOT EXISTS")
  })

  test('a members-only task list does not list its space / project owner as a parent', () => {
    expect(sql('task-list')).toContain("l.owner_type IN ('project', 'space') AND l.share_mode IN ('space', 'workspace')")
  })
})

describe('PostgresAclRepository', () => {
  test('rejects an unsafe schema name', () => {
    expect(() => new PostgresAclRepository(fakeDb(() => []).db, 'x;drop')).toThrow()
  })

  test('non-uuid ids and unknown kinds resolve to null without a query', async () => {
    const { db, calls } = fakeDb(() => [])
    const repo = new PostgresAclRepository(db)
    expect(await repo.resource(WS, { kind: 'goal', id: 'not-a-uuid' })).toBeNull()
    expect(await repo.resource(WS, { kind: 'session', id: G })).toBeNull()
    expect(await repo.membership('nope', P)).toBeNull()
    expect(await repo.principal('nope')).toBeNull()
    expect(await repo.policyEpoch('nope')).toBe('0')
    expect(await repo.groups(WS, 'nope')).toEqual({ departmentIds: [], channelIds: [] })
    expect(calls).toHaveLength(0)
  })

  test('every loader is schema-prefixed, workspace-scoped and suppresses the workspace grant for secrets', () => {
    for (const [kind, loader] of Object.entries(RESOURCE_LOADERS)) {
      const sql = loader!('"tenant".')
      expect(sql, kind).toContain('"tenant".')
      expect(sql, kind).toContain('$1::uuid')
      expect(sql, kind).toMatch(/WHERE [a-z]+\.[a-z_]+ = \$1::uuid AND [a-z]+\.workspace_id = \$2::uuid/)
      expect(sql, kind).toContain('CASE WHEN r.secret THEN NULL ELSE r.implicit_raw END AS implicit_workspace_role')
      if (sql.includes('resource_policy rp')) expect(sql, kind).toContain('rp.workspace_id = $2::uuid')
    }
  })

  test('resource loads pass the workspace as $2', async () => {
    const { db, calls } = fakeDb(() => [row()])
    await new PostgresAclRepository(db).resource(WS, { kind: 'goal', id: G })
    expect(calls[0]!.params).toEqual([G, WS])
  })

  test('no repository-level memo: entries / policy never reload the resource row', async () => {
    const { db, calls } = fakeDb(sql => sql.includes('FROM "public".doc d') ? [row({ link_token: 'pub' })] : [])
    const repo = new PostgresAclRepository(db)
    expect('scoped' in repo).toBe(false)
    await repo.entries(WS, { kind: 'note', id: G })
    await repo.policy(WS, { kind: 'note', id: G })
    expect(calls.filter(c => c.sql.includes('FROM "public".doc d'))).toHaveLength(0)
  })

  test('membership and principal default v2 status columns', async () => {
    const { db } = fakeDb(sql => sql.includes('workspace_member') ? [{ role: 'member', status: 'removed' }] : [{ kind: 'guest', status: null }])
    const repo = new PostgresAclRepository(db)
    expect(await repo.membership(WS, P)).toEqual({ role: 'member', status: 'removed' })
    expect(await repo.principal(P)).toEqual({ kind: 'guest', status: 'active' })
  })

  test('entries: stored rows only (invalid ones dropped); table visibility rides on the node', async () => {
    const { db, calls } = fakeDb(sql => {
      if (sql.includes('FROM "public".acl_entry')) return [
        { subject_type: 'principal', subject_id: P, role: 'editor' },
        { subject_type: 'robot', subject_id: P, role: 'editor' },
        { subject_type: 'principal', subject_id: P, role: 'god' },
      ]
      if (sql.includes('FROM "public".goal g')) return [row({ implicit_workspace_role: 'viewer' })]
      return []
    })
    const repo = new PostgresAclRepository(db)
    expect(await repo.entries(WS, { kind: 'goal', id: G })).toEqual([
      { subjectType: 'principal', subjectId: P, role: 'editor' },
    ])
    expect((await repo.resource(WS, { kind: 'goal', id: G }))!.implicitEntries).toEqual(workspaceViewer())
    expect(calls[0]!.params).toEqual([WS, 'goal', G])
  })

  test('entries: notes query both the note and legacy doc resource types', async () => {
    const { db, calls } = fakeDb(() => [])
    await new PostgresAclRepository(db).entries(WS, { kind: 'note', id: G })
    expect(aclStoredResourceTypes('note')).toEqual(['note', 'doc'])
    expect(calls[0]!.params).toEqual([WS, 'note,doc', G])
  })

  test('entries: chat members become synthetic principal grants on a channel', async () => {
    const { db, calls } = fakeDb(sql => {
      if (sql.includes('FROM "public".chat c')) return [row({ id: C, secret: true })]
      if (sql.includes('cm.role FROM')) return [
        { principal_id: P, role: 'owner' }, { principal_id: G, role: 'member' }, { principal_id: WS, role: 'weird' },
      ]
      return []
    })
    const entries = await new PostgresAclRepository(db).entries(WS, { kind: 'channel', id: C })
    expect(entries).toEqual([
      { subjectType: 'principal', subjectId: P, role: 'manager', via: 'chat' },
      { subjectType: 'principal', subjectId: G, role: 'commenter', via: 'chat' },
    ])
    expect(calls.find(c => c.sql.includes('cm.role FROM'))!.params).toEqual([C, WS])
  })

  test('entries: space members come only from a live space chat of this workspace (review 5)', () => {
    expect(sqlSpaceMembers('"public".')).toContain('JOIN "public".chat c ON c.chat_id = cm.chat_id AND c.deleted_at IS NULL AND c.workspace_id = $2::uuid')
  })

  test('entries: calendar_member rows become calendar grants (canonical calendar share store)', async () => {
    const { db, calls } = fakeDb(sql => {
      if (sql.includes('FROM "public".acl_entry')) return [{ subject_type: 'principal', subject_id: P, role: 'commenter' }]
      if (sql.includes('FROM "public".calendar_member cm')) return [
        { subject_type: 'principal', subject_id: G, role: 'owner' },
        { subject_type: 'channel', subject_id: C, role: 'viewer' },
        { subject_type: 'space', subject_id: C, role: 'editor' },
        { subject_type: 'workspace', subject_id: WS, role: 'free_busy' },
        { subject_type: 'department', subject_id: C, role: 'viewer' },
        { subject_type: 'principal', subject_id: C, role: 'god' },
      ]
      return []
    })
    expect(await new PostgresAclRepository(db).entries(WS, { kind: 'calendar', id: G })).toEqual([
      { subjectType: 'principal', subjectId: P, role: 'commenter' },
      { subjectType: 'principal', subjectId: G, role: 'manager' },
      { subjectType: 'channel', subjectId: C, role: 'viewer' },
      { subjectType: 'space', subjectId: C, role: 'editor' },
      { subjectType: 'workspace', subjectId: WS, role: 'free_busy' },
    ])
    const call = calls.find(c => c.sql.includes('calendar_member cm'))!
    expect(call.params).toEqual([WS, G])
    expect(call.sql).toContain('k.workspace_id = $1::uuid')
    // Other kinds never read calendar_member.
    const other = fakeDb(() => [])
    await new PostgresAclRepository(other.db).entries(WS, { kind: 'note', id: G })
    expect(other.calls.some(c => c.sql.includes('calendar_member'))).toBe(false)
  })

  test('entries: space chat members become space member grants', async () => {
    const { db } = fakeDb(sql => {
      if (sql.includes('JOIN "public".space s ON s.chat_id')) return [
        { principal_id: P, role: 'admin' }, { principal_id: G, role: 'member' },
      ]
      return []
    })
    expect(await new PostgresAclRepository(db).entries(WS, { kind: 'space', id: C })).toEqual([
      { subjectType: 'principal', subjectId: P, role: 'manager', via: 'chat' },
      { subjectType: 'principal', subjectId: G, role: 'editor', via: 'chat' },
    ])
  })

  test('policy: resource_policy row, with link token/expiry from policy jsonb', async () => {
    const { db } = fakeDb(sql => sql.includes('resource_policy') ? [{
      default_subject: 'link', default_role: 'commenter', policy: { link_token: 'tok', link_expires_at: '2030-01-01T00:00:00Z' },
    }] : [])
    expect(await new PostgresAclRepository(db).policy(WS, { kind: 'note', id: G })).toEqual({
      defaultSubject: 'link', defaultRole: 'commenter', linkToken: 'tok', linkExpiresAt: '2030-01-01T00:00:00Z',
    })
  })

  test('policy: no row → null (the doc public_token is the node defaultPolicy)', async () => {
    const { db } = fakeDb(sql => sql.includes('FROM "public".doc d') ? [row({ link_token: 'pub' })] : [])
    expect(await new PostgresAclRepository(db).policy(WS, { kind: 'note', id: G })).toBeNull()
  })

  test('policy: invalid preset values are dropped', async () => {
    const { db } = fakeDb(sql => sql.includes('resource_policy') ? [{ default_subject: 'world', default_role: 'owner', policy: null }] : [])
    expect(await new PostgresAclRepository(db).policy(WS, { kind: 'goal', id: G })).toEqual({
      defaultSubject: null, defaultRole: null, linkToken: null, linkExpiresAt: null,
    })
  })

  test('groups: departments and channels', async () => {
    const { db } = fakeDb(sql => sql.includes('department_member') ? [{ id: 'd1' }] : [{ id: 'c1' }, { id: 'c2' }])
    expect(await new PostgresAclRepository(db).groups(WS, P)).toEqual({ departmentIds: ['d1'], channelIds: ['c1', 'c2'] })
  })
})
