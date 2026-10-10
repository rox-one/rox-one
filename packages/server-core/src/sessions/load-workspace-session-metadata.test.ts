import './__test-config-isolation.ts'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sessions from '@rox/shared/sessions'
import { createSession, getSessionFilePath, listSessions, sessionPersistenceQueue, updateSessionMetadata, type SessionMetadata } from '@rox/shared/sessions'
import { addWorkspace } from '@rox/shared/config'
import { closeStateStore, openStateStore, resetStateStores, type StateStore } from '../state/state-store.ts'
import { bindSessionStateProjector, createSessionStateProjector, resetSessionStateProjector, sessionIndexFilePath, sessionStateProjector, type SessionStateProjector } from '../state/sessions-projection.ts'
import { loadWorkspaceSessionMetadata, SessionManager } from './SessionManager.ts'

const roots: string[] = []
const configDirs: string[] = []
function scratch(prefix: string, sink: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  sink.push(dir)
  return dir
}
afterEach(() => {
  resetSessionStateProjector()
  resetStateStores()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
  while (configDirs.length > 0) {
    const dir = configDirs.pop()!
    closeStateStore(dir)
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixture(): { root: string; store: StateStore; projector: SessionStateProjector } {
  const root = scratch('rox-boot-ws-', roots)
  const configDir = scratch('rox-boot-cfg-', configDirs)
  // This fixture exercises the projection's write path directly, the way the
  // server does while holding the writer lock; the lock itself is covered by
  // state-store.test.ts, so the store is opened with the explicit opt-out.
  const store = openStateStore({ configDir, lock: 'allow-unlocked' })
  return { root, store, projector: createSessionStateProjector({ store }) }
}

/** Order-independent, key-order-sensitive comparison over a session map. */
function mapKey(metas: SessionMetadata[]): string {
  return JSON.stringify(metas.map((meta) => [meta.id, meta]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
}

describe('loadWorkspaceSessionMetadata boot fast path', () => {
  it('serves a fresh index with zero readSessionHeader calls, byte-identical to the scan', async () => {
    const { root, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    const two = await createSession(root, { name: 'Two', labels: ['x'] })
    await projector.recordSession(root, one.id)
    await projector.recordSession(root, two.id)

    const indexSpy = spyOn(sessions, 'readSessionHeader')
    const fresh = loadWorkspaceSessionMetadata(root, projector)
    const indexCalls = indexSpy.mock.calls.length
    indexSpy.mockRestore()

    const scanSpy = spyOn(sessions, 'readSessionHeader')
    const scanned = listSessions(root)
    const scanCalls = scanSpy.mock.calls.length
    scanSpy.mockRestore()

    expect(indexCalls).toBe(0)
    expect(scanCalls).toBe(2)
    expect(mapKey(fresh)).toBe(mapKey(scanned))
  })

  it('falls back to a scan when a session changed (stale cookie) and repairs the index', async () => {
    const { root, store, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    const two = await createSession(root, { name: 'Two' })
    await projector.recordSession(root, one.id)
    await projector.recordSession(root, two.id)

    await updateSessionMetadata(root, one.id, { name: 'Renamed' })
    const future = new Date(Date.now() + 10_000)
    utimesSync(getSessionFilePath(root, one.id), future, future)

    const spy = spyOn(sessions, 'readSessionHeader')
    const metas = loadWorkspaceSessionMetadata(root, projector)
    const calls = spy.mock.calls.length
    spy.mockRestore()

    expect(calls).toBe(2)
    expect(metas.find((meta) => meta.id === one.id)?.name).toBe('Renamed')
    await store.queue.whenIdle(store.dbPath)
    expect(projector.readFreshHeaders(root)?.map((header) => header.id).sort()).toEqual([one.id, two.id].sort())
  })

  it('falls back to a scan and rebuilds when the index is absent', async () => {
    const { root, store, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    expect(existsSync(sessionIndexFilePath(root))).toBe(false)

    const metas = loadWorkspaceSessionMetadata(root, projector)
    expect(metas.map((meta) => meta.id)).toEqual([one.id])

    await store.queue.whenIdle(store.dbPath)
    expect(existsSync(sessionIndexFilePath(root))).toBe(true)
    expect(projector.readFreshHeaders(root)?.map((header) => header.id)).toEqual([one.id])
  })

  it('falls back to a scan and rebuilds when the index is corrupt', async () => {
    const { root, store, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    await projector.recordSession(root, one.id)
    writeFileSync(sessionIndexFilePath(root), '{ not json')

    const metas = loadWorkspaceSessionMetadata(root, projector)
    expect(metas.map((meta) => meta.id)).toEqual([one.id])

    await store.queue.whenIdle(store.dbPath)
    expect(projector.readFreshHeaders(root)?.map((header) => header.id)).toEqual([one.id])
  })
})

describe('ingestImportedSession index fast path', () => {
  // The ingest path reads through the process-wide projector; bind it to this
  // suite's store (opened with the explicit lock opt-out above) rather than
  // letting it open a second, unlocked store on the real config dir.
  beforeEach(() => bindSessionStateProjector(fixture().store))

  it('loads one imported session from a fresh index with zero header reads', async () => {
    const workspace = addWorkspace({ name: 'Ingest fast', rootPath: mkdtempSync(join(tmpdir(), 'rox-ingest-ws-')) })
    roots.push(workspace.rootPath)
    const created = await createSession(workspace.rootPath, { name: 'Imported' })
    await sessionStateProjector().recordSession(workspace.rootPath, created.id)

    const manager = new SessionManager()
    const spy = spyOn(sessions, 'readSessionHeader')
    manager.ingestImportedSession(workspace.id, created.id)
    const calls = spy.mock.calls.length
    spy.mockRestore()
    const ids = manager.getSessions(workspace.id).map((session) => session.id)
    await sessionPersistenceQueue.flush(created.id)
    manager.cleanup()

    expect(calls).toBe(0)
    expect(ids).toContain(created.id)
  })

  it('falls back to a scan and rebuilds when the index is stale', async () => {
    const workspace = addWorkspace({ name: 'Ingest fallback', rootPath: mkdtempSync(join(tmpdir(), 'rox-ingest-ws-')) })
    roots.push(workspace.rootPath)
    const first = await createSession(workspace.rootPath, { name: 'First' })
    await sessionStateProjector().recordSession(workspace.rootPath, first.id)
    // A second session lands on disk without touching the index → stale cookie.
    const second = await createSession(workspace.rootPath, { name: 'Second' })

    const manager = new SessionManager()
    const spy = spyOn(sessions, 'readSessionHeader')
    manager.ingestImportedSession(workspace.id, second.id)
    const calls = spy.mock.calls.length
    spy.mockRestore()
    const ids = manager.getSessions(workspace.id).map((session) => session.id)
    await sessionPersistenceQueue.flush(second.id)
    manager.cleanup()

    expect(calls).toBeGreaterThan(0)
    expect(ids).toContain(second.id)
  })
})