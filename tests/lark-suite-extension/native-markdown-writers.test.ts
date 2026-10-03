import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { MarkdownCommitStore, markdownRevision, type MarkdownChangedEvent, type MarkdownCommitOwner, type NativeMarkdownWriteCommand } from '../../packages/server-core/src/docs/markdown-commit.ts'
import { registerContentHandlers } from '../../packages/server-core/src/handlers/rpc/content.ts'
import type { HandlerFn, RequestContext, RpcServer } from '../../packages/server-core/src/transport/types.ts'
import { RPC_CHANNELS, type NoteDocument } from '../../packages/shared/src/protocol/index.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const modulePath = join(import.meta.dir, '../../packages/server-core/src/docs/markdown-commit.ts')
const initial = '\uFEFF---\r\ntitle: old\r\n---\r\n# Original\r\n'
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rox-native-writers-'))
  roots.push(root)
  await writeFile(join(root, 'old.md'), initial)
  const events: MarkdownChangedEvent[] = []
  const owner: MarkdownCommitOwner = {
    authorize: async actor => actor === 'local', authorizeNative: async actor => actor === 'local',
    authorityEpoch: async () => 1, requireSourceBinding: true, sourceStoreId: async () => 'native-source',
    changed: async event => { events.push(event) },
  }
  const command = (operationId: string, changes: NativeMarkdownWriteCommand['changes'], reason: NativeMarkdownWriteCommand['reason'] = 'rename'): NativeMarkdownWriteCommand => ({
    workspaceId: 'ws', operationId, sourceStoreId: 'native-source', authorityEpoch: 1, reason, changes,
  })
  return { root, owner, events, command }
}
const childOwner = `{authorize:async()=>true,authorizeNative:async()=>true,authorityEpoch:async()=>1,requireSourceBinding:true,sourceStoreId:async()=>"native-source"}`
const save = (operationId: string, content: string) => ({ workspaceId: 'ws', noteId: 'old', operationId, content, expectedRevision: markdownRevision(initial), authorityEpoch: 1, sourceStoreId: 'native-source' })
async function journals(root: string) {
  const state = join(root, '.rox-docs', 'commits')
  const result: Array<{ phase: string; changed?: { state: string }; receipt: { eventId: string }; applied?: number }> = []
  for (const dir of await readdir(state)) {
    if (!/^[a-f0-9]{64}$/.test(dir)) continue
    for (const entry of await readdir(join(state, dir))) {
      if (entry.endsWith('.json')) result.push(JSON.parse(await readFile(join(state, dir, entry), 'utf8')))
    }
  }
  return result
}
async function waitForFile(path: string) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    try { await readFile(path); return } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await Bun.sleep(10)
  }
  throw new Error('Writer did not reach the selected fault boundary')
}

async function nativeComposition() {
  const f = await fixture()
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) }, push() {},
    async invokeClient() { throw new Error('Client invocation is outside this native composition test') },
    hasClientCapability() { return false }, findClientsWithCapability() { return [] },
  }
  const context: RequestContext = { clientId: 'local-window-client', workspaceId: 'ws', webContentsId: 42 }
  const events: Array<{ workspaceId: string; noteId: string; reason: string; eventId?: string }> = []
  let invalidatorAvailable = true
  let ownsWindow = true
  let revokeOnChanged = false
  const api = registerContentHandlers(server, {
    notesRoot: workspaceId => workspaceId === 'ws' ? f.root : null,
    ownsWindow: request => ownsWindow && request.clientId === context.clientId && request.webContentsId === 42,
    async readNote(_workspaceId, noteId, capturedRoot): Promise<NoteDocument> {
      const path = join(capturedRoot, `${noteId}.md`)
      const content = await readFile(path, 'utf8')
      return { id: noteId, title: noteId, content, revision: markdownRevision(content), path,
        relativePath: `${noteId}.md`, properties: {}, links: [], tags: [], backlinks: [], assetRefs: [],
        updatedAt: 0, createdAt: 0, size: Buffer.byteLength(content) }
    },
    changed(workspaceId, noteId, reason, eventId) {
      if (!invalidatorAvailable) throw new Error('native invalidator unavailable')
      events.push({ workspaceId, noteId, reason, eventId })
      if (revokeOnChanged) { revokeOnChanged = false; ownsWindow = false }
    },
  })
  const call = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`Missing registered channel: ${channel}`)
    return await handler(context, ...args)
  }
  return { ...f, api, context, events, call,
    offline: () => { invalidatorAvailable = false }, online: () => { invalidatorAvailable = true },
    revoke: () => { ownsWindow = false }, restore: () => { ownsWindow = true },
    revokeOnNextInvalidation: () => { revokeOnChanged = true } }
}

describe('native Markdown production handler composition', () => {
  test('legacy resolve, read and absent receipt lookup leave the vault without writer metadata', async () => {
    const f = await nativeComposition()
    const before = await readdir(f.root)
    expect(await f.api.readNote(f.context, 'ws', 'old')).toMatchObject({ content: initial, revision: markdownRevision(initial) })
    expect(await f.call(RPC_CHANNELS.content.RESOLVE, { workspaceId: 'ws', entityId: 'note:old' })).toMatchObject({ status: 'ok', descriptorState: 'inferredLegacy' })
    const note = await f.api.readNote(f.context, 'ws', 'old')
    if (!note.sourceStoreId) throw new Error('Expected server-derived native source binding')
    expect(await f.call(RPC_CHANNELS.content.GET_COMMIT_RECEIPT, 'ws', 'old', 'never-submitted', note.sourceStoreId)).toBeNull()
    expect(await readdir(f.root)).toEqual(before)
    await expect(readdir(join(f.root, '.rox-docs'))).rejects.toThrow('ENOENT')
  })

  test('native creation, move and deletion use the actual source authority and durable invalidation event IDs', async () => {
    const f = await nativeComposition()
    const created = await f.api.writeNative(f.context, 'ws', 'create', [{ kind: 'write', noteId: 'projects/new', expectedRevision: null, content: initial }])
    expect(await readFile(join(f.root, 'projects/new.md'), 'utf8')).toBe(initial)
    expect(f.events[0]).toMatchObject({ workspaceId: 'ws', noteId: 'projects/new', reason: 'create', eventId: `${created.eventId}:${createHash('sha256').update('projects/new').digest('hex')}` })
    const moved = await f.api.writeNative(f.context, 'ws', 'rename', [{ kind: 'move', noteId: 'projects/new', targetNoteId: 'projects/moved', expectedRevision: markdownRevision(initial) }])
    expect(await f.api.readNote(f.context, 'ws', 'projects/moved')).toMatchObject({ content: initial })
    expect(f.events[1]).toMatchObject({ noteId: 'projects/moved', reason: 'rename', eventId: `${moved.eventId}:${createHash('sha256').update('projects/moved').digest('hex')}` })
    const deleted = await f.api.writeNative(f.context, 'ws', 'delete', [{ kind: 'delete', noteId: 'projects/moved', expectedRevision: markdownRevision(initial) }])
    expect(f.events[2]).toMatchObject({ noteId: 'projects/moved', reason: 'delete', eventId: `${deleted.eventId}:${createHash('sha256').update('projects/moved').digest('hex')}` })
    await expect(readFile(join(f.root, 'projects/moved.md'))).rejects.toThrow('ENOENT')
    expect((await journals(f.root)).every(journal => journal.phase === 'committed' && journal.changed?.state === 'accepted')).toBe(true)
  })

  test('callback failure returns result-unavailable while the receipt remains retrievable without acceptance', async () => {
    const f = await nativeComposition()
    const note = await f.api.readNote(f.context, 'ws', 'old')
    if (!note.sourceStoreId) throw new Error('Expected server-derived native source binding')
    const command = { ...save('composition-invalidation-offline', initial + '\r\nDurable while callback unavailable\r\n'), sourceStoreId: note.sourceStoreId }
    f.offline()
    await expect(f.api.commit(f.context, command)).rejects.toMatchObject({ code: 'DOCUMENT_RESULT_UNAVAILABLE' })
    expect(await readFile(join(f.root, 'old.md'), 'utf8')).toBe(command.content)
    expect((await journals(f.root))[0]?.changed?.state).toBe('pending')
    expect(await f.call(RPC_CHANNELS.content.GET_COMMIT_RECEIPT, 'ws', 'old', command.operationId, note.sourceStoreId)).toMatchObject({ operationId: command.operationId, revision: markdownRevision(command.content) })
    expect((await journals(f.root))[0]?.changed?.state).toBe('pending')
    expect(await f.api.readNote(f.context, 'ws', 'old')).toMatchObject({ content: command.content })
    f.revoke()
    await expect(f.call(RPC_CHANNELS.content.GET_COMMIT_RECEIPT, 'ws', 'old', command.operationId, note.sourceStoreId)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  test('authorization revoked after durable publication reports unavailable result and denies subsequent reads and receipt lookup', async () => {
    const f = await nativeComposition()
    const note = await f.api.readNote(f.context, 'ws', 'old')
    if (!note.sourceStoreId) throw new Error('Expected server-derived native source binding')
    const command = { ...save('revoke-at-invalidation', initial + '\r\nAuthorized durable content\r\n'), sourceStoreId: note.sourceStoreId }
    f.revokeOnNextInvalidation()
    await expect(f.api.commit(f.context, command)).rejects.toMatchObject({ code: 'DOCUMENT_RESULT_UNAVAILABLE' })
    expect(await readFile(join(f.root, 'old.md'), 'utf8')).toBe(command.content)
    expect((await journals(f.root))[0]?.changed?.state).toBe('pending')
    await expect(f.api.readNote(f.context, 'ws', 'old')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    await expect(f.call(RPC_CHANNELS.content.GET_COMMIT_RECEIPT, 'ws', 'old', command.operationId, note.sourceStoreId)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    f.restore()
    expect(await f.call(RPC_CHANNELS.content.GET_COMMIT_RECEIPT, 'ws', 'old', command.operationId, note.sourceStoreId)).toMatchObject({ operationId: command.operationId, revision: markdownRevision(command.content) })
  })
})

describe('all native Markdown writers share the durable CAS authority', () => {
  test.each(['authorization', 'source binding', 'authority epoch'] as const)('an external edit during final publication %s survives without a committed receipt', async boundary => {
    const f = await fixture()
    let atPublication = false
    let signalPaused!: () => void
    let releasePublication!: () => void
    const paused = new Promise<void>(resolve => { signalPaused = resolve })
    const released = new Promise<void>(resolve => { releasePublication = resolve })
    let pauseCount = 0
    const pause = async () => {
      if (!atPublication) return
      atPublication = false
      pauseCount += 1
      signalPaused()
      await released
    }
    const owner: MarkdownCommitOwner = {
      ...f.owner,
      authorize: async (actor, scope) => {
        if (boundary === 'authorization') await pause()
        return f.owner.authorize(actor, scope)
      },
      sourceStoreId: async () => {
        if (boundary === 'source binding') await pause()
        return 'native-source'
      },
      authorityEpoch: async scope => {
        if (boundary === 'authority epoch') await pause()
        return f.owner.authorityEpoch(scope)
      },
    }
    const store = new MarkdownCommitStore(f.root, owner, async point => {
      // Initial authorization and the check before preparing the temporary file
      // must finish; pause only the owner checks immediately before publication.
      if (point === 'beforeContentRename') atPublication = true
    })
    const command = save(`publication-${boundary.replaceAll(' ', '-')}`, initial + 'Application replacement')
    const externalBytes = Buffer.from('\uFEFF---\r\ntitle: external\r\n---\r\n# External edit\r\n\u0000\r\n', 'utf8')
    const committing = Promise.allSettled([store.commit('local', command)])
    await paused
    try { await writeFile(join(f.root, 'old.md'), externalBytes) }
    finally { releasePublication() }
    const [result] = await committing
    expect(result?.status).toBe('rejected')
    if (result?.status !== 'rejected') throw new Error('Expected the external edit to reject publication')
    expect(result.reason).toMatchObject({ kind: 'conflict' })
    expect(pauseCount).toBe(1)
    expect(await readFile(join(f.root, 'old.md'))).toEqual(externalBytes)
    expect((await journals(f.root)).some(journal => journal.phase === 'committed')).toBe(false)
    expect(await store.getReceipt('local', 'ws', 'old', command.operationId)).toBeNull()
    expect((await journals(f.root))[0]?.phase).toBe('aborted')
    expect(await readFile(join(f.root, 'old.md'))).toEqual(externalBytes)
    expect(f.events).toHaveLength(0)
    expect((await readdir(f.root)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  test('recursive deletion resumes after actual process death between its individual file removals', async () => {
    const f = await fixture()
    await mkdir(join(f.root, 'folder/child'), { recursive: true })
    await writeFile(join(f.root, 'folder/a.md'), 'first file')
    await writeFile(join(f.root, 'folder/child/b.md'), 'second file')
    const snapshot = await new MarkdownCommitStore(f.root, f.owner).folderSnapshot('folder')
    if (!snapshot) throw new Error('Expected native folder snapshot')
    const command = f.command('folder-delete-crash', [{ kind: 'deleteFolder', noteId: 'folder', expectedRevision: snapshot.revision, entries: snapshot.entries, noteIds: snapshot.noteIds }], 'delete')
    const child = Bun.spawn([process.execPath, '-e', `import {MarkdownCommitStore} from ${JSON.stringify(modulePath)};await new MarkdownCommitStore(${JSON.stringify(f.root)},${childOwner},async p=>{if(p==='afterNativeFolderEntry')process.kill(process.pid,'SIGKILL')}).writeNative('local',${JSON.stringify(command)});`], { stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).not.toBe(0)
    await expect(readFile(join(f.root, 'folder/a.md'))).rejects.toThrow('ENOENT')
    expect(await readFile(join(f.root, 'folder/child/b.md'), 'utf8')).toBe('second file')
    expect((await journals(f.root))[0]?.phase).toBe('prepared')
    const receipt = await new MarkdownCommitStore(f.root, f.owner).writeNative('local', command)
    expect(receipt.noteIds).toEqual(['folder/a', 'folder/child/b'])
    await expect(readdir(join(f.root, 'folder'))).rejects.toThrow('ENOENT')
    expect((await journals(f.root))[0]?.phase).toBe('committed')
  })

  test('folder rename preserves binary files and empty folders, then its snapshot guards recursive deletion', async () => {
    const f = await fixture()
    await mkdir(join(f.root, 'projects/topic/empty'), { recursive: true })
    await writeFile(join(f.root, 'projects/topic/note.md'), initial)
    const bytes = Buffer.from([0, 1, 255, 42])
    await writeFile(join(f.root, 'projects/topic/data.bin'), bytes)
    const store = new MarkdownCommitStore(f.root, f.owner)
    const snapshot = await store.folderSnapshot('projects/topic')
    if (!snapshot) throw new Error('Expected native folder snapshot')
    const moved = f.command('folder-rename', [{ kind: 'moveFolder', noteId: 'projects/topic', targetNoteId: 'projects/renamed', expectedRevision: snapshot.revision, noteIds: snapshot.noteIds }])
    await store.writeNative('local', moved)
    expect(await readFile(join(f.root, 'projects/renamed/data.bin'))).toEqual(bytes)
    expect(await readdir(join(f.root, 'projects/renamed/empty'))).toEqual([])
    expect(await readFile(join(f.root, 'projects/renamed/note.md'), 'utf8')).toBe(initial)
    await expect(readdir(join(f.root, 'projects/topic'))).rejects.toThrow('ENOENT')
    const next = await store.folderSnapshot('projects/renamed')
    if (!next) throw new Error('Expected renamed native folder snapshot')
    const deletion = f.command('folder-delete', [{ kind: 'deleteFolder', noteId: 'projects/renamed', expectedRevision: next.revision, entries: next.entries, noteIds: next.noteIds }], 'delete')
    await writeFile(join(f.root, 'projects/renamed/new.md'), 'external addition')
    await expect(store.writeNative('local', deletion)).rejects.toThrow('revision conflict')
    expect(await readFile(join(f.root, 'projects/renamed/new.md'), 'utf8')).toBe('external addition')
    const fresh = await store.folderSnapshot('projects/renamed')
    if (!fresh) throw new Error('Expected complete folder snapshot')
    await store.writeNative('local', f.command('folder-delete-current', [{ kind: 'deleteFolder', noteId: 'projects/renamed', expectedRevision: fresh.revision, entries: fresh.entries, noteIds: fresh.noteIds }], 'delete'))
    await expect(readdir(join(f.root, 'projects/renamed'))).rejects.toThrow('ENOENT')
  })

  test('a killed rename resumes its move, title and backlink CAS steps before acknowledging', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'links.md'), '[[old]]\r\n')
    const command = f.command('rename-crash', [
      { kind: 'move', noteId: 'old', targetNoteId: 'new', expectedRevision: markdownRevision(initial) },
      { kind: 'write', noteId: 'new', expectedRevision: markdownRevision(initial), content: initial.replace('title: old', 'title: new') },
      { kind: 'write', noteId: 'links', expectedRevision: markdownRevision('[[old]]\r\n'), content: '[[new]]\r\n' },
    ])
    const child = Bun.spawn([process.execPath, '-e', `import {MarkdownCommitStore} from ${JSON.stringify(modulePath)}; const store=new MarkdownCommitStore(${JSON.stringify(f.root)},${childOwner},async p=>{if(p==='afterNativeChange')process.kill(process.pid,'SIGKILL')});await store.writeNative('local',${JSON.stringify(command)});`], { stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).not.toBe(0)
    expect(await readFile(join(f.root, 'new.md'), 'utf8')).toBe(initial)
    expect((await journals(f.root))[0]?.phase).toBe('prepared')
    const store = new MarkdownCommitStore(f.root, f.owner)
    const receipt = await store.writeNative('local', command)
    expect(await readFile(join(f.root, 'new.md'), 'utf8')).toBe(initial.replace('title: old', 'title: new'))
    expect(await readFile(join(f.root, 'links.md'), 'utf8')).toBe('[[new]]\r\n')
    await expect(readFile(join(f.root, 'old.md'))).rejects.toThrow('ENOENT')
    expect((await journals(f.root))[0]?.phase).toBe('committed')
    expect(await store.getNativeWriteReceipt('local', 'ws', command.operationId, 'native-source')).toEqual(receipt)
    expect(f.events).toHaveLength(2)
    expect(await store.writeNative('local', command)).toEqual(receipt)
    expect(f.events).toHaveLength(2)
  })

  test('daily merge and save from independent processes cannot both overwrite one base revision', async () => {
    const f = await fixture()
    const ready = join(f.root, 'ready')
    const native = f.command('daily', [{ kind: 'write', noteId: 'old', expectedRevision: markdownRevision(initial), content: initial + '\r\nSession merge\r\n' }], 'save')
    const daily = Bun.spawn([process.execPath, '-e', `import {writeFile} from 'node:fs/promises';import {MarkdownCommitStore} from ${JSON.stringify(modulePath)};const store=new MarkdownCommitStore(${JSON.stringify(f.root)},${childOwner},async p=>{if(p==='afterJournalSync'){await writeFile(${JSON.stringify(ready)},'ready');await Bun.sleep(200)}});await store.writeNative('local',${JSON.stringify(native)});`], { stdout: 'pipe', stderr: 'pipe' })
    await waitForFile(ready)
    const writer = Bun.spawn([process.execPath, '-e', `import {MarkdownCommitStore} from ${JSON.stringify(modulePath)};try{await new MarkdownCommitStore(${JSON.stringify(f.root)},${childOwner}).commit('local',${JSON.stringify(save('editor', initial + 'Editor text'))})}catch(e){if(e.kind==='conflict')process.exit(23);throw e}`], { stdout: 'pipe', stderr: 'pipe' })
    expect(await daily.exited).toBe(0)
    expect(await writer.exited).toBe(23)
    expect(await readFile(join(f.root, 'old.md'), 'utf8')).toBe(native.changes[0]?.kind === 'write' ? native.changes[0].content : '')
  })

  test('pending invalidation survives process death and loss of the callback acceptance ACK', async () => {
    const f = await fixture()
    const accepted = join(f.root, 'accepted-event')
    const command = save('lost-ack', initial + 'Saved bytes')
    const child = Bun.spawn([process.execPath, '-e', `import {writeFile} from 'node:fs/promises';import {MarkdownCommitStore} from ${JSON.stringify(modulePath)};const owner={...${childOwner},changed:async e=>{await writeFile(${JSON.stringify(accepted)},e.eventId)}};await new MarkdownCommitStore(${JSON.stringify(f.root)},owner,async p=>{if(p==='afterChangedAccepted')process.kill(process.pid,'SIGKILL')}).commit('local',${JSON.stringify(command)});`], { stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).not.toBe(0)
    const firstEventId = await readFile(accepted, 'utf8')
    expect((await journals(f.root))[0]?.changed?.state).toBe('pending')
    const restarted = new MarkdownCommitStore(f.root, f.owner)
    expect(await restarted.drainChangedEvents()).toBe(1)
    expect(f.events[0]?.eventId).toBe(firstEventId)
    expect((await journals(f.root))[0]?.changed?.state).toBe('accepted')
    expect(await restarted.drainChangedEvents()).toBe(0)
    expect(await readFile(join(f.root, 'old.md'), 'utf8')).toBe(command.content)
  })

  test('a callback failure retains a committed receipt and pending intent for restart delivery', async () => {
    const f = await fixture()
    const command = save('callback-offline', initial + 'Committed while callback unavailable')
    const unavailable = new MarkdownCommitStore(f.root, { ...f.owner, changed: async () => { throw new Error('native invalidation unavailable') } })
    await expect(unavailable.commit('local', command)).rejects.toThrow('unavailable')
    expect((await journals(f.root))[0]?.phase).toBe('committed')
    expect((await journals(f.root))[0]?.changed?.state).toBe('pending')
    expect((await unavailable.getReceipt('local', 'ws', 'old', command.operationId))?.revision).toBe(markdownRevision(command.content))
    expect((await journals(f.root))[0]?.changed?.state).toBe('pending')
    const store = new MarkdownCommitStore(f.root, f.owner)
    expect(await store.drainChangedEvents()).toBe(1)
    expect((await store.getReceipt('local', 'ws', 'old', command.operationId))?.revision).toBe(markdownRevision(command.content))
    expect(f.events).toHaveLength(1)
  })

  test('a native lifecycle receipt is independent of the still unavailable invalidation acceptance', async () => {
    const f = await fixture()
    const command = f.command('native-receipt-offline', [{ kind: 'write', noteId: 'daily/new', expectedRevision: null, content: 'Created daily content' }], 'create')
    const unavailable = new MarkdownCommitStore(f.root, { ...f.owner, changed: async () => { throw new Error('native invalidation unavailable') } })
    await expect(unavailable.writeNative('local', command)).rejects.toThrow('unavailable')
    expect(await unavailable.getNativeWriteReceipt('local', 'ws', command.operationId, 'native-source')).toMatchObject({ operationId: command.operationId, noteIds: ['daily/new'] })
    expect((await journals(f.root))[0]?.changed?.state).toBe('pending')
    expect(await readFile(join(f.root, 'daily/new.md'), 'utf8')).toBe('Created daily content')
  })

  test('process death inside claim publication is reclaimed by exactly one competing successor', async () => {
    const f = await fixture()
    const child = Bun.spawn([process.execPath, '-e', `import {MarkdownCommitStore} from ${JSON.stringify(modulePath)};await new MarkdownCommitStore(${JSON.stringify(f.root)},${childOwner},async p=>{if(p==='afterClaimSync')process.kill(process.pid,'SIGKILL')}).commit('local',${JSON.stringify(save('claim-crash', 'unpublished'))});`], { stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).not.toBe(0)
    const results = await Promise.allSettled([
      new MarkdownCommitStore(f.root, f.owner).commit('local', save('successor-A', 'successor A')),
      new MarkdownCommitStore(f.root, f.owner).commit('local', save('successor-B', 'successor B')),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    if (rejected?.status !== 'rejected') throw new Error('Expected a competing CAS rejection')
    expect(rejected.reason.kind).toBe('conflict')
  })

  test('a stopped live writer cannot be taken over; recovery starts only after process death', async () => {
    const f = await fixture()
    const ready = join(f.root, 'stopped-ready')
    const first = Bun.spawn([process.execPath, '-e', `import {writeFile} from 'node:fs/promises';import {MarkdownCommitStore} from ${JSON.stringify(modulePath)};await new MarkdownCommitStore(${JSON.stringify(f.root)},${childOwner},async p=>{if(p==='afterJournalSync'){await writeFile(${JSON.stringify(ready)},'ready');process.kill(process.pid,'SIGSTOP')}}).commit('local',${JSON.stringify(save('stopped-owner', 'first owner bytes'))});`], { stdout: 'pipe', stderr: 'pipe' })
    let second: ReturnType<typeof Bun.spawn> | undefined
    try {
      await waitForFile(ready)
      second = Bun.spawn([process.execPath, '-e', `import {MarkdownCommitStore} from ${JSON.stringify(modulePath)};try{await new MarkdownCommitStore(${JSON.stringify(f.root)},${childOwner}).commit('local',${JSON.stringify(save('contender', 'must not replace stopped owner'))})}catch(e){if(e.kind==='conflict')process.exit(23);throw e}`], { stdout: 'pipe', stderr: 'pipe' })
      await Bun.sleep(200)
      expect(second.exitCode).toBeNull()
      expect(await readFile(join(f.root, 'old.md'), 'utf8')).toBe(initial)
      first.kill('SIGKILL')
      await first.exited
      expect(await second.exited).toBe(23)
      expect(await readFile(join(f.root, 'old.md'), 'utf8')).toBe('first owner bytes')
    } finally { if (first.exitCode === null) first.kill('SIGKILL'); if (second?.exitCode === null) second.kill('SIGKILL') }
  })

  test('source migration fences an unfinished native transaction without publishing its remaining steps', async () => {
    const f = await fixture()
    const command = f.command('fenced', [{ kind: 'write', noteId: 'daily/day', expectedRevision: null, content: 'new daily note' }], 'create')
    await expect(new MarkdownCommitStore(f.root, f.owner, async point => { if (point === 'afterJournalSync') throw new Error('interrupt') }).writeNative('local', command)).rejects.toThrow('interrupt')
    const changedOwner = { ...f.owner, sourceStoreId: async () => 'different-source' }
    await expect(new MarkdownCommitStore(f.root, changedOwner).drainChangedEvents()).rejects.toThrow('authorized source owner')
    await expect(readFile(join(f.root, 'daily/day.md'))).rejects.toThrow('ENOENT')
    expect((await journals(f.root))[0]?.phase).toBe('prepared')
  })

  test('create and move reject a preexisting target instead of overwriting its bytes', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'new.md'), 'other note')
    const store = new MarkdownCommitStore(f.root, f.owner)
    await expect(store.writeNative('local', f.command('create-existing', [{ kind: 'write', noteId: 'new', expectedRevision: null, content: 'replacement' }], 'create'))).rejects.toThrow('revision conflict')
    await expect(store.writeNative('local', f.command('move-existing', [{ kind: 'move', noteId: 'old', targetNoteId: 'new', expectedRevision: markdownRevision(initial) }]))).rejects.toThrow('already exists')
    expect(await readFile(join(f.root, 'new.md'), 'utf8')).toBe('other note')
    expect(await readFile(join(f.root, 'old.md'), 'utf8')).toBe(initial)
  })
})
