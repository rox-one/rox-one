/**
 * W1-06 (#1503) review 4 regression tests — the three exploits found in the
 * fourth review round, one describe block each:
 * (a) a plain chat member could weaken chat settings (policy, visibility,
 *     notice, tabs, labels) straight through the command catalogue;
 * (b) a share holder could hand themselves the space / workspace owner role
 *     through `spaces.update_members_permissions` / `people.*_workspace_member`;
 * (c) public-link tokens came from `tx.newId` and were therefore guessable.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { InMemoryCommandStore } from '../../commands/store'
import { MemoryRecordBackend, configureReferenceRuntime, deterministicId, referenceMemoryRecords, resetReferenceMemory, resetReferenceRuntime, type StoredRecord } from '../reference'
import { createHarness, type Harness } from './reference-harness'
import { ACTOR_ID, BOB, U, WORKSPACE_ID } from './reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const CAROL = U('carol')

const harness = (): Harness => createHarness({ local: new InMemoryCommandStore(), workspace: new InMemoryCommandStore() })
const records = (collection: string): StoredRecord[] => referenceMemoryRecords(WORKSPACE_ID, collection)

/** Direct memory write of a legacy owner row: no command can create one any more. */
function markPersonOwner(principalId: string): void {
  const backend = new MemoryRecordBackend(WORKSPACE_ID)
  const { collections } = backend as unknown as { collections: Map<string, Map<string, StoredRecord>> }
  const rows = collections.get('person') ?? new Map<string, StoredRecord>()
  collections.set('person', rows)
  const current = rows.get(principalId)
  rows.set(principalId, { id: principalId, revision: (current?.revision ?? 0) + 1, data: { ...(current?.data ?? {}), role: 'owner', state: 'active' } })
}

beforeEach(() => {
  resetReferenceMemory()
  configureReferenceRuntime({ now: () => NOW })
})

afterEach(() => resetReferenceRuntime())

// ── (a) chat settings: owner / admin only ────────────────────────────────

describe('W1-06 review 4: chat settings are owner / admin only', () => {
  const chat = { kind: 'channel', id: U('chat') }
  const settings: [string, Record<string, unknown>][] = [
    ['im.update_chat', { name: 'renamed' }],
    ['im.update_policy', { postingPolicy: 'admins' }],
    ['im.set_visibility', { visibility: 'private' }],
    ['im.set_top_notice', { content: 'notice' }],
    ['im.update_announcement', { docId: null }],
    ['im.create_tab', { id: U('tab'), kind: 'link', title: 'Tab' }],
    ['im.update_tab', { tabId: U('tab'), title: 'Tab 2' }],
    ['im.delete_tab', { tabId: U('tab') }],
    ['im.create_label', { id: U('label'), name: 'Label' }],
    ['im.label_chats', { labelId: U('label'), messageIds: [] }],
  ]

  async function chats(): Promise<Harness> {
    const setup = harness()
    expect(await setup.run({ type: 'im.create_chat', payload: { id: chat.id, name: 'general', visibility: 'public', memberIds: [BOB] } })).toMatchObject({ status: 'applied' })
    return setup
  }

  test('a plain member is refused and nothing is written; the owner may change the same settings', async () => {
    const setup = await chats()
    for (const [type, payload] of settings) expect(await setup.run({ type, target: chat, payload, actor: BOB })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('channel-notice')).toEqual([])
    expect(records('channel-tab')).toEqual([])
    expect(records('channel-label')).toEqual([])
    expect(records('channel').find(record => record.id === chat.id)!.data).toMatchObject({ name: 'general', visibility: 'public', postingPolicy: 'all' })
    expect(await setup.run({ type: 'im.update_policy', target: chat, payload: { postingPolicy: 'admins' } })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'im.update_chat', target: chat, payload: { name: 'renamed' } })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'im.set_visibility', target: chat, payload: { visibility: 'private' } })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'im.create_tab', target: chat, payload: { id: U('tab'), kind: 'link', title: 'Tab' } })).toMatchObject({ status: 'applied' })
    expect(records('channel').find(record => record.id === chat.id)!.data).toMatchObject({ name: 'renamed', visibility: 'private', postingPolicy: 'admins' })
  })

  test('a non-member is refused the same way', async () => {
    const setup = await chats()
    expect(await setup.run({ type: 'im.update_policy', target: chat, payload: { postingPolicy: 'admins' }, actor: CAROL })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('channel').find(record => record.id === chat.id)!.data.postingPolicy).toBe('all')
  })
})

// ── (b) space ownership: fixed ───────────────────────────────────────────

describe('W1-06 review 4: space ownership is fixed', () => {
  const space = { kind: 'space', id: U('space') }
  const rowOf = (principalId: string) => records('space-member').find(row => row.id === `${space.id}:${principalId}`)

  async function spaces(): Promise<Harness> {
    const setup = harness()
    expect(await setup.run({ type: 'spaces.create', payload: { id: space.id, name: 'Eng', memberIds: [CAROL] } })).toMatchObject({ status: 'applied' })
    return setup
  }

  test('a share holder cannot make themselves owner, demote or remove the owner, and the owner cannot leave', async () => {
    const setup = await spaces()
    expect(await setup.run({ type: 'spaces.update_members_permissions', target: space, payload: { members: [{ principalId: CAROL, role: 'owner' }] }, actor: CAROL })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'spaces.add_members', target: space, payload: { members: [{ principalId: CAROL, role: 'owner' }] }, actor: CAROL })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'spaces.update_members_permissions', target: space, payload: { members: [{ principalId: ACTOR_ID, role: 'viewer' }] }, actor: CAROL })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'spaces.remove_member', target: space, payload: { principalId: ACTOR_ID }, actor: CAROL })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'spaces.leave', target: space, payload: {} })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(rowOf(ACTOR_ID)!.data).toMatchObject({ role: 'owner' })
    expect(rowOf(ACTOR_ID)!.data.deletedAt).toBeFalsy()
    expect(rowOf(CAROL)!.data.role).toBe('editor')
    // Non-owner rows remain manageable, and the owner keeps full authority.
    expect(await setup.run({ type: 'spaces.update_members_permissions', target: space, payload: { members: [{ principalId: CAROL, role: 'viewer' }] } })).toMatchObject({ status: 'applied' })
    expect(rowOf(CAROL)!.data.role).toBe('viewer')
    expect(await setup.run({ type: 'spaces.remove_member', target: space, payload: { principalId: CAROL } })).toMatchObject({ status: 'applied' })
    expect(rowOf(CAROL)!.data.deletedAt).toBeTruthy()
  })

  test('a member can still leave and rejoin', async () => {
    const setup = await spaces()
    expect(await setup.run({ type: 'spaces.leave', target: space, payload: {}, actor: CAROL })).toMatchObject({ status: 'applied' })
    expect(rowOf(CAROL)!.data.deletedAt).toBeTruthy()
    expect(await setup.run({ type: 'spaces.join', target: space, payload: {}, actor: CAROL })).toMatchObject({ status: 'applied' })
    expect(rowOf(CAROL)!.data).toMatchObject({ role: 'editor' })
    expect(rowOf(CAROL)!.data.deletedAt).toBeFalsy()
  })
})

// ── (b) workspace ownership: fixed ───────────────────────────────────────

describe('W1-06 review 4: workspace ownership is fixed', () => {
  const DAVE = U('dave')

  test('the owner role is never granted through people.invite or people.add_workspace_member', async () => {
    const setup = harness()
    expect(await setup.run({ type: 'people.invite', payload: { id: U('inv'), email: 'dave@example.com', role: 'owner' } })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'people.add_workspace_member', payload: { principalId: DAVE, role: 'owner' } })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('invitation')).toEqual([])
    expect(records('person').filter(record => record.id === DAVE)).toEqual([])
    expect(await setup.run({ type: 'people.add_workspace_member', payload: { principalId: DAVE, role: 'member' } })).toMatchObject({ status: 'applied' })
  })

  test('an existing owner row is neither demoted nor converted to a guest', async () => {
    const setup = harness()
    expect(await setup.run({ type: 'people.add_workspace_member', payload: { principalId: DAVE, role: 'member' } })).toMatchObject({ status: 'applied' })
    markPersonOwner(DAVE)
    expect(await setup.run({ type: 'people.add_workspace_member', payload: { principalId: DAVE, role: 'member' } })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(await setup.run({ type: 'people.convert_to_guest', target: { kind: 'person', id: DAVE }, payload: {} })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(records('person').find(record => record.id === DAVE)!.data).toMatchObject({ role: 'owner', state: 'active' })
    // A regular member is still convertible to a guest.
    expect(await setup.run({ type: 'people.add_workspace_member', payload: { principalId: U('erin'), role: 'member' } })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'people.convert_to_guest', target: { kind: 'person', id: U('erin') }, payload: {} })).toMatchObject({ status: 'applied' })
    expect(records('person').find(record => record.id === U('erin'))!.data).toMatchObject({ role: 'guest' })
  })
})

// ── (c) public-sharing tokens: random ────────────────────────────────────

describe('W1-06 review 4: public-sharing tokens are random', () => {
  const doc = (name: string) => ({ kind: 'note', id: U(name) })
  const tokenOf = (id: string) => records('note').find(record => record.id === id)!.data.publicToken as string | null

  test('each document gets a 128-bit token, a retry keeps it, disabling clears it', async () => {
    const setup = harness()
    expect(await setup.run({ type: 'docs.create_document', payload: { id: U('doc-a'), title: 'A' } })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'docs.create_document', payload: { id: U('doc-b'), title: 'B' } })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'docs.set_public_sharing', target: doc('doc-a'), payload: { enabled: true } })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'docs.set_public_sharing', target: doc('doc-b'), payload: { enabled: true } })).toMatchObject({ status: 'applied' })
    const first = tokenOf(U('doc-a'))
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(tokenOf(U('doc-b'))).toMatch(/^[0-9a-f]{32}$/)
    expect(tokenOf(U('doc-b'))).not.toBe(first)
    // Re-running the command (retry, second enable) keeps the document's token.
    expect(await setup.run({ type: 'docs.set_public_sharing', target: doc('doc-a'), payload: { enabled: true } })).toMatchObject({ status: 'applied' })
    expect(tokenOf(U('doc-a'))).toBe(first)
    expect(await setup.run({ type: 'docs.set_public_sharing', target: doc('doc-a'), payload: { enabled: false } })).toMatchObject({ status: 'applied' })
    expect(tokenOf(U('doc-a'))).toBeUndefined()
    expect(await setup.run({ type: 'docs.set_public_sharing', target: doc('doc-a'), payload: { enabled: true } })).toMatchObject({ status: 'applied' })
    const second = tokenOf(U('doc-a'))
    expect(second).toMatch(/^[0-9a-f]{32}$/)
    expect(second).not.toBe(first)
  })

  test('the token is not the deterministic id the command used to mint', async () => {
    const setup = harness()
    expect(await setup.run({ type: 'docs.create_document', payload: { id: U('doc-c'), title: 'C' } })).toMatchObject({ status: 'applied' })
    expect(await setup.run({ type: 'docs.set_public_sharing', target: doc('doc-c'), payload: { enabled: true } }, { commandId: 'cmd-public' })).toMatchObject({ status: 'applied' })
    expect(tokenOf(U('doc-c'))).not.toBe(deterministicId(WORKSPACE_ID, 'cmd-public', 'public'))
  })
})