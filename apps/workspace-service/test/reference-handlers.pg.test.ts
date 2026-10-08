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
import { applyWorkspaceMigrations, compareMigrationNames, migrationFromSource } from '../src/database/migrations.ts'
import { PostgresCommandStore } from '../src/modules/commands/store.ts'
import { InMemoryCommandStore } from '../../../packages/server-core/src/commands/store.ts'
import { configureReferenceRuntime, resetPostgresReferenceMeta, resetReferenceMemory, resetReferenceRuntime } from '../../../packages/server-core/src/work/reference/index.ts'
import { createHarness } from '../../../packages/server-core/src/work/__tests__/reference-harness.ts'
import { ACTOR_ID, BOB, REFERENCE_SCENARIO, U, WORKSPACE_ID } from '../../../packages/server-core/src/work/__tests__/reference-scenario.ts'

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))
const NOW = new Date('2026-10-08T12:00:00.000Z')

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

describe('W1-06 reference handlers over PostgreSQL (skips without a database)', () => {
  itDb('every workspace / by-target command applies against the W1-05 schema', async () => {
    const harness = pgHarness()
    const failures: string[] = []
    for (const step of REFERENCE_SCENARIO) {
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
})
