import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, deleteSession, getSessionFilePath, readSessionHeader, updateSessionMetadata } from '@rox/shared/sessions'
import { closeStateStore, openStateStore, type StateStore } from '../state-store.ts'
import {
  checkSessionIndexDrift,
  createSessionStateProjector,
  liveCookie,
  scanWorkspaceEntries,
  sessionIndexFilePath,
  type SessionIndexFile,
  type SessionStateProjector,
} from '../sessions-projection.ts'

const roots: string[] = []
const configDirs: string[] = []
function scratch(prefix: string, sink: string[] = roots): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  sink.push(dir)
  return dir
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
  while (configDirs.length > 0) {
    const dir = configDirs.pop()!
    closeStateStore(dir)
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixture(): { root: string; store: StateStore; projector: SessionStateProjector } {
  const root = scratch('rox-projection-ws-')
  const configDir = scratch('rox-projection-cfg-', configDirs)
  const store = openStateStore({ configDir, lock: 'allow-unlocked' })
  return { root, store, projector: createSessionStateProjector({ store }) }
}

function readIndexFile(root: string): SessionIndexFile {
  return JSON.parse(readFileSync(sessionIndexFilePath(root), 'utf-8')) as SessionIndexFile
}

describe('session state projection', () => {
  it('records sessions into the DB and the index file', async () => {
    const { root, store, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    const two = await createSession(root, { name: 'Two' })
    await projector.recordSession(root, one.id)
    await projector.recordSession(root, two.id)

    const file = readIndexFile(root)
    expect(file.version).toBe(1)
    expect(file.count).toBe(2)
    expect(file.entries.map((entry) => entry.id).sort()).toEqual([one.id, two.id].sort())
    expect(file.maxHeaderMtimeMs).toBe(liveCookie(root).maxHeaderMtimeMs)
    expect(store.listSessionIndex(root).map((row) => row.sessionId).sort()).toEqual([one.id, two.id].sort())
  })

  it('keeps the index file equal to a fresh scan', async () => {
    const { root, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    const two = await createSession(root, { name: 'Two', labels: ['x'] })
    await projector.recordSession(root, one.id)
    await projector.recordSession(root, two.id)

    expect(readIndexFile(root).entries).toEqual(scanWorkspaceEntries(root))
  })

  it('removes a deleted session from both stores', async () => {
    const { root, store, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    const two = await createSession(root, { name: 'Two' })
    await projector.recordSession(root, one.id)
    await projector.recordSession(root, two.id)

    expect(deleteSession(root, one.id)).toBe(true)
    await projector.removeSession(root, one.id)

    expect(readIndexFile(root).entries.map((entry) => entry.id)).toEqual([two.id])
    expect(store.listSessionIndex(root).map((row) => row.sessionId)).toEqual([two.id])
  })

  it('rebuilds from the JSONL scan', async () => {
    const { root, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    await createSession(root, { name: 'Two' })

    const entries = await projector.rebuildWorkspace(root)
    expect(entries).toEqual(scanWorkspaceEntries(root))
    expect(readIndexFile(root).entries).toEqual(entries)
  })

  it('restores a deleted index file', async () => {
    const { root, store, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    await projector.recordSession(root, one.id)
    rmSync(sessionIndexFilePath(root))

    const entries = projector.readIndex(root)
    expect(entries.map((entry) => entry.id)).toEqual([one.id])
    await store.queue.whenIdle(store.dbPath)
    expect(existsSync(sessionIndexFilePath(root))).toBe(true)
    expect(readIndexFile(root).entries.map((entry) => entry.id)).toEqual([one.id])
  })

  it('rebuilds when the freshness cookie no longer matches the directory', async () => {
    const { root, store, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    await projector.recordSession(root, one.id)
    expect(readIndexFile(root).entries[0]!.name).toBe('One')

    await updateSessionMetadata(root, one.id, { name: 'Renamed' })
    // Force a strictly newer header mtime so the cookie visibly mismatches.
    const file = getSessionFilePath(root, one.id)
    const future = new Date(Date.now() + 10_000)
    utimesSync(file, future, future)

    const entries = projector.readIndex(root)
    expect(entries.find((entry) => entry.id === one.id)?.name).toBe('Renamed')
    await store.queue.whenIdle(store.dbPath)
    expect(readIndexFile(root).entries.find((entry) => entry.id === one.id)?.name).toBe('Renamed')
  })

  it('persists each full header JSON and serves it fresh without scanning', async () => {
    const { root, store, projector } = fixture()
    const one = await createSession(root, { name: 'One', labels: ['x'] })
    const two = await createSession(root, { name: 'Two' })
    await projector.recordSession(root, one.id)
    await projector.recordSession(root, two.id)

    const row = store.listSessionIndex(root).find((candidate) => candidate.sessionId === one.id)!
    const storedRow = JSON.parse(row.header) as Record<string, unknown>
    expect(typeof storedRow.messageCount).toBe('number')
    expect(storedRow.tokenUsage).toBeTruthy()

    const headers = projector.readFreshHeaders(root)
    expect(headers?.map((header) => header.id).sort()).toEqual([one.id, two.id].sort())
    expect(headers?.find((header) => header.id === one.id) ?? null).toEqual(readSessionHeader(getSessionFilePath(root, one.id)))
  })

  it('readFreshHeaders returns null when a session changed (stale cookie)', async () => {
    const { root, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    await projector.recordSession(root, one.id)
    expect(projector.readFreshHeaders(root)).not.toBeNull()

    await updateSessionMetadata(root, one.id, { name: 'Renamed' })
    const future = new Date(Date.now() + 10_000)
    utimesSync(getSessionFilePath(root, one.id), future, future)

    expect(projector.readFreshHeaders(root)).toBeNull()
  })

  it('readFreshHeaders returns null when the index is absent or corrupt', async () => {
    const { root, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    expect(projector.readFreshHeaders(root)).toBeNull()

    await projector.recordSession(root, one.id)
    expect(projector.readFreshHeaders(root)).not.toBeNull()
    writeFileSync(sessionIndexFilePath(root), '{ not json')
    expect(projector.readFreshHeaders(root)).toBeNull()
  })

  it('readFreshHeaders rejects pre-upgrade entry-subset rows', async () => {
    const { root, store, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    await projector.recordSession(root, one.id)
    // A pre-upgrade row held the list-entry subset, not the full header.
    await store.upsertSessionIndex(root, one.id, JSON.stringify({ id: one.id, workspaceRootPath: root, createdAt: 1, lastUsedAt: 1, headerMtimeMs: 1 }))
    await store.queue.whenIdle(store.dbPath)

    expect(projector.readFreshHeaders(root)).toBeNull()
  })

  it('drift guard reports planted drift without rewriting the index', async () => {
    const { root, projector } = fixture()
    const one = await createSession(root, { name: 'One' })
    await projector.recordSession(root, one.id)

    expect(checkSessionIndexDrift(root)).toEqual({
      indexCount: 1,
      scannedCount: 1,
      cookieMatches: true,
      missingFromIndex: [],
      staleInIndex: [],
    })

    const two = await createSession(root, { name: 'Two' })
    const future = new Date(Date.now() + 10_000)
    utimesSync(getSessionFilePath(root, two.id), future, future)

    const drift = checkSessionIndexDrift(root)
    expect(drift.cookieMatches).toBe(false)
    expect(drift.indexCount).toBe(1)
    expect(drift.scannedCount).toBe(2)
    expect(drift.missingFromIndex).toEqual([two.id])
    expect(drift.staleInIndex).toEqual([])
    // Read-only: the index file still lists only the original session.
    expect(readIndexFile(root).entries.map((entry) => entry.id)).toEqual([one.id])
  })
})