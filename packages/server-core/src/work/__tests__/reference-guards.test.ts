/**
 * W1-06 (#1503) review 3 — membership rows, ACL owner protection, inherited
 * containers, subscriptions for other people, real drive moves, actor-private
 * check-in drafts, create conflicts on someone else's ids, and
 * authorize-before-load (a denied payload id is FORBIDDEN, never NOT_FOUND).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Authorizer } from '@rox/core/commands'
import { InMemoryCommandStore } from '../../commands/store'
import { configureReferenceRuntime, referenceMemoryRecords, resetReferenceMemory, resetReferenceRuntime, storedAclRole } from '../reference'
import { createHarness } from './reference-harness'
import { ACTOR_ID, BOB, U, WORKSPACE_ID } from './reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const CAROL = U('carol')

interface Call { principalId: string; verb: string; ref: { kind: string; id: string } | null }

function recording(allow: (call: Call) => boolean, options: { answersForAnyPrincipal?: boolean } = {}): { calls: Call[]; authorizer: Authorizer } {
  const calls: Call[] = []
  return {
    calls,
    authorizer: {
      ...(options.answersForAnyPrincipal ? { answersForAnyPrincipal: true } : {}),
      can: async (principal, verb, ref) => {
        const call = { principalId: principal.principalId, verb, ref: ref ? { kind: ref.kind, id: ref.id } : null }
        calls.push(call)
        return allow(call)
      },
    },
  }
}
const denyId = (id: string, verb?: string) => recording(call => !(call.ref?.id === id && (verb === undefined || call.verb === verb)))

function harness(authorizer?: Authorizer) {
  return createHarness({ local: new InMemoryCommandStore(), workspace: new InMemoryCommandStore(), ...(authorizer ? { authorizer } : {}) })
}
const records = (collection: string) => referenceMemoryRecords(WORKSPACE_ID, collection)
const live = (collection: string) => records(collection).filter(record => !record.data.deletedAt)

beforeEach(() => {
  resetReferenceMemory()
  configureReferenceRuntime({ now: () => NOW })
})
afterEach(() => resetReferenceRuntime())

describe('chat membership', () => {
  const chat = { kind: 'channel', id: U('chat') }
  const memberRow = (principalId: string) => records('channel-member').find(row => row.data.principalId === principalId && row.data.chatId === chat.id)

  async function bobsChat() {
    const setup = harness()
    await setup.run({ type: 'im.create_chat', payload: { id: chat.id, kind: 'group', name: 'bob', visibility: 'public', members: [] }, actor: BOB })
    return setup
  }

  test('mark_read / mark_unread / update_member_state need an active membership and never create one', async () => {
    const setup = await bobsChat()
    for (const step of [
      { type: 'im.mark_read', payload: { seq: 1 } },
      { type: 'im.mark_unread', payload: { seq: 1 } },
      { type: 'im.update_member_state', payload: { muted: true } },
    ]) expect(await setup.run({ ...step, target: chat })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(memberRow(ACTOR_ID)).toBeUndefined()
    expect(await setup.run({ type: 'im.mark_read', target: chat, payload: { seq: 1 }, actor: BOB })).toMatchObject({ status: 'applied' })
  })

  test('leave_chat sets state left; a left member cannot post, mark read or regain a role, and rejoins with the default role', async () => {
    const setup = await bobsChat()
    await setup.run({ type: 'im.join_chat', target: chat, payload: {} })
    expect(await setup.run({ type: 'im.leave_chat', target: chat, payload: {} })).toMatchObject({ status: 'applied' })
    expect(memberRow(ACTOR_ID)!.data).toMatchObject({ state: 'left' })
    expect(await setup.run({ type: 'im.mark_read', target: chat, payload: { seq: 1 } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(memberRow(ACTOR_ID)!.data).toMatchObject({ state: 'left' })
    expect(await setup.run({ type: 'im.send_message', target: chat, payload: { body: { doc: 'x' }, mentions: [] } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'im.add_members', target: chat, payload: { memberIds: [CAROL] } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'im.leave_chat', target: chat, payload: {} })).toMatchObject({ error: { code: 'NOT_FOUND' } })
    // The owner who left comes back as a plain member.
    expect(await setup.run({ type: 'im.leave_chat', target: chat, payload: {}, actor: BOB })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'im.join_chat', target: chat, payload: {}, actor: BOB })).toMatchObject({ status: 'applied' })
    expect(memberRow(BOB)!.data).toMatchObject({ state: 'active' })
    expect(memberRow(BOB)!.data.role).not.toBe('owner')
  })

  test('add_members: a non-member cannot add people (invitePolicy members)', async () => {
    const setup = await bobsChat()
    expect(await setup.run({ type: 'im.add_members', target: chat, payload: { memberIds: [CAROL] } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(memberRow(CAROL)).toBeUndefined()
    expect(await setup.run({ type: 'im.add_members', target: chat, payload: { memberIds: [CAROL] }, actor: BOB })).toMatchObject({ status: 'applied' })
    expect(memberRow(CAROL)!.data).toMatchObject({ state: 'active' })
  })

  test('a disbanded p2p chat is revived by get_or_create_p2p', async () => {
    const setup = harness()
    expect(await setup.run({ type: 'im.get_or_create_p2p', payload: { peerId: BOB } })).toMatchObject({ status: 'applied' })
    const id = records('channel').find(record => record.data.kind === 'p2p')!.id
    expect(await setup.run({ type: 'im.disband_chat', target: { kind: 'channel', id }, payload: {} })).toMatchObject({ status: 'applied' })
    expect(records('channel').find(record => record.id === id)!.data.deletedAt).toBeTruthy()
    expect(await setup.run({ type: 'im.get_or_create_p2p', payload: { peerId: BOB } })).toMatchObject({ status: 'applied', result: { existed: false } })
    expect(records('channel').find(record => record.id === id)!.data.deletedAt).toBeFalsy()
    expect(await setup.run({ type: 'im.send_message', target: { kind: 'channel', id }, payload: { body: { doc: 'back' }, mentions: [] } })).toMatchObject({ status: 'applied' })
  })

  test('meetings.publish_outcomes: membership and posting policy are checked before the first write', async () => {
    const setup = await bobsChat()
    await setup.run({ type: 'vc.start_meeting', payload: { id: U('call') } })
    const receipt = await setup.run({ type: 'meetings.publish_outcomes', target: { kind: 'call', id: U('call') }, payload: { decisions: [{ title: 'Ship' }], tasks: [{ title: 'Do it' }], toChatId: chat.id } })
    expect(receipt).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(records('task')).toEqual([])
    expect(records('decision')).toEqual([])
    expect(records('channel-message')).toEqual([])
  })
})

describe('ACL: the owner changes only through transfer_ownership', () => {
  const doc = { kind: 'note', id: U('doc') }
  const roleOf = (principalId: string) => live('acl-entry').find(entry => entry.data.resourceId === doc.id && entry.data.subjectId === principalId)?.data.role

  test('grant, revoke, decide_request and docs.update_permissions refuse the implicit and the explicit owner', async () => {
    const setup = harness()
    await setup.run({ type: 'docs.create_document', payload: { id: doc.id, title: 'D' } })
    await setup.run({ type: 'acl.grant', target: doc, payload: { principal: { kind: 'user', id: BOB }, role: 'full_access' } })
    // Implicit owner (the creator, no entry): a full_access holder cannot demote or remove them.
    expect(await setup.run({ type: 'acl.grant', target: doc, payload: { principal: { kind: 'user', id: ACTOR_ID }, role: 'viewer' }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'acl.revoke', target: doc, payload: { principal: { kind: 'user', id: ACTOR_ID } }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'docs.update_permissions', target: doc, payload: { entries: [{ principalId: ACTOR_ID, role: 'viewer' }] }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'acl.request_access', target: doc, payload: { id: U('req'), role: 'viewer' } })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'acl.decide_request', target: doc, payload: { requestId: U('req'), decision: 'approve' }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(roleOf(ACTOR_ID)).toBeUndefined()
    // Explicit owner entry after a transfer to CAROL.
    expect(await setup.run({ type: 'acl.transfer_ownership', target: doc, payload: { toPrincipalId: CAROL } })).toMatchObject({ status: 'applied' })
    expect(roleOf(CAROL)).toBe(storedAclRole('owner'))
    expect(await setup.run({ type: 'acl.grant', target: doc, payload: { principal: { kind: 'user', id: CAROL }, role: 'editor' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'acl.revoke', target: doc, payload: { principal: { kind: 'user', id: CAROL } } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'docs.update_permissions', target: doc, payload: { entries: [{ principalId: CAROL, role: null }] } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(roleOf(CAROL)).toBe(storedAclRole('owner'))
    // Others are still managed normally.
    expect(await setup.run({ type: 'acl.grant', target: doc, payload: { principal: { kind: 'user', id: BOB }, role: 'viewer' } })).toMatchObject({ status: 'applied' })
    expect(roleOf(BOB)).toBe(storedAclRole('viewer'))
  })
})

describe('inherited containers are authorized at write', () => {
  test('tasks.duplicate: the copy lands in the source list / section / shared workspace', async () => {
    const setup = harness()
    await setup.run({ type: 'task_lists.create', payload: { id: U('list'), name: 'L' } })
    await setup.run({ type: 'tasks.create', payload: { id: U('t'), title: 'x', listId: U('list') } })
    const { calls, authorizer } = denyId(U('list'), 'write')
    expect(await harness(authorizer).run({ type: 'tasks.duplicate', target: { kind: 'task', id: U('t') }, payload: { id: U('t2') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'write', ref: { kind: 'task-list', id: U('list') } }))
    expect(records('task').map(task => task.id)).toEqual([U('t')])
  })

  test('okr.import_from_cycle: the copied goals\' space is written into; deleted sources are skipped', async () => {
    const setup = harness()
    await setup.run({ type: 'spaces.create', payload: { id: U('space'), name: 'Eng' } })
    await setup.run({ type: 'okr.create_cycle', payload: { id: U('q3'), name: 'Q3', startsOn: '2026-07-01', endsOn: '2026-09-30' } })
    await setup.run({ type: 'okr.create_cycle', payload: { id: U('q4'), name: 'Q4', startsOn: '2026-10-01', endsOn: '2026-12-31' } })
    await setup.run({ type: 'goals.create', payload: { id: U('g'), name: 'G', okrCycleId: U('q3'), spaceId: U('space') } })
    await setup.run({ type: 'goals.create', payload: { id: U('g-gone'), name: 'Gone', okrCycleId: U('q3') } })
    expect(await setup.run({ type: 'goals.delete', target: { kind: 'goal', id: U('g-gone') }, payload: {} })).toMatchObject({ status: 'applied' })
    const importStep = { type: 'okr.import_from_cycle', target: { kind: 'okr-cycle', id: U('q4') }, payload: { fromCycleId: U('q3'), goalIds: [U('g'), U('g-gone')] } }
    const { calls, authorizer } = denyId(U('space'), 'write')
    expect(await harness(authorizer).run(importStep)).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'write', ref: { kind: 'space', id: U('space') } }))
    const inQ4 = () => records('goal').filter(goal => goal.data.okrCycleId === U('q4'))
    expect(inQ4()).toEqual([])
    expect(await setup.run(importStep)).toMatchObject({ status: 'applied' })
    expect(inQ4().map(goal => goal.data.name)).toEqual(['G'])
    expect(inQ4()[0]!.data.deletedAt).toBeFalsy()
  })

  test('project_templates.create_project: the template\'s space is written into', async () => {
    const setup = harness()
    await setup.run({ type: 'spaces.create', payload: { id: U('space'), name: 'Eng' } })
    await setup.run({ type: 'projects.create', payload: { id: U('p'), name: 'P', spaceId: U('space') } })
    await setup.run({ type: 'project_templates.create_from_project', target: { kind: 'project', id: U('p') }, payload: { id: U('tpl'), name: 'T' } })
    const { calls, authorizer } = denyId(U('space'), 'write')
    expect(await harness(authorizer).run({ type: 'project_templates.create_project', target: { kind: 'project-template', id: U('tpl') }, payload: { id: U('p2'), name: 'P2' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'write', ref: { kind: 'space', id: U('space') } }))
    expect(records('project').map(project => project.id)).toEqual([U('p')])
  })
})

describe('spaces, drafts, subscriptions, drive, own-id conflicts', () => {
  test('spaces.join leaves an existing membership (and its role) unchanged', async () => {
    const setup = harness()
    await setup.run({ type: 'spaces.create', payload: { id: U('space'), name: 'Eng' } })
    const ownRow = () => records('space-member').find(row => row.data.principalId === ACTOR_ID)!
    expect(ownRow().data.role).toBe('owner')
    expect(await setup.run({ type: 'spaces.join', target: { kind: 'space', id: U('space') }, payload: {} })).toMatchObject({ status: 'applied', result: { existed: true } })
    expect(ownRow().data.role).toBe('owner')
    expect(await setup.run({ type: 'spaces.join', target: { kind: 'space', id: U('space') }, payload: {}, actor: BOB })).toMatchObject({ status: 'applied' })
    expect(records('space-member').find(row => row.data.principalId === BOB)!.data.role).toBe('editor')
  })

  test('checkins.draft_from_activity writes an actor-private draft, never a shared check-in', async () => {
    const setup = harness()
    await setup.run({ type: 'goals.create', payload: { id: U('g'), name: 'G' } })
    expect(await setup.run({ type: 'checkins.draft_from_activity', target: { kind: 'goal', id: U('g') }, payload: { id: U('draft') } })).toMatchObject({ status: 'applied' })
    expect(records('check-in')).toEqual([])
    expect(records('check-in-draft').map(draft => draft.data)).toEqual([expect.objectContaining({ ownerId: ACTOR_ID, subjectId: U('g'), status: 'pending' })])
  })

  test('subscriptions: self by default; others need write + their own read through an authorizer that answers for them', async () => {
    const doc = { kind: 'note', id: U('doc') }
    const setup = harness()
    await setup.run({ type: 'docs.create_document', payload: { id: doc.id, title: 'D' } })
    // LOCAL_OWNER / ALLOW_ALL-style authorizers cannot answer for other people: self only.
    expect(await setup.run({ type: 'subscriptions.subscribe', target: doc, payload: { principalIds: [BOB] } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'subscriptions.subscribe', target: doc, payload: {} })).toMatchObject({ status: 'applied' })
    // An authorizer that answers for anyone: BOB may read, CAROL may not.
    const { calls, authorizer } = recording(call => !(call.principalId === CAROL && call.verb === 'read'), { answersForAnyPrincipal: true })
    const guarded = harness(authorizer)
    expect(await guarded.run({ type: 'subscriptions.subscribe', target: doc, payload: { principalIds: [BOB, CAROL] } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual({ principalId: ACTOR_ID, verb: 'write', ref: doc })
    expect(calls).toContainEqual({ principalId: CAROL, verb: 'read', ref: doc })
    expect(live('subscription').filter(row => row.data.principalId !== ACTOR_ID)).toEqual([])
    expect(await guarded.run({ type: 'subscriptions.subscribe', target: doc, payload: { principalIds: [BOB] } })).toMatchObject({ status: 'applied' })
    // Unsubscribing someone else needs share (manage) on the resource.
    const noShare = harness(recording(call => call.verb !== 'share').authorizer)
    expect(await noShare.run({ type: 'subscriptions.unsubscribe', target: doc, payload: { principalIds: [BOB] } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await noShare.run({ type: 'subscriptions.unsubscribe', target: doc, payload: {} })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'subscriptions.unsubscribe', target: doc, payload: { principalIds: [BOB] } })).toMatchObject({ status: 'applied' })
  })

  test('drive.move_items detaches the old placement, updates the item and authorizes the source folder', async () => {
    const setup = harness()
    await setup.run({ type: 'drive.create_folder', payload: { id: U('from'), name: 'From' } })
    await setup.run({ type: 'drive.create_folder', payload: { id: U('to'), name: 'To' } })
    await setup.run({ type: 'drive.create_folder', payload: { id: U('sub'), name: 'Sub', parentId: U('to') } })
    await setup.run({ type: 'docs.create_document', payload: { id: U('doc'), title: 'D', folderId: U('from') } })
    const doc = { kind: 'note', id: U('doc') }
    await setup.run({ type: 'drive.move_items', target: { kind: 'folder', id: U('from') }, payload: { items: [doc], toFolderId: U('from') } })
    const placements = () => live('folder-item').filter(row => row.data.itemRef === `note:${U('doc')}`).map(row => row.data.folderId)
    expect(placements()).toEqual([U('from')])
    const { calls, authorizer } = denyId(U('from'), 'write')
    expect(await harness(authorizer).run({ type: 'drive.move_items', target: { kind: 'folder', id: U('to') }, payload: { items: [doc], toFolderId: U('to') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls).toContainEqual(expect.objectContaining({ verb: 'write', ref: { kind: 'folder', id: U('from') } }))
    expect(placements()).toEqual([U('from')])
    expect(await setup.run({ type: 'drive.move_items', target: { kind: 'folder', id: U('to') }, payload: { items: [doc], toFolderId: U('to') } })).toMatchObject({ status: 'applied' })
    expect(placements()).toEqual([U('to')])
    expect(records('note').find(note => note.id === U('doc'))!.data.folderId).toBe(U('to'))
    // A folder cannot move into itself or below itself.
    expect(await setup.run({ type: 'drive.move_items', target: { kind: 'folder', id: U('sub') }, payload: { items: [{ kind: 'folder', id: U('to') }], toFolderId: U('sub') } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await setup.run({ type: 'drive.move_items', target: { kind: 'folder', id: U('to') }, payload: { items: [{ kind: 'folder', id: U('to') }], toFolderId: U('to') } })).toMatchObject({ error: { code: 'VALIDATION' } })
  })

  test('provision_personal_agent / ensure_placeholder: another owner\'s id is a create conflict', async () => {
    const setup = harness()
    await setup.run({ type: 'agents.provision_personal_agent', payload: { id: U('agent'), ownerId: BOB }, actor: BOB })
    const agent = await setup.run({ type: 'agents.provision_personal_agent', payload: { id: U('agent'), ownerId: ACTOR_ID } })
    expect(agent).toMatchObject({ status: 'conflict' })
    expect(JSON.stringify(agent)).not.toContain(BOB)
    await setup.run({ type: 'identity.ensure_placeholder', payload: { id: U('ph'), displayName: 'Frank' }, actor: BOB })
    expect(await setup.run({ type: 'identity.ensure_placeholder', payload: { id: U('ph'), displayName: 'Other' } })).toMatchObject({ status: 'conflict' })
    // The email key still dedupes across people.
    await setup.run({ type: 'identity.ensure_placeholder', payload: { displayName: 'Gina', email: 'gina@example.com' }, actor: BOB })
    expect(await setup.run({ type: 'identity.ensure_placeholder', payload: { displayName: 'Gina', email: 'gina@example.com' } })).toMatchObject({ status: 'applied', result: { existed: true } })
  })
})

describe('authorize before load: a denied missing id is FORBIDDEN, not NOT_FOUND', () => {
  const missing = U('missing')
  const cases: Array<{ name: string; step: Record<string, unknown>; setup?: (run: ReturnType<typeof harness>) => Promise<unknown> }> = [
    { name: 'tasks.add_to_list', setup: run => run.run({ type: 'tasks.create', payload: { id: U('t'), title: 'x' } }), step: { type: 'tasks.add_to_list', target: { kind: 'task', id: U('t') }, payload: { listId: missing } } },
    { name: 'tasks.add_dependency', setup: run => run.run({ type: 'tasks.create', payload: { id: U('t'), title: 'x' } }), step: { type: 'tasks.add_dependency', target: { kind: 'task', id: U('t') }, payload: { blocks: missing } } },
    { name: 'task_sections.create', step: { type: 'task_sections.create', payload: { id: U('s'), taskListId: missing, title: 'S' } } },
    { name: 'goals.create (parent goal)', step: { type: 'goals.create', payload: { id: U('g'), name: 'G', parentGoalId: missing } } },
    { name: 'goals.align', setup: run => run.run({ type: 'goals.create', payload: { id: U('g'), name: 'G' } }), step: { type: 'goals.align', target: { kind: 'goal', id: U('g') }, payload: { toGoalId: missing } } },
    { name: 'calendar.subscribe', step: { type: 'calendar.subscribe', payload: { calendarId: missing } } },
    { name: 'drive.create_folder', step: { type: 'drive.create_folder', payload: { id: U('f'), name: 'F', parentId: missing } } },
    { name: 'drive.add_shortcut', step: { type: 'drive.add_shortcut', payload: { item: { kind: 'note', id: U('n') }, folderId: missing } } },
    { name: 'drive.move_items', step: { type: 'drive.move_items', payload: { items: [{ kind: 'note', id: U('n') }], toFolderId: missing } } },
    { name: 'im.create_space_chat', step: { type: 'im.create_space_chat', payload: { spaceId: missing, name: 'x' } } },
    { name: 'identity.activate_placeholder', step: { type: 'identity.activate_placeholder', payload: { placeholderId: missing, principalId: BOB } } },
    { name: 'contacts.merge_cards', setup: run => run.run({ type: 'contacts.create_card', payload: { id: U('card'), displayName: 'E' } }), step: { type: 'contacts.merge_cards', target: { kind: 'person', id: U('card') }, payload: { sourceIds: [missing] } } },
  ]
  for (const { name, step, setup } of cases) {
    test(name, async () => {
      const open = harness()
      if (setup) await setup(open)
      const { calls, authorizer } = denyId(missing)
      const receipt = await harness(authorizer).run(step as never)
      expect(receipt).toMatchObject({ error: { code: 'FORBIDDEN' } })
      expect(calls.some(call => call.ref?.id === missing)).toBe(true)
    })
  }
})
