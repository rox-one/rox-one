/**
 * W1-12 (#1509) — the `automation_rule` / `rule_execution` tables of the real
 * W1-05 schema (`515-automation-rules.sql`), the Postgres store, and the
 * settings routes over it. Needs `ROX_TEST_PG_URL` or `ROX_TEST_PG_DOCKER=1`
 * (the shared `@rox/test-harness` fixture); skipped otherwise.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensurePostgres } from '@rox/test-harness'
import { skipMarker, type RuleExecutionRecord } from '../../../packages/core/src/automation/index.ts'
import { automationRulesResponseSchema, ruleExecutionsResponseSchema } from '../../../packages/shared/src/automation/index.ts'
import type { SharedProjectAuthority } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { applyWorkspaceMigrations, compareMigrationNames, migrationFromSource } from '../src/database/migrations.ts'
import { PostgresRulesStore } from '../src/modules/rules/store.ts'
import { createWorkspaceRules } from '../src/modules/rules/runtime.ts'
import { actor, fakeResolver, request, serve } from './helpers.ts'

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))
const NOW = '2026-10-08T09:00:00.000Z'

const fixture = await ensurePostgres()
if (fixture.status !== 'live') console.log(`[w1-12] no Postgres available: rules PG tests skip (${fixture.reason ?? 'no database'})`)
const itDb = fixture.status === 'live' ? test : test.skip

/** Never touched: these tests build routes/runtimes with an injected store. */
const unusedAuthority = new Proxy({}, { get: () => () => { throw new Error('not used') } }) as SharedProjectAuthority

let db: SQL
let schema: string
let workspaceId: string
let ownerId: string

beforeEach(async () => {
  if (fixture.status !== 'live') return
  db = new SQL(fixture.url!)
  schema = `w112_${randomBytes(4).toString('hex')}`
  workspaceId = crypto.randomUUID()
  ownerId = crypto.randomUUID()
  await db.unsafe(`CREATE SCHEMA "${schema}"`)
  const names = (await readdir(MIGRATIONS_DIR)).filter(name => name.endsWith('.sql')).sort(compareMigrationNames)
  const migrations = await Promise.all(names.map(async name => migrationFromSource(name, await readFile(join(MIGRATIONS_DIR, name), 'utf8'))))
  await applyWorkspaceMigrations(db, migrations, schema)
  await db.unsafe(`INSERT INTO "${schema}".principal (principal_id) VALUES ($1)`, [ownerId])
  await db.unsafe(`INSERT INTO "${schema}".workspace (workspace_id, owner_principal_id, name) VALUES ($1, $2, 'Rules')`, [workspaceId, ownerId])
  await db.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id, principal_id, role) VALUES ($1, $2, 'owner')`, [workspaceId, ownerId])
}, 120_000)

afterEach(async () => {
  if (fixture.status !== 'live') return
  await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
  await db.close()
})

afterAll(async () => { await fixture.cleanup?.() })

function execution(key: string, overrides: Partial<RuleExecutionRecord> = {}): RuleExecutionRecord {
  return {
    ruleExecutionId: crypto.randomUUID(),
    workspaceId,
    ruleId: 'R1',
    idempotencyKey: key,
    sourceEventId: crypto.randomUUID(),
    status: 'running',
    steps: [{ action: 'ensure-daily-note', command_id: `${key}:ensure-daily-note`, status: 'pending', plan: { type: 'docs.ensure_daily_note', payload: { date: '2026-10-09' }, actor: 'system', subject: ownerId } }],
    attempts: 1,
    createdAt: NOW,
    ...overrides,
  }
}

describe('W1-12 rules over PostgreSQL (skips without a database)', () => {
  itDb('claim is idempotent on the idempotency key and the row round-trips', async () => {
    const store = new PostgresRulesStore(db, schema)
    const first = await store.claim(execution('R1:event-1:single:owner'))
    expect(first.inserted).toBe(true)
    const second = await store.claim(execution('R1:event-1:single:owner'))
    expect(second.inserted).toBe(false)
    expect(second.execution).toMatchObject({ ruleId: 'R1', status: 'running', attempts: 1 })
    expect(second.execution.idempotencyKey).toBe('R1:event-1:single:owner')
    expect(second.execution.steps[0]).toMatchObject({ action: 'ensure-daily-note', status: 'pending' })
    expect(second.execution.steps[0]!.plan).toMatchObject({ type: 'docs.ensure_daily_note', subject: ownerId })

    const [row] = await db.unsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM "${schema}".rule_execution`)
    expect(Number(row!.count)).toBe(1)
  })

  itDb('save / get / list / pending follow the stored steps and statuses', async () => {
    const store = new PostgresRulesStore(db, schema)
    const record = execution('R1:a:single:owner')
    await store.claim(record)
    const skipped = execution('R1:b:single:owner', { status: 'skipped', steps: [], lastError: skipMarker('all_day'), createdAt: '2026-10-08T10:00:00.000Z', finishedAt: '2026-10-08T10:00:00.000Z' })
    await store.claim(skipped)
    const failed = execution('R1:c:single:owner', { attempts: 4, status: 'failed', createdAt: '2026-10-08T11:00:00.000Z', finishedAt: '2026-10-08T11:00:00.000Z' })
    await store.claim(failed)

    const stored = await store.save({
      ...record,
      status: 'partially_succeeded',
      attempts: 2,
      steps: [{ action: 'ensure-daily-note', command_id: 'R1:a:single:owner:ensure-daily-note', status: 'failed', error: 'FORBIDDEN', attempts: 2, duration_ms: 3, finished_at: NOW }],
      finishedAt: NOW,
    })
    expect(stored).toBeUndefined()
    const read = await store.get(workspaceId, 'R1:a:single:owner')
    expect(read).toMatchObject({ status: 'partially_succeeded', attempts: 2, finishedAt: NOW })
    expect(read!.steps[0]).toMatchObject({ status: 'failed', error: 'FORBIDDEN', attempts: 2 })

    expect((await store.list(workspaceId, { ruleId: 'R1' })).map(item => item.idempotencyKey).sort())
      .toEqual(['R1:a:single:owner', 'R1:b:single:owner', 'R1:c:single:owner'])
    expect((await store.list(workspaceId, { status: 'skipped' })).map(item => item.idempotencyKey)).toEqual(['R1:b:single:owner'])
    // `pending` is what a restart may re-drive: `running` / `failed` only —
    // a `partially_succeeded` execution has no step left to run.
    expect((await store.pending(workspaceId)).map(item => item.idempotencyKey)).toEqual(['R1:c:single:owner'])
    expect(await store.get(workspaceId, 'missing')).toBeNull()
  })

  itDb('automation_rule upserts on the COALESCE(principal_id) unique index', async () => {
    const store = new PostgresRulesStore(db, schema)
    const workspaceRow = {
      automationRuleId: crypto.randomUUID(), ruleId: 'R2', workspaceId, enabled: true,
      params: { announce: true }, scope: 'workspace' as const, principalId: null, updatedBy: ownerId, updatedAt: NOW,
    }
    expect(await store.upsert(workspaceRow)).toMatchObject({ ruleId: 'R2', scope: 'workspace', enabled: true })
    const updated = await store.upsert({ ...workspaceRow, automationRuleId: crypto.randomUUID(), enabled: false, params: { announce: false } })
    expect(updated).toMatchObject({ enabled: false, params: { announce: false } })
    expect((await store.listSettings(workspaceId))).toHaveLength(1)

    const principalRow = { ...workspaceRow, automationRuleId: crypto.randomUUID(), scope: 'principal' as const, principalId: ownerId, enabled: false, params: { skipAllDay: false } }
    await store.upsert(principalRow)
    expect(await store.read(workspaceId, 'R2', ownerId)).toMatchObject({ scope: 'principal', enabled: false })
    expect(await store.read(workspaceId, 'R2', null)).toMatchObject({ scope: 'workspace', enabled: false })
    expect(await store.read(workspaceId, 'R5', null)).toBeNull()
    expect(await store.memberRole(workspaceId, ownerId)).toBe('owner')
    expect(await store.memberRole(workspaceId, crypto.randomUUID())).toBeNull()
  })

  itDb('the consumer group persists executions and the settings routes read them back', async () => {
    const store = new PostgresRulesStore(db, schema)
    const dispatched: string[] = []
    const rules = createWorkspaceRules({
      database: db,
      schema,
      storeFor: () => store,
      dispatchFor: () => async input => {
        dispatched.push(input.envelope.type)
        return { commandId: input.envelope.commandId, status: 'applied' as const }
      },
      isFlagEnabled: () => true,
      now: () => new Date(NOW),
    })
    await rules.sink([{
      eventId: crypto.randomUUID(),
      workspaceId,
      type: 'calendar.event_created',
      subject: { kind: 'calendar-event', id: 'event-1' },
      aggregateRevision: 1,
      payload: {
        event: {
          ref: { kind: 'calendar-event', id: 'event-1' }, calendarId: 'calendar-1', title: 'Планёрка',
          startAt: '2026-10-09T07:00:00.000Z', endAt: '2026-10-09T07:30:00.000Z', allDay: false, organizerId: ownerId,
        },
      },
      createdAt: NOW,
    }])
    expect(dispatched).toHaveLength(8)
    const [row] = await db.unsafe<{ status: string; steps: Array<{ action: string }> }[]>(
      `SELECT status, steps FROM "${schema}".rule_execution WHERE workspace_id = $1`, [workspaceId])
    expect(row!.status).toBe('succeeded')
    expect(Array.isArray(row!.steps) ? row!.steps.length : JSON.parse(String(row!.steps)).length).toBe(8)

    const owner = actor([workspaceId], ownerId)
    const { resolver } = fakeResolver(owner)
    const http = await serve({ authority: unusedAuthority, actorResolver: resolver, automation: { rules, enabled: () => rules.enabled() } })
    const base = `/v1/workspaces/${workspaceId}/automation`
    const list = await request(http.url, `${base}/rules`)
    expect(list.status).toBe(200)
    const listBody = automationRulesResponseSchema.parse(list.body)
    const r1 = listBody.rules.find(rule => rule.ruleId === 'R1')!
    expect(r1).toMatchObject({ scope: 'principal' })

    const put = await request(http.url, `${base}/rules/R1`, { method: 'PUT', body: { enabled: false } })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ ruleId: 'R1', enabled: false, source: 'principal' })
    const [settings] = await db.unsafe<{ enabled: boolean; scope: string }[]>(
      `SELECT enabled, scope FROM "${schema}".automation_rule WHERE workspace_id = $1 AND rule_id = 'R1'`, [workspaceId])
    expect(settings).toMatchObject({ enabled: false, scope: 'principal' })

    const history = await request(http.url, `${base}/executions?limit=5`)
    expect(history.status).toBe(200)
    const historyBody = ruleExecutionsResponseSchema.parse(history.body)
    expect(historyBody.executions[0]).toMatchObject({ ruleId: 'R1', status: 'succeeded', attempts: 1 })
    expect(historyBody.executions[0]!.steps).toHaveLength(8)

    const retry = await request(http.url, `${base}/executions/${encodeURIComponent('R1:event-1:single:' + ownerId)}/retry`, { method: 'POST' })
    expect(retry.status).toBe(200)
    expect(retry.body).toMatchObject({ status: 'succeeded', steps: 8 })
    await http.close()
    rules.close()
  }, 60_000)
})