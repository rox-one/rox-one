/**
 * W1-11 (#1508) — `audit_log` in PostgreSQL (the workspace authority's chain).
 *
 * Needs the same protected PG config as the other workspace-service database
 * tests (`ROX_WORKSPACE_TEST_CONFIG`, file 0600 with
 * `{ "ROX_WORKSPACE_DATABASE_URL": ... }`); skipped when it is absent. Each run
 * uses its own schema, applies the real migrations, and asserts the chain
 * properties of §13.4: append, verify, tamper detection and the per-workspace
 * isolation of the chain.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { auditRequestHash, type AuditRowInput } from '../../../packages/core/src/agents/audit.ts'
import { loadProtectedWorkspaceDatabaseUrl } from '../src/auth/postgres-identity.ts'
import { PostgresAuditLog } from '../src/modules/agents/audit-log.ts'
import { applyWorkspaceMigrations } from '../src/database/migrations.ts'
import { loadWorkspaceBootstrapMigrations } from '../src/server.ts'

const configPath = process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')
const hasDatabase = existsSync(configPath)

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

function auditRow(workspaceId: string, actorPrincipalId: string, overrides: Partial<AuditRowInput> = {}): AuditRowInput {
  return {
    auditId: randomUUID(),
    workspaceId,
    actorPrincipalId,
    actorKind: 'bot',
    onBehalfOf: null,
    commandType: 'im.create_chat',
    targetRef: 'channel:1',
    decision: 'executed',
    riskClass: 'consequential',
    approvalRequestId: null,
    ruleExecutionId: null,
    provenance: { trigger: 'mention', transport: 'http' },
    requestHash: auditRequestHash(randomUUID()),
    receipt: { status: 'applied' },
    error: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe.if(hasDatabase)('audit_log chain (PostgreSQL)', () => {
  interface Fixture {
    sql: SQL
    log: PostgresAuditLog
    workspaceId: string
    principalId: string
    prefix: string
  }

  async function setup(): Promise<Fixture> {
    const url = await loadProtectedWorkspaceDatabaseUrl(configPath)
    const sql = new SQL({ url, max: 2 })
    closers.push(() => sql.close({ timeout: 2 }).catch(() => {}))
    const schema = `w1_11_agents_${randomUUID().replaceAll('-', '')}`
    const prefix = `"${schema}".`
    await sql.unsafe(`CREATE SCHEMA "${schema}"`)
    closers.push(() => sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {}))
    // The real runner: it sets the schema's search_path inside one transaction,
    // so the DDL lands in this run's schema (never in `public`).
    const bootstrap = await loadWorkspaceBootstrapMigrations(resolve(import.meta.dir, '../migrations'))
    await applyWorkspaceMigrations(sql, bootstrap, schema)
    const workspaceId = randomUUID()
    const principalId = randomUUID()
    await sql.unsafe(`INSERT INTO ${prefix}principal (principal_id) VALUES ($1)`, [principalId])
    await sql.unsafe(`INSERT INTO ${prefix}workspace (workspace_id, owner_principal_id, name) VALUES ($1, $2, $3)`, [workspaceId, principalId, 'W1-11'])
    return { sql, log: new PostgresAuditLog({ database: sql, schema }), workspaceId, principalId, prefix }
  }

  test('appends a chained row per workspace and verifies it', async () => {
    const { log, workspaceId, principalId } = await setup()
    const first = await log.append(auditRow(workspaceId, principalId))
    const second = await log.append(auditRow(workspaceId, principalId, { commandType: 'tasks.create' }))
    expect(first.prevHash).toBeNull()
    expect(second.prevHash).toBe(first.hash)
    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    const verification = await log.verify(workspaceId)
    expect(verification.ok).toBe(true)
    expect(verification.rows).toBe(2)
    const rows = await log.read(workspaceId)
    expect(rows[1]?.hash).toBe(second.hash)
    expect(rows[1]?.actorKind).toBe('bot')
    expect(rows[1]?.riskClass).toBe('consequential')
    expect(rows[1]?.provenance).toMatchObject({ trigger: 'mention', transport: 'http' })
  })

  test('round-trips the hash columns: a written hex reads back as the same hex', async () => {
    const { log, workspaceId, principalId } = await setup()
    const input = auditRow(workspaceId, principalId)
    const first = await log.append(input)
    // `request_hash`/`hash` are `bytea`; the read must give back exactly the hex
    // that was written (a UTF-8 write would double it and break the chain).
    const [row] = await log.read(workspaceId)
    expect(row?.requestHash).toBe(input.requestHash)
    expect(row?.hash).toBe(first.hash)
    expect(row?.prevHash).toBeNull()
    // The second row chains onto the first, and both hashes survive the round-trip.
    const second = await log.append(auditRow(workspaceId, principalId, { commandType: 'tasks.create' }))
    const rows = await log.read(workspaceId)
    expect(rows[1]?.prevHash).toBe(first.hash)
    expect(rows[1]?.hash).toBe(second.hash)
    expect((await log.verify(workspaceId)).ok).toBe(true)
  })

  test('a tampered row fails the verifier at that row', async () => {
    const { sql, log, workspaceId, principalId, prefix } = await setup()
    await log.append(auditRow(workspaceId, principalId))
    const second = await log.append(auditRow(workspaceId, principalId, { commandType: 'tasks.create' }))
    // The app role only INSERTs and SELECTs; a privileged role can tamper, which
    // is exactly what the verifier must catch.
    await sql.unsafe(`UPDATE ${prefix}audit_log SET decision = 'denied' WHERE audit_id = $1`, [(await log.read(workspaceId))[1]?.auditId ?? ''])
    const verification = await log.verify(workspaceId)
    expect(verification.ok).toBe(false)
    expect(verification.brokenAt).toMatchObject({ index: 1, reason: 'hash_mismatch' })
  })

  test('two workspaces keep separate chains under the same lock discipline', async () => {
    const { sql, log, workspaceId, principalId, prefix } = await setup()
    const otherWorkspace = randomUUID()
    await sql.unsafe(`INSERT INTO ${prefix}workspace (workspace_id, owner_principal_id, name) VALUES ($1, $2, $3)`, [otherWorkspace, principalId, 'Other'])
    const mine = await log.append(auditRow(workspaceId, principalId))
    const theirs = await log.append(auditRow(otherWorkspace, principalId))
    expect(mine.prevHash).toBeNull()
    expect(theirs.prevHash).toBeNull()
    expect((await log.verify(workspaceId)).rows).toBe(1)
    expect((await log.verify(otherWorkspace)).rows).toBe(1)
    // Concurrent appends to the same workspace still chain (advisory lock).
    const [third, fourth] = await Promise.all([
      log.append(auditRow(workspaceId, principalId)),
      log.append(auditRow(workspaceId, principalId)),
    ])
    expect(new Set([third.hash, fourth.hash]).size).toBe(2)
    expect((await log.verify(workspaceId)).ok).toBe(true)
  })
})