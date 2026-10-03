import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from '@tursodatabase/database'
import { createWorkGraphKernel } from './index'

const nativeIt = process.platform === 'darwin' && process.arch === 'arm64' ? it : it.skip
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-connection-audit-')); roots.push(root)
  const open = () => createWorkGraphKernel({ configDir: root, platform: { platform: 'darwin', arch: 'arm64' } })
  return { root, open, database: join(root, 'workgraph', 'workgraph.db') }
}
const create = (kernel: ReturnType<typeof createWorkGraphKernel>) => kernel.createConnection({
  workspaceId: 'workspace_a', integrationId: 'github',
  credentialRefId: 'cred_123e4567-e89b-12d3-a456-426614174000', storageMode: 'copy',
})
nativeIt('persists metadata action and creation audit through restart without exposing the digest input', async () => {
  const f = fixture(); const first = f.open(); const connection = await create(first)
  await first.appendConnectionAudit({ workspaceId: 'workspace_a', connectionId: connection.id,
    consumer: 'agent-a', action: 'connection.reconnect', decision: 'allow', eventType: 'connection-reconnected' })
  await first.close(); const reopened = f.open()
  const rows = await reopened.listConnectionAudit('workspace_a', connection.id)
  expect(rows).toHaveLength(2)
  expect(rows.find(row => row.eventType === 'connection-created')?.action).toBe('connection.create')
  expect(rows.find(row => row.eventType === 'connection-reconnected')?.action).toBe('connection.reconnect')
  expect(rows.every(row => Object.keys(row).sort().join(',') === 'action,actorId,connectionId,eventType,occurredAt,outcome,payloadDigest')).toBe(true)
  expect(await reopened.listConnectionAudit('workspace_b', connection.id)).toEqual([])
  await reopened.close()
})
nativeIt('migrates a populated schema2 ledger additively, preserves old checksums and immutable rows', async () => {
  const f = fixture(); const first = f.open(); const connection = await create(first)
  await first.appendConnectionAudit({ workspaceId: 'workspace_a', connectionId: connection.id,
    action: 'github.request', decision: 'deny' })
  await first.close()
  const legacy = await connect(f.database)
  // Reconstruct the exact source/current schema2 layout. V1/V2 SQL and checksums
  // are unchanged; only the additive V3 column and its migration row are absent.
  await legacy.exec('ALTER TABLE workgraph_ledger DROP COLUMN action')
  await legacy.run('DELETE FROM workgraph_schema_migrations WHERE version = 3')
  const before = await legacy.all('SELECT * FROM workgraph_ledger ORDER BY sequence')
  const checksums = await legacy.all('SELECT version, checksum FROM workgraph_schema_migrations ORDER BY version')
  await legacy.close()
  const reopened = f.open(); expect(await reopened.getVersion()).toEqual({ schemaVersion: 3, state: 'available' })
  expect((await reopened.listConnectionAudit('workspace_a', connection.id)).find(row => row.eventType === 'connection-audit')?.action).toBe('connection-audit')
  await reopened.appendConnectionAudit({ workspaceId: 'workspace_a', connectionId: connection.id,
    action: 'connection.move', decision: 'allow', eventType: 'connection-moved' })
  await reopened.close()
  const migrated = await connect(f.database)
  const after = await migrated.all('SELECT * FROM workgraph_ledger ORDER BY sequence') as Array<Record<string, unknown>>
  expect(after.slice(0, before.length).map(({ action, ...old }) => old)).toEqual(before)
  expect(after.slice(0, before.length).every(row => row.action === null)).toBe(true)
  expect(await migrated.all('SELECT version, checksum FROM workgraph_schema_migrations WHERE version < 3 ORDER BY version')).toEqual(checksums)
  await expect(migrated.exec("UPDATE workgraph_ledger SET action = 'tampered'")).rejects.toThrow('workgraph ledger is immutable')
  await expect(migrated.exec('DELETE FROM workgraph_ledger')).rejects.toThrow('workgraph ledger is immutable')
  await migrated.close()
})
