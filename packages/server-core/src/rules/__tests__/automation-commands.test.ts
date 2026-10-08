/**
 * W1-12 (#1509) — negative paths (PLAN §1.4) of the two commands this package
 * adds to the catalogue: `task_lists.ensure_system_list` and
 * `notify.send_invite_email`.
 *
 * The reference scenario cannot drive them (they are owned here, not by the
 * reference layer), so permission, flag-off, validation and idempotent replay
 * are covered directly. Scope, quota, expiry and conflict do not exist on these
 * two commands: the system list carries no ACL of its own (its `person` target
 * is authorized), and the invite email has no quota or expiry column.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { InMemoryCommandStore } from '../../commands/store'
import { referenceMemoryRecords, resetReferenceMemory, resetReferenceRuntime, configureReferenceRuntime } from '../../work/reference'
import { ALLOW_ALL, ALL_FLAGS, CATALOGUE_TYPES, DENY_ALL, createHarness } from '../../work/__tests__/reference-harness'
import { ACTOR_ID, U, WORKSPACE_ID, type ScenarioStep } from '../../work/__tests__/reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const OWNER = ACTOR_ID
const OTHER = U('other-principal')
const LIST_ID = U('system-list')
const INVITE_ID = U('invite-email')

function memoryHarness(options: Parameters<typeof createHarness>[0] extends infer O ? Partial<O> : never = {}) {
  return createHarness({ local: new InMemoryCommandStore(), workspace: new InMemoryCommandStore(), ...options })
}

const ensureList = (extra: Partial<ScenarioStep> = {}): ScenarioStep => ({
  type: 'task_lists.ensure_system_list',
  payload: { systemKey: 'backlog', ownerId: OWNER, id: LIST_ID },
  target: { kind: 'person', id: OWNER },
  ...extra,
})

const sendInvite = (extra: Partial<ScenarioStep> = {}): ScenarioStep => ({
  type: 'notify.send_invite_email',
  payload: { email: 'anna@example.com', principalId: OTHER, role: 'member', workspaceId: WORKSPACE_ID },
  target: { kind: 'person', id: OTHER },
  ...extra,
})

beforeEach(() => {
  resetReferenceMemory()
  configureReferenceRuntime({ now: () => NOW })
})
afterEach(() => resetReferenceRuntime())

describe('the two W1-12 commands are in the catalogue with their own bindings', () => {
  test('catalogue membership, strict schemas and availability', () => {
    expect(CATALOGUE_TYPES).toContain('task_lists.ensure_system_list')
    expect(CATALOGUE_TYPES).toContain('notify.send_invite_email')
    const { registry } = memoryHarness()
    for (const type of ['task_lists.ensure_system_list', 'notify.send_invite_email']) {
      expect(registry.get(type)!.schemaBound).toBe(true)
      expect(registry.handler(type)).toBeDefined()
      expect(registry.capability(type)).toMatchObject({ available: true })
    }
    // Owner module `automation`; the flag is theirs, default OFF.
    expect(registry.get('task_lists.ensure_system_list')!.module).toBe('automation')
    expect(registry.get('task_lists.ensure_system_list')!.flag).toBe('automation.rules.v1')
  })
})

describe('task_lists.ensure_system_list', () => {
  test('permission denied is FORBIDDEN and writes nothing', async () => {
    const receipt = await memoryHarness({ authorizer: DENY_ALL }).run(ensureList())
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task-list')).toEqual([])
  })

  test('owner flag off is UNAVAILABLE', async () => {
    const receipt = await memoryHarness({ flags: new Set() }).run(ensureList())
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'UNAVAILABLE' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task-list')).toEqual([])
  })

  test('unknown payload members and a missing system key are VALIDATION', async () => {
    expect(await memoryHarness().run(ensureList({ payload: { ...ensureList().payload, __unknown: true } })))
      .toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(await memoryHarness().run(ensureList({ payload: { ownerId: OWNER } })))
      .toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(await memoryHarness().run(ensureList({ payload: { systemKey: '', ownerId: OWNER } })))
      .toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
  })

  test('applies once, answers a replay with the receipt and never duplicates the list', async () => {
    const harness = memoryHarness()
    const first = await harness.run(ensureList())
    expect(first).toMatchObject({ status: 'applied', result: { existed: false, systemKey: 'backlog' } })
    const [list] = referenceMemoryRecords(WORKSPACE_ID, 'task-list')
    expect(list!.data).toMatchObject({ name: 'Бэклог', systemKey: 'backlog', ownerType: 'user', ownerId: OWNER })

    const replay = await harness.run(ensureList(), { idempotencyKey: `cmd-${1}-task_lists.ensure_system_list` })
    expect(replay.status === 'duplicate' || replay.status === 'applied').toBe(true)
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task-list')).toHaveLength(1)

    // The id is deterministic per (workspace, owner, systemKey): an explicit id
    // already owned by another principal is a create conflict, never a silent
    // hand-over (same rule as `identity.ensure_placeholder`).
    const other = await harness.run({ ...ensureList(), actor: OTHER, payload: { ...ensureList().payload, ownerId: OTHER }, target: { kind: 'person', id: OTHER } })
    expect(other).toMatchObject({ status: 'conflict', conflict: { currentRevision: 1 } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task-list')).toHaveLength(1)
  })

  test('a person target that is not the payload owner is FORBIDDEN', async () => {
    const receipt = await memoryHarness().run({ ...ensureList(), target: { kind: 'person', id: OTHER } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task-list')).toEqual([])
  })
})

describe('notify.send_invite_email', () => {
  test('permission denied is FORBIDDEN and writes nothing', async () => {
    const receipt = await memoryHarness({ authorizer: DENY_ALL }).run(sendInvite())
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'invitation')).toEqual([])
  })

  test('owner flag off is UNAVAILABLE', async () => {
    const receipt = await memoryHarness({ flags: new Set() }).run(sendInvite())
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'UNAVAILABLE' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'invitation')).toEqual([])
  })

  test('an invalid e-mail is VALIDATION', async () => {
    expect(await memoryHarness().run(sendInvite({ payload: { email: 'not-an-email' } })))
      .toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'invitation')).toEqual([])
  })

  test('queues one invitation email and emits identity.invitation_sent', async () => {
    const workspace = new InMemoryCommandStore()
    const harness = createHarness({ local: new InMemoryCommandStore(), workspace })
    const commandId = { commandId: 'invite-1', idempotencyKey: 'invite-1' }
    const receipt = await harness.run(sendInvite(), commandId)
    expect(receipt).toMatchObject({ status: 'applied', result: { queued: true, existed: false } })
    // The reference primary event plus the mailer intent.
    const events = await workspace.listEvents(WORKSPACE_ID)
    expect(events.map(event => event.type).sort()).toEqual(['identity.invitation_sent', 'notify.send_invite_email'])
    expect(receipt.eventIds?.length).toBe(2)
    const [invitation] = referenceMemoryRecords(WORKSPACE_ID, 'invitation')
    expect(invitation!.data).toMatchObject({ email: 'anna@example.com', state: 'queued', role: 'member', principalId: OTHER, invitedBy: ACTOR_ID })

    // The same command id delivered twice (a lost receipt) answers with the
    // stored receipt and does not queue a second email.
    const retry = await harness.run(sendInvite(), commandId)
    expect(retry).toMatchObject({ status: 'duplicate' })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'invitation')).toHaveLength(1)
  })

  test('a different person target than the payload principal is FORBIDDEN', async () => {
    const receipt = await memoryHarness().run({ ...sendInvite(), target: { kind: 'person', id: OWNER } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'invitation')).toEqual([])
  })
})

describe('the daily-note pair keeps its negative paths under the automation contract', () => {
  test('denied writes are FORBIDDEN; the flag gates the pair', async () => {
    const denied = memoryHarness({ authorizer: DENY_ALL })
    expect(await denied.run({ type: 'docs.ensure_daily_note', payload: { date: '2026-10-09', ownerId: OWNER }, target: { kind: 'person', id: OWNER } }))
      .toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    const off = memoryHarness({ flags: new Set() })
    expect(await off.run({ type: 'docs.ensure_daily_note', payload: { date: '2026-10-09', ownerId: OWNER }, target: { kind: 'person', id: OWNER } }))
      .toMatchObject({ status: 'rejected', error: { code: 'UNAVAILABLE' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'note')).toEqual([])
  })

  test('the daily link is one block updated in place across replays', async () => {
    const harness = memoryHarness()
    const link = { kind: 'note' as const, id: U('minutes') }
    const step: ScenarioStep = {
      type: 'docs.append_daily_link',
      payload: { date: '2026-10-09', ownerId: OWNER, id: U('daily'), link, label: 'Планёрка', blockId: U('block'), time: '2026-10-09T07:00:00.000Z' },
      target: { kind: 'person', id: OWNER },
    }
    expect(await harness.run(step)).toMatchObject({ status: 'applied', result: { blockId: U('block'), updated: false } })
    const replay = await harness.run(step, { idempotencyKey: `cmd-${1}-docs.append_daily_link` })
    expect(replay.status === 'duplicate' || replay.status === 'applied').toBe(true)
    const blocks = referenceMemoryRecords(WORKSPACE_ID, 'doc-block').filter(record => record.id === U('block'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.data).toMatchObject({ kind: 'link', label: 'Планёрка', time: '2026-10-09T07:00:00.000Z' })
    expect(ALLOW_ALL.can).toBeDefined()
    expect([...ALL_FLAGS].length).toBeGreaterThan(0)
  })
})