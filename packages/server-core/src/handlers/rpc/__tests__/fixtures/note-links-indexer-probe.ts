/**
 * Child-process probe for the W1-02 note-mention indexer (run by
 * note-links-indexer.test.ts with its own ROX_CONFIG_DIR, so the workspace
 * registry it creates never leaks into other suites).
 *
 * Drives the REAL Notes handlers on the local filesystem-vault path (and the
 * native journal path): create → save with mentions → line shift → edit →
 * rename/move/emoji-folder rename → delete, plus a manual link surviving
 * saves, pruning after an OFF period and concurrent native saves; asserts
 * the workspace link store after each step. Prints `verified-<scenario>`.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const scenario = process.env.ROX_NOTE_LINKS_SCENARIO ?? 'flag-on'
if (scenario !== 'flag-off') process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
else delete process.env.CRAFT_FEATURE_ENTITIES_LINKS

const storage = await import('@rox/shared/config')
const { RPC_CHANNELS } = await import('@rox/shared/protocol')
const { registerNotesHandlers } = await import('../../notes.ts')
const { getEntityLinkStore, closeEntityLinkStores } = await import('../../../../entities/link-store.ts')
const { NOTE_LINKS_INDEXER_OWNERSHIP, ensureNoteLinksPruned, noteLinkSourceProbeFor, observeEntitiesLinksEnabled } = await import('../../../../entities/note-links-indexer.ts')

const workspaceRoot = join(process.env.ROX_NOTE_LINKS_ROOT!, 'workspace')
mkdirSync(workspaceRoot, { recursive: true })
storage.saveConfig(storage.createInitialStoredConfig())
const workspace = storage.addWorkspace({ name: 'Links', rootPath: workspaceRoot, kind: 'personal' })
const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@rox/shared/workspaces')
// Legacy vault on a custom notesPath (external disk / cloud folder) so the
// review 5 #1 unmount check exercises the real root resolution.
const externalNotes = join(process.env.ROX_NOTE_LINKS_ROOT!, 'external-notes')
if (scenario !== 'native') {
  mkdirSync(externalNotes, { recursive: true })
  const config = loadWorkspaceConfig(workspaceRoot)
  assert.ok(config, 'workspace config exists')
  saveWorkspaceConfig(workspaceRoot, { ...config, notesPath: externalNotes })
}

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
// Replica-lag double: the commit whose content contains `lag.marker` lands,
// then waits for `lag.gate`, and its next read sees the snapshot from when
// it landed (an older revision than what other saves already indexed).
let lag: { marker: string; gate: Promise<void>; landed: () => void } | null = null
let pullOverride: any[] | null = null
// Review 5 #1: the native workspace briefly does not resolve.
let nativeUnresolved = false
const nativeData = {
  authority: {
    hasRegisteredWorkspaces: () => true,
    authorize: () => true,
    permissionFence: () => 'fixture-fence',
    resolveWorkspace: () => (nativeUnresolved ? null : { nativeRoot }),
  },
  sync: {
    pull: () => {
      const snapshot = pullOverride ?? [...entities.values()]
      pullOverride = null
      return { entities: snapshot, hasMore: false, nextSequence: 1 }
    },
    commit: async (_principal: unknown, _workspaceId: string, command: { nativeId: string; changes: Array<{ path: string; content: string | null }> }) => {
      const previous = entities.get(command.nativeId)
      const files = new Map<string, any>(previous?.files.map((file: any) => [file.path, file]) ?? [])
      for (const change of command.changes) {
        const path = join(nativeRoot, change.path)
        if (change.content === null) { await rm(path); files.delete(change.path) }
        else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, change.content); files.set(change.path, { path: change.path, content: change.content }) }
      }
      // Like the journal: every accepted commit gets the next revision,
      // assigned atomically when it lands (concurrent commits never share one).
      entities.set(command.nativeId, { nativeId: command.nativeId, kind: 'notes', deleted: files.size === 0,
        revision: (entities.get(command.nativeId)?.revision ?? 0) + 1, files: [...files.values()] })
      if (lag && command.changes.some(change => change.content?.includes(lag!.marker))) {
        const held = lag
        lag = null
        const landedSnapshot = [...entities.values()]
        held.landed()
        await held.gate
        pullOverride = landedSnapshot
      }
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
const ownedCount = () => store.outgoingSourceIds('note', NOTE_LINKS_INDEXER_OWNERSHIP).length
const summary = () => store.outgoing(from).map(link => `${link.relation} ${link.to.kind}:${link.to.id}${link.anchor?.line ? `@${link.anchor.line}` : ''}`).sort()
// The inline `![[note:Plan]]` is a mention: only a whole-line embed is an
// embed (review 5 #7, as matchEntityEmbedLine).
assert.deepEqual(summary(), [
  'mentions goal:g1@9',
  'mentions note:Plan@4',
  'mentions note:Встреча: итоги@9',
  'mentions task:42@4',
])
assert.equal(store.backlinks({ kind: 'task', id: '42' }).links.length, 1, 'task backlinks see the note')
const pushesAfterSave = linksChanged()
assert.ok(pushesAfterSave >= 1, 'save pushes entities:linksChanged')

// Re-saving identical content is idempotent: no writes, no push.
const resaved0 = await save(saved.id, body1)
assert.deepEqual(summary().length, 4)
assert.equal(linksChanged(), pushesAfterSave, 'identical re-save does not push')

// Review 4 #2: a line inserted above the links refreshes anchors silently.
const revisions = () => store.outgoing(from).map(link => `${link.to.id}#${link.revision}`).sort()
const revisionsBefore = revisions()
const shiftedBody = body1.replace('---\nOwner', '---\nA brand new first body line.\nOwner')
const shifted = await save(resaved0.id, shiftedBody)
assert.deepEqual(summary(), [
  'mentions goal:g1@10',
  'mentions note:Plan@5',
  'mentions note:Встреча: итоги@10',
  'mentions task:42@5',
], 'anchors follow the shifted lines')
assert.deepEqual(revisions(), revisionsBefore, 'no revision bump for an anchor-only change')
assert.equal(linksChanged(), pushesAfterSave, 'no linksChanged push for an anchor-only change')

// Review 4 #1: a manual relates link on the note survives the indexer's saves.
store.add({ from, to: { kind: 'goal', id: 'manual' }, relation: 'relates-to', createdBy: 'user-1' })
const resaved = await save(shifted.id, body1)

// Edit: drop the task mention, keep the goal, add a person.
const body2 = 'Only rox://goals/goal/g1 and [[person:c7]] remain.'
const edited = await save(resaved.id, body2)
assert.deepEqual(summary(), ['mentions goal:g1@1', 'mentions person:c7@1', 'relates-to goal:manual'])
assert.equal(store.backlinks({ kind: 'task', id: '42' }).links.length, 0, 'stale task link removed')
assert.ok(linksChanged() > pushesAfterSave, 'edit pushes entities:linksChanged')
// The manual link is its author's to remove (it never follows a rename).
assert.equal(store.remove({ from, to: { kind: 'goal', id: 'manual' }, relation: 'relates-to' }), true)

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
// Review 4 #3: an astral (emoji) folder name.
const archive = '📁 Archive'
const moved = (native
  ? await invoke(RPC_CHANNELS.notes.MOVE, renamedNote.id, archive, op(current.nativeRevision))
  : await invoke(RPC_CHANNELS.notes.MOVE, renamedNote.id, archive)).note
assert.equal(moved.id.startsWith(`${archive}/`), true)
assert.deepEqual(targetsOf(renamedNote.id), [])
assert.deepEqual(targetsOf(moved.id), ['goal:g1', 'person:c7'])

let last = moved.id
if (!native) {
  // Folder rename (moveFolder events name only the new ids).
  const renamedFolder = await invoke(RPC_CHANNELS.notes.RENAME_FOLDER, archive, 'Old')
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

// Owner decision (review 4): a note deleted while the flag is OFF leaves no
// phantom backlinks — pruned on the first use after the flag turns back on.
const scratch = native
  ? await invoke(RPC_CHANNELS.notes.CREATE, 'Scratch', undefined, op(null))
  : await invoke(RPC_CHANNELS.notes.CREATE, 'Scratch')
const keeper = native
  ? await invoke(RPC_CHANNELS.notes.CREATE, 'Keeper', undefined, op(null))
  : await invoke(RPC_CHANNELS.notes.CREATE, 'Keeper')
await save(scratch.id, 'Scratch mentions [[task:phantom]]')
// Keeper is indexed too: a prune run where EVERY source reads as missing is
// skipped by design (review 5 #1), so the store needs a surviving source.
await save(keeper.id, 'Keeper mentions [[task:early]]')
assert.equal(store.backlinks({ kind: 'task', id: 'phantom' }).links.length, 1)
process.env.CRAFT_FEATURE_ENTITIES_LINKS = '0'
await remove(scratch.id)
assert.equal(store.backlinks({ kind: 'task', id: 'phantom' }).links.length, 1, 'flag off: the store is not touched')
process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
const pushesBeforePrune = linksChanged()
await save(keeper.id, 'Keeper mentions [[task:kept]]')
assert.equal(store.backlinks({ kind: 'task', id: 'phantom' }).links.length, 0, 'the deleted note was pruned after re-enable')
assert.equal(store.backlinks({ kind: 'task', id: 'kept' }).links.length, 1)
assert.ok(linksChanged() > pushesBeforePrune)

if (native) {
  // Review 4 #4: concurrent native saves of one note end with the links of
  // the note's final content, never an older read.
  const base = await invoke(RPC_CHANNELS.notes.READ, keeper.id)
  const concurrentSave = (n: number) =>
    invoke(RPC_CHANNELS.notes.SAVE, keeper.id, `Concurrent save ${n} mentions [[task:c${n}]]`, undefined, op(base.nativeRevision))
  // Deterministic interleaving: save 1 lands first but its post-commit read
  // resolves only after saves 2–6 committed and indexed.
  let releaseLagged!: () => void
  let landed!: () => void
  const lagLanded = new Promise<void>(resolve => { landed = resolve })
  lag = { marker: '[[task:c1]]', gate: new Promise<void>(resolve => { releaseLagged = resolve }), landed }
  const lagged = concurrentSave(1)
  await lagLanded
  await Promise.all([2, 3, 4, 5, 6].map(concurrentSave))
  releaseLagged()
  await lagged
  const final = await invoke(RPC_CHANNELS.notes.READ, keeper.id)
  const expected = /\[\[task:(c\d)\]\]/.exec(final.content)![1]
  assert.notEqual(expected, 'c1')
  assert.deepEqual(targetsOf(keeper.id), [`task:${expected}`], 'the store matches the final content, not the late stale read')
}
await remove(keeper.id)
assert.equal(ownedCount(), 0)

// Review 5 #1: an unavailable notes root never prunes and hides nothing.
const linksWorkspace = { id: workspace.id, rootPath: workspaceRoot }
const guardA = native
  ? await invoke(RPC_CHANNELS.notes.CREATE, 'Guard A', undefined, op(null))
  : await invoke(RPC_CHANNELS.notes.CREATE, 'Guard A')
const guardB = native
  ? await invoke(RPC_CHANNELS.notes.CREATE, 'Guard B', undefined, op(null))
  : await invoke(RPC_CHANNELS.notes.CREATE, 'Guard B')
await save(guardA.id, 'A mentions [[task:guard]]')
await save(guardB.id, 'B mentions [[task:guard]]')
const guardBacklinks = () => store.backlinks({ kind: 'task', id: 'guard' }, {}, { sourceExists: noteLinkSourceProbeFor(linksWorkspace) }).links.length
assert.equal(guardBacklinks(), 2)
const rearm = () => { observeEntitiesLinksEnabled(false); observeEntitiesLinksEnabled(true) }
let restore: () => void
if (native) {
  nativeUnresolved = true // resolveWorkspace() → null: never fall back to a vault root
  restore = () => { nativeUnresolved = false }
} else {
  renameSync(externalNotes, `${externalNotes}.offline`) // custom notesPath unmounted
  restore = () => renameSync(`${externalNotes}.offline`, externalNotes)
}
rearm()
assert.equal(ensureNoteLinksPruned(linksWorkspace), 0, 'unavailable root: nothing pruned')
assert.equal(guardBacklinks(), 2, 'unavailable root: every source counts as present')
assert.equal(ownedCount(), 2)
restore()
// Same generation (the skipped run was not marked): B is really gone now.
rmSync(native ? join(nativeRoot, 'notes', `${guardB.id}.md`) : join(externalNotes, `${guardB.id}.md`))
assert.equal(guardBacklinks(), 1, 'a really missing source is hidden')
assert.equal(ensureNoteLinksPruned(linksWorkspace), 1, 'root back: the missing note is pruned')
assert.equal(ownedCount(), 1)

closeEntityLinkStores()
console.log(`verified-${scenario}`)
