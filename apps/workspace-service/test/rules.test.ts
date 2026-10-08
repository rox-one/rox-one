/**
 * W1-12 (#1509) — the workspace `rules` consumer group and the
 * `automation_rule` settings API, without Postgres: the relay sink runs the
 * rules for committed events, the settings routes enforce the per-user /
 * admin split of DATA-MODEL §5.16, and everything is inert while
 * `automation.rules.v1` is off.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { SQL } from 'bun'
import type { CommandActor, CommandEnvelope, CommandReceipt } from '../../../packages/core/src/commands/index.ts'
import type { DomainEvent } from '../../../packages/core/src/events/index.ts'
import { skipMarker, type RuleExecutionRecord } from '../../../packages/core/src/automation/index.ts'
import { InMemoryRulesStore } from '../../../packages/server-core/src/rules/store.ts'
import type { SharedProjectAuthority } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { createWorkspaceRules, type WorkspaceRulesRuntime } from '../src/modules/rules/runtime.ts'
import { actor, fakeResolver, request, serve } from './helpers.ts'

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })

/** Never touched: the runtime is constructed with injected stores and roles. */
const unusedDatabase = {} as SQL
const unusedAuthority = new Proxy({}, { get: () => () => { throw new Error('not used') } }) as SharedProjectAuthority

const NOW = '2026-10-08T09:00:00.000Z'

interface Dispatched { actor: CommandActor; envelope: CommandEnvelope }

function setup(options: {
  flagOn?: boolean
  role?: 'owner' | 'admin' | 'member' | null
  /** Command types the fake dispatcher rejects. */
  reject?: readonly string[]
} = {}) {
  const workspaceId = randomUUID()
  const store = new InMemoryRulesStore()
  const dispatched: Dispatched[] = []
  const rules = createWorkspaceRules({
    database: unusedDatabase,
    schema: 'public',
    storeFor: () => store,
    roleFor: async () => (options.role === undefined ? 'owner' : options.role),
    dispatchFor: () => async input => {
      dispatched.push({ actor: input.actor, envelope: input.envelope })
      const rejected = (options.reject ?? []).includes(input.envelope.type)
      const receipt: CommandReceipt = rejected
        ? { commandId: input.envelope.commandId, status: 'rejected', error: { code: 'FORBIDDEN', message: 'not allowed' } }
        : { commandId: input.envelope.commandId, status: 'applied', ref: { kind: 'task', id: input.envelope.commandId } }
      return receipt
    },
    isFlagEnabled: flag => flag === 'automation.rules.v1' && options.flagOn !== false,
    now: () => new Date(NOW),
  })
  return { workspaceId, store, rules, dispatched }
}

function event(workspaceId: string, overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: randomUUID(),
    workspaceId,
    type: 'calendar.event_created',
    subject: { kind: 'calendar-event', id: 'event-1' },
    aggregateRevision: 1,
    payload: {
      event: {
        ref: { kind: 'calendar-event', id: 'event-1' },
        calendarId: 'calendar-1',
        title: 'Планёрка',
        startAt: '2026-10-09T07:00:00.000Z',
        endAt: '2026-10-09T07:30:00.000Z',
        allDay: false,
        organizerId: 'principal-mark',
      },
    },
    createdAt: NOW,
    ...overrides,
  }
}

describe('rules consumer group over the relay (workspace authority)', () => {
  test('runs R1 for a committed event and records one execution', async () => {
    const { workspaceId, store, rules, dispatched } = setup()
    await rules.sink([event(workspaceId)])
    const executions = await store.list(workspaceId)
    expect(executions).toHaveLength(1)
    expect(executions[0]).toMatchObject({ ruleId: 'R1', status: 'succeeded', attempts: 1 })
    expect(executions[0]!.idempotencyKey).toBe('R1:event-1:single:principal-mark')
    // Nine commands: the eight declared steps plus the shared agent scope.
    expect(dispatched.map(entry => entry.envelope.type)).toEqual([
      'task_lists.ensure_system_list', 'docs.ensure_daily_note', 'docs.create_meeting_notes', 'docs.append_daily_link',
      'tasks.create', 'links.add', 'links.add', 'links.add',
    ])
    expect(dispatched.every(entry => entry.actor.principalId === 'principal-mark')).toBe(true)
    expect(dispatched.map(entry => entry.envelope.idempotencyKey)).toEqual(dispatched.map(entry => `${executions[0]!.idempotencyKey}:${entry.envelope.commandId.split(':').slice(-1)[0]}`))
  })

  test('a redelivered event (relay catch-up) adds nothing', async () => {
    const { workspaceId, store, rules, dispatched } = setup()
    const delivered = event(workspaceId)
    await rules.sink([delivered])
    const after = dispatched.length
    await rules.sink([delivered])
    await rules.sink([delivered])
    expect(await store.list(workspaceId)).toHaveLength(1)
    expect(dispatched).toHaveLength(after)
    expect(rules.snapshot()['rule_duplicates_prevented_total']).toBe(2)
    // Duplicates are counted apart from executions (TECH-SPEC §14.4).
    expect(rules.snapshot()['rule_executions_total|rule=R1|status=succeeded']).toBe(1)
  })

  test('skipped conditions are recorded with their reason', async () => {
    const { workspaceId, store, rules, dispatched } = setup()
    const allDay = event(workspaceId, {
      payload: { event: { ...(event(workspaceId).payload as { event: Record<string, unknown> }).event, allDay: true } },
    })
    await rules.sink([allDay])
    const [record] = await store.list(workspaceId)
    expect(record).toMatchObject({ status: 'skipped' })
    expect(record!.lastError).toBe(skipMarker('all_day'))
    expect(dispatched).toEqual([])
  })

  test('the flag gates the sink: nothing runs, nothing is written', async () => {
    const { workspaceId, store, rules, dispatched } = setup({ flagOn: false })
    expect(rules.enabled()).toBe(false)
    await rules.sink([event(workspaceId)])
    expect(await store.list(workspaceId)).toEqual([])
    expect(dispatched).toEqual([])
    expect(rules.snapshot()).toEqual({})
  })

  test('a failing step retries through resumePending with the backoff gate', async () => {
    const workspaceId = randomUUID()
    const store = new InMemoryRulesStore()
    let fail = true
    let clock = new Date(NOW)
    const scheduled: number[] = []
    const rules = createWorkspaceRules({
      database: unusedDatabase,
      schema: 'public',
      storeFor: () => store,
      dispatchFor: () => async input => {
        if (fail && input.envelope.type === 'docs.create_meeting_notes') {
          return { commandId: input.envelope.commandId, status: 'rejected', error: { code: 'INTERNAL', message: 'boom' } }
        }
        return { commandId: input.envelope.commandId, status: 'applied' }
      },
      isFlagEnabled: () => true,
      now: () => clock,
      scheduler: { schedule: (delayMs, task) => { scheduled.push(delayMs); return () => {} } },
    })
    await rules.sink([event(workspaceId)])
    const key = 'R1:event-1:single:principal-mark'
    expect(await store.get(workspaceId, key)).toMatchObject({ status: 'running', attempts: 1 })
    expect(scheduled).toEqual([60_000])

    // Backoff gate: too early to retry.
    expect(await rules.resumePending(workspaceId)).toBe(0)
    expect((await store.get(workspaceId, key))!.attempts).toBe(1)

    fail = false
    clock = new Date(clock.getTime() + 60_000)
    expect(await rules.resumePending(workspaceId)).toBe(1)
    expect(await store.get(workspaceId, key)).toMatchObject({ status: 'succeeded', attempts: 2 })
  })
})

describe('automation_rule settings API', () => {
  async function serveAutomation(options: { flagOn?: boolean; role?: 'owner' | 'admin' | 'member' | null } = {}) {
    const { workspaceId, store, rules } = setup(options)
    const owner = actor([workspaceId])
    const { resolver } = fakeResolver(owner)
    const http = await serve({
      authority: unusedAuthority,
      actorResolver: resolver,
      automation: { rules, enabled: () => rules.enabled() },
    })
    closers.push(http.close)
    const base = `/v1/workspaces/${workspaceId}/automation`
    const get = (path: string) => request(http.url, path)
    return { workspaceId, store, rules, http, base, owner, get }
  }

  test('GET /automation/rules lists every rule with its effective settings', async () => {
    const served = await serveAutomation()
    const { base, workspaceId } = served
    const rules = await request(served.http.url, `${base}/rules`)
    expect(rules.status).toBe(200)
    expect((rules.body.rules as Array<{ ruleId: string }>).map(rule => rule.ruleId)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5'])
    const r1 = (rules.body.rules as Array<{ ruleId: string; enabled: boolean; source: string; scope: string }>).find(rule => rule.ruleId === 'R1')!
    expect(r1).toMatchObject({ enabled: true, source: 'default', scope: 'principal' })
    // The path is workspace-scoped: an actor of another workspace is rejected.
    const stranger = await request(served.http.url, `/v1/workspaces/${randomUUID()}/automation/rules`, { token: 'aaa.bbb.ccc' })
    expect(stranger.status).toBe(403)
    expect(workspaceId).toBeTruthy()
  })

  test('PUT /automation/rules/{ruleId}: R1 is per user, R2–R5 are admin-only', async () => {
    const asAdmin = await serveAutomation({ role: 'admin' })
    const r1 = await request(asAdmin.http.url, `${asAdmin.base}/rules/R1`, { method: 'PUT', body: { enabled: false, params: { skipAllDay: true, for: 'organiser' } } })
    expect(r1.status).toBe(200)
    expect(r1.body).toMatchObject({ ruleId: 'R1', enabled: false, scope: 'principal', source: 'principal' })
    expect(await asAdmin.store.read(asAdmin.workspaceId, 'R1', asAdmin.owner.principalId)).toMatchObject({ enabled: false, scope: 'principal' })

    const r3 = await request(asAdmin.http.url, `${asAdmin.base}/rules/R3`, { method: 'PUT', body: { params: { handles: ['@rox', '@rox-anna'] } } })
    expect(r3.status).toBe(200)
    expect(r3.body).toMatchObject({ ruleId: 'R3', scope: 'workspace', source: 'workspace' })
    expect(r3.body.params).toEqual({ handles: ['@rox', '@rox-anna'] })
    expect(await asAdmin.store.read(asAdmin.workspaceId, 'R3', null)).toMatchObject({ enabled: true, params: { handles: ['@rox', '@rox-anna'] } })

    // A plain member cannot change the workspace rules.
    const asMember = await serveAutomation({ role: 'member' })
    const denied = await request(asMember.http.url, `${asMember.base}/rules/R2`, { method: 'PUT', body: { enabled: false } })
    expect(denied.status).toBe(403)
    expect(await asMember.store.read(asMember.workspaceId, 'R2', null)).toBeNull()

    // Unknown rules and invalid params are rejected; unknown paths 404.
    const unknown = await request(asAdmin.http.url, `${asAdmin.base}/rules/R9`, { method: 'PUT', body: { enabled: true } })
    expect(unknown.status).toBe(400)
    const badParams = await request(asAdmin.http.url, `${asAdmin.base}/rules/R1`, { method: 'PUT', body: { params: { for: 'nonsense' } } })
    expect(badParams.status).toBe(400)
    const wrongMethod = await request(asAdmin.http.url, `${asAdmin.base}/rules`, { method: 'PUT', body: {} })
    expect(wrongMethod.status).toBe(405)
  })

  test('the settings routes answer 404 while the flag is off', async () => {
    const off = await serveAutomation({ flagOn: false })
    expect((await request(off.http.url, `${off.base}/rules`)).status).toBe(404)
    expect((await request(off.http.url, `${off.base}/executions`)).status).toBe(404)
  })

  test('GET /automation/executions exposes history and the skip reason; retry is admin-only', async () => {
    const { workspaceId, store, rules } = setup()
    const record: RuleExecutionRecord = {
      ruleExecutionId: randomUUID(), workspaceId, ruleId: 'R1', idempotencyKey: 'R1:event-1:single:principal-mark',
      sourceEventId: 'evt-1', status: 'skipped', steps: [], attempts: 1, lastError: skipMarker('all_day'),
      createdAt: NOW, finishedAt: NOW,
    }
    await store.claim(record)
    const owner = actor([workspaceId])
    const { resolver } = fakeResolver(owner)
    const http = await serve({ authority: unusedAuthority, actorResolver: resolver, automation: { rules, enabled: () => rules.enabled() } })
    closers.push(http.close)
    const base = `/v1/workspaces/${workspaceId}/automation`
    const baseGet = (path: string) => request(http.url, path)
    const history = await baseGet(`${base}/executions?limit=10`)
    expect(history.status).toBe(200)
    expect(history.body.executions[0]).toMatchObject({ ruleId: 'R1', status: 'skipped', skippedReason: 'all_day', attempts: 1 })
    expect(history.body.executions[0].steps).toEqual([])

    const retry = await request(http.url, `${base}/executions/${encodeURIComponent(record.idempotencyKey)}/retry`, { method: 'POST' })
    expect(retry.status).toBe(200)
    expect(retry.body).toMatchObject({ key: record.idempotencyKey, status: 'skipped', steps: 0 })
    const missing = await request(http.url, `${base}/executions/nope/retry`, { method: 'POST' })
    expect(missing.status).toBe(404)
    const badLimit = await baseGet(`${base}/executions?limit=0`)
    expect(badLimit.status).toBe(400)
  })

  test('metrics carry fixed labels only', async () => {
    const { workspaceId, rules } = setup()
    await rules.sink([event(workspaceId)])
    const snapshot: Readonly<Record<string, number>> = rules.snapshot()
    for (const key of Object.keys(snapshot)) {
      expect(key).not.toContain(workspaceId)
      expect(key).toMatch(/^rule_[a-z_]+\|/)
    }
    expect(snapshot['rule_executions_total|rule=R1|status=succeeded']).toBe(1)
    expect(Object.keys(snapshot).some(key => key.startsWith('rule_step_latency_ms|rule=R1|'))).toBe(true)
  })

  test('an unknown workspace without a dispatcher never runs', async () => {
    const rules: WorkspaceRulesRuntime = createWorkspaceRules({
      database: unusedDatabase,
      schema: 'public',
      storeFor: () => new InMemoryRulesStore(),
      dispatchFor: () => null,
      isFlagEnabled: () => true,
      onError: () => {},
    })
    await rules.sink([event(randomUUID())])
    expect(rules.snapshot()).toEqual({})
    rules.close()
  })
})