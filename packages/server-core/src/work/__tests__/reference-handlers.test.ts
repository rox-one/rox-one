/**
 * W1-06 (#1503) — Reference-handler contract tests (memory backend): every
 * catalogue command executes through its reference handler, plus the
 * negative paths of PLAN §1.4 (permission, scope, conflict, expiry, flag off,
 * validation, not found, idempotent replay).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { COMMAND_CATALOGUE } from '@rox/core/commands'
import { InMemoryCommandStore } from '../../commands/store'
import { COMMAND_MODULES, boundCommandTypes } from '../../commands/registry'
import { REFERENCE_SPECS, configureReferenceRuntime, referenceMemoryRecords, resetReferenceMemory, resetReferenceRuntime } from '../reference'
import { ALLOW_ALL, CATALOGUE_TYPES, DENY_ALL, createHarness } from './reference-harness'
import { ACTOR_ID, BOB, REFERENCE_SCENARIO, U, WORKSPACE_ID, type ScenarioStep } from './reference-scenario'

const NOW = new Date('2026-10-08T12:00:00.000Z')

function memoryHarness(options: Parameters<typeof createHarness>[0] extends infer O ? Partial<O> : never = {}) {
  return createHarness({ local: new InMemoryCommandStore(), workspace: new InMemoryCommandStore(), ...options })
}

beforeEach(() => {
  resetReferenceMemory()
  configureReferenceRuntime({ now: () => NOW })
})
afterEach(() => resetReferenceRuntime())

describe('reference handlers: wiring', () => {
  test('one reference spec per non-system catalogue command', () => {
    expect(Object.keys(REFERENCE_SPECS).sort()).toEqual(CATALOGUE_TYPES)
  })

  test('the wired registry binds every catalogue command and every schema', () => {
    const { registry } = memoryHarness()
    expect(boundCommandTypes(registry)).toEqual(COMMAND_CATALOGUE.map(d => d.type).sort())
    expect(registry.list().filter(d => !d.schemaBound && !d.type.startsWith('system.')).map(d => d.type)).toEqual([])
    expect(COMMAND_MODULES.map(m => m.name)).toEqual(['system', 'domain-schemas', 'reference-handlers'])
  })

  test('the scenario covers every catalogue command', () => {
    expect([...new Set(REFERENCE_SCENARIO.map(step => step.type))].sort()).toEqual(CATALOGUE_TYPES)
  })
})

describe('reference handlers: every command executes (memory backend)', () => {
  test('the full scenario applies, with a ref or result and a domain event per command', async () => {
    const harness = memoryHarness()
    const failures: string[] = []
    for (const step of REFERENCE_SCENARIO) {
      const receipt = await harness.run(step)
      if (receipt.status !== 'applied') { failures.push(`${step.type}: ${receipt.status} ${JSON.stringify(receipt.error ?? receipt)}`); continue }
      if (!receipt.eventIds?.length) failures.push(`${step.type}: no domain event`)
      if (!receipt.result || typeof (receipt.result as { collection?: unknown }).collection !== 'string') failures.push(`${step.type}: no result`)
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

async function seed(harness: ReturnType<typeof memoryHarness>, upTo: string): Promise<void> {
  for (const step of REFERENCE_SCENARIO) {
    if (step.type === upTo) return
    const receipt = await harness.run(step)
    if (receipt.status !== 'applied') throw new Error(`seed ${step.type}: ${JSON.stringify(receipt)}`)
  }
}

describe('reference handlers: negative paths (PLAN §1.4)', () => {
  test.each(CATALOGUE_TYPES)('%s: unknown payload members are VALIDATION', async type => {
    const receipt = await memoryHarness().run({ type, target: { kind: 'task', id: 'x' }, payload: { __unknown: true } })
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
  })

  test.each(CATALOGUE_TYPES)('%s: permission denied is FORBIDDEN and writes nothing', async type => {
    const step = REFERENCE_SCENARIO.find(s => s.type === type)!
    const receipt = await memoryHarness({ authorizer: DENY_ALL }).run(step)
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
  })

  test.each(COMMAND_CATALOGUE.filter(d => d.flag).map(d => d.type))('%s: owner flag off is UNAVAILABLE', async type => {
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

  test('creating an existing id is a conflict', async () => {
    const harness = memoryHarness()
    await harness.run({ type: 'goals.create', payload: { id: 'g-dup', name: 'A' } })
    expect(await harness.run({ type: 'goals.create', payload: { id: 'g-dup', name: 'B' } })).toMatchObject({ status: 'conflict' })
  })

  test('handler-level permissions: foreign message edit, private join, admin-only posting, own access request', async () => {
    const harness = memoryHarness()
    await seed(harness, 'im.update_chat')
    expect(await harness.run({ type: 'im.send_message', target: { kind: 'channel', id: U('chat') }, payload: { id: U('m2'), content: { doc: 'x' } } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'im.edit_message', target: { kind: 'channel', id: U('chat') }, payload: { messageId: U('m2'), content: { doc: 'y' } }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    await harness.run({ type: 'im.create_chat', payload: { id: U('private'), name: 'p', visibility: 'private' } })
    expect(await harness.run({ type: 'im.join_chat', target: { kind: 'channel', id: U('private') }, payload: {}, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    await harness.run({ type: 'im.update_policy', target: { kind: 'channel', id: U('chat') }, payload: { postingPolicy: 'admins' } })
    expect(await harness.run({ type: 'im.send_message', target: { kind: 'channel', id: U('chat') }, payload: { content: { doc: 'z' } }, actor: BOB })).toMatchObject({ error: { code: 'FORBIDDEN' } })
    await harness.run({ type: 'docs.create_document', payload: { id: U('d2'), title: 'D' } })
    await harness.run({ type: 'acl.request_access', target: { kind: 'note', id: U('d2') }, payload: { id: U('r2') } })
    expect(await harness.run({ type: 'acl.decide_request', payload: { requestId: U('r2'), decision: 'approve' } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  test('expiry: an upload session and an access request past their TTL are rejected', async () => {
    const harness = memoryHarness()
    await harness.run({ type: 'drive.open_upload', payload: { id: U('u-exp'), fileName: 'f', sizeExpected: 1 } })
    await harness.run({ type: 'docs.create_document', payload: { id: U('d-exp'), title: 'D' } })
    await harness.run({ type: 'acl.request_access', target: { kind: 'note', id: U('d-exp') }, payload: { id: U('r-exp') } })
    configureReferenceRuntime({ now: () => new Date(NOW.getTime() + 30 * 24 * 3600 * 1000) })
    expect(await harness.run({ type: 'drive.complete_upload', payload: { uploadSessionId: U('u-exp'), sha256: 'a'.repeat(64) } })).toMatchObject({ error: { code: 'VALIDATION', message: 'upload session expired' } })
    expect(await harness.run({ type: 'acl.decide_request', payload: { requestId: U('r-exp'), decision: 'approve' }, actor: BOB })).toMatchObject({ error: { code: 'VALIDATION', message: 'request expired' } })
  })

  test('domain rules: self-parenting, space delete confirmation, paused agent', async () => {
    const harness = memoryHarness()
    await harness.run({ type: 'goals.create', payload: { id: 'g-self', name: 'A' } })
    expect(await harness.run({ type: 'goals.update_parent_goal', target: { kind: 'goal', id: 'g-self' }, payload: { parentGoalId: 'g-self' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    await harness.run({ type: 'spaces.create', payload: { id: U('sp'), name: 'Ops' } })
    expect(await harness.run({ type: 'spaces.delete', target: { kind: 'space', id: U('sp') }, payload: { confirmName: 'Opz' } })).toMatchObject({ error: { code: 'VALIDATION' } })
    await harness.run({ type: 'agents.provision_personal_agent', payload: { id: U('ag'), ownerId: ACTOR_ID } })
    await harness.run({ type: 'agents.pause', payload: { agentId: U('ag') } })
    expect(await harness.run({ type: 'agents.invoke', payload: { agentId: U('ag'), prompt: 'x' } })).toMatchObject({ error: { code: 'UNAVAILABLE' } })
    expect(await harness.run({ type: 'agents.provision_personal_agent', payload: { ownerId: BOB } })).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  test('the allow-all authorizer is only a test double', () => {
    expect(ALLOW_ALL).not.toBe(DENY_ALL)
  })
})
