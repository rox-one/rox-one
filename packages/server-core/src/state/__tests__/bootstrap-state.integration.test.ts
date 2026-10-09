import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { createSession, deleteSession, listSessions } from '@rox/shared/sessions'
import { closeStateStore, openStateStore, stateDatabasePath, stateWriterLockPath, LATEST_STATE_USER_VERSION } from '../state-store.ts'
import { createSessionStateProjector, sessionIndexFilePath, type SessionIndexFile } from '../sessions-projection.ts'
// Type-only: erased at runtime, so importing it does not initialize headless-start's
// module-level LOCK_FILE before the test sets ROX_CONFIG_DIR.
import type { ServerInstance } from '../../bootstrap/headless-start.ts'

const WRITER_LOCK_MODULE = join(import.meta.dir, '..', 'writer-lock.ts')

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
}

const configDir = mkdtempSync(join(tmpdir(), 'rox-state-boot-'))
const workspace = mkdtempSync(join(tmpdir(), 'rox-state-boot-ws-'))
const previousConfigDir = process.env.ROX_CONFIG_DIR
const previousToken = process.env.ROX_SERVER_TOKEN

let instance: ServerInstance<Record<string, never>> | null = null

interface ChildResult {
  outcome: 'ACQUIRED' | 'REFUSED'
  detail: string
}

async function tryAcquireInChild(): Promise<ChildResult> {
  const script = `
    const mod = await import(process.env.WRITER_LOCK_MODULE)
    try {
      const lock = mod.acquireStateWriterLock(process.env.STATE_LOCK_PATH, { label: 'intruder' })
      lock.release()
      console.log('ACQUIRED')
    } catch (error) {
      console.log('REFUSED ' + error.name + ' ' + (error.holder ? error.holder.pid : '') + ' ' + (error.holder ? error.holder.label : ''))
    }
  `
  const child = Bun.spawn(['bun', '-e', script], {
    cwd: join(import.meta.dir, '../../../..'),
    env: { ...process.env, WRITER_LOCK_MODULE, STATE_LOCK_PATH: stateWriterLockPath(configDir) },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (exitCode !== 0) throw new Error(`child exited ${exitCode}: ${stdout}`)
  const line = stdout.trim().split('\n').pop() ?? ''
  if (line.startsWith('ACQUIRED')) return { outcome: 'ACQUIRED', detail: line }
  return { outcome: 'REFUSED', detail: line }
}

describe('bootstrap unified state store (integration)', () => {
  beforeAll(async () => {
    process.env.ROX_CONFIG_DIR = configDir
    const token = randomToken()
    process.env.ROX_SERVER_TOKEN = token
    // Dynamic: the module initializes its `.server.lock` path from the config dir
    // at load time, so the env override above must precede the import.
    const { bootstrapServer } = await import('../../bootstrap/headless-start.ts')
    instance = await bootstrapServer<Record<string, never>, Record<string, never>>({
      serverToken: token,
      rpcPort: 0,
      createSessionManager: () => ({}),
      createHandlerDeps: () => ({}),
      registerAllRpcHandlers: () => {},
      initializeSessionManager: async () => {},
      setSessionEventSink: () => {},
      initModelRefreshService: () => ({ startAll: () => {}, stopAll: () => {} }),
    })
  }, 30_000)

  afterAll(async () => {
    if (instance) await instance.stop()
    if (previousConfigDir === undefined) delete process.env.ROX_CONFIG_DIR
    else process.env.ROX_CONFIG_DIR = previousConfigDir
    if (previousToken === undefined) delete process.env.ROX_SERVER_TOKEN
    else process.env.ROX_SERVER_TOKEN = previousToken
    closeStateStore(configDir)
    rmSync(configDir, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  it('creates <configDir>/state/rox-state.sqlite at the latest user_version', () => {
    const dbPath = stateDatabasePath(configDir)
    expect(existsSync(dbPath)).toBe(true)
    const db = new DatabaseSync(dbPath)
    const row = db.prepare('PRAGMA user_version').get()
    db.close()
    expect(row?.user_version).toBe(LATEST_STATE_USER_VERSION)
  })

  it('projects create/delete so the index matches live sessions', async () => {
    const store = openStateStore({ configDir })
    const projector = createSessionStateProjector({ store })

    const session = await createSession(workspace, { name: 'Integration' })
    await projector.recordSession(workspace, session.id)

    const readEntries = (): SessionIndexFile =>
      JSON.parse(readFileSync(sessionIndexFilePath(workspace), 'utf-8')) as SessionIndexFile
    expect(readEntries().entries.map((entry) => entry.id)).toEqual(listSessions(workspace).map((live) => live.id))

    expect(deleteSession(workspace, session.id)).toBe(true)
    await projector.removeSession(workspace, session.id)

    expect(readEntries().entries).toEqual([])
    expect(listSessions(workspace)).toEqual([])
  })

  it('refuses a second process while the server holds the lock', async () => {
    const result = await tryAcquireInChild()
    expect(result.outcome).toBe('REFUSED')
    expect(result.detail).toContain('StateLockedError')
  })

  it('releases the lock on stop so the next process can take it', async () => {
    await instance!.stop()
    const result = await tryAcquireInChild()
    expect(result.outcome).toBe('ACQUIRED')
  })
})