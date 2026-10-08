/**
 * Child-process probe for the W1-02 note-mention indexer (run by
 * note-links-indexer.test.ts with its own ROX_CONFIG_DIR, so the workspace
 * registry it creates never leaks into other suites).
 *
 * Drives the REAL Notes handlers on the local filesystem-vault path:
 * create → save with mentions → edit → delete, and asserts the workspace
 * link store after each step. Prints `verified-<scenario>` on success.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const scenario = process.env.ROX_NOTE_LINKS_SCENARIO ?? 'flag-on'
if (scenario !== 'flag-off') process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
else delete process.env.CRAFT_FEATURE_ENTITIES_LINKS

const storage = await import('@rox/shared/config')
const { RPC_CHANNELS } = await import('@rox/shared/protocol')
const { registerNotesHandlers } = await import('../../notes.ts')
const { getEntityLinkStore, closeEntityLinkStores } = await import('../../../../entities/link-store.ts')

const workspaceRoot = join(process.env.ROX_NOTE_LINKS_ROOT!, 'workspace')
mkdirSync(workspaceRoot, { recursive: true })
storage.saveConfig(storage.createInitialStoredConfig())
const workspace = storage.addWorkspace({ name: 'Links', rootPath: workspaceRoot, kind: 'personal' })

const handlers = new Map<string, (...args: any[]) => any>()
const pushes: Array<{ channel: string; args: unknown[] }> = []
const server = {
  handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
  push: (channel: string, _target: unknown, ...args: unknown[]) => { pushes.push({ channel, args }) },
}
const native = scenario === 'native'
// Native (journal-backed) Notes: deterministic authority/journal doubles, as
// in notes-missing.test.ts; all registered Notes handlers are real.
const nativeRoot = join(process.env.ROX_NOTE_LINKS_ROOT!, 'native')
const entities = new Map<string, any>()
const nativeData = {
  authority: {
    hasRegisteredWorkspaces: () => true,
    authorize: () => true,
    permissionFence: () => 'fixture-fence',
    resolveWorkspace: () => ({ nativeRoot }),
  },
  sync: {
    pull: () => ({ entities: [...entities.values()], hasMore: false, nextSequence: 1 }),
    commit: async (_principal: unknown, _workspaceId: string, command: { nativeId: string; changes: Array<{ path: string; content: string | null }> }) => {
      const previous = entities.get(command.nativeId)
      const files = new Map<string, any>(previous?.files.map((file: any) => [file.path, file]) ?? [])
      for (const change of command.changes) {
        const path = join(nativeRoot, change.path)
        if (change.content === null) { await rm(path); files.delete(change.path) }
        else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, change.content); files.set(change.path, { path: change.path, content: change.content }) }
      }
      entities.set(command.nativeId, { nativeId: command.nativeId, kind: 'notes', deleted: files.size === 0,
        revision: (previous?.revision ?? 0) + 1, files: [...files.values()] })
      return {}
    },
  },
}
const deps = native ? { nativeData } : {
  windowManager: {
    getWindowByWebContentsId: () => ({}),
    getWorkspaceForWindow: () => workspace.id,
  },
}
registerNotesHandlers(server as never, deps as never)
const ctx = native
  ? { clientId: 'probe', workspaceId: workspace.id, webContentsId: null, principal: { issuer: 'fixture', subject: 'probe-user' } }
  : { clientId: 'probe', workspaceId: workspace.id, webContentsId: 1 }
const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(ctx, workspace.id, ...args)
const op = (expectedRevision: unknown) => ({ operationId: crypto.randomUUID(), expectedRevision, schemaVersion: 1 })
const linksChanged = () => pushes.filter(push => push.channel === RPC_CHANNELS.entities.LINKS_CHANGED).length
const dbPath = join(workspaceRoot, '.rox', 'entity-links.sqlite')

const created = native
  ? await invoke(RPC_CHANNELS.notes.CREATE, 'Weekly', undefined, op(null))
  : await invoke(RPC_CHANNELS.notes.CREATE, 'Weekly')
// The editor saves against the revision + source binding it last read.
const save = async (noteId: string, content: string) => {
  const current = await invoke(RPC_CHANNELS.notes.READ, noteId)
  return native
    ? invoke(RPC_CHANNELS.notes.SAVE, noteId, content, undefined, op(current.nativeRevision))
    : invoke(RPC_CHANNELS.notes.SAVE, noteId, content, current.revision, current.sourceStoreId)
}
const remove = async (noteId: string) => {
  const current = await invoke(RPC_CHANNELS.notes.READ, noteId)
  return native ? invoke(RPC_CHANNELS.notes.DELETE, noteId, op(current.nativeRevision)) : invoke(RPC_CHANNELS.notes.DELETE, noteId)
}
const rename = async (noteId: string, title: string) => {
  const current = await invoke(RPC_CHANNELS.notes.READ, noteId)
  return native ? invoke(RPC_CHANNELS.notes.RENAME, noteId, title, op(current.nativeRevision)) : invoke(RPC_CHANNELS.notes.RENAME, noteId, title)
}
const body1 = [
  '---',
  'title: Weekly',
  '---',
  'Owner follows up on [[task:42|Fix login]] and embeds ![[note:Plan]].',
  'Bare task:99 and `[[task:code]]` never link.',
  '```',
  '[[task:fenced]]',
  '```',
  'See rox://goals/goal/g1 and [[Встреча: итоги#Решения]].',
].join('\n')
const saved = await save(created.id, body1)
assert.equal(saved.content, body1, 'the note text is never rewritten')

if (scenario === 'flag-off') {
  await remove(saved.id)
  assert.equal(existsSync(dbPath), false, 'flag off: no link store is created')
  assert.equal(linksChanged(), 0, 'flag off: no linksChanged push')
  console.log('verified-flag-off')
  process.exit(0)
}

const store = getEntityLinkStore(workspaceRoot)
const from = { kind: 'note' as const, id: saved.id }
const summary = () => store.outgoing(from).map(link => `${link.relation} ${link.to.kind}:${link.to.id}${link.anchor?.line ? `@${link.anchor.line}` : ''}`).sort()
assert.deepEqual(summary(), [
  'embeds note:Plan@4',
  'mentions goal:g1@9',
  'mentions note:Встреча: итоги@9',
  'mentions task:42@4',
])
assert.equal(store.backlinks({ kind: 'task', id: '42' }).links.length, 1, 'task backlinks see the note')
const pushesAfterSave = linksChanged()
assert.ok(pushesAfterSave >= 1, 'save pushes entities:linksChanged')

// Re-saving identical content is idempotent: no writes, no push.
const resaved = await save(saved.id, body1)
assert.deepEqual(summary().length, 4)
assert.equal(linksChanged(), pushesAfterSave, 'identical re-save does not push')

// Edit: drop the task mention, keep the goal, add a person.
const body2 = 'Only rox://goals/goal/g1 and [[person:c7]] remain.'
const edited = await save(resaved.id, body2)
assert.deepEqual(summary(), ['mentions goal:g1@1', 'mentions person:c7@1'])
assert.equal(store.backlinks({ kind: 'task', id: '42' }).links.length, 0, 'stale task link removed')
assert.ok(linksChanged() > pushesAfterSave, 'edit pushes entities:linksChanged')

// Rename moves the note's outgoing links to its new id.
const renamed = await rename(edited.id, 'Weekly Renamed')
const renamedNote = renamed.note
assert.notEqual(renamedNote.id, edited.id)
assert.deepEqual(summary(), [], 'old id keeps no outgoing links')
const renamedFrom = { kind: 'note' as const, id: renamedNote.id }
assert.deepEqual(store.outgoing(renamedFrom).map(link => `${link.to.kind}:${link.to.id}`).sort(), ['goal:g1', 'person:c7'])

const targetsOf = (noteId: string) => store.outgoing({ kind: 'note', id: noteId }).map(link => `${link.to.kind}:${link.to.id}`).sort()

// Move into a folder: links follow the note.
const current = await invoke(RPC_CHANNELS.notes.READ, renamedNote.id)
const moved = (native
  ? await invoke(RPC_CHANNELS.notes.MOVE, renamedNote.id, 'Archive', op(current.nativeRevision))
  : await invoke(RPC_CHANNELS.notes.MOVE, renamedNote.id, 'Archive')).note
assert.equal(moved.id.startsWith('Archive/'), true)
assert.deepEqual(targetsOf(renamedNote.id), [])
assert.deepEqual(targetsOf(moved.id), ['goal:g1', 'person:c7'])

let last = moved.id
if (!native) {
  // Folder rename (moveFolder events name only the new ids).
  const renamedFolder = await invoke(RPC_CHANNELS.notes.RENAME_FOLDER, 'Archive', 'Old')
  assert.equal(renamedFolder.movedNotes.length, 1)
  last = renamedFolder.movedNotes[0]
  assert.equal(last.startsWith('Old/'), true)
  assert.deepEqual(targetsOf(moved.id), [])
  assert.deepEqual(targetsOf(last), ['goal:g1', 'person:c7'])
  // Folder delete drops every contained note's links.
  await invoke(RPC_CHANNELS.notes.DELETE_FOLDER, 'Old')
  assert.deepEqual(targetsOf(last), [])
} else {
  // Delete removes every outgoing link of the note.
  await remove(last)
  assert.deepEqual(targetsOf(last), [])
}
assert.equal(store.count(), 0)

closeEntityLinkStores()
console.log(`verified-${scenario}`)
