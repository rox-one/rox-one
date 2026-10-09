import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, deleteSession, getSessionFilePath, updateSessionMetadata } from '@rox/shared/sessions'
import { closeStateStore, openStateStore, type StateStore } from '../state-store.ts'
import {
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
})