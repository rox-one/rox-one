/**
 * W1-06 (#1503) — Reference handlers on the workspace authority over
 * PostgreSQL: the full W1-05 DDL is migrated into a throwaway schema and the
 * whole command scenario runs through `PostgresCommandStore`, so W1-05
 * table rows, snapshot events, conflicts and constraint mapping are
 * exercised for real. Needs `ROX_TEST_PG_URL` or `initdb`/`pg_ctl` on PATH;
 * skipped otherwise (`ROX_TEST_PG_REQUIRED=1` fails instead).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CommandRegistry, registerCommandCatalogue } from '@rox/core/commands'
import { applyWorkspaceMigrations, compareMigrationNames, migrationFromSource } from '../src/database/migrations.ts'
import { PostgresCommandStore } from '../src/modules/commands/store.ts'
import { InMemoryCommandStore } from '../../../packages/server-core/src/commands/store.ts'
import { boundCommandTypes } from '../../../packages/server-core/src/commands/registry.ts'
import { AGENTS_COMMAND_MODULE } from '../../../packages/server-core/src/agents/module.ts'
import { PostgresRecordBackend, configureReferenceRuntime, resetPostgresReferenceMeta, resetReferenceMemory, resetReferenceRuntime } from '../../../packages/server-core/src/work/reference/index.ts'
import { createHarness } from '../../../packages/server-core/src/work/__tests__/reference-harness.ts'
import { ACTOR_ID, BOB, REFERENCE_SCENARIO, U, WORKSPACE_ID, type ScenarioStep } from '../../../packages/server-core/src/work/__tests__/reference-scenario.ts'

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))
const NOW = new Date('2026-10-08T12:00:00.000Z')

/**
 * W1-11 (#1508, merged as #1623) — the agent-governance module binds its own
 * handlers for these command types (`packages/server-core/src/agents/module.ts:54-69`),
 * and `packages/server-core/src/commands/registry.ts:50` lists
 * `AGENTS_COMMAND_MODULE` before `REFERENCE_COMMAND_MODULE`, so the reference
 * module skips any type that already has a handler
 * (`packages/server-core/src/work/reference/module.ts:126`).
 *
 * Those handlers run on the agent-governance runtime (`getAgentsRuntime` in
 * `agents/runtime.ts`), which this reference harness never backs with the W1-05
 * schema, so their scenario steps can never apply here ("Unknown workspace /
 * Unknown chat / Unknown agent"). The list is asserted against the live module
 * below, so a future ownership change fails this suite instead of silently
 * shrinking the scenario's coverage.
 */
const W1_11_OWNED_TYPES: readonly string[] = [
  'workspaces.create',
  'people.invite',
  'identity.ensure_placeholder',
  'identity.activate_placeholder',
  'identity.merge_placeholder',
  'im.create_chat',
  'im.join_chat',
  'im.leave_chat',
  'im.set_visibility',
  'im.browse_public_chats',
  'agents.provision_personal_agent',
  'agents.invoke',
  'agents.decide_approval',
  'agents.pause',
]

/** The channel built by the W1-11-owned `im.create_chat`: the reference store never gains it. */
const W1_11_OWNED_CHAT = U('chat')

/**
 * True for a scenario step the reference engine does not own today: W1-11 bound
 * the type itself, or the step is scoped to (targets, or delivers into via
 * `toChatId`) the channel whose creation W1-11 owns. Every other step still has
 * to apply — the assertion stays strict for the reference-owned remainder.
 */
function isW1_11Shadow(step: ScenarioStep): boolean {
  if (W1_11_OWNED_TYPES.includes(step.type)) return true
  if (step.target?.kind === 'channel' && step.target.id === W1_11_OWNED_CHAT) return true
  return step.payload.toChatId === W1_11_OWNED_CHAT
}

/** The reference-owned remainder of the scenario: what must apply against the W1-05 schema. */
const REFERENCE_OWNED_SCENARIO = REFERENCE_SCENARIO.filter(step => !isW1_11Shadow(step))

interface TestDatabase { url: string; cleanup: () => Promise<void> }

async function tryConnect(url: string): Promise<boolean> {
  const db = new SQL(url)
  try { await db`SELECT 1`; return true } catch { return false } finally { await db.close().catch(() => {}) }
}

function which(name: string): string | null {
  const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' })
  return found.stdout?.trim() || null
}

async function startTempPostgres(): Promise<TestDatabase | null> {
  const initdb = which('initdb')
  const pgctl = which('pg_ctl')
  if (!initdb || !pgctl) return null
  const dir = await mkdtemp(join(tmpdir(), 'w106-pg-'))
  const data = join(dir, 'data')
  const cleanup = async () => {
    spawnSync(pgctl, ['-D', data, 'stop', '-m', 'fast'], { encoding: 'utf8' })
    await rm(dir, { recursive: true, force: true })
  }
  if (spawnSync(initdb, ['-D', data, '-U', 'postgres', '--auth=trust'], { encoding: 'utf8' }).status !== 0) { await cleanup(); return null }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const port = 47300 + (process.pid % 2000) + attempt
    const run = spawnSync(pgctl, ['-D', data, '-w', '-o', `-k ${dir} -p ${port} -c listen_addresses='127.0.0.1'`, '-l', join(dir, 'log'), 'start'], { encoding: 'utf8' })
    if (run.status !== 0) { spawnSync(pgctl, ['-D', data, 'stop', '-m', 'fast'], { encoding: 'utf8' }); continue }
    const url = `postgres://postgres@127.0.0.1:${port}/postgres`
    if (await tryConnect(url)) return { url, cleanup }
    spawnSync(pgctl, ['-D', data, 'stop', '-m', 'fast'], { encoding: 'utf8' })
  }
  await cleanup()
  return null
}

async function resolveDatabase(): Promise<TestDatabase | null> {
  const url = process.env.ROX_TEST_PG_URL
  if (url && await tryConnect(url)) return { url, cleanup: async () => {} }
  return startTempPostgres()
}

const testDb = await resolveDatabase()
if (!testDb && process.env.ROX_TEST_PG_REQUIRED === '1') throw new Error('ROX_TEST_PG_REQUIRED=1 but no Postgres is available')
if (!testDb) console.log('[w1-06] no Postgres available: reference-handler PG tests skip')
const itDb = testDb ? test : test.skip

let db: SQL
let schema: string

beforeEach(async () => {
  resetReferenceMemory()
  configureReferenceRuntime({ now: () => NOW })
  if (!testDb) return
  db = new SQL(testDb.url)
  schema = `w106_${randomBytes(4).toString('hex')}`
  await db.unsafe(`CREATE SCHEMA "${schema}"`)
  const names = (await readdir(MIGRATIONS_DIR)).filter(n => n.endsWith('.sql')).sort(compareMigrationNames)
  const migrations = await Promise.all(names.map(async name => migrationFromSource(name, await readFile(join(MIGRATIONS_DIR, name), 'utf8'))))
  await applyWorkspaceMigrations(db, migrations, schema)
  for (const id of [ACTOR_ID, BOB]) await db.unsafe(`INSERT INTO "${schema}".principal (principal_id) VALUES ($1)`, [id])
  await db.unsafe(`INSERT INTO "${schema}".workspace (workspace_id, owner_principal_id, name) VALUES ($1, $2, 'Reference')`, [WORKSPACE_ID, ACTOR_ID])
}, 120000)

afterEach(async () => {
  resetReferenceRuntime()
  resetPostgresReferenceMeta()
  if (!testDb) return
  await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
  await db.close()
})

afterAll(async () => { await testDb?.cleanup() })

function pgHarness() {
  return createHarness({ local: new InMemoryCommandStore(), workspace: new PostgresCommandStore(db, schema), onError: (error, type) => console.error(`[w1-06] ${type}:`, (error as Error)?.message ?? error) })
}

// Guards the exclusion above: the reference harness only skips what W1-11
// really claims. If the module starts or stops binding one of these types,
// this fails so the exclusion is reviewed instead of quietly drifting. It is
// pure wiring, so it runs (and applies no schema) even without a database.
test('the W1-11 ownership exclusion matches what the module binds today', () => {
  const probe = new CommandRegistry()
  registerCommandCatalogue(probe)
  AGENTS_COMMAND_MODULE.bind(probe)
  expect(boundCommandTypes(probe)).toEqual([...W1_11_OWNED_TYPES].sort())
  // The channel scope is only justified while W1-11 owns chat creation.
  expect(W1_11_OWNED_TYPES).toContain('im.create_chat')
  expect(REFERENCE_OWNED_SCENARIO.length).toBeLessThan(REFERENCE_SCENARIO.length)
})

describe('W1-06 reference handlers over PostgreSQL (skips without a database)', () => {
  itDb('every workspace / by-target command applies against the W1-05 schema', async () => {
    const harness = pgHarness()
    const failures: string[] = []
    // Only the reference-owned remainder is asserted; the W1-11 shadow (its own
    // command types and the channel it creates) is excluded with a documented
    // rationale — see W1_11_OWNED_TYPES / isW1_11Shadow above.
    for (const step of REFERENCE_OWNED_SCENARIO) {
      const receipt = await harness.run(step)
      if (receipt.status !== 'applied') failures.push(`${step.type}: ${JSON.stringify(receipt.error ?? receipt)}`)
    }
    expect(failures).toEqual([])
    const [task] = await db.unsafe<{ title: string; status_key: string; owner_principal_id: string; notes_md: string }[]>(
      `SELECT title, status_key, owner_principal_id, notes_md FROM "${schema}".work_item WHERE work_item_id = $1`, [U('task')])
    expect(task).toMatchObject({ title: 'Write tests', owner_principal_id: ACTOR_ID, notes_md: 'details' })
    const [goal] = await db.unsafe<{ name: string }[]>(`SELECT name FROM "${schema}".goal WHERE goal_id = $1`, [U('goal')])
    expect(goal).toBeDefined()
    const [events] = await db.unsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM "${schema}".domain_event WHERE workspace_id = $1`, [WORKSPACE_ID])
    expect(Number(events!.count)).toBeGreaterThan(REFERENCE_SCENARIO.length / 2)
  }, 120000)

  itDb('stale revision is a conflict; a bad uuid is VALIDATION; a missing FK target is NOT_FOUND', async () => {
    const harness = pgHarness()
    expect(await harness.run({ type: 'tasks.create', payload: { id: U('pg-t'), title: 'v1' } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.update', target: { kind: 'task', id: U('pg-t') }, payload: { title: 'v2' } }, { expectedRevision: 1 })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.update', target: { kind: 'task', id: U('pg-t') }, payload: { title: 'v3' } }, { expectedRevision: 1 })).toMatchObject({ status: 'conflict' })
    expect(await harness.run({ type: 'tasks.update', target: { kind: 'task', id: 'not-a-uuid' }, payload: { title: 'x' } })).toMatchObject({ status: 'rejected' })
    expect(await harness.run({ type: 'kpis.create', payload: { name: 'K', spaceId: U('missing-space'), cadence: 'weekly', unit: 'n' } })).toMatchObject({ status: 'rejected', error: { code: 'NOT_FOUND' } })
    const [row] = await db.unsafe<{ title: string }[]>(`SELECT title FROM "${schema}".work_item WHERE work_item_id = $1`, [U('pg-t')])
    expect(row!.title).toBe('v2')
  }, 120000)

  /** Reads through the workspace backend (row + latest companion snapshot). */
  async function readTask(id: string) {
    return db.begin(async tx => new PostgresRecordBackend({ sql: tx, prefix: `"${schema}".`, workspaceId: WORKSPACE_ID, actorId: ACTOR_ID }).get('task', id))
  }

  itDb('fields without a work_item column round-trip through the companion snapshot', async () => {
    const harness = pgHarness()
    const id = U('pg-companion')
    const target = { kind: 'task' as const, id }
    expect(await harness.run({ type: 'task_lists.create', payload: { id: U('pg-list'), name: 'Sprint' } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.create', payload: { id, title: 'Companion', evening: true, list: 'today' } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.update_assignees', target, payload: { add: [BOB] } })).toMatchObject({ status: 'applied' })
    // A second add reads the first back (merge, not overwrite).
    expect(await harness.run({ type: 'tasks.update_assignees', target, payload: { add: [ACTOR_ID] } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.update_reminders', target, payload: { reminderAt: '2026-10-09T09:00:00.000Z', reminderTimeZone: 'Europe/Moscow', reminderOffsets: [15, 60] } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.share', target, payload: { workspaceId: U('pg-shared') } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.add_to_list', target, payload: { listId: U('pg-list') } })).toMatchObject({ status: 'applied' })
    expect(await harness.run({ type: 'tasks.move', target, payload: { sectionId: U('pg-section') } })).toMatchObject({ status: 'applied' })
    const task = await readTask(id)
    expect(task!.data).toMatchObject({
      title: 'Companion', evening: true, list: 'today', assigneeIds: [BOB, ACTOR_ID], reminderAt: '2026-10-09T09:00:00.000Z', reminderTimeZone: 'Europe/Moscow',
      reminderOffsets: [15, 60], sharedWorkspaceId: U('pg-shared'), listId: U('pg-list'), sectionId: U('pg-section'), createdBy: ACTOR_ID,
    })
    expect(task!.data.lastCommandId).toBeUndefined()
    // Clearing a companion field sticks.
    expect(await harness.run({ type: 'tasks.move', target, payload: { sectionId: null } })).toMatchObject({ status: 'applied' })
    expect((await readTask(id))!.data.sectionId).toBeUndefined()
    const [companion] = await db.unsafe<{ payload: { companion?: boolean; revision: number; record: Record<string, unknown> } }[]>(
      `SELECT payload FROM "${schema}".domain_event WHERE subject_kind = 'task' AND subject_id = $1 AND type = 'reference.record_written' ORDER BY sequence DESC LIMIT 1`, [id])
    expect(companion!.payload).toMatchObject({ companion: true, revision: (await readTask(id))!.revision })
    expect(companion!.payload.record.title).toBeUndefined()
  }, 120000)

  itDb('create_from_* keeps origin in origin_ref and the rest in the companion', async () => {
    const harness = pgHarness()
    const fromMessage = await harness.run({ type: 'tasks.create_from_message', payload: { id: U('pg-from-msg'), chatId: U('pg-chat'), seq: 3, assigneeIds: [BOB] } })
    expect(fromMessage).toMatchObject({ status: 'applied' })
    const fromSelection = await harness.run({ type: 'tasks.create_from_selection', payload: { id: U('pg-from-sel'), docRef: { kind: 'note', id: U('pg-doc') }, blockId: 'b1', text: 'Do it' } })
    expect(fromSelection).toMatchObject({ status: 'applied' })
    const rows = await db.unsafe<{ work_item_id: string; origin_ref: string }[]>(`SELECT work_item_id, origin_ref FROM "${schema}".work_item WHERE work_item_id IN ($1, $2) ORDER BY origin_ref`, [U('pg-from-msg'), U('pg-from-sel')])
    expect(rows.map(r => r.origin_ref)).toEqual([`channel-message:${U('pg-chat')}:3`, `note:${U('pg-doc')}#block-b1`])
    expect((await readTask(U('pg-from-msg')))!.data).toMatchObject({ origin: { kind: 'channel-message', id: `${U('pg-chat')}:3` }, assigneeIds: [BOB] })
    expect((await readTask(U('pg-from-sel')))!.data).toMatchObject({ origin: { kind: 'note', id: U('pg-doc'), fragment: 'block-b1' }, title: 'Do it' })
  }, 120000)

  itDb('a create conflict returns only the revision; deleting a referenced row is VALIDATION, not INTERNAL', async () => {
    const harness = pgHarness()
    expect(await harness.run({ type: 'tasks.create', payload: { id: U('pg-dup'), title: 'Private title' } })).toMatchObject({ status: 'applied' })
    const dup = await harness.run({ type: 'tasks.create', payload: { id: U('pg-dup'), title: 'x' } })
    expect(dup).toMatchObject({ status: 'conflict', conflict: { currentRevision: 1, current: { error: 'id already exists' } } })
    expect(JSON.stringify(dup)).not.toContain('Private title')
    expect(await harness.run({ type: 'tasks.create', payload: { id: U('pg-child'), title: 'Child', parentId: U('pg-dup') } })).toMatchObject({ status: 'applied' })
    const hard = await harness.run({ type: 'tasks.delete', target: { kind: 'task', id: U('pg-dup') }, payload: { hard: true } })
    expect(hard).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION', message: expect.stringContaining('still referenced') } })
    const [row] = await db.unsafe<{ title: string }[]>(`SELECT title FROM "${schema}".work_item WHERE work_item_id = $1`, [U('pg-dup')])
    expect(row!.title).toBe('Private title')
  }, 120000)
})
