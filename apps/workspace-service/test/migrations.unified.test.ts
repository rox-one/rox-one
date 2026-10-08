// W1-05 (issue #1502) · unified server DDL migration tests.
// Static inventory / ordering / FK-target / enum checks always run.
// Migrate-up runs need Postgres: ROX_TEST_PG_URL, else a temp initdb cluster
// (initdb/pg_ctl on PATH), else the DB block is skipped. Tests never read real
// dot-configs. Set ROX_TEST_PG_REQUIRED=1 (CI) to fail instead of skipping.
import { describe, expect, test, afterAll } from 'bun:test'
import { SQL } from 'bun'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyWorkspaceMigrations, compareMigrationNames, migrationFromSource } from '../src/database/migrations'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../src/server'

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))

// Spec number -> on-disk name (migrations/README.md). Spec 40-tables (#1295) has no
// slot here: it must land as 553+ (see LOCKED_MIGRATIONS below).
const EXPECTED_FILES = [
  '502-directory.sql', '503-acl.sql', '504-files.sql', '505-events.sql', '506-notify.sql',
  '507-search.sql', '508-social.sql', '509-spaces.sql', '510-docs.sql', '511-drive-wiki.sql',
  '512-im.sql', '513-identity-lifecycle.sql', '514-agent-governance.sql', '515-automation-rules.sql',
  '516-drive-quota.sql', '517-collab.sql', '520-work-item.sql', '521-calendar.sql', '522-goals.sql',
  '523-projects.sql', '524-check-ins-reviews.sql', '525-kpi.sql', '526-templates.sql', '530-vc.sql',
  '551-workplace.sql', '552-mail.sql',
]

// Every migration that exists today, in sorted order. Databases apply them as an exact
// sorted prefix, so a new file must sort after the last entry here (553+), never in
// the middle (a 540-* or 40-* file would break every DB that already applied 551/552).
// When adding a migration, append its name here in the same change.
const LOCKED_MIGRATIONS = [
  '01-domain-contract.sql', '01-local-auth-bootstrap.sql', '48-license-audit.sql', ...EXPECTED_FILES,
] as const

/** Names that are not locked yet but sort before the last locked one (order-conflict traps). */
function migrationsSortingIntoLockedHistory(names: readonly string[]): string[] {
  const locked = new Set<string>(LOCKED_MIGRATIONS)
  const last = [...LOCKED_MIGRATIONS].sort(compareMigrationNames).at(-1)!
  return names.filter(name => !locked.has(name) && compareMigrationNames(name, last) <= 0)
}

// Tables that already exist from 01-domain-contract / 01-local-auth-bootstrap / 48-license-audit.
const BASE_TABLES = new Set([
  'principal', 'auth_subject_alias', 'workspace', 'workspace_member', 'project',
  'project_create_receipt', 'project_event', 'project_event_inbox', 'project_projection_watermark',
  'project_query_cursor', 'bootstrap_auth_credential', 'bootstrap_auth_session',
  'license_component', 'license_audit_receipt',
])

// REFERENCES whose target sorts later; the FK is added in the noted file instead.
const DEFERRED_FKS: Array<{ from: string; to: string; addedIn: string }> = [
  { from: 'space', to: 'chat', addedIn: '512-im.sql' },
  { from: 'space', to: 'folder', addedIn: '512-im.sql' },
  { from: 'space', to: 'wiki_space', addedIn: '512-im.sql' },
  { from: 'file_object', to: 'drive', addedIn: '516-drive-quota.sql' },
  { from: 'calendar_member', to: 'calendar', addedIn: '521-calendar.sql' },
]

async function loadSources(): Promise<Map<string, string>> {
  const names = (await readdir(MIGRATIONS_DIR)).filter(n => n.endsWith('.sql'))
  const out = new Map<string, string>()
  for (const name of names) out.set(name, await readFile(join(MIGRATIONS_DIR, name), 'utf8'))
  return out
}

function sortedNames(sources: Map<string, string>): string[] {
  return [...sources.keys()].sort(compareMigrationNames)
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

function createdTables(sql: string): string[] {
  const names: string[] = []
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi
  let m: RegExpExecArray | null
  const clean = stripComments(sql)
  while ((m = re.exec(clean)) !== null) names.push(m[2].toLowerCase())
  return names
}

function referencedTables(sql: string): string[] {
  const names: string[] = []
  const re = /REFERENCES\s+(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?\s*(?:\(|$|[,;\s])/gi
  let m: RegExpExecArray | null
  const clean = stripComments(sql)
  while ((m = re.exec(clean)) !== null) names.push(m[1].toLowerCase())
  return names
}

function alteredTables(sql: string): string[] {
  const names: string[] = []
  const re = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?/gi
  let m: RegExpExecArray | null
  const clean = stripComments(sql)
  while ((m = re.exec(clean)) !== null) names.push(m[1].toLowerCase())
  return names
}

/** Whitespace-insensitive contains for CHECK enum assertions. */
function containsCompact(haystack: string, needle: string): boolean {
  return haystack.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))
}

describe('W1-05 unified DDL static checks (no DB required)', () => {
  test('all 26 files exist and sort after 48-license-audit.sql', async () => {
    const sources = await loadSources()
    const sorted = sortedNames(sources)
    const pivot = sorted.indexOf('48-license-audit.sql')
    expect(pivot).toBeGreaterThan(-1)
    for (const name of EXPECTED_FILES) {
      expect(sources.has(name), name).toBe(true)
      expect(sorted.indexOf(name), name).toBeGreaterThan(pivot)
    }
  })

  test('locked migrations are an exact sorted prefix; any new file sorts after the last one (553+)', async () => {
    const sorted = sortedNames(await loadSources())
    expect(sorted.slice(0, LOCKED_MIGRATIONS.length)).toEqual([...LOCKED_MIGRATIONS].sort(compareMigrationNames))
    expect(migrationsSortingIntoLockedHistory(sorted)).toEqual([])
  })

  test('the 553+ guard rejects mid-sequence names (#1295/#1314 tables)', () => {
    expect(migrationsSortingIntoLockedHistory(['540-tables.sql', '40-tables.sql', '02-directory.sql', '552-a-late.sql']))
      .toEqual(['540-tables.sql', '40-tables.sql', '02-directory.sql', '552-a-late.sql'])
    expect(migrationsSortingIntoLockedHistory(['553-tables.sql', '554-sheets.sql', '1000-later.sql'])).toEqual([])
  })

  test('the packaged service ships every migration the runtime loads', async () => {
    const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')) as { scripts: Record<string, string> }
    const script = pkg.scripts['workspace-service:package'] ?? ''
    for (const name of sortedNames(await loadSources())) expect(script, name).toContain(`migrations/${name}`)
  })

  test('every file parses as a migration (name + non-empty SQL)', async () => {
    const sources = await loadSources()
    for (const name of EXPECTED_FILES) {
      const parsed = migrationFromSource(name, sources.get(name)!)
      expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test('sort order keeps every new file after 48-license-audit.sql', async () => {
    const sources = await loadSources()
    const sorted = sortedNames(sources)
    const pivot = sorted.indexOf('48-license-audit.sql')
    expect(pivot).toBeGreaterThan(-1)
    for (const name of EXPECTED_FILES) expect(sorted.indexOf(name)).toBeGreaterThan(pivot)
  })

  test('94 new tables across the 26 files (103 with #1295 tables file, 553+)', async () => {
    const sources = await loadSources()
    const tables = EXPECTED_FILES.flatMap(n => createdTables(sources.get(n)!))
    expect(new Set(tables).size).toBe(tables.length)
    expect(tables.length).toBe(94)
  })

  test('every FK / ALTER target exists earlier in sort order (or is a documented deferral)', async () => {
    const sources = await loadSources()
    const sorted = sortedNames(sources)
    const definedBy = new Map<string, string>()
    for (const name of sorted) {
      for (const t of createdTables(sources.get(name)!)) {
        if (!definedBy.has(t)) definedBy.set(t, name)
      }
    }
    const definedAt = (table: string): number => {
      if (BASE_TABLES.has(table)) return -1
      const at = definedBy.get(table)
      if (at === undefined) return Number.POSITIVE_INFINITY
      return sorted.indexOf(at)
    }
    for (const [index, name] of sorted.entries()) {
      if (!EXPECTED_FILES.includes(name)) continue
      const sql = sources.get(name)!
      for (const target of referencedTables(sql)) {
        if (target === 'rox_schema_migration') continue
        const okEarlier = definedAt(target) <= index
        const okDeferredLater = DEFERRED_FKS.some(d => d.to === target && sorted.indexOf(d.addedIn) > definedAt(d.from))
        expect(okEarlier || okDeferredLater, `${name} REFERENCES ${target}`).toBe(true)
      }
      for (const target of alteredTables(sql)) {
        expect(definedAt(target) < index, `${name} ALTERs ${target}`).toBe(true)
      }
    }
    // The deferrals themselves must resolve: each addedIn file really adds the FK.
    for (const d of DEFERRED_FKS) {
      const sql = sources.get(d.addedIn)!
      expect(sql).toContain(d.from)
      expect(definedAt(d.to)).toBeLessThanOrEqual(sorted.indexOf(d.addedIn))
    }
  })

  test('team-chat columns per D-v2-2 (DATA-MODEL §5.11)', async () => {
    const sources = await loadSources()
    const sql = sources.get('513-identity-lifecycle.sql')!
    for (const token of ['system_role', 'posting_policy', 'invite_policy', 'archived_at', 'chat_general_uniq', 'chat_general_public']) {
      expect(sql).toContain(token)
    }
    expect(containsCompact(sql, `CHECK (system_role IN ('general'))`)).toBe(true)
    expect(containsCompact(sql, `posting_policy IN ('all','admins')`)).toBe(true)
    expect(containsCompact(sql, `invite_policy IN ('members','admins')`)).toBe(true)
  })

  test('FTS configs russian + simple (+ english) and pg_trgm in 507', async () => {
    const sources = await loadSources()
    const sql = sources.get('507-search.sql')!
    expect(sql).toContain(`to_tsvector('russian'`)
    expect(sql).toContain(`to_tsvector('simple'`)
    expect(sql).toContain(`to_tsvector('english'`)
    expect(sql).toContain('gin_trgm_ops')
  })

  test('CHECK enum vocabulary matches the spec', async () => {
    const sources = await loadSources()
    const social = sources.get('508-social.sql')!
    for (const rel of ['parent', 'mentions', 'blocks', 'assigned', 'in-calendar', 'derived-from',
      'attached-to', 'member-of', 'embeds', 'relates-to', 'aligned-to', 'resource-of']) {
      expect(social).toContain(`'${rel}'`)
    }
    const notify = sources.get('506-notify.sql')!
    expect(notify).toContain(`'reminder_due'`)
    const gov = sources.get('514-agent-governance.sql')!
    expect(containsCompact(gov, `'routine','consequential','privileged'`)).toBe(true)
    expect(containsCompact(gov, `'pending','approved','rejected','expired','executed','failed'`)).toBe(true)
    const im = sources.get('512-im.sql')!
    expect(containsCompact(im, `'p2p','group','channel','topic_group','bot_p2p','space','entity'`)).toBe(true)
    const work = sources.get('520-work-item.sql')!
    expect(work).toContain(`'pending'`)
    expect(work).toContain(`'in_progress'`)
  })
})

// ---- database-gated tests ----

interface TestDatabase {
  url: string
  label: string
  cleanup: () => Promise<void>
}

async function tryConnect(url: string): Promise<SQL | null> {
  try {
    const db = new SQL(url)
    await db`SELECT 1`
    return db
  } catch {
    return null
  }
}

function whichBinary(name: string): string | null {
  const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' })
  const path = found.stdout?.trim()
  return path ? path : null
}

async function startTempPostgres(): Promise<TestDatabase | null> {
  const initdb = whichBinary('initdb')
  const pgctl = whichBinary('pg_ctl')
  if (!initdb || !pgctl) return null
  let dir: string
  try {
    dir = await mkdtemp(join(tmpdir(), 'w105-pg-'))
  } catch {
    return null
  }
  const data = join(dir, 'data')
  // Stop whatever this data dir may be running, then remove the temp dir.
  const teardown = async () => {
    spawnSync(pgctl, ['-D', data, 'stop', '-m', 'fast'], { encoding: 'utf8' })
    await rm(dir, { recursive: true, force: true })
  }
  try {
    const init = spawnSync(initdb, ['-D', data, '-U', 'postgres', '--auth=trust'], { encoding: 'utf8' })
    if (init.status !== 0) {
      await teardown()
      return null
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const port = 45200 + (process.pid % 2000) + attempt
      const run = spawnSync(pgctl, ['-D', data, '-w', '-o', `-k ${dir} -p ${port} -c listen_addresses='127.0.0.1'`, '-l', join(dir, 'log'), 'start'], { encoding: 'utf8' })
      if (run.status !== 0) {
        // A failed start may still leave a postmaster behind; stop it before the next port.
        spawnSync(pgctl, ['-D', data, 'stop', '-m', 'fast'], { encoding: 'utf8' })
        continue
      }
      const url = `postgres://postgres@127.0.0.1:${port}/postgres`
      const probe = await tryConnect(url)
      if (probe) {
        await probe.close()
        return { url, label: `temp initdb cluster (port ${port})`, cleanup: teardown }
      }
      // Started but unreachable: stop it, or it keeps the data dir locked and leaks.
      spawnSync(pgctl, ['-D', data, 'stop', '-m', 'fast'], { encoding: 'utf8' })
    }
    await teardown()
    return null
  } catch {
    await teardown().catch(() => {})
    return null
  }
}

async function resolveTestDatabase(): Promise<TestDatabase | null> {
  if (process.env.ROX_TEST_PG_URL) {
    const probe = await tryConnect(process.env.ROX_TEST_PG_URL)
    if (probe) {
      await probe.close()
      return { url: process.env.ROX_TEST_PG_URL, label: 'ROX_TEST_PG_URL', cleanup: async () => {} }
    }
    console.warn('[w1-05] ROX_TEST_PG_URL is set but did not answer SELECT 1; trying a temp initdb cluster')
  }
  return startTempPostgres()
}

// Top-level await: static tests above always run; the DB block below is gated.
const testDb = await resolveTestDatabase()
if (testDb) console.log(`[w1-05] migrate-up tests use ${testDb.label}`)
else if (process.env.ROX_TEST_PG_REQUIRED === '1') throw new Error('ROX_TEST_PG_REQUIRED=1 but no Postgres is available (set ROX_TEST_PG_URL or put initdb/pg_ctl on PATH)')
else console.log('[w1-05] no Postgres available (set ROX_TEST_PG_URL or put initdb/pg_ctl on PATH): migrate-up tests skip (static checks still ran)')
const itDb = testDb ? test : test.skip

afterAll(async () => {
  await testDb?.cleanup()
})

async function loadMigrations() {
  const names = (await readdir(MIGRATIONS_DIR)).filter(n => n.endsWith('.sql')).sort(compareMigrationNames)
  return Promise.all(names.map(async name => migrationFromSource(name, await readFile(join(MIGRATIONS_DIR, name), 'utf8'))))
}

const NIL = '00000000-0000-0000-0000-000000000000'
const BOT = '00000000-0000-0000-0000-000000000b07'

describe('W1-05 unified DDL migrate-up (Postgres; skips without a database)', () => {
  itDb('migrate up on an empty schema, then re-run is a no-op (run a)', async () => {
    const db = new SQL(testDb!.url)
    try {
      const schema = `w105_empty_${randomBytes(4).toString('hex')}`
      await db.unsafe(`CREATE SCHEMA "${schema}"`)
      try {
        const migrations = await loadMigrations()
        const first = await applyWorkspaceMigrations(db, migrations, schema)
        expect(first.applied.length).toBe(migrations.length)
        expect(first.retained).toEqual([])
        const replay = await applyWorkspaceMigrations(db, migrations, schema)
        expect(replay.applied).toEqual([])
        // Table inventory: every new table exists.
        const rows = await db.unsafe<{ tablename: string }[]>(
          `SELECT tablename FROM pg_tables WHERE schemaname = '${schema}' AND tablename <> 'rox_schema_migration'`)
        const names = new Set(rows.map(r => r.tablename))
        const sources = await loadSources()
        for (const file of EXPECTED_FILES) {
          for (const table of createdTables(sources.get(file)!)) {
            expect(names.has(table), `${file}:${table}`).toBe(true)
          }
        }
        // Seed rows: system bot principal + default status set.
        const bot = await db.unsafe<{ kind: string; status: string }[]>(
          `SELECT kind, status FROM "${schema}".principal WHERE principal_id = '${BOT}'`)
        expect(bot).toEqual([{ kind: 'bot', status: 'active' }])
        const statuses = await db.unsafe<{ key: string }[]>(
          `SELECT key FROM "${schema}".task_status WHERE workspace_id = '${NIL}' ORDER BY sort_key`)
        expect(statuses.map(s => s.key)).toEqual(['pending', 'in_progress', 'done', 'canceled'])
      } finally {
        await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      }
    } finally {
      await db.close()
    }
  }, 120000)

  itDb('migrate up on a copy of the current schema (01 + 48), then the new files (run b)', async () => {
    const db = new SQL(testDb!.url)
    try {
      const schema = `w105_staging_${randomBytes(4).toString('hex')}`
      await db.unsafe(`CREATE SCHEMA "${schema}"`)
      try {
        const migrations = await loadMigrations()
        const base = migrations.filter(m => m.name.startsWith('01-') || m.name.startsWith('48-'))
        expect(base.map(m => m.name).sort()).toEqual(['01-domain-contract.sql', '01-local-auth-bootstrap.sql', '48-license-audit.sql'])
        await applyWorkspaceMigrations(db, base, schema)
        const rest = await applyWorkspaceMigrations(db, migrations, schema)
        expect(rest.applied.length).toBe(migrations.length - base.length)
        const replay = await applyWorkspaceMigrations(db, migrations, schema)
        expect(replay.applied).toEqual([])
      } finally {
        await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      }
    } finally {
      await db.close()
    }
  }, 120000)

  itDb('startup loader: full sorted set; DBs bootstrapped by the old loader (01 only, or 01 + 48) upgrade without MIGRATION_ORDER_CONFLICT', async () => {
    const db = new SQL(testDb!.url)
    const loaded = await loadWorkspaceBootstrapMigrations(MIGRATIONS_DIR)
    const names = loaded.map(m => m.name)
    // Always: both 01-*, then 48 (unconditional), then every 5NN-* in sorted order.
    expect(names).toEqual([...LOCKED_MIGRATIONS].sort(compareMigrationNames))
    const newFiles = [...EXPECTED_FILES].sort(compareMigrationNames)
    const created: string[] = []
    try {
      for (const [label, history, expected] of [
        // Old loader without licenseRegistry recorded only the two 01-* files.
        ['no_registry', ['01-domain-contract.sql', '01-local-auth-bootstrap.sql'], ['48-license-audit.sql', ...newFiles]],
        // Old loader with licenseRegistry recorded 01 + 48.
        ['registry', ['01-domain-contract.sql', '01-local-auth-bootstrap.sql', '48-license-audit.sql'], newFiles],
      ] as const) {
        const schema = `w105_upgrade_${label}_${randomBytes(4).toString('hex')}`
        await db.unsafe(`CREATE SCHEMA "${schema}"`)
        created.push(schema)
        await applyWorkspaceMigrations(db, loaded.filter(m => (history as readonly string[]).includes(m.name)), schema)
        const upgraded = await applyWorkspaceMigrations(db, loaded, schema)
        expect(upgraded.retained).toEqual([...history])
        expect(upgraded.applied).toEqual([...expected])
        // Every later restart (licence registry on or off loads the same set) is a no-op.
        const restarted = await applyWorkspaceMigrations(db, await loadWorkspaceBootstrapMigrations(MIGRATIONS_DIR), schema)
        expect(restarted).toEqual({ applied: [], retained: names })
      }
    } finally {
      for (const schema of created) await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      await db.close()
    }
  }, 120000)

  itDb('createWorkspaceServer applies 48 and 502..552 at startup; restart is a no-op', async () => {
    const db = new SQL(testDb!.url, { max: 4 })
    const schema = `w105_startup_${randomBytes(4).toString('hex')}`
    const stateRoot = await mkdtemp(join(tmpdir(), 'w105-auth-'))
    await db.unsafe(`CREATE SCHEMA "${schema}"`)
    try {
      const migrations = await loadWorkspaceBootstrapMigrations(MIGRATIONS_DIR)
      const start = () => createWorkspaceServer({
        database: db, schema, migrations, host: '127.0.0.1', port: 0, serverId: `w105-${schema}`,
        authentication: { mode: 'local-bootstrap', configuration: {
          mode: 'local-bootstrap', issuer: `urn:rox:w105:${schema}`, audience: 'w105-test',
          stateDirectory: join(stateRoot, 'auth'), checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 300,
        } },
      })
      const first = await start()
      try {
        expect(first.migrations.retained).toEqual([])
        expect(first.migrations.applied).toEqual(migrations.map(m => m.name))
        expect(first.migrations.applied).toContain('48-license-audit.sql')
        for (const name of EXPECTED_FILES) expect(first.migrations.applied, name).toContain(name)
      } finally {
        await first.server.close()
      }
      const second = await start()
      try {
        expect(second.migrations).toEqual({ applied: [], retained: migrations.map(m => m.name) })
      } finally {
        await second.server.close()
      }
    } finally {
      await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      await db.close()
      await rm(stateRoot, { recursive: true, force: true })
    }
  }, 120000)

  itDb('event_attendee requires a principal or an email', async () => {
    const db = new SQL(testDb!.url)
    const schema = `w105_attendee_${randomBytes(4).toString('hex')}`
    await db.unsafe(`CREATE SCHEMA "${schema}"`)
    try {
      await applyWorkspaceMigrations(db, await loadMigrations(), schema)
      const { randomUUID } = await import('node:crypto')
      const [wsId, calId, eventId] = [randomUUID(), randomUUID(), randomUUID()]
      await db.unsafe(`INSERT INTO "${schema}".workspace (workspace_id, owner_principal_id, name) VALUES ('${wsId}', '${BOT}', 'w105')`)
      await db.unsafe(`INSERT INTO "${schema}".calendar (calendar_id, workspace_id, name) VALUES ('${calId}', '${wsId}', 'w105')`)
      await db.unsafe(`INSERT INTO "${schema}".calendar_event (event_id, workspace_id, calendar_id, title, starts_at, ends_at)
        VALUES ('${eventId}', '${wsId}', '${calId}', 'w105', now(), now() + interval '1 hour')`)
      // Bun SQL queries are lazy thenables; run them inside an async fn so `rejects` sees a real Promise.
      const run = async (sql: string) => { await db.unsafe(sql) }
      await expect(run(`INSERT INTO "${schema}".event_attendee (event_id) VALUES ('${eventId}')`))
        .rejects.toThrow(/event_attendee_identity/)
      await db.unsafe(`INSERT INTO "${schema}".event_attendee (event_id, email) VALUES ('${eventId}', 'a@example.invalid')`)
      await db.unsafe(`INSERT INTO "${schema}".event_attendee (event_id, principal_id) VALUES ('${eventId}', '${BOT}')`)
      await expect(run(`INSERT INTO "${schema}".event_attendee (event_id, email) VALUES ('${eventId}', 'A@example.invalid')`))
        .rejects.toThrow(/event_attendee_uniq/)
    } finally {
      await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      await db.close()
    }
  }, 120000)

  itDb('checksum change fails closed with MIGRATION_CHANGED (run d)', async () => {
    const db = new SQL(testDb!.url)
    try {
      const schema = `w105_changed_${randomBytes(4).toString('hex')}`
      await db.unsafe(`CREATE SCHEMA "${schema}"`)
      try {
        const migrations = await loadMigrations()
        await applyWorkspaceMigrations(db, migrations, schema)
        const tampered = migrations.map(m => m.name === '520-work-item.sql'
          ? migrationFromSource(m.name, `${m.sql}\n-- tampered`)
          : m)
        await expect(applyWorkspaceMigrations(db, tampered, schema)).rejects.toMatchObject({ code: 'MIGRATION_CHANGED' })
      } finally {
        await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      }
    } finally {
      await db.close()
    }
  }, 120000)

  itDb('retroactive 02..47 names fail closed with MIGRATION_ORDER_CONFLICT (negative)', async () => {
    const db = new SQL(testDb!.url)
    try {
      const schema = `w105_order_${randomBytes(4).toString('hex')}`
      await db.unsafe(`CREATE SCHEMA "${schema}"`)
      try {
        const migrations = await loadMigrations()
        const head = migrations.slice(0, 4)
        await applyWorkspaceMigrations(db, head, schema)
        const retro = migrationFromSource('02-retroactive.sql', 'SELECT 1;')
        await expect(applyWorkspaceMigrations(db, [retro, ...head], schema))
          .rejects.toMatchObject({ code: 'MIGRATION_ORDER_CONFLICT' })
      } finally {
        await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      }
    } finally {
      await db.close()
    }
  }, 120000)

  itDb('EXPLAIN uses the key-query indexes (work map, chat feed, backlinks, review)', async () => {
    const db = new SQL(testDb!.url)
    try {
      const schema = `w105_explain_${randomBytes(4).toString('hex')}`
      await db.unsafe(`CREATE SCHEMA "${schema}"`)
      try {
        await applyWorkspaceMigrations(db, await loadMigrations(), schema)
        // Seed a small skewed link set so the backlinks index is the selective path.
        const { randomUUID } = await import('node:crypto')
        const wsId = randomUUID()
        await db.unsafe(`INSERT INTO "${schema}".principal (principal_id, kind, status) VALUES ('${BOT}', 'bot', 'active') ON CONFLICT (principal_id) DO NOTHING`)
        await db.unsafe(`INSERT INTO "${schema}".workspace (workspace_id, owner_principal_id, name) VALUES ('${wsId}', '${BOT}', 'w105') ON CONFLICT DO NOTHING`)
        const probeTo = 'goal:probe-target'
        const values: string[] = []
        for (let i = 0; i < 200; i += 1) {
          const to = i < 3 ? probeTo : `goal:other-${i}`
          values.push(`(gen_random_uuid(), '${wsId}', 'note', 'note-${i}', 'goal', '${to}', 'mentions', '${BOT}')`)
        }
        await db.unsafe(`INSERT INTO "${schema}".entity_link (link_id, workspace_id, from_kind, from_id, to_kind, to_id, relation, created_by) VALUES ${values.join(',')}`)
        await db.unsafe(`ANALYZE "${schema}".entity_link`)
        const plans = await db.begin(async tx => {
          await tx.unsafe('SET LOCAL enable_seqscan = off')
          const out: Array<{ label: string; plan: string }> = []
          const queries: Array<[string, string]> = [
            ['goal_space', `SELECT goal_id FROM "${schema}".goal WHERE workspace_id = '${NIL}' AND space_id = '${NIL}' AND deleted_at IS NULL`],
            ['message_feed', `SELECT message_id FROM "${schema}".message WHERE chat_id = '${NIL}' AND deleted_at IS NULL ORDER BY seq DESC LIMIT 50`],
            ['entity_link_to', `SELECT link_id FROM "${schema}".entity_link WHERE to_kind = 'goal' AND to_id = '${probeTo}' AND deleted_at IS NULL`],
            ['check_in_subject', `SELECT check_in_id FROM "${schema}".check_in WHERE subject_type = 'goal' AND subject_id = '${NIL}' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`],
            ['notification_unread', `SELECT notification_id FROM "${schema}".notification WHERE principal_id = '${NIL}' AND read_at IS NULL ORDER BY created_at DESC LIMIT 20`],
          ]
          for (const [label, q] of queries) {
            const rows = await tx.unsafe<{ plan: string }[]>(`EXPLAIN ${q}`)
            out.push({ label, plan: rows.map(r => r.plan ?? JSON.stringify(r)).join('\n') })
          }
          return out
        })
        for (const { label, plan } of plans) {
          expect(`${label}: ${plan}`).toMatch(/Index Scan|Bitmap Heap Scan/)
          expect(plan).toContain(label)
        }
      } finally {
        await db.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      }
    } finally {
      await db.close()
    }
  }, 120000)
})
