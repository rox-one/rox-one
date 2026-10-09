/**
 * W1-06 (#1503) — Reference-handler contract tests (memory backend): every
 * catalogue command executes through its reference handler, plus the
 * negative paths of PLAN §1.4 (permission, scope, conflict, expiry, flag off,
 * validation, not found, idempotent replay).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { COMMAND_CATALOGUE, CommandRegistry, registerCommandCatalogue } from '@rox/core/commands'
import { COMMAND_PAYLOAD_SCHEMAS } from '@rox/shared/domain'
import { InMemoryCommandStore } from '../../commands/store'
import { COMMAND_MODULES, boundCommandTypes } from '../../commands/registry'
import { AGENTS_COMMAND_MODULE } from '../../agents/module'
import { REFERENCE_SPECS, configureReferenceRuntime, referenceMemoryRecords, resetReferenceMemory, resetReferenceRuntime } from '../reference'
import { COLLAB_DIRECT_HANDLER_TYPES, COLLAB_REFERENCE_SPECS } from '../../collab/reference-handlers'
import { DRIVE_REFERENCE_SPECS } from '../../drive/reference-handlers'
import { XSC_REFERENCE_SPECS } from '../../xsc/reference-handlers'
import { ALLOW_ALL, CATALOGUE_TYPES, DENY_ALL, OWNER_BOUND_TYPES, REFERENCE_OWNED_SCENARIO, REFERENCE_TYPES, W1_11_OWNED_TYPES, createHarness, type Harness } from './reference-harness'
import { ACTOR_ID, BOB, REFERENCE_SCENARIO, U, WORKSPACE_ID, type ScenarioStep } from './reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')

/**
 * Commands that must not write a `domain_event`: presence lives in Valkey for
 * 60 s (DATA-MODEL §5.17, "Ephemeral"), and `calendar.free_busy` is a query.
 */
const EPHEMERAL_COMMANDS: ReadonlySet<string> = new Set(['presence.heartbeat', 'presence.join', 'presence.leave', 'calendar.free_busy'])

/**
 * W1-15 (#1512) declares these in the XFN catalogue
 * (`packages/core/src/commands/catalogue/xfn.ts:20-23`, spread at
 * `packages/core/src/commands/catalogue/index.ts:66`) but their handler and
 * contract arrive with `bindXfnContracts` (#1534,
 * `docs/specs/2026-10-08-lark-operately-unified/PLAN.md`). They have neither a
 * handler nor a payload schema, so wiring them here would make the `risk-class`
 * / `negative-tests` gates demand a `riskClass` and a negative test that do not
 * exist. Every assertion below pins this list to what the registry reports, so
 * lifting the deferral fails this suite instead of shrinking it silently.
 */
const XFN_DEFERRED_TYPES: readonly string[] = ['decisions.create', 'tables.insert_row']

/**
 * Types the domain payload-schema map does not cover yet: W1-15's two XFN names,
 * which have neither a handler nor a schema until #1534 wires `bindXfnContracts`.
 * (`im.browse_public_chats` used to sit here too — its schema ships outside
 * `@rox/shared/domain` and is re-issued strict at that boundary now, so it is
 * swept like every other command.)
 */
const UNSCHEMAED_TYPES: Readonly<Record<string, true>> = {
  'decisions.create': true,
  'tables.insert_row': true,
}

function memoryHarness(options: Parameters<typeof createHarness>[0] extends infer O ? Partial<O> : never = {}) {
  return createHarness({ local: new InMemoryCommandStore(), workspace: new InMemoryCommandStore(), ...options })
}

/**
 * A chat in the reference store. W1-11 owns `im.create_chat` (see
 * `W1_11_OWNED_TYPES`), so the reference store never gains the channel it
 * makes; `im.create_space_chat` is a live reference spec that honours the
 * payload id and takes members, and it needs its space first.
 */
async function referenceChat(harness: Harness, id: string, memberIds: readonly string[] = []): Promise<string> {
  const spaceId = U(`chat-space:${id}`)
  await harness.run({ type: 'spaces.create', payload: { id: spaceId, name: 'Chats' } })
  await harness.run({ type: 'im.create_space_chat', payload: { id, spaceId, name: 'general', memberIds: [...memberIds] } })
  return id
}

beforeEach(() => {
  resetReferenceMemory()
  configureReferenceRuntime({ now: () => NOW })
})
afterEach(() => resetReferenceRuntime())

describe('reference handlers: wiring', () => {
  test('every non-system catalogue command has a reference spec or an owner-module handler', () => {
    // W1-12 (#1509): a command bound by an owner module before `reference-handlers`
    // is served by that module (its own handler and schema); everything else is
    // the reference layer's, and nothing may be left unhandled.
    const missing = CATALOGUE_TYPES.filter(type => !(type in REFERENCE_SPECS) && !OWNER_BOUND_TYPES.has(type))
    // Everything but W1-15's not-yet-wired XFN types. Asserting equality (not
    // merely `arrayContaining`) keeps the net strict: a command that loses its
    // handler/spec still fails here, and lifting the #1534 deferral shrinks
    // `missing` and fails until the exemption is removed.
    expect(missing).toEqual([...XFN_DEFERRED_TYPES].sort())
    // No spec outlives its catalogue entry.
    expect(Object.keys(REFERENCE_SPECS).filter(type => !CATALOGUE_TYPES.includes(type))).toEqual([])
    // W1-14 (#1511) split the table: the W1-06 placeholders plus the collab / drive / §12
    // module specs, which are bound (and win) earlier in COMMAND_MODULES.
    const union = [
      ...Object.keys(REFERENCE_SPECS), ...Object.keys(COLLAB_REFERENCE_SPECS), ...Object.keys(DRIVE_REFERENCE_SPECS), ...Object.keys(XSC_REFERENCE_SPECS),
      ...COLLAB_DIRECT_HANDLER_TYPES,
    ]
    expect(new Set(union).size).toBe(union.length)
  })

  test('the wired registry binds every catalogue command and every schema', () => {
    const { registry } = memoryHarness()
    // W1-15's XFN deferral (#1534): the two unwired types have no handler and no
    // schema, so they are the only holes. Pinning both sides to that list means
    // a third unwired command, or a lifted deferral, fails this suite.
    expect(boundCommandTypes(registry)).toEqual(COMMAND_CATALOGUE.map(d => d.type).sort().filter(type => !XFN_DEFERRED_TYPES.includes(type)))
    // `d.type` carries the template-literal command-id type; widen it to `string`
    // so the plain-string deferral list has a matching overload.
    expect(registry.list().filter(d => !d.schemaBound && !d.type.startsWith('system.')).map(d => String(d.type))).toEqual([...XFN_DEFERRED_TYPES].sort())
    // `COMMAND_MODULES` is an open registry: owner modules append before the
    // reference module (W1-12 added `automation`, W1-14 added `collab`/`drive`/`xsc`).
    // The fixed ends are the contract.
    const modules = COMMAND_MODULES.map(module => module.name)
    expect(modules[0]).toBe('system')
    expect(modules.at(-1)).toBe('reference-handlers')
    expect(modules).toEqual(expect.arrayContaining(['domain-schemas', 'automation', 'collab', 'drive', 'xsc']))
  })

  test('the W1-11 ownership exclusion matches what the module binds today', () => {
    // Guards the exclusion in `REFERENCE_OWNED_SCENARIO` and the negative paths:
    // the reference memory harness only skips what W1-11 really claims. If the
    // module starts or stops binding one of these types, this fails so the
    // exclusion is reviewed instead of quietly drifting.
    const probe = new CommandRegistry()
    registerCommandCatalogue(probe)
    AGENTS_COMMAND_MODULE.bind(probe)
    expect(boundCommandTypes(probe)).toEqual([...W1_11_OWNED_TYPES].sort())
    // The chat scope is only justified while W1-11 owns chat creation.
    expect(W1_11_OWNED_TYPES).toContain('im.create_chat')
    expect(REFERENCE_OWNED_SCENARIO.length).toBeLessThan(REFERENCE_SCENARIO.length)
  })

  test('the scenario covers every command the reference layer serves', () => {
    // W1-14 (#1511) split the reference layer: the collab / drive / §12 specs live
    // in their own modules and `presence.*` / `calendar.free_busy` are direct
    // handlers, so the scenario spans their union rather than bare `REFERENCE_SPECS`.
    // W1-12's `task_lists.ensure_system_list` / `notify.send_invite_email` are
    // owner-bound with no reference spec (the rule-engine tests cover them).
    const served = [
      ...Object.keys(REFERENCE_SPECS), ...Object.keys(COLLAB_REFERENCE_SPECS), ...Object.keys(DRIVE_REFERENCE_SPECS), ...Object.keys(XSC_REFERENCE_SPECS),
      ...COLLAB_DIRECT_HANDLER_TYPES,
    ].sort()
    expect([...new Set(REFERENCE_SCENARIO.map(step => step.type))].sort()).toEqual(served)
  })
})

describe('reference handlers: every command executes (memory backend)', () => {
  test('the full scenario applies, with a ref or result and a domain event per command', async () => {
    const harness = memoryHarness()
    const failures: string[] = []
    // Only the reference-owned remainder runs: W1-11's own command types and the
    // chat it creates are served by `getAgentsRuntime()`, not this backend — see
    // `W1_11_OWNED_TYPES` / `isW1_11Shadow` in `./reference-harness`.
    for (const step of REFERENCE_OWNED_SCENARIO) {
      const receipt = await harness.run(step)
      if (receipt.status !== 'applied') { failures.push(`${step.type}: ${receipt.status} ${JSON.stringify(receipt.error ?? receipt)}`); continue }
      // Presence and the free-busy query are ephemeral / read-only: DATA-MODEL
      // §5.17 keeps them out of `domain_event`, so a receipt for them has no events.
      const ephemeral = EPHEMERAL_COMMANDS.has(step.type)
      if (!ephemeral && !receipt.eventIds?.length) failures.push(`${step.type}: no domain event`)
      if (ephemeral && receipt.eventIds?.length) failures.push(`${step.type}: ephemeral command wrote a domain event`)
      // A record-backed command answers with its collection; the ephemeral ones
      // answer with presence / query state and never touch a collection.
      if (ephemeral) {
        if (!receipt.result || typeof receipt.result !== 'object') failures.push(`${step.type}: no result`)
      } else if (!receipt.result || typeof (receipt.result as { collection?: unknown }).collection !== 'string') {
        failures.push(`${step.type}: no result`)
      }
    }
    expect(failures).toEqual([])
    const tasks = referenceMemoryRecords(WORKSPACE_ID, 'task')
    const task = tasks.find(record => record.id === U('task'))!
    expect(task.data).toMatchObject({ title: 'Write tests', statusKey: 'pending', priority: 'high', assigneeIds: [BOB], ownerPrincipalId: ACTOR_ID })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'goal').find(r => r.id === U('goal'))!.data).toMatchObject({ lastCheckInId: U('checkin'), lastCheckInStatus: 'on_track', parentGoalId: U('goal2') })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'goal-target').find(r => r.id === U('target'))!.data).toMatchObject({ value: 7, statusOverride: 'caution' })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'space').find(r => r.id === U('space'))!.data.deletedAt).toBe(NOW.toISOString())
  })

  test('a duplicate command is answered from its receipt without a second effect', async () => {
    const harness = memoryHarness()
    const step: ScenarioStep = { type: 'tasks.create', payload: { title: 'Once' } }
    const first = await harness.run(step, { commandId: 'dup-1' })
    const second = await harness.run(step, { commandId: 'dup-1' })
    expect(first.status).toBe('applied')
    expect(second.status).toBe('duplicate')
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task').filter(r => r.data.title === 'Once')).toHaveLength(1)
  })
})

async function seed(harness: Harness, upTo: string): Promise<void> {
  for (const step of REFERENCE_OWNED_SCENARIO) {
    if (step.type === upTo) return
    const receipt = await harness.run(step)
    if (receipt.status !== 'applied') throw new Error(`seed ${step.type}: ${JSON.stringify(receipt)}`)
  }
}

describe('reference handlers: negative paths (PLAN §1.4)', () => {
  test.each(CATALOGUE_TYPES.filter(type => !(type in UNSCHEMAED_TYPES)))('%s: unknown payload members are VALIDATION', async type => {
    const receipt = await memoryHarness().run({ type, target: { kind: 'task', id: 'x' }, payload: { __unknown: true } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
  })

  test('the unknown-member exemption is exactly the catalogue the domain schema map does not cover', () => {
    // Drift guard for the sweep above: the exemption may only name the types
    // `COMMAND_PAYLOAD_SCHEMAS` is missing (W1-15's XFN deferral + W1-11's
    // non-strict browse schema). A schema arriving (#1534) shrinks the right
    // side and fails here, so the exemption is removed with the gap — and a
    // stray name on the left fails too.
    expect(Object.keys(UNSCHEMAED_TYPES).sort()).toEqual(CATALOGUE_TYPES.filter(type => !(type in COMMAND_PAYLOAD_SCHEMAS)))
  })

  test.each(REFERENCE_TYPES)('%s: permission denied is FORBIDDEN and writes nothing', async type => {
    const step = REFERENCE_SCENARIO.find(s => s.type === type)!
    const receipt = await memoryHarness({ authorizer: DENY_ALL }).run(step)
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
  })

  test.each(COMMAND_CATALOGUE.filter(d => d.flag && REFERENCE_TYPES.includes(d.type)).map(d => d.type))('%s: owner flag off is UNAVAILABLE', async type => {
    const step = REFERENCE_SCENARIO.find(s => s.type === type)!
    const receipt = await memoryHarness({ flags: new Set() }).run(step)
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'UNAVAILABLE' } })
  })

  test('missing target is NOT_FOUND; missing target ref is VALIDATION; wrong target kind is VALIDATION (scope)', async () => {
    const harness = memoryHarness()
    expect(await harness.run({ type: 'tasks.update', target: { kind: 'task', id: 'nope' }, payload: { title: 'x' } })).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(await harness.run({ type: 'tasks.update', payload: { title: 'x' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await harness.run({ type: 'tasks.update', target: { kind: 'goal', id: 'g' }, payload: { title: 'x' } })).toMatchObject({ error: { code: 'VALIDATION' } })
  })

  test('a child of another parent is NOT_FOUND (scope)', async () => {
    const harness = memoryHarness()
    await seed(harness, 'goals.update_name')
    const receipt = await harness.run({ type: 'goals.update_target', target: { kind: 'goal', id: U('goal2') }, payload: { targetId: U('target'), toValue: 1 } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'NOT_FOUND' } })
  })

  test('a stale expectedRevision is a conflict receipt and changes nothing', async () => {
    const harness = memoryHarness()
    await harness.run({ type: 'tasks.create', payload: { id: 't-cas', title: 'v1' } })
    const ok = await harness.run({ type: 'tasks.update', target: { kind: 'task', id: 't-cas' }, payload: { title: 'v2' } }, { expectedRevision: 1 })
    expect(ok).toMatchObject({ status: 'applied', revision: 2 })
    const stale = await harness.run({ type: 'tasks.update', target: { kind: 'task', id: 't-cas' }, payload: { title: 'v3' } }, { expectedRevision: 1 })
    expect(stale).toMatchObject({ status: 'conflict', conflict: { currentRevision: 2 } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task').find(r => r.id === 't-cas')!.data.title).toBe('v2')
  })

  test('creating an existing id is a conflict that carries only the revision, never the record', async () => {
    const harness = memoryHarness()
    await harness.run({ type: 'goals.create', payload: { id: 'g-dup', name: 'Secret plan' } })
    const receipt = await harness.run({ type: 'goals.create', payload: { id: 'g-dup', name: 'B' } })
    expect(receipt).toMatchObject({ status: 'conflict', conflict: { currentRevision: 1 } })
    expect(receipt.conflict!.current).toEqual({ error: 'id already exists' })
    expect(JSON.stringify(receipt)).not.toContain('Secret plan')
    await harness.run({ type: 'tasks.create', payload: { id: 't-dup', title: 'Private title' } })
    const task = await harness.run({ type: 'tasks.create', payload: { id: 't-dup', title: 'x' } })
    expect(task).toMatchObject({ status: 'conflict', conflict: { currentRevision: 1, current: { error: 'id already exists' } } })
    expect(JSON.stringify(task)).not.toContain('Private title')
  })

  test('handler-level permissions: foreign message edit, admin-only posting, own access request', async () => {
    const harness = memoryHarness()
    // W1-11 now owns `im.create_chat` / `im.join_chat`, so their reference specs
    // are shadowed (see `W1_11_OWNED_TYPES`); the chat comes from the live
    // reference spec `im.create_space_chat`, and the private-join path moved to
    // W1-11's own suite.
    const chat = await referenceChat(harness, U('chat'), [BOB])
    expect(await harness.run({ type: 'im.send_message', target: { kind: 'channel', id: chat }, payload: { chatRef: { kind: 'channel', id: chat }, body: { doc: 'x' }, mentions: [], messageId: U('m2') } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'im.edit_message', target: { kind: 'channel', id: chat }, payload: { messageId: U('m2'), content: { doc: 'y' } }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    await harness.run({ type: 'im.update_policy', target: { kind: 'channel', id: chat }, payload: { postingPolicy: 'admins' } })
    expect(await harness.run({ type: 'im.send_message', target: { kind: 'channel', id: chat }, payload: { chatRef: { kind: 'channel', id: chat }, body: { doc: 'z' }, mentions: [] }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    await harness.run({ type: 'docs.create_document', payload: { id: U('d2'), title: 'D' } })
    await harness.run({ type: 'acl.request_access', target: { kind: 'note', id: U('d2') }, payload: { id: U('r2') } })
    expect(await harness.run({ type: 'acl.decide_request', target: { kind: 'note', id: U('d2') }, payload: { requestId: U('r2'), decision: 'approve' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  test('expiry: an upload session and an access request past their TTL are rejected', async () => {
    const harness = memoryHarness()
    await harness.run({ type: 'drive.provision', payload: {} })
    await harness.run({ type: 'drive.open_upload', payload: { id: U('u-exp'), fileName: 'f', sizeExpected: 1 } })
    await harness.run({ type: 'docs.create_document', payload: { id: U('d-exp'), title: 'D' } })
    await harness.run({ type: 'acl.request_access', target: { kind: 'note', id: U('d-exp') }, payload: { id: U('r-exp') } })
    configureReferenceRuntime({ now: () => new Date(NOW.getTime() + 30 * 24 * 3600 * 1000) })
    expect(await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('u-exp'), sha256: 'a'.repeat(64) } })).toMatchObject({ error: { code: 'VALIDATION', message: 'upload session expired' } })
    expect(await harness.run({ type: 'acl.decide_request', target: { kind: 'note', id: U('d-exp') }, payload: { requestId: U('r-exp'), decision: 'approve' }, actor: BOB })).toMatchObject({ error: { code: 'VALIDATION', message: 'request expired' } })
  })

  test('domain rules: self-parenting, space delete confirmation', async () => {
    const harness = memoryHarness()
    await harness.run({ type: 'goals.create', payload: { id: 'g-self', name: 'A' } })
    expect(await harness.run({ type: 'goals.update_parent_goal', target: { kind: 'goal', id: 'g-self' }, payload: { parentGoalId: 'g-self' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    await harness.run({ type: 'spaces.create', payload: { id: U('sp'), name: 'Ops' } })
    expect(await harness.run({ type: 'spaces.delete', target: { kind: 'space', id: U('sp') }, payload: { confirmName: 'Opz' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    // The paused-agent path runs on W1-11's `agents.*` handlers (see
    // `W1_11_OWNED_TYPES`), so it is asserted by that module's own suite.
  })

  test('the allow-all authorizer is only a test double', () => {
    expect(ALLOW_ALL).not.toBe(DENY_ALL)
  })
})

/** Records `can()` calls; allows only what `allow` accepts. */
function recordingAuthorizer(allow: (verb: string, ref: { kind: string; id: string } | null) => boolean) {
  const calls: Array<{ verb: string; ref: { kind: string; id: string } | null }> = []
  return { calls, authorizer: { can: async (_p: unknown, verb: string, ref: { kind: string; id: string } | null) => { calls.push({ verb, ref }); return allow(verb, ref) } } }
}

describe('reference handlers: the payload never widens the authorized target', () => {
  const docA = { kind: 'note' as const, id: U('acl-a') }
  const docB = { kind: 'note' as const, id: U('acl-b') }

  test('acl.*: a payload subject other than the target is FORBIDDEN, a missing target is VALIDATION', async () => {
    const harness = memoryHarness()
    const principal = { kind: 'user', id: BOB }
    expect(await harness.run({ type: 'acl.grant', target: docA, payload: { subject: docB, principal, role: 'editor' } })).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(await harness.run({ type: 'acl.grant', payload: { subject: docB, principal, role: 'editor' } })).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect(await harness.run({ type: 'acl.revoke', payload: { subject: docB, principal } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await harness.run({ type: 'acl.set_link', payload: { subject: docB, scope: 'workspace' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await harness.run({ type: 'acl.set_link', target: docA, payload: { subject: docB, scope: 'workspace' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await harness.run({ type: 'acl.transfer_ownership', payload: { subject: docB, toPrincipalId: BOB } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await harness.run({ type: 'acl.transfer_ownership', target: docA, payload: { subject: docB, toPrincipalId: BOB } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await harness.run({ type: 'acl.request_access', target: docA, payload: { subject: docB, role: 'viewer' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'acl-entry')).toEqual([])
    expect(referenceMemoryRecords(WORKSPACE_ID, 'acl-link')).toEqual([])
    // A subject that repeats the target is fine.
    expect(await harness.run({ type: 'acl.grant', target: docA, payload: { subject: docA, principal, role: 'editor' } })).toMatchObject({ status: 'applied' })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'acl-entry')[0]!.data).toMatchObject({ resourceType: 'note', resourceId: docA.id, subjectId: BOB })
  })

  test('acl.grant authorized on doc A cannot grant on doc B', async () => {
    const { authorizer, calls } = recordingAuthorizer((verb, ref) => verb !== 'share' || ref?.id === docA.id)
    const harness = memoryHarness({ authorizer })
    expect(await harness.run({ type: 'acl.grant', target: docA, payload: { subject: docB, principal: { kind: 'user', id: BOB }, role: 'full_access' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await harness.run({ type: 'acl.grant', target: docB, payload: { principal: { kind: 'user', id: BOB }, role: 'full_access' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls.map(call => call.ref?.id)).toEqual([docA.id, docB.id])
    expect(referenceMemoryRecords(WORKSPACE_ID, 'acl-entry')).toEqual([])
  })

  test('acl.decide_request needs the requested resource as its target', async () => {
    const harness = memoryHarness()
    await harness.run({ type: 'acl.request_access', target: docA, payload: { id: U('acl-req'), role: 'viewer' }, actor: BOB })
    expect(await harness.run({ type: 'acl.decide_request', payload: { requestId: U('acl-req'), decision: 'approve' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await harness.run({ type: 'acl.decide_request', target: docB, payload: { requestId: U('acl-req'), decision: 'approve' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'acl-entry')).toEqual([])
    expect(await harness.run({ type: 'acl.decide_request', target: docA, payload: { requestId: U('acl-req'), decision: 'approve' } })).toMatchObject({ status: 'applied' })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'acl-entry')[0]!.data).toMatchObject({ resourceId: docA.id, subjectId: BOB, role: 'viewer' })
  })

  test('mail.share_to_chat is authorized on the destination chat', async () => {
    const harness = memoryHarness()
    // W1-11 owns `im.create_chat`; both chats come from the live reference spec
    // `im.create_space_chat` (see `referenceChat`).
    const dest = await referenceChat(harness, U('dest'))
    const other = await referenceChat(harness, U('other'))
    const before = referenceMemoryRecords(WORKSPACE_ID, 'channel-message').length
    expect(await harness.run({ type: 'mail.share_to_chat', payload: { threadId: 'th-1', chatId: dest } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await harness.run({ type: 'mail.share_to_chat', target: { kind: 'channel', id: U('dest') }, payload: { threadId: 'th-1', chatId: U('other') } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'channel-message')).toHaveLength(before)
    const { authorizer, calls } = recordingAuthorizer((_verb, ref) => ref?.id !== U('other'))
    const guarded = memoryHarness({ authorizer })
    expect(await guarded.run({ type: 'mail.share_to_chat', target: { kind: 'channel', id: U('other') }, payload: { threadId: 'th-1' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(calls.at(-1)).toMatchObject({ verb: 'write', ref: { kind: 'channel', id: U('other') } })
    expect(await guarded.run({ type: 'mail.share_to_chat', target: { kind: 'channel', id: U('dest') }, payload: { threadId: 'th-1' } })).toMatchObject({ status: 'applied' })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'channel-message').filter(m => m.data.chatId === U('dest'))).toHaveLength(1)
  })

  test('links.*: from must be the target', async () => {
    const harness = memoryHarness()
    const to = { kind: 'goal' as const, id: U('lg') }
    expect(await harness.run({ type: 'links.add', target: { kind: 'task', id: U('lt') }, payload: { from: { kind: 'task', id: U('other-task') }, to, relation: 'aligned-to' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(await harness.run({ type: 'links.add', payload: { from: { kind: 'task', id: U('other-task') }, to, relation: 'aligned-to' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(await harness.run({ type: 'links.remove', payload: { from: { kind: 'task', id: U('other-task') }, to, relation: 'aligned-to' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'entity-link')).toEqual([])
  })
})

describe('reference handlers: retry after a lost receipt (same commandId, fresh receipt store)', () => {
  /** Same memory records, new command store: the first receipt is gone, the effect is not. */
  const retryHarness = () => memoryHarness()

  test('a retried create returns the record it made', async () => {
    const first = await retryHarness().run({ type: 'tasks.create', payload: { title: 'Once' } }, { commandId: 'retry-create' })
    const again = await retryHarness().run({ type: 'tasks.create', payload: { title: 'Once' } }, { commandId: 'retry-create' })
    expect(first).toMatchObject({ status: 'applied', revision: 1 })
    expect(again).toMatchObject({ status: 'applied', revision: 1, ref: first.ref })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task').filter(r => r.data.title === 'Once')).toHaveLength(1)
  })

  test('a retried update applies once and passes its own expectedRevision', async () => {
    await retryHarness().run({ type: 'tasks.create', payload: { id: 't-retry', title: 'v1', tags: [] } })
    const step = { type: 'tasks.update', target: { kind: 'task' as const, id: 't-retry' }, payload: { title: 'v2' } }
    expect(await retryHarness().run(step, { commandId: 'retry-update', expectedRevision: 1 })).toMatchObject({ status: 'applied', revision: 2 })
    expect(await retryHarness().run(step, { commandId: 'retry-update', expectedRevision: 1 })).toMatchObject({ status: 'applied', revision: 2 })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task').find(r => r.id === 't-retry')).toMatchObject({ revision: 2, data: { title: 'v2', lastCommandId: 'retry-update' } })
    // A different command with the stale revision still conflicts.
    expect(await retryHarness().run(step, { commandId: 'other-update', expectedRevision: 1 })).toMatchObject({ status: 'conflict' })
    // Assignee add is not applied twice either.
    const add = { type: 'tasks.update_assignees', target: { kind: 'task' as const, id: 't-retry' }, payload: { add: [BOB] } }
    await retryHarness().run(add, { commandId: 'retry-assign' })
    await retryHarness().run(add, { commandId: 'retry-assign' })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'task').find(r => r.id === 't-retry')).toMatchObject({ revision: 3, data: { assigneeIds: [BOB] } })
  })

  test('a retried message append keeps one message and one seq', async () => {
    // W1-11 owns `im.create_chat`; the reference chat comes from the live
    // reference spec `im.create_space_chat` (see `referenceChat`).
    await referenceChat(retryHarness(), U('retry-chat'))
    const send = { type: 'im.send_message', target: { kind: 'channel' as const, id: U('retry-chat') }, payload: { chatRef: { kind: 'channel', id: U('retry-chat') }, body: { doc: 'hi' }, mentions: [] } }
    const first = await retryHarness().run(send, { commandId: 'retry-send' })
    const again = await retryHarness().run(send, { commandId: 'retry-send' })
    expect(first.status).toBe('applied')
    expect(again).toMatchObject({ status: 'applied', result: first.result })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'channel-message').filter(m => m.data.chatId === U('retry-chat'))).toHaveLength(1)
    expect(referenceMemoryRecords(WORKSPACE_ID, 'channel-sequence').find(r => r.id === U('retry-chat'))!.data.lastSeq).toBe(1)
    expect(await retryHarness().run(send, { commandId: 'next-send' })).toMatchObject({ status: 'applied', result: { seq: 2 } })
  })

  test('a retried soft delete finds its own tombstone', async () => {
    await retryHarness().run({ type: 'goals.create', payload: { id: 'g-del', name: 'G' } })
    const del = { type: 'goals.delete', target: { kind: 'goal' as const, id: 'g-del' }, payload: {} }
    expect(await retryHarness().run(del, { commandId: 'retry-delete' })).toMatchObject({ status: 'applied' })
    expect(await retryHarness().run(del, { commandId: 'retry-delete' })).toMatchObject({ status: 'applied' })
    expect(await retryHarness().run(del, { commandId: 'other-delete' })).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  test('multi-record creates validate every id before the first write', async () => {
    const harness = retryHarness()
    await harness.run({ type: 'goals.create', payload: { id: 'g-a', name: 'A', targets: [{ id: 'tg-taken', name: 'T', fromValue: 0, toValue: 1 }] } })
    const receipt = await harness.run({ type: 'goals.create', payload: { id: 'g-b', name: 'B', targets: [{ id: 'tg-taken', name: 'T2', fromValue: 0, toValue: 1 }] } })
    expect(receipt).toMatchObject({ status: 'conflict', conflict: { current: { error: 'id already exists' } } })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'goal').map(r => r.id)).toEqual(['g-a'])
    // W1-14: the origin chat must exist — the card is posted back into it. W1-11
    // owns `im.create_chat`, so it comes from the live reference spec
    // `im.create_space_chat` (see `referenceChat`).
    await referenceChat(harness, U('c'))
    await harness.run({ type: 'tasks.create', payload: { id: U('from-taken'), title: 'x' } })
    const fromMessage = await harness.run({ type: 'tasks.create_from_message', payload: { id: U('from-taken'), origin: { kind: 'message', chatRef: `channel:${U('c')}`, seq: 1 }, title: 'From message' } })
    expect(fromMessage).toMatchObject({ status: 'conflict' })
    expect(referenceMemoryRecords(WORKSPACE_ID, 'entity-link')).toEqual([])
  })
})
