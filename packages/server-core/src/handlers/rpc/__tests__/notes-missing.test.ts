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
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rox-qa-note-read-')))
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

test('create, save, reopen, delete then revisit reports structured NOT_FOUND without a filesystem path', async () => {
  const f = await fixture()
  const created: NoteDocument = await f.invoke(RPC_CHANNELS.notes.CREATE, 'QA-ROX-20261003', undefined,
    { operationId: 'create', expectedRevision: null, schemaVersion: 1 })
  const saved: NoteDocument = await f.invoke(RPC_CHANNELS.notes.SAVE, created.id, '# QA saved', undefined,
    { operationId: 'save', expectedRevision: created.nativeRevision, schemaVersion: 1 })
  expect((await f.invoke(RPC_CHANNELS.notes.READ, saved.id)).content).toBe('# QA saved')
  expect(await f.invoke(RPC_CHANNELS.notes.DELETE, saved.id,
    { operationId: 'delete', expectedRevision: saved.nativeRevision, schemaVersion: 1 })).toBe(true)
  for (let visit = 0; visit < 2; visit++) {
    await expect(f.invoke(RPC_CHANNELS.notes.READ, saved.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(f.invoke(RPC_CHANNELS.notes.READ, saved.id)).rejects.not.toThrow(f.root)
  }
})

test('a missing target file is NOT_FOUND but a real stat failure remains an I/O error', async () => {
  const f = await fixture()
  const created: NoteDocument = await f.invoke(RPC_CHANNELS.notes.CREATE, 'Target', undefined,
    { operationId: 'create', expectedRevision: null, schemaVersion: 1 })
  await rm(created.path)
  await expect(f.invoke(RPC_CHANNELS.notes.READ, created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await rm(join(f.root, 'notes'), { recursive: true })
  await writeFile(join(f.root, 'notes'), 'not a directory')
  try { await f.invoke(RPC_CHANNELS.notes.READ, created.id); throw new Error('read unexpectedly succeeded') }
  catch (error) { expect((error as { code?: string }).code).not.toBe('NOT_FOUND'); expect((error as { code?: string }).code).toBeDefined() }
})

test('authorization and journal I/O failures do not become missing-note responses', async () => {
  const denied = await fixture()
  denied.deny()
  await expect(denied.invoke(RPC_CHANNELS.notes.READ, 'missing')).rejects.toThrow('unauthorized')
  const failed = await fixture()
  const error = Object.assign(new Error('ENOENT: missing journal dependency'), { code: 'ENOENT', path: join(failed.root, 'journal.db') })
  failed.failPull(error)
  await expect(failed.invoke(RPC_CHANNELS.notes.READ, 'missing')).rejects.toBe(error)
})

test('deleted nested folders are missing notes, but corrupted folder paths remain storage failures', async () => {
  const f = await fixture()
  const note: NoteDocument = await f.invoke(RPC_CHANNELS.notes.CREATE, 'Nested', 'folder',
    { operationId: 'nested-create', expectedRevision: null, schemaVersion: 1 })
  await rm(dirname(note.path), { recursive: true })
  await expect(f.invoke(RPC_CHANNELS.notes.READ, note.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await writeFile(dirname(note.path), 'not a folder')
  try { await f.invoke(RPC_CHANNELS.notes.READ, note.id); throw new Error('read unexpectedly succeeded') }
  catch (error) { expect((error as { code?: string }).code).not.toBe('NOT_FOUND'); expect((error as { code?: string }).code).toBeDefined() }
})

test('legacy local document reads distinguish deleted targets, source failures and real read errors', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rox-qa-local-note-')))
  roots.push(root)
  let reads = 0
  let readError: Error | undefined
  const content = registerContentHandlers({ handle: () => {} } as unknown as RpcServer, {
    notesRoot: () => root, ownsWindow: () => true, changed: () => {},
    readNote: async (_workspaceId, id) => {
      reads++
      if (readError) throw readError
      return { id, path: join(root, `${id}.md`), content: '# Legacy' } as NoteDocument
    },
  })
  const context = { workspaceId: 'local-qa', clientId: 'local-fixture', webContentsId: 1 } as RequestContext
  await expect(content.readNote(context, 'local-qa', 'Legacy')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(reads).toBe(0)
  await writeFile(join(root, 'Legacy.md'), '# Legacy')
  expect((await content.readNote(context, 'local-qa', 'Legacy')).content).toBe('# Legacy')
  readError = Object.assign(new Error('read failed'), { code: 'EIO' })
  await expect(content.readNote(context, 'local-qa', 'Legacy')).rejects.toBe(readError)
  await expect(content.readNote(context, 'other-workspace', 'Legacy')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  await rm(join(root, 'Legacy.md'))
  await expect(content.readNote(context, 'local-qa', 'Legacy')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await rm(root, { recursive: true })
  await expect(content.readNote(context, 'local-qa', 'Legacy')).rejects.toMatchObject({ code: 'ENOENT' })
})

test('target absence classifier preserves EACCES, EIO and unrelated ENOENT without inspecting messages', async () => {
  const f = await fixture()
  const path = join(f.root, 'Missing.md')
  for (const error of [Object.assign(new Error('NOT_FOUND'), { code: 'EACCES', path }),
    Object.assign(new Error('ENOENT'), { code: 'EIO', path }),
    Object.assign(new Error('missing dependency'), { code: 'ENOENT', path: join(f.root, 'index.db') }),
    new Error('ENOENT: missing note')]) {
    await expect(readNoteTarget(f.root, path, async () => { throw error })).rejects.toBe(error)
  }
})

test.each(['root-missing', 'root-file', 'parent-file'] as const)('absent journal entry does not conceal %s', async corruption => {
  const f = await fixture()
  const notesRoot = join(f.root, 'notes')
  if (corruption === 'root-file') await writeFile(notesRoot, 'not a source directory')
  if (corruption === 'parent-file') { await mkdir(notesRoot); await writeFile(join(notesRoot, 'folder'), 'not a folder') }
  let caught: unknown
  try { await f.invoke(RPC_CHANNELS.notes.READ, 'folder/deleted') } catch (error) { caught = error }
  expect(caught).toBeDefined()
  expect((caught as { code?: string }).code).not.toBe('NOT_FOUND')
  expect((caught as { code?: string }).code).toBe(corruption === 'root-missing' ? 'ENOENT' : 'DOCUMENT_AUTHORITY_CHANGED')
  if (corruption === 'root-missing') await expect(realpath(notesRoot)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('absent journal entry is NOT_FOUND only under a healthy authorized source', async () => {
  const f = await fixture()
  await mkdir(join(f.root, 'notes'))
  await expect(f.invoke(RPC_CHANNELS.notes.READ, 'folder/deleted')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  for (const id of ['../outside', '/outside', 'folder\\outside', 'imports/foreign']) {
    let caught: unknown
    try { await f.invoke(RPC_CHANNELS.notes.READ, id) } catch (error) { caught = error }
    expect(caught).toBeDefined()
    expect((caught as { code?: string }).code).not.toBe('NOT_FOUND')
  }
})

test('absent journal entry does not hide a directory in place of a Markdown file', async () => {
  const f = await fixture()
  await mkdir(join(f.root, 'notes', 'invalid.md'), { recursive: true })
  await expect(f.invoke(RPC_CHANNELS.notes.READ, 'invalid')).rejects.toMatchObject({ code: 'DOCUMENT_AUTHORITY_CHANGED' })
})

test.each(['escape', 'dangling-parent', 'dangling-target'] as const)('missing %s path stays denied for native and legacy reads', async kind => {
  const f = await fixture()
  const notesRoot = join(f.root, 'notes'), outside = join(f.root, 'outside')
  await mkdir(notesRoot); await mkdir(outside)
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  let noteId = 'escape/deleted'
  if (kind === 'escape') await symlink(outside, join(notesRoot, 'escape'), linkType)
  if (kind === 'dangling-parent') { await symlink(outside, join(notesRoot, 'escape'), linkType); await rm(outside, { recursive: true }) }
  if (kind === 'dangling-target') {
    // A directory junction named *.md avoids requiring Windows file-symlink rights.
    noteId = 'dangling'
    await symlink(outside, join(notesRoot, 'dangling.md'), linkType)
    await rm(outside, { recursive: true })
  }
  const legacy = registerContentHandlers({ handle: () => {} } as unknown as RpcServer, {
    notesRoot: () => notesRoot, ownsWindow: () => true, changed: () => {},
    readNote: async () => { throw new Error('must not read forbidden path') },
  })
  await expect(f.invoke(RPC_CHANNELS.notes.READ, noteId)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  await expect(legacy.readNote({ workspaceId: 'local-qa', clientId: 'fixture', webContentsId: 1 } as RequestContext,
    'local-qa', noteId)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
})

test('canonical Knowledge projection retains Notes identity/schema and does not hide failed stat reads', async () => {
  const f = await fixture()
  const created: NoteDocument = await f.invoke(RPC_CHANNELS.notes.CREATE, 'Knowledge', undefined,
    { operationId: 'knowledge-create', expectedRevision: null, schemaVersion: 1 })
  const access = nativeNotesKnowledgeAccess(f.deps, f.context)
  expect(access.connectionId).toBe('local-markdown:qa-workspace')
  const documents = await access.list()
  expect(documents).toHaveLength(1)
  expect(documents[0]).toMatchObject({ id: created.id, nativeId: created.nativeId, content: created.content,
    nativeRevision: created.nativeRevision, sourceStoreId: created.sourceStoreId, revision: created.revision })
  await rm(created.path)
  await expect(access.list()).rejects.toMatchObject({ code: 'NOT_FOUND' })
  f.deny()
  await expect(access.list()).rejects.toThrow('permission changed')
})
