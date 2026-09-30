import { SQL } from 'bun'
import { writeSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations, type WorkspaceRequestLifecycle } from '../../apps/workspace-service/src/server'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_TEST_INPUT')
  return Object.fromEntries(Object.entries(value))
}
function text(value: unknown): string { if (typeof value !== 'string' || !value) throw new Error('INVALID_TEST_INPUT'); return value }
function emit(value: unknown): void { writeSync(1, JSON.stringify(value) + '\n') }
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
let service: Awaited<ReturnType<typeof createWorkspaceServer>> | undefined
let database: SQL | undefined
let armed = false
let completions = 0
let active = 0
const lifecycle: WorkspaceRequestLifecycle = {
  begin() { active++; return true },
  end() {
    if (active <= 0) throw new Error('UNBALANCED_TEST_LIFECYCLE')
    active--
    if (armed && ++completions === 2) {
      // Completion 1 is inbound authentication, completion 2 is the real handler's
      // finally after its SQL transaction returned. Parent separately verifies
      // committed rows and absence of any success response before killing us.
      emit({ type: 'postcommit-pre-reply', completions, active })
      Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0)
    }
  },
}
try {
  for await (const line of lines) {
    const input = record(JSON.parse(line))
    if (!service) {
      database = new SQL(await loadProtectedWorkspaceDatabaseUrl(text(input.databaseConfiguration)), { max: 12 })
      service = await createWorkspaceServer({ database, schema: text(input.schema),
        migrations: await loadWorkspaceBootstrapMigrations(join(import.meta.dir, '../../apps/workspace-service/migrations')),
        requestLifecycle: lifecycle, host: '127.0.0.1', port: 0, serverId: text(input.serverId),
        authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer: text(input.issuer), audience: text(input.audience),
          stateDirectory: text(input.issuerDirectory), checkoutDirectory: process.cwd(), tokenLifetimeSeconds: 300 } } })
      await service.server.listen()
      emit({ type: 'ready', port: service.server.port, pid: process.pid, migrations: service.migrations })
    } else if (input.action === 'arm') {
      if (active !== 0 || armed) throw new Error('INVALID_TEST_BOUNDARY')
      completions = 0; armed = true; emit({ type: 'armed' })
    } else if (input.action === 'consume') {
      const consumerId = text(input.consumerId)
      const schema = text(input.schema)
      if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('INVALID_TEST_INPUT')
      const changed = await service.repository.consumeNextEvent(consumerId, async (tx, event) => {
        if (event.type === 'project.created') {
          await tx.unsafe(`INSERT INTO "${schema}".crash_projection (event_id,applications) VALUES ($1,1)
            ON CONFLICT (event_id) DO UPDATE SET applications=crash_projection.applications+1`, [event.id])
        }
      })
      emit({ type: 'consumed', changed })
    } else {
      throw new Error('INVALID_TEST_INPUT')
    }
  }
} catch {
  emit({ type: 'failed', code: 'TEST_CHILD_FAILED' })
  process.exitCode = 1
} finally {
  service?.server.close()
  if (database) await database.close()
}
