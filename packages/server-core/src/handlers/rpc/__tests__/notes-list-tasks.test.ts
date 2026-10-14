import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { NoteDocument } from '@rox/shared/protocol'
import type { JournalEntitySnapshot } from '../../../authority/native-journal'
import type { HandlerDeps } from '../../handler-deps'
import type { RpcServer, RequestContext } from '../../../transport'

const { RPC_CHANNELS } = await import('@rox/shared/protocol')
const { registerNotesHandlers, nativeNotesKnowledgeAccess } = await import('../notes')
const { registerContentHandlers } = await import('../content')
const { readNoteTarget } = await import('../note-read-error')

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rox-note-tasks-')))
  roots.push(root)
  const entities = new Map<string, JournalEntitySnapshot>()
  let allowed = true
  let pullError: Error | undefined
  const handlers = new Map<string, (...args: any[]) => any>()
  const server = {
    handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
    push: () => {},
  } as unknown as RpcServer
  // Authority/journal ports are deterministic test doubles; all file reads and
  // registered Notes handlers are real. No OS-owner bootstrap or user config.
  const deps = { nativeData: {
    authority: {
      hasRegisteredWorkspaces: () => true,
      authorize: () => allowed,
      permissionFence: () => allowed ? 'fixture-fence' : null,
      resolveWorkspace: () => ({ nativeRoot: root }),
    },
    sync: {
      pull: () => {
        if (pullError) throw pullError
        return { entities: [...entities.values()], hasMore: false, nextSequence: 1 }
      },
      commit: async (_principal: unknown, _workspaceId: string, command: { nativeId: string; changes: Array<{ path: string; content: string | null }> }) => {
        const previous = entities.get(command.nativeId)
        const files = new Map(previous?.files.map(file => [file.path, file]) ?? [])
        for (const change of command.changes) {
          const path = join(root, change.path)
          if (change.content === null) { await rm(path); files.delete(change.path) }
          else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, change.content); files.set(change.path, { path: change.path, content: change.content }) }
        }
        entities.set(command.nativeId, { nativeId: command.nativeId, kind: 'notes', deleted: files.size === 0,
          revision: (previous?.revision ?? 0) + 1, files: [...files.values()] } as JournalEntitySnapshot)
        return {}
      },
    },
  } } as unknown as HandlerDeps
  registerNotesHandlers(server, deps)
  const context = { workspaceId: 'qa-workspace', principal: { issuer: 'fixture', subject: 'qa-user' } } as RequestContext
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(context, 'qa-workspace', ...args)
  return { root, deps, context, invoke, deny: () => { allowed = false }, failPull: (error: Error) => { pullError = error } }
}

const op = (id: string, expectedRevision: number | null | undefined) => ({ operationId: id, expectedRevision, schemaVersion: 1 })

test('#1574 notes:listTasks returns tasks per readable note in one call', async () => {
  const f = await fixture()
  const a: NoteDocument = await f.invoke(RPC_CHANNELS.notes.CREATE, 'A', undefined, op('ca', null))
  const b: NoteDocument = await f.invoke(RPC_CHANNELS.notes.CREATE, 'B', undefined, op('cb', null))
  await f.invoke(RPC_CHANNELS.notes.SAVE, a.id, '# A\n- [ ] one\n- [x] two', undefined, op('sa', a.nativeRevision))
  await f.invoke(RPC_CHANNELS.notes.SAVE, b.id, 'no tasks', undefined, op('sb', b.nativeRevision))
  const entries = await f.invoke(RPC_CHANNELS.notes.LIST_TASKS, [a.id, b.id, 'missing-note', a.id])
  expect(entries.map((e: { id: string }) => e.id).sort()).toEqual([a.id, b.id].sort())
  const forA = entries.find((e: { id: string }) => e.id === a.id)
  expect(forA.tasks).toEqual([{ line: 2, text: 'one', checked: false }, { line: 3, text: 'two', checked: true }])
  expect(JSON.stringify(entries)).not.toContain('# A')
})

test('#1574 notes:listTasks validates input and enforces read access', async () => {
  const f = await fixture()
  await expect(f.invoke(RPC_CHANNELS.notes.LIST_TASKS, 'not-an-array')).rejects.toThrow('array of strings')
  await expect(f.invoke(RPC_CHANNELS.notes.LIST_TASKS, Array.from({ length: 201 }, (_, i) => `n${i}`))).rejects.toThrow('at most 200 note ids (got 201)')
  await expect(f.invoke(RPC_CHANNELS.notes.LIST_TASKS, ['ok', 7])).rejects.toThrow('every note id to be a string')
  f.deny()
  await expect(f.invoke(RPC_CHANNELS.notes.LIST_TASKS, ['x'])).rejects.toThrow()
})

test('#1574 principal mode enumerates the vault once per listTasks call', async () => {
  const f = await fixture()
  const ids: string[] = []
  for (const name of ['P1', 'P2', 'P3']) {
    const note: NoteDocument = await f.invoke(RPC_CHANNELS.notes.CREATE, name, undefined, op(`c${name}`, null))
    ids.push(note.id)
  }
  const sync = (f.deps as unknown as { nativeData: { sync: { pull: (...a: unknown[]) => unknown } } }).nativeData.sync
  const original = sync.pull
  let pulls = 0
  sync.pull = (...args: unknown[]) => { pulls++; return original(...args) }
  try {
    const entries = await f.invoke(RPC_CHANNELS.notes.LIST_TASKS, ids)
    expect(entries).toHaveLength(3)
    const batched = pulls
    pulls = 0
    await f.invoke(RPC_CHANNELS.notes.LIST_TASKS, [ids[0]])
    // One enumeration regardless of batch size.
    expect(pulls).toBeGreaterThan(0)
    expect(batched).toBe(pulls)
  } finally {
    sync.pull = original
  }
})
