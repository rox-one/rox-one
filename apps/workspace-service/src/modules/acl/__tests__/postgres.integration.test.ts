/**
 * W1-04 (#1501) — ACL + directory repositories against a real Postgres that
 * already has the W1-05 (#1502) migrations applied in `public`.
 *
 * Opt-in: skipped unless `ROX_WORKSPACE_ACL_TEST_DATABASE_URL` is set (point it
 * at a throwaway database). Everything runs in one transaction that is
 * rolled back, so nothing is left behind.
 */
import { describe, expect, test } from 'bun:test'
import { SQL, type TransactionSQL } from 'bun'
import { createAcl } from '../../../../../../packages/core/src/acl/index.ts'
import { PostgresAclRepository } from '../repository.ts'
import { PostgresDirectoryRepository } from '../../directory/repository.ts'

const URL = process.env.ROX_WORKSPACE_ACL_TEST_DATABASE_URL
const ROLLBACK = new Error('rollback')

const id = () => crypto.randomUUID()

async function inRollback(fn: (tx: TransactionSQL) => Promise<void>): Promise<void> {
  const db = new SQL(URL!)
  try {
    await db.begin(async tx => { await fn(tx); throw ROLLBACK })
  } catch (error) {
    if (error !== ROLLBACK) throw error
  } finally {
    await db.close()
  }
}

describe.skipIf(!URL)('Postgres ACL + directory (#1502 schema)', () => {
  test('roles, secrets, synthetic grants, links, revocation and manager chain', async () => {
    await inRollback(async tx => {
      const [ws, owner, alice, bob, guest, gone, ph] = [id(), id(), id(), id(), id(), id(), id()]
      const q = (sql: string, params: unknown[] = []) => tx.unsafe(sql, params)
      for (const [p, kind, status] of [[owner, 'human', 'active'], [alice, 'human', 'active'], [bob, 'human', 'active'],
        [guest, 'guest', 'active'], [gone, 'human', 'active'], [ph, 'human', 'placeholder']] as const) {
        await q('INSERT INTO principal (principal_id, kind, status) VALUES ($1, $2, $3)', [p, kind, status])
      }
      await q(`INSERT INTO workspace (workspace_id, owner_principal_id, name) VALUES ($1, $2, 'WS')`, [ws, owner])
      for (const [p, role, status] of [[owner, 'owner', 'active'], [alice, 'member', 'active'], [bob, 'member', 'active'],
        [guest, 'member', 'active'], [gone, 'member', 'removed'], [ph, 'member', 'active']] as const) {
        await q('INSERT INTO workspace_member (workspace_id, principal_id, role, status) VALUES ($1, $2, $3, $4)', [ws, p, role, status])
      }
      const [company, personal, child, project, privProject, chat, doc, secretDoc] = [id(), id(), id(), id(), id(), id(), id(), id()]
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id) VALUES ($1, $2, 'company', 'Company', $3)`, [company, ws, owner])
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, champion_id) VALUES ($1, $2, 'personal', 'Secret', $3, $4)`, [personal, ws, alice, bob])
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, parent_goal_id) VALUES ($1, $2, 'company', 'Child', $3, $4)`, [child, ws, owner, company])
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility) VALUES ($1, $2, $3, 'Open', 'members')`, [project, ws, owner])
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility) VALUES ($1, $2, $3, 'Closed', 'private')`, [privProject, ws, owner])
      await q(`INSERT INTO chat (chat_id, workspace_id, kind, visibility) VALUES ($1, $2, 'group', 'private')`, [chat, ws])
      await q(`INSERT INTO chat_member (chat_id, principal_id, role) VALUES ($1, $2, 'admin')`, [chat, alice])
      await q(`INSERT INTO doc (doc_id, workspace_id, owner_id, public_token) VALUES ($1, $2, $3, 'pub-token')`, [doc, ws, owner])
      await q(`INSERT INTO doc (doc_id, workspace_id, owner_id) VALUES ($1, $2, $3)`, [secretDoc, ws, owner])
      await q(`INSERT INTO resource_policy (policy_id, workspace_id, resource_type, resource_id, policy) VALUES ($1, $2, 'note', $3, '{"privacy":"invited"}')`, [id(), ws, secretDoc])
      await q(`INSERT INTO acl_entry (acl_id, workspace_id, resource_type, resource_id, subject_type, subject_id, role) VALUES ($1, $2, 'doc', $3, 'principal', $4, 'commenter')`, [id(), ws, secretDoc, guest])
      const dept = id()
      await q(`INSERT INTO department (department_id, workspace_id, name) VALUES ($1, $2, 'Eng')`, [dept, ws])
      await q(`INSERT INTO department_member (department_id, principal_id, role) VALUES ($1, $2, 'head')`, [dept, bob])
      await q(`INSERT INTO acl_entry (acl_id, workspace_id, resource_type, resource_id, subject_type, subject_id, role) VALUES ($1, $2, 'project', $3, 'department', $4, 'editor')`, [id(), ws, privProject, dept])
      // Manager chain alice → bob → owner → alice (cycle).
      await q(`INSERT INTO user_profile (principal_id, workspace_id, display_name, manager_id) VALUES ($1, $2, 'Owner', $3)`, [owner, ws, alice])
      await q(`INSERT INTO user_profile (principal_id, workspace_id, display_name, manager_id) VALUES ($1, $2, 'Bob', $3)`, [bob, ws, owner])
      await q(`INSERT INTO user_profile (principal_id, workspace_id, display_name, manager_id) VALUES ($1, $2, 'Alice', $3)`, [alice, ws, bob])

      const facts = new PostgresAclRepository(tx)
      const acl = createAcl(facts)
      const who = async (p: string, linkToken?: string) => ({ id: p, workspaceId: ws, ...(await facts.principal(p))!, ...(linkToken ? { linkToken } : {}) })
      const can = async (p: string, action: Parameters<typeof acl.can>[1], kind: Parameters<typeof acl.can>[2]['kind'], rid: string, link?: string) =>
        await acl.can(await who(p, link), action, { kind, id: rid })

      // Company goal: workspace viewers; child inherits; secret personal goal: creator owner, champion manager, others nothing.
      expect(await can(alice, 'view', 'goal', company)).toBe(true)
      expect(await can(alice, 'edit', 'goal', company)).toBe(false)
      expect(await can(alice, 'view', 'goal', child)).toBe(true)
      expect(await can(owner, 'delete', 'goal', company)).toBe(false) // has_children
      expect((await acl.evaluate(await who(owner), 'delete', { kind: 'goal', id: company })).reason).toBe('has_children')
      expect(await can(alice, 'transfer', 'goal', personal)).toBe(true)
      expect(await can(bob, 'manage_access', 'goal', personal)).toBe(true)
      expect(await can(guest, 'view', 'goal', personal)).toBe(false)
      const hidden = await acl.evaluate(await who(guest), 'view', { kind: 'goal', id: personal })
      expect(hidden.secret).toBe(true)
      expect(hidden.preview).toBe('none')
      // Projects: members visibility → workspace viewer; private → department grant only.
      expect(await can(alice, 'view', 'project', project)).toBe(true)
      expect(await can(alice, 'view', 'project', privProject)).toBe(false)
      expect(await can(bob, 'edit', 'project', privProject)).toBe(true)
      // Private chat: admin member → editor; others none.
      expect(await can(alice, 'edit', 'channel', chat)).toBe(true)
      expect(await can(bob, 'view', 'channel', chat)).toBe(false)
      // Doc public token: a link view grant; the secret doc is shared with the guest via a legacy 'doc' row.
      expect(await can(bob, 'view', 'note', doc, 'pub-token')).toBe(true)
      expect(await can(bob, 'comment', 'note', doc, 'pub-token')).toBe(false)
      expect(await can(guest, 'comment', 'note', secretDoc)).toBe(true)
      expect(await can(alice, 'view', 'note', secretDoc)).toBe(false)
      // Hard denials.
      expect((await acl.evaluate(await who(gone), 'view', { kind: 'goal', id: company })).reason).toBe('not_member')
      expect((await acl.evaluate(await who(ph), 'view', { kind: 'goal', id: company })).reason).toBe('placeholder')
      expect((await acl.evaluate(await who(alice), 'view', { kind: 'goal', id: id() })).reason).toBe('not_found')
      // Epoch bump invalidates: remove alice → not_member immediately.
      await q(`UPDATE workspace_member SET status = 'left' WHERE workspace_id = $1 AND principal_id = $2`, [ws, alice])
      await q(`UPDATE workspace SET policy_epoch = policy_epoch + 1 WHERE workspace_id = $1`, [ws])
      expect((await acl.evaluate(await who(alice), 'view', { kind: 'goal', id: company })).reason).toBe('not_member')

      const directory = new PostgresDirectoryRepository(tx)
      expect((await directory.members(ws, 10)).members.map(m => m.principalId).sort()).toEqual([owner, bob, guest, ph].sort())
      expect(await directory.managerChain(ws, alice)).toEqual([bob, owner])
      expect(await directory.directReports(ws, owner)).toEqual([bob])
      expect(await directory.departments(ws)).toEqual([{ departmentId: dept, parentId: null, name: 'Eng', headId: bob }])
      expect(await directory.departmentMembers(ws, dept)).toEqual([bob])
      expect((await directory.principal(ws, bob))?.departmentIds).toEqual([dept])
    })
  })
})
