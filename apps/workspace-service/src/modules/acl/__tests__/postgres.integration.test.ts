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
import { createAcl, listingVisibility } from '../../../../../../packages/core/src/acl/index.ts'
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
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, champion_id) VALUES ($1, $2, 'company', 'Company', $3, $4)`, [company, ws, owner, alice])
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, champion_id) VALUES ($1, $2, 'personal', 'Secret', $3, $4)`, [personal, ws, alice, bob])
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility) VALUES ($1, $2, $3, 'Open', 'members')`, [project, ws, owner])
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility) VALUES ($1, $2, $3, 'Closed', 'private')`, [privProject, ws, owner])
      await q(`INSERT INTO chat (chat_id, workspace_id, kind, visibility) VALUES ($1, $2, 'group', 'private')`, [chat, ws])
      await q(`INSERT INTO chat_member (chat_id, principal_id, role) VALUES ($1, $2, 'admin')`, [chat, alice])
      await q(`INSERT INTO doc (doc_id, workspace_id, owner_id, public_token) VALUES ($1, $2, $3, 'pub-token')`, [doc, ws, owner])
      await q(`INSERT INTO doc (doc_id, workspace_id, owner_id) VALUES ($1, $2, $3)`, [secretDoc, ws, owner])
      await q(`INSERT INTO resource_policy (policy_id, workspace_id, resource_type, resource_id, policy) VALUES ($1, $2, 'note', $3, '{"privacy":"invited"}')`, [id(), ws, secretDoc])
      await q(`INSERT INTO acl_entry (acl_id, workspace_id, resource_type, resource_id, subject_type, subject_id, role) VALUES ($1, $2, 'doc', $3, 'principal', $4, 'commenter')`, [id(), ws, secretDoc, guest])
      // Space: members are the active members of the space chat; a space goal inherits.
      const [spaceChat, rootFolder, space, spaceGoal] = [id(), id(), id(), id()]
      await q(`INSERT INTO chat (chat_id, workspace_id, kind, visibility) VALUES ($1, $2, 'space', 'private')`, [spaceChat, ws])
      await q(`INSERT INTO folder (folder_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'space', $3, 'Root')`, [rootFolder, ws, space])
      await q(`INSERT INTO space (space_id, workspace_id, name, chat_id, root_folder_id) VALUES ($1, $2, 'Team', $3, $4)`, [space, ws, spaceChat, rootFolder])
      await q(`INSERT INTO chat_member (chat_id, principal_id, role) VALUES ($1, $2, 'member')`, [spaceChat, bob])
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, space_id) VALUES ($1, $2, 'space', 'Space goal', $3, $4)`, [spaceGoal, ws, owner, space])
      // Company goal → space child goal (no goal → goal inheritance: own privacy).
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, space_id, parent_goal_id) VALUES ($1, $2, 'space', 'Child', $3, $4, $5)`, [child, ws, owner, space, company])
      // Space project with visibility 'members' = everyone in the space (not workspace-visible); a legacy one with a policy row follows the row.
      const [spaceProject, policedProject, goalProject] = [id(), id(), id()]
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility, space_id) VALUES ($1, $2, $3, 'Space open', 'members', $4)`, [spaceProject, ws, owner, space])
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility) VALUES ($1, $2, $3, 'Policed', 'members')`, [policedProject, ws, owner])
      await q(`INSERT INTO resource_policy (policy_id, workspace_id, resource_type, resource_id) VALUES ($1, $2, 'project', $3)`, [id(), ws, policedProject])
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility, space_id, parent_goal_id) VALUES ($1, $2, $3, 'Under company goal', 'members', $4, $5)`, [goalProject, ws, owner, space, company])
      // Task lists in the space: 'members' is not space-visible, 'space' is.
      const [membersList, spaceList] = [id(), id()]
      await q(`INSERT INTO task_list (task_list_id, workspace_id, owner_type, owner_id, name, share_mode) VALUES ($1, $2, 'space', $3, 'Members', 'members')`, [membersList, ws, space])
      await q(`INSERT INTO task_list (task_list_id, workspace_id, owner_type, owner_id, name, share_mode) VALUES ($1, $2, 'space', $3, 'Space', 'space')`, [spaceList, ws, space])
      // A task in the private project (secret ancestor).
      const privTask = id()
      await q(`INSERT INTO work_item (work_item_id, workspace_id, owner_principal_id, title, project_id) VALUES ($1, $2, $3, 'Hidden', $4)`, [privTask, ws, owner, privProject])
      // Private chat created by bob, who was later removed; a public chat (alice admin) with a chat-owned folder.
      const [bobChat, publicChat, chatFolder] = [id(), id(), id()]
      await q(`INSERT INTO chat (chat_id, workspace_id, kind, visibility, created_by) VALUES ($1, $2, 'group', 'private', $3)`, [bobChat, ws, bob])
      await q(`INSERT INTO chat_member (chat_id, principal_id, role, state) VALUES ($1, $2, 'owner', 'removed')`, [bobChat, bob])
      await q(`INSERT INTO chat (chat_id, workspace_id, kind, visibility, created_by) VALUES ($1, $2, 'group', 'public', $3)`, [publicChat, ws, alice])
      await q(`INSERT INTO chat_member (chat_id, principal_id, role) VALUES ($1, $2, 'admin')`, [publicChat, alice])
      await q(`INSERT INTO folder (folder_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'chat', $3, 'Chat files')`, [chatFolder, ws, publicChat])
      // Review 3 fixtures.
      // Goal ownership: a company goal created by bob and championed by bob.
      const ownedGoal = id()
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, champion_id) VALUES ($1, $2, 'company', 'Owned', $3, $3)`, [ownedGoal, ws, bob])
      // A space goal championed by bob (a space-chat member, removed later).
      const championGoal = id()
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, space_id, champion_id) VALUES ($1, $2, 'space', 'Champion', $3, $4, $5)`, [championGoal, ws, owner, space, bob])
      // Secrecy-only ancestors: a goal-owned folder under the personal goal; a members list of the private project.
      const [goalFolder, privList, listTask] = [id(), id(), id()]
      await q(`INSERT INTO folder (folder_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'goal', $3, 'Goal files')`, [goalFolder, ws, personal])
      await q(`INSERT INTO task_list (task_list_id, workspace_id, owner_type, owner_id, name, share_mode) VALUES ($1, $2, 'project', $3, 'Members', 'members')`, [privList, ws, privProject])
      await q(`INSERT INTO work_item (work_item_id, workspace_id, owner_principal_id, title) VALUES ($1, $2, $3, 'Listed')`, [listTask, ws, alice])
      await q(`INSERT INTO task_in_list (task_list_id, work_item_id, sort_key) VALUES ($1, $2, 'm')`, [privList, listTask])
      // A secret space whose chat is 'public', with a chat-owned folder; a members-only space with a public chat alice joined.
      const [hiddenChat, hiddenRoot, hiddenSpace, hiddenFolder] = [id(), id(), id(), id()]
      await q(`INSERT INTO chat (chat_id, workspace_id, kind, visibility) VALUES ($1, $2, 'space', 'public')`, [hiddenChat, ws])
      await q(`INSERT INTO folder (folder_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'space', $3, 'Root')`, [hiddenRoot, ws, hiddenSpace])
      await q(`INSERT INTO space (space_id, workspace_id, name, chat_id, root_folder_id) VALUES ($1, $2, 'Hidden', $3, $4)`, [hiddenSpace, ws, hiddenChat, hiddenRoot])
      await q(`UPDATE chat SET space_id = $2 WHERE chat_id = $1`, [hiddenChat, hiddenSpace])
      await q(`INSERT INTO resource_policy (policy_id, workspace_id, resource_type, resource_id, policy) VALUES ($1, $2, 'space', $3, '{"privacy":"invited"}')`, [id(), ws, hiddenSpace])
      await q(`INSERT INTO folder (folder_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'chat', $3, 'Hidden chat files')`, [hiddenFolder, ws, hiddenChat])
      const [openChat, openRoot, openSpace, openGoal] = [id(), id(), id(), id()]
      await q(`INSERT INTO chat (chat_id, workspace_id, kind, visibility) VALUES ($1, $2, 'space', 'public')`, [openChat, ws])
      await q(`INSERT INTO folder (folder_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'space', $3, 'Root')`, [openRoot, ws, openSpace])
      await q(`INSERT INTO space (space_id, workspace_id, name, chat_id, root_folder_id) VALUES ($1, $2, 'Members only', $3, $4)`, [openSpace, ws, openChat, openRoot])
      await q(`UPDATE chat SET space_id = $2 WHERE chat_id = $1`, [openChat, openSpace])
      await q(`INSERT INTO chat_member (chat_id, principal_id, role) VALUES ($1, $2, 'member')`, [openChat, alice])
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, space_id) VALUES ($1, $2, 'space', 'Members goal', $3, $4)`, [openGoal, ws, owner, openSpace])
      // A deleted project: its milestone and tasks are gone too.
      const [deadProject, deadMilestone, deadTask] = [id(), id(), id()]
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility, deleted_at) VALUES ($1, $2, $3, 'Dead', 'members', now())`, [deadProject, ws, owner])
      await q(`INSERT INTO milestone (milestone_id, workspace_id, project_id, title, sort_key) VALUES ($1, $2, $3, 'M', 'm')`, [deadMilestone, ws, deadProject])
      await q(`INSERT INTO work_item (work_item_id, workspace_id, owner_principal_id, title, project_id) VALUES ($1, $2, $3, 'Orphan', $4)`, [deadTask, ws, owner, deadProject])
      // Review 4 — personal content is owner-only secret unless shared.
      const [myDoc, myFolder, myFolderDoc, myCalendar, looseTask, sharedDoc, childOfPersonal] = [id(), id(), id(), id(), id(), id(), id()]
      await q(`INSERT INTO doc (doc_id, workspace_id, owner_id) VALUES ($1, $2, $3)`, [myDoc, ws, alice])
      await q(`INSERT INTO folder (folder_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'user', $3, 'Mine')`, [myFolder, ws, alice])
      await q(`INSERT INTO doc (doc_id, workspace_id, owner_id, folder_id) VALUES ($1, $2, $3, $4)`, [myFolderDoc, ws, alice, myFolder])
      await q(`INSERT INTO calendar (calendar_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'principal', $3, 'Alice')`, [myCalendar, ws, alice])
      await q(`INSERT INTO work_item (work_item_id, workspace_id, owner_principal_id, title) VALUES ($1, $2, $3, 'Loose')`, [looseTask, ws, alice])
      await q(`INSERT INTO work_item_member (work_item_id, principal_id, role) VALUES ($1, $2, 'assignee')`, [looseTask, bob])
      await q(`INSERT INTO doc (doc_id, workspace_id, owner_id) VALUES ($1, $2, $3)`, [sharedDoc, ws, alice])
      await q(`INSERT INTO acl_entry (acl_id, workspace_id, resource_type, resource_id, subject_type, subject_id, role) VALUES ($1, $2, 'note', $3, 'workspace', $4, 'viewer')`, [id(), ws, sharedDoc, ws])
      for (const [rtype, rid, role] of [['note', myDoc, 'commenter'], ['folder', myFolder, 'viewer'], ['calendar', myCalendar, 'free_busy']] as const) {
        await q(`INSERT INTO acl_entry (acl_id, workspace_id, resource_type, resource_id, subject_type, subject_id, role) VALUES ($1, $2, $3, $4, 'principal', $5, $6)`, [id(), ws, rtype, rid, bob, role])
      }
      // A company goal under the personal goal: governed by its own privacy.
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, parent_goal_id) VALUES ($1, $2, 'company', 'Under personal', $3, $4)`, [childOfPersonal, ws, owner, personal])
      const presetGoal = id()
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, space_id) VALUES ($1, $2, 'space', 'Space edit goal', $3, $4)`, [presetGoal, ws, owner, space])
      await q(`INSERT INTO resource_policy (policy_id, workspace_id, resource_type, resource_id, default_subject, default_role) VALUES ($1, $2, 'goal', $3, 'space', 'editor')`, [id(), ws, presetGoal])
      // A company goal made "Only invited people" via resource_policy.
      const invitedCompanyGoal = id()
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id) VALUES ($1, $2, 'company', 'Invited', $3)`, [invitedCompanyGoal, ws, owner])
      await q(`INSERT INTO resource_policy (policy_id, workspace_id, resource_type, resource_id, policy) VALUES ($1, $2, 'goal', $3, '{"privacy":"invited"}')`, [id(), ws, invitedCompanyGoal])
      // Another workspace reuses the project id (project PK is (workspace_id, project_id)).
      const ws2 = id()
      await q(`INSERT INTO workspace (workspace_id, owner_principal_id, name) VALUES ($1, $2, 'WS2')`, [ws2, owner])
      await q(`INSERT INTO workspace_member (workspace_id, principal_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [ws2, owner])
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility) VALUES ($1, $2, $3, 'Twin', 'private')`, [project, ws2, owner])
      await q(`INSERT INTO resource_policy (policy_id, workspace_id, resource_type, resource_id, policy) VALUES ($1, $2, 'project', $3, '{"privacy":"invited"}')`, [id(), ws2, project])
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

      // Company goal: workspace viewers (alice champions it); the space child goal / project
      // under it is NOT visible to non-members of the space; secret personal goal: creator owner,
      // champion manager, others nothing.
      expect(await can(bob, 'view', 'goal', company)).toBe(true)
      expect(await can(bob, 'edit', 'goal', company)).toBe(false)
      expect(await can(alice, 'manage_access', 'goal', company)).toBe(true)
      expect(await can(alice, 'view', 'goal', child)).toBe(false)
      expect(await can(alice, 'view', 'project', goalProject)).toBe(false)
      expect(await can(bob, 'view', 'goal', child)).toBe(true) // space member
      expect(await can(bob, 'edit', 'goal', child)).toBe(false)
      expect(await can(owner, 'delete', 'goal', company)).toBe(false) // has_children
      expect((await acl.evaluate(await who(owner), 'delete', { kind: 'goal', id: company })).reason).toBe('has_children')
      expect(await can(alice, 'transfer', 'goal', personal)).toBe(true)
      expect(await can(bob, 'manage_access', 'goal', personal)).toBe(true)
      expect(await can(guest, 'view', 'goal', personal)).toBe(false)
      const hidden = await acl.evaluate(await who(guest), 'view', { kind: 'goal', id: personal })
      expect(hidden.secret).toBe(true)
      expect(hidden.preview).toBe('none')
      // The workspace owner: manager on non-secret resources, never on another person's personal goal.
      expect(await can(owner, 'manage_access', 'project', project)).toBe(true)
      expect(await can(owner, 'view', 'goal', personal)).toBe(false)
      expect(await acl.evaluate(await who(owner), 'view', { kind: 'goal', id: personal })).toMatchObject({ secret: true, preview: 'none' })
      expect(await can(owner, 'view', 'task', privTask)).toBe(true) // owner_principal_id of the task (contextual owner)
      // Projects: legacy members visibility → workspace viewer; private → department grant only;
      // a space 'members' project → space members; a policy row overrides the legacy viewer.
      expect(await can(alice, 'view', 'project', project)).toBe(true)
      expect(await can(alice, 'view', 'project', privProject)).toBe(false)
      expect(await can(bob, 'edit', 'project', privProject)).toBe(true)
      expect(await can(alice, 'view', 'project', spaceProject)).toBe(false)
      expect(await can(bob, 'view', 'project', spaceProject)).toBe(true)
      expect(await can(alice, 'view', 'project', policedProject)).toBe(false)
      // Secret ancestor: the private project's task is hidden from alice; the department editor inherits.
      expect(await acl.evaluate(await who(alice), 'view', { kind: 'task', id: privTask })).toMatchObject({ allowed: false, secret: true, preview: 'none' })
      expect(await can(bob, 'edit', 'task', privTask)).toBe(true)
      // Task lists: a members-only space list is not space-visible; a space list is.
      expect(await can(bob, 'view', 'task-list', membersList)).toBe(false)
      expect(await can(bob, 'view', 'task-list', spaceList)).toBe(true)
      // Chats: a removed private-chat creator loses access (ownership = active chat_member role only);
      // a public chat is minimal for non-members, and that does not reach its folder.
      expect(await can(bob, 'view', 'channel', bobChat)).toBe(false)
      expect(await acl.evaluate(await who(bob), 'view', { kind: 'channel', id: publicChat })).toMatchObject({ allowed: false, role: 'minimal', preview: 'minimal' })
      expect(await can(bob, 'view_title', 'folder', chatFolder)).toBe(false)
      expect(await acl.evaluate(await who(alice), 'view', { kind: 'folder', id: chatFolder })).toMatchObject({ allowed: true, role: 'viewer' })
      // Private chat: admin member → editor; others none.
      expect(await can(alice, 'edit', 'channel', chat)).toBe(true)
      expect(await can(bob, 'view', 'channel', chat)).toBe(false)
      // Doc public token: a link view grant; the secret doc is shared with the guest via a legacy 'doc' row.
      expect(await can(bob, 'view', 'note', doc, 'pub-token')).toBe(true)
      expect(await can(bob, 'comment', 'note', doc, 'pub-token')).toBe(false)
      expect(await can(guest, 'comment', 'note', secretDoc)).toBe(true)
      expect(await can(alice, 'view', 'note', secretDoc)).toBe(false)
      // Space chat member: viewer on a space goal by default, editor only through its space preset.
      expect(await can(bob, 'view', 'goal', spaceGoal)).toBe(true)
      expect(await can(bob, 'edit', 'goal', spaceGoal)).toBe(false)
      expect(await can(bob, 'edit', 'goal', presetGoal)).toBe(true)
      expect(await can(alice, 'view', 'goal', spaceGoal)).toBe(false)
      expect(await can(alice, 'view', 'goal', presetGoal)).toBe(false)
      // Invited policy beats the company scope: no synthetic workspace grant, hidden from listings.
      expect(await can(alice, 'view', 'goal', invitedCompanyGoal)).toBe(false)
      const invited = await acl.evaluate(await who(alice), 'view', { kind: 'goal', id: invitedCompanyGoal })
      expect(invited).toMatchObject({ secret: true, preview: 'none' })
      // The foreign twin (private + invited) does not shadow our project.
      expect(await can(alice, 'view', 'project', project)).toBe(true)
      expect(await can(alice, 'view', 'space', space)).toBe(false)
      // Review 3 — secrecy-only ancestors: hidden from others, no owner bypass.
      for (const [kind, rid] of [['folder', goalFolder], ['task-list', privList], ['task', listTask], ['channel', hiddenChat], ['folder', hiddenFolder]] as const) {
        for (const p of [owner, bob]) {
          const decision = await acl.evaluate(await who(p), 'view', { kind, id: rid })
          expect(decision, `${kind} ${p === owner ? 'owner' : 'bob'}`).toMatchObject({ allowed: false, secret: true, preview: 'none' })
        }
      }
      expect(await can(alice, 'view', 'task', listTask)).toBe(true) // the task's own owner
      // The secret space's 'public' chat: no workspace minimal, title not listed.
      expect(await acl.evaluate(await who(alice), 'view_title', { kind: 'channel', id: hiddenChat })).toMatchObject({ allowed: false, role: null, secret: true })
      // Joining the public chat of a members-only space does not make alice a space member.
      expect(await can(alice, 'view', 'goal', openGoal)).toBe(false)
      // … nor any role on that space itself (review 4), while the private space chat's member keeps editor.
      expect(await acl.evaluate(await who(alice), 'view', { kind: 'space', id: openSpace })).toMatchObject({ allowed: false, role: null })
      expect(await acl.evaluate(await who(bob), 'edit', { kind: 'space', id: space })).toMatchObject({ allowed: true, role: 'editor' })
      expect(await acl.evaluate(await who(bob), 'view_title', { kind: 'channel', id: openChat })).toMatchObject({ allowed: false, role: null })
      // Deleted project → its milestone and task are not found.
      expect((await acl.evaluate(await who(owner), 'view', { kind: 'milestone', id: deadMilestone })).reason).toBe('not_found')
      expect((await acl.evaluate(await who(owner), 'view', { kind: 'task', id: deadTask })).reason).toBe('not_found')
      // Goal ownership follows the champion; the personal goal's creator stays owner.
      expect(await can(bob, 'transfer', 'goal', ownedGoal)).toBe(true)
      await q(`UPDATE goal SET champion_id = $2 WHERE goal_id = $1`, [ownedGoal, alice])
      await q(`UPDATE workspace SET policy_epoch = policy_epoch + 1 WHERE workspace_id = $1`, [ws])
      expect(await can(bob, 'transfer', 'goal', ownedGoal)).toBe(false)
      expect(await can(bob, 'view', 'goal', ownedGoal)).toBe(true) // company scope
      expect(await can(alice, 'transfer', 'goal', ownedGoal)).toBe(true)
      expect(await can(alice, 'transfer', 'goal', personal)).toBe(true)
      // A champion removed from the space keeps nothing beyond the edges.
      expect(await can(bob, 'manage_access', 'goal', championGoal)).toBe(true)
      await q(`UPDATE chat_member SET state = 'removed' WHERE chat_id = $1 AND principal_id = $2`, [spaceChat, bob])
      await q(`UPDATE workspace SET policy_epoch = policy_epoch + 1 WHERE workspace_id = $1`, [ws])
      expect(await can(bob, 'view', 'goal', championGoal)).toBe(false)
      expect(await can(bob, 'view', 'goal', spaceGoal)).toBe(false)
      // Review 4 — the workspace owner cannot see a member's personal doc, folder doc, calendar or loose task.
      for (const [kind, rid] of [['note', myDoc], ['folder', myFolder], ['note', myFolderDoc], ['calendar', myCalendar], ['task', looseTask]] as const) {
        const decision = await acl.evaluate(await who(owner), 'view', { kind, id: rid })
        expect(decision, `owner ${kind}`).toMatchObject({ allowed: false, secret: true, preview: 'none' })
        expect(await can(alice, 'edit', kind, rid), `alice ${kind}`).toBe(true)
      }
      // … while explicit shares, free_busy and the assignee tag still work.
      expect(await can(bob, 'comment', 'note', myDoc)).toBe(true)
      expect(await can(bob, 'view', 'note', myFolderDoc)).toBe(true) // through the shared folder
      expect(await acl.evaluate(await who(bob), 'view_title', { kind: 'calendar', id: myCalendar })).toMatchObject({ allowed: true, preview: 'minimal' })
      expect(await can(bob, 'edit', 'task', looseTask)).toBe(true)
      // A workspace-shared personal doc is no longer personal.
      expect(await can(owner, 'manage_access', 'note', sharedDoc)).toBe(true)
      expect(await can(bob, 'view', 'note', sharedDoc)).toBe(true)
      // A company goal under a personal goal: company-viewable, owner bypass applies.
      expect(await can(bob, 'view', 'goal', childOfPersonal)).toBe(true)
      expect(await acl.evaluate(await who(owner), 'manage_access', { kind: 'goal', id: childOfPersonal })).toMatchObject({ allowed: true, secret: false })
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
      // A removed manager ends the chain (never walked through, never returned).
      await q(`UPDATE user_profile SET manager_id = $2 WHERE principal_id = $1`, [bob, gone])
      await q(`INSERT INTO user_profile (principal_id, workspace_id, display_name, manager_id) VALUES ($1, $2, 'Gone', $3)`, [gone, ws, owner])
      expect(await directory.managerChain(ws, alice)).toEqual([bob])
      await q(`UPDATE user_profile SET manager_id = $2 WHERE principal_id = $1`, [bob, owner])
      expect(await directory.directReports(ws, owner)).toEqual([bob])
      expect(await directory.departments(ws)).toEqual([{ departmentId: dept, parentId: null, name: 'Eng', headId: bob }])
      expect(await directory.departmentMembers(ws, dept)).toEqual([bob])
      expect((await directory.principal(ws, bob))?.departmentIds).toEqual([dept])
    })
  })

  test('review 5: real shares only un-secret, deleted space chats, channel join rule, calendar_member, members lists', async () => {
    await inRollback(async tx => {
      const [ws, owner, alice, bob, dave, carl] = [id(), id(), id(), id(), id(), id()]
      const q = (sql: string, params: unknown[] = []) => tx.unsafe(sql, params)
      for (const p of [owner, alice, bob, dave, carl]) await q(`INSERT INTO principal (principal_id, kind, status) VALUES ($1, 'human', 'active')`, [p])
      await q(`INSERT INTO workspace (workspace_id, owner_principal_id, name) VALUES ($1, $2, 'WS5')`, [ws, owner])
      for (const p of [owner, alice, bob, dave, carl]) {
        await q(`INSERT INTO workspace_member (workspace_id, principal_id, role, status) VALUES ($1, $2, $3, 'active')`, [ws, p, p === owner ? 'owner' : 'member'])
      }
      const grant = (rtype: string, rid: string, stype: string, sid: string, role: string) =>
        q(`INSERT INTO acl_entry (acl_id, workspace_id, resource_type, resource_id, subject_type, subject_id, role) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id(), ws, rtype, rid, stype, sid, role])
      const preset = (rtype: string, rid: string, subject: string | null, role: string | null, policy: object = {}) =>
        q(`INSERT INTO resource_policy (policy_id, workspace_id, resource_type, resource_id, default_subject, default_role, policy) VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb)`, [id(), ws, rtype, rid, subject, role, JSON.stringify(policy)])
      const personalDoc = async () => { const d = id(); await q(`INSERT INTO doc (doc_id, workspace_id, owner_id) VALUES ($1, $2, $3)`, [d, ws, alice]); return d }
      const personalCalendar = async () => { const k = id(); await q(`INSERT INTO calendar (calendar_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'principal', $3, 'Alice')`, [k, ws, alice]); return k }
      const calendarMember = (k: string, stype: string, sid: string, role: string) =>
        q(`INSERT INTO calendar_member (calendar_id, subject_type, subject_id, role) VALUES ($1, $2, $3, $4)`, [k, stype, sid, role])
      const makeSpace = async (name: string, chatVisibility: 'public' | 'private', secret = false) => {
        const [chat, root, space] = [id(), id(), id()]
        await q(`INSERT INTO chat (chat_id, workspace_id, kind, visibility) VALUES ($1, $2, 'space', $3)`, [chat, ws, chatVisibility])
        await q(`INSERT INTO folder (folder_id, workspace_id, owner_type, owner_id, name) VALUES ($1, $2, 'space', $3, 'Root')`, [root, ws, space])
        await q(`INSERT INTO space (space_id, workspace_id, name, chat_id, root_folder_id) VALUES ($1, $2, $3, $4, $5)`, [space, ws, name, chat, root])
        await q(`UPDATE chat SET space_id = $2 WHERE chat_id = $1`, [chat, space])
        if (secret) await preset('space', space, null, null, { privacy: 'invited' })
        return { chat, space }
      }
      const bump = () => q(`UPDATE workspace SET policy_epoch = policy_epoch + 1 WHERE workspace_id = $1`, [ws])

      // 1. Only grants that actually give access un-secret personal content.
      const fbCalendar = await personalCalendar()
      await grant('calendar', fbCalendar, 'workspace', ws, 'free_busy')
      const [rolelessDoc, expiredLinkDoc, liveLinkDoc, spacePresetDoc, minimalDoc, followerDoc, foreignWsDoc] =
        [await personalDoc(), await personalDoc(), await personalDoc(), await personalDoc(), await personalDoc(), await personalDoc(), await personalDoc()]
      await preset('note', rolelessDoc, 'workspace', null)
      await preset('note', expiredLinkDoc, 'link', 'viewer', { link_token: 'old', link_expires_at: '2020-01-01T00:00:00Z' })
      await preset('note', liveLinkDoc, 'link', 'viewer', { link_token: 'live', link_expires_at: '2999-01-01T00:00:00Z' })
      await preset('note', spacePresetDoc, 'space', 'editor')
      await grant('note', minimalDoc, 'workspace', ws, 'minimal')
      await grant('note', followerDoc, 'workspace', ws, 'follower')
      await grant('note', foreignWsDoc, 'workspace', id(), 'viewer')

      // 2. A members-only space whose public chat dave self-joined; a private-chat space bob belongs to.
      const closed = await makeSpace('Closed', 'public')
      await q(`INSERT INTO chat_member (chat_id, principal_id, role) VALUES ($1, $2, 'member')`, [closed.chat, dave])
      const closedGoal = id()
      await q(`INSERT INTO goal (goal_id, workspace_id, scope, name, creator_id, space_id) VALUES ($1, $2, 'space', 'Closed goal', $3, $4)`, [closedGoal, ws, owner, closed.space])
      const team = await makeSpace('Team', 'private')
      await q(`INSERT INTO chat_member (chat_id, principal_id, role) VALUES ($1, $2, 'member')`, [team.chat, bob])

      // 3. Chat X is public in a secret space (dave self-joined); chat Y is private (dave invited).
      const hidden = await makeSpace('Hidden', 'public', true)
      await q(`INSERT INTO chat_member (chat_id, principal_id, role) VALUES ($1, $2, 'member')`, [hidden.chat, dave])
      const privateChat = id()
      await q(`INSERT INTO chat (chat_id, workspace_id, kind, visibility) VALUES ($1, $2, 'group', 'private')`, [privateChat, ws])
      await q(`INSERT INTO chat_member (chat_id, principal_id, role) VALUES ($1, $2, 'member')`, [privateChat, dave])
      const [xDoc, yDoc] = [await personalDoc(), await personalDoc()]
      await grant('note', xDoc, 'channel', hidden.chat, 'editor')
      await grant('note', yDoc, 'channel', privateChat, 'editor')

      // 4. calendar_member shares.
      const [personShared, wsFreeBusy, wsViewer, chatShared] = [await personalCalendar(), await personalCalendar(), await personalCalendar(), await personalCalendar()]
      await calendarMember(personShared, 'principal', bob, 'viewer')
      await calendarMember(wsFreeBusy, 'workspace', ws, 'free_busy')
      await calendarMember(wsViewer, 'workspace', ws, 'viewer')
      await calendarMember(chatShared, 'channel', hidden.chat, 'viewer')
      await calendarMember(chatShared, 'channel', privateChat, 'free_busy')

      // 5. 'members' task lists: user-owned and project-owned.
      const [userList, project, projectList, listedTask] = [id(), id(), id(), id()]
      await q(`INSERT INTO task_list (task_list_id, workspace_id, owner_type, owner_id, name, share_mode) VALUES ($1, $2, 'user', $3, 'Mine', 'members')`, [userList, ws, alice])
      await grant('task-list', userList, 'principal', carl, 'editor')
      await q(`INSERT INTO work_item (work_item_id, workspace_id, owner_principal_id, title) VALUES ($1, $2, $3, 'In list')`, [listedTask, ws, alice])
      await q(`INSERT INTO task_in_list (task_list_id, work_item_id, sort_key) VALUES ($1, $2, 'm')`, [userList, listedTask])
      await q(`INSERT INTO work_item_member (work_item_id, principal_id, role) VALUES ($1, $2, 'assignee')`, [listedTask, dave])
      await q(`INSERT INTO project (project_id, workspace_id, owner_principal_id, name, visibility) VALUES ($1, $2, $3, 'Open', 'members')`, [project, ws, alice])
      await q(`INSERT INTO task_list (task_list_id, workspace_id, owner_type, owner_id, name, share_mode) VALUES ($1, $2, 'project', $3, 'Project members', 'members')`, [projectList, ws, project])
      await grant('task-list', projectList, 'principal', carl, 'viewer')

      const facts = new PostgresAclRepository(tx)
      const acl = createAcl(facts)
      const who = async (p: string, linkToken?: string) => ({ id: p, workspaceId: ws, ...(await facts.principal(p))!, ...(linkToken ? { linkToken } : {}) })
      const evaluate = async (p: string, action: Parameters<typeof acl.can>[1], kind: Parameters<typeof acl.can>[2]['kind'], rid: string, link?: string) =>
        await acl.evaluate(await who(p, link), action, { kind, id: rid })

      // 1. A workspace free_busy calendar stays owner-only secret: no owner manager, others free/busy only.
      expect(await evaluate(owner, 'view', 'calendar', fbCalendar)).toMatchObject({ allowed: false, secret: true, role: 'minimal' })
      expect(await evaluate(owner, 'manage_access', 'calendar', fbCalendar)).toMatchObject({ allowed: false })
      expect(await evaluate(bob, 'view_title', 'calendar', fbCalendar)).toMatchObject({ allowed: true, preview: 'minimal', role: 'minimal' })
      expect(await evaluate(bob, 'view', 'calendar', fbCalendar)).toMatchObject({ allowed: false })
      expect(await evaluate(alice, 'edit', 'calendar', fbCalendar)).toMatchObject({ allowed: true })
      for (const [label, rid] of [['role-less preset', rolelessDoc], ['expired link', expiredLinkDoc], ['space preset', spacePresetDoc],
        ['workspace minimal', minimalDoc], ['workspace follower', followerDoc], ['foreign workspace subject', foreignWsDoc]] as const) {
        expect(await evaluate(owner, 'view', 'note', rid), label).toMatchObject({ allowed: false, secret: true, preview: 'none' })
      }
      expect(await evaluate(bob, 'view', 'note', expiredLinkDoc, 'old')).toMatchObject({ allowed: false })
      // An unexpired link preset is a real share: no longer personal, the link works.
      expect(await evaluate(owner, 'manage_access', 'note', liveLinkDoc)).toMatchObject({ allowed: true, secret: false })
      expect(await evaluate(bob, 'view', 'note', liveLinkDoc, 'live')).toMatchObject({ allowed: true })

      // 2. Deleting a space chat never re-enables chat-derived membership.
      expect(await evaluate(dave, 'view', 'space', closed.space)).toMatchObject({ allowed: false, role: null })
      expect(await evaluate(bob, 'edit', 'space', team.space)).toMatchObject({ allowed: true, role: 'editor' })
      for (const chat of [closed.chat, team.chat]) await q(`UPDATE chat SET deleted_at = now() WHERE chat_id = $1`, [chat])
      await bump()
      expect(await evaluate(dave, 'view', 'space', closed.space)).toMatchObject({ allowed: false, role: null })
      expect(await evaluate(dave, 'view', 'goal', closedGoal)).toMatchObject({ allowed: false, role: null })
      expect(await evaluate(bob, 'view', 'space', team.space)).toMatchObject({ allowed: false, role: null })

      // 3. A doc shared with chat X (public in a secret space) gives the self-joiner nothing; invite-only Y works.
      expect(await evaluate(dave, 'view', 'note', xDoc)).toMatchObject({ allowed: false, role: null })
      expect(await evaluate(dave, 'edit', 'note', yDoc)).toMatchObject({ allowed: true, role: 'editor' })

      // 4. calendar_member: a person share — the sharee sees it, the calendar stays secret for the owner.
      expect(await evaluate(bob, 'view', 'calendar', personShared)).toMatchObject({ allowed: true, role: 'viewer' })
      expect(await evaluate(owner, 'view', 'calendar', personShared)).toMatchObject({ allowed: false, secret: true })
      expect(await evaluate(carl, 'view_title', 'calendar', personShared)).toMatchObject({ allowed: false, secret: true, preview: 'none' })
      // … workspace free_busy: others free/busy only, still secret.
      expect(await evaluate(bob, 'view_title', 'calendar', wsFreeBusy)).toMatchObject({ allowed: true, role: 'minimal' })
      expect(await evaluate(bob, 'view', 'calendar', wsFreeBusy)).toMatchObject({ allowed: false })
      expect(await evaluate(owner, 'manage_access', 'calendar', wsFreeBusy)).toMatchObject({ allowed: false, secret: true })
      // … workspace viewer: a real share (no longer personal).
      expect(await evaluate(bob, 'view', 'calendar', wsViewer)).toMatchObject({ allowed: true, role: 'viewer' })
      expect(await evaluate(owner, 'manage_access', 'calendar', wsViewer)).toMatchObject({ allowed: true, secret: false })
      // … channel subjects pass the join rule: X gives nothing, invite-only Y gives its free/busy.
      expect(await evaluate(dave, 'view_title', 'calendar', chatShared)).toMatchObject({ allowed: true, role: 'minimal' })
      expect(await evaluate(dave, 'view', 'calendar', chatShared)).toMatchObject({ allowed: false })

      // 5. 'members' lists: non-members get no row at all, the workspace owner is not manager.
      for (const rid of [userList, projectList]) {
        for (const p of [bob, owner]) {
          const decision = await evaluate(p, 'view', 'task-list', rid)
          expect(decision, `${rid === userList ? 'user' : 'project'} list ${p === owner ? 'owner' : 'bob'}`).toMatchObject({ allowed: false, secret: true, preview: 'none' })
          expect(listingVisibility(decision)).toBe('hide')
        }
        expect(await evaluate(carl, 'view', 'task-list', rid)).toMatchObject({ allowed: true })
      }
      expect(await evaluate(alice, 'manage_access', 'task-list', userList)).toMatchObject({ allowed: true })
      // Its tasks inherit the secrecy; the assignee and the list member still reach them.
      expect(await evaluate(owner, 'view', 'task', listedTask)).toMatchObject({ allowed: false, secret: true, preview: 'none' })
      expect(await evaluate(bob, 'view', 'task', listedTask)).toMatchObject({ allowed: false, secret: true })
      expect(await evaluate(dave, 'view', 'task', listedTask)).toMatchObject({ allowed: true })
      expect(await evaluate(carl, 'edit', 'task', listedTask)).toMatchObject({ allowed: true })
    })
  })
})
