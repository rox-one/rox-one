import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeAuthority, type NativeIssuedCredential } from '../../../authority/native-authority.ts'
import { NativeJournal } from '../../../authority/native-journal.ts'
import { CollaborationSyncService } from '../../../collaboration/sync-service.ts'
import { WsRpcServer } from '../../../transport/server.ts'
import { WsRpcClient } from '../../../transport/client.ts'
import { RPC_CHANNELS, type NoteDocument } from '@rox/shared/protocol'
import { legacyDocumentDescriptor, applyMarkerMapping, retainSource } from '@rox/core/docs'
import { FileDescriptorStore, type ContentResolution } from '../../../docs/descriptor-resolver.ts'
import { markdownRevision } from '../../../docs/markdown-commit.ts'
import type { NativeMarkerMappingPreview, BlockTreeResult } from '../../../docs/block-tree-service.ts'
import { registerNotesHandlers } from '../notes.ts'
import type { HandlerDeps } from '../../handler-deps.ts'
import { RoutedClient } from '../../../../../../apps/electron/src/transport/routed-client.ts'
import { buildClientApi } from '../../../../../../apps/electron/src/transport/build-api.ts'
import { CHANNEL_MAP } from '../../../../../../apps/electron/src/transport/channel-map.ts'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const workspaceId = 'native-content-workspace'

async function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'native-content-union-')))
  const root = join(dir, 'workspace')
  const stateDir = join(dir, 'state')
  mkdirSync(root)
  let authority: NativeAuthority
  let journal: NativeJournal
  let server: WsRpcServer
  const clients: WsRpcClient[] = []
  async function start() {
    authority = new NativeAuthority({ stateDir })
    journal = new NativeJournal({ stateDir,
      authorize: (principal, id, action, nativeRoot) => authority.authorize(principal, id, action, nativeRoot),
      permissionFence: (principal, id, action) => authority.permissionFence(principal, id, action),
      authorizePreparedRecovery: (principal, id, action, fence, nativeRoot) => authority.authorizePreparedRecovery(principal, id, action, fence, nativeRoot),
    })
    server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
      validateToken: async token => token === 'legacy-test-token' })
    registerNotesHandlers(server, { nativeData: { authority, journal, sync: new CollaborationSyncService(authority, journal) } } as HandlerDeps)
    await server.listen()
  }
  await start()
  cleanups.push(async () => { for (const client of clients) client.destroy(); await server.close(); journal.close(); authority.close(); rmSync(dir, { recursive: true, force: true }) })
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  let admin: NativeIssuedCredential
  try { Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true }); admin = authority!.bootstrapLocalAdministrator('content test') }
  finally { if (tty) Object.defineProperty(process.stdin, 'isTTY', tty); else Reflect.deleteProperty(process.stdin, 'isTTY') }
  authority!.registerWorkspace(admin.credential, workspaceId, root)
  function enroll(label: string, actions: Array<'read' | 'write' | 'delete'>) {
    const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, label, Date.now() + 60_000), label)!
    authority.grantWorkspace(admin.credential, issued.principal.subject, workspaceId, actions)
    return issued
  }
  const writer = enroll('writer', ['read', 'write', 'delete'])
  function connect(token = writer.credential, workspace: string | null = workspaceId) {
    const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId: workspace ?? undefined, autoReconnect: false, requestTimeout: 5000 })
    clients.push(client)
    return client
  }
  return { root, writer, admin, enroll, connect, authority: () => authority,
    restart: async () => { for (const client of clients) client.destroy(); await server.close(); journal.close(); authority.close(); await start() },
  }
}
async function create(f: Awaited<ReturnType<typeof fixture>>, client: WsRpcClient) {
  return client.invoke(RPC_CHANNELS.notes.CREATE, workspaceId, 'Canonical', undefined,
    { operationId: 'create-canonical', expectedRevision: null, schemaVersion: 1 }) as Promise<NoteDocument>
}
function scope(resolution: ContentResolution) {
  return { ref: resolution.canonicalRef, revision: resolution.revision,
    authorityEpoch: resolution.origin.authorityEpoch, sourceStoreId: resolution.origin.sourceStoreId }
}

test('routed Electron API follows native Notes authority; marker writes use only journal CAS and survive real reopen', async () => {
  const f = await fixture()
  let remote = f.connect()
  let note = await create(f, remote)
  let localCalls = 0
  const localServer = new WsRpcServer({ host: '127.0.0.1', port: 0 })
  for (const channel of [RPC_CHANNELS.notes.READ, RPC_CHANNELS.notes.SAVE, RPC_CHANNELS.notes.UPDATE_PROPERTIES, ...Object.values(RPC_CHANNELS.content)]) {
    localServer.handle(channel, () => { localCalls += 1; throw new Error('Wrong local authority') })
  }
  await localServer.listen()
  const local = new WsRpcClient(`ws://127.0.0.1:${localServer.port}`, { autoReconnect: false })
  cleanups.push(async () => { local.destroy(); await localServer.close() })
  const api = buildClientApi(new RoutedClient(local, remote), CHANNEL_MAP)
  expect((await api.readNote(workspaceId, note.id)).nativeId).toBe(note.nativeId)
  const content = '\uFEFF---\r\ntitle: Canonical\r\n---\r\n# Canonical\r\n- Unmarked item\r\n- Stable ^stable\r\n'
  note = await api.saveNote(workspaceId, note.id, content, undefined, { operationId: 'save-source', expectedRevision: note.nativeRevision!, schemaVersion: 1 })
  const ref = { workspaceId, entityId: `note:${note.nativeId}` }
  const resolution = await api.resolveContent(ref) as ContentResolution
  expect(resolution.status).toBe('ok')
  expect(resolution.origin.nativeId).toBe(note.nativeId!)
  expect(resolution.origin.sourceStoreId).toBe(note.sourceStoreId!)
  const preview = await remote.invoke(RPC_CHANNELS.content.PREVIEW_MARKER_MAPPING, scope(resolution)) as NativeMarkerMappingPreview
  expect(preview.baseContent).toBe(content)
  expect(await remote.invoke(RPC_CHANNELS.content.GET_BLOCK_TREE, scope(resolution))).toHaveProperty('revision', markdownRevision(content))
  await expect(remote.invoke(RPC_CHANNELS.content.APPLY_MARKER_MAPPING, { preview, reviewedDigest: preview.digest, operationId: 'forbidden-wal-markers' })).rejects.toHaveProperty('code', 'CAPABILITY_UNAVAILABLE')
  await expect(remote.invoke(RPC_CHANNELS.content.COMMIT_MARKDOWN, { workspaceId, noteId: note.nativeId, expectedRevision: resolution.revision,
    authorityEpoch: resolution.origin.authorityEpoch, sourceStoreId: resolution.origin.sourceStoreId, content: 'second writer', operationId: 'forbidden-wal' })).rejects.toHaveProperty('code', 'CAPABILITY_UNAVAILABLE')
  await expect(remote.invoke(RPC_CHANNELS.content.GET_COMMIT_RECEIPT, workspaceId, note.nativeId, 'forbidden-wal', resolution.origin.sourceStoreId)).rejects.toHaveProperty('code', 'CAPABILITY_UNAVAILABLE')
  expect(existsSync(join(f.root, 'notes', '.rox-docs'))).toBe(false)
  const applied = applyMarkerMapping(retainSource(preview.baseContent), preview.mapping, preview.authorityEpoch)
  if (applied.status !== 'ok') throw new Error('Reviewed native mapping failed')
  const saveOperation = { operationId: 'native-reviewed-markers', expectedRevision: note.nativeRevision!, schemaVersion: 1 as const }
  note = await api.saveNote(workspaceId, note.id, applied.text, undefined, saveOperation)
  expect(note.nativeRevision).toBe(3)
  const withProperties = await api.updateNoteProperties(workspaceId, note.id, { category: 'retained' }, { operationId: 'native-properties', expectedRevision: note.nativeRevision!, schemaVersion: 1 })
  expect(withProperties.properties.category).toBe('retained')
  expect(localCalls).toBe(0)
  await expect(remote.invoke(RPC_CHANNELS.notes.SAVE, workspaceId, note.id, 'stale', undefined,
    { operationId: 'stale-new-op', expectedRevision: 1, schemaVersion: 1 })).rejects.toThrow()
  await f.restart()
  remote = f.connect()
  const reopened = await remote.invoke(RPC_CHANNELS.notes.READ, workspaceId, note.id) as NoteDocument
  expect(reopened.nativeId).toBe(note.nativeId)
  expect(reopened.nativeRevision).toBe(4)
  expect(readFileSync(reopened.path, 'utf8')).toBe(withProperties.content)
  const reloaded = await remote.invoke(RPC_CHANNELS.content.RESOLVE, ref) as ContentResolution
  const blocks = await remote.invoke(RPC_CHANNELS.content.GET_BLOCK_TREE, scope(reloaded)) as BlockTreeResult
  expect(blocks.listTree.nodes.map(node => node.nodeId)).toContain('stable')
  expect(blocks.listTree.nodes.every(node => !!node.nodeId)).toBe(true)
  await expect(remote.invoke(RPC_CHANNELS.content.COMMIT_MARKDOWN, { workspaceId, noteId: note.nativeId, expectedRevision: reloaded.revision,
    authorityEpoch: 1, sourceStoreId: reloaded.origin.sourceStoreId, content: 'after restart writer', operationId: 'forbidden-reopen-wal' })).rejects.toHaveProperty('code', 'CAPABILITY_UNAVAILABLE')
  expect(existsSync(join(f.root, 'notes', '.rox-docs'))).toBe(false)
})

test('native projection never reads or recovers legacy WAL; persisted descriptors remain readable by another authorized principal', async () => {
  const f = await fixture()
  const client = f.connect()
  const note = await create(f, client)
  const legacy = join(f.root, 'notes', '.rox-docs')
  mkdirSync(join(legacy, 'commits'), { recursive: true })
  writeFileSync(join(legacy, 'descriptors.json.lock'), 'untrusted interrupted legacy writer')
  writeFileSync(join(legacy, 'commits', 'foreign.json'), 'corrupt legacy intent')
  writeFileSync(join(f.root, 'notes', 'foreign.md'), 'outside canonical journal')
  const ref = { workspaceId, entityId: `note:${note.nativeId}` }
  const resolution = await client.invoke(RPC_CHANNELS.content.RESOLVE, ref) as ContentResolution
  expect(resolution.content).toBe(note.content)
  const adopted = await client.invoke(RPC_CHANNELS.content.ADOPT_DESCRIPTOR, { ref, expectedRevision: resolution.revision,
    expectedDescriptorRevision: null, operationId: 'adopt-canonical', idempotencyKey: 'adopt-canonical', authorityEpoch: 1,
    descriptor: legacyDocumentDescriptor({ ref, contentRevision: resolution.revision, authorityEpoch: 1 }) })
  expect(adopted.status).toBe('committed')
  const reader = f.enroll('reader', ['read'])
  const readClient = f.connect(reader.credential)
  const shared = await readClient.invoke(RPC_CHANNELS.content.RESOLVE, ref) as ContentResolution
  expect(shared.status).toBe('ok')
  expect(shared.descriptorState).toBe('persisted')
  expect(shared.origin).toEqual(resolution.origin)
  expect(shared.capabilities.write).toBe(false)
  expect(shared.capabilities.adoptDescriptor).toBe(false)
  await expect(readClient.invoke(RPC_CHANNELS.content.COMMIT_MARKDOWN, {})).rejects.toHaveProperty('code', 'AUTH_FAILED')
  expect(await client.invoke(RPC_CHANNELS.content.RESOLVE, { workspaceId, entityId: 'note:foreign' })).toEqual({ status: 'error', code: 'deleted' })
  expect(readFileSync(join(legacy, 'descriptors.json.lock'), 'utf8')).toBe('untrusted interrupted legacy writer')
  expect(readFileSync(join(legacy, 'commits', 'foreign.json'), 'utf8')).toBe('corrupt legacy intent')
  await f.restart()
  const reopened = await f.connect(reader.credential).invoke(RPC_CHANNELS.content.RESOLVE, ref) as ContentResolution
  expect(reopened.descriptorState).toBe('persisted')
  expect(reopened.origin).toEqual(shared.origin)
})

test('revocation and regrant while descriptor lookup awaits cannot return native bytes or edit capabilities', async () => {
  const f = await fixture()
  const client = f.connect()
  const note = await create(f, client)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const original = FileDescriptorStore.prototype.read
  FileDescriptorStore.prototype.read = async function () { entered.resolve(); await release.promise; return original.call(this) }
  try {
    const pending = client.invoke(RPC_CHANNELS.content.RESOLVE, { workspaceId, entityId: `note:${note.nativeId}` })
    await entered.promise
    f.authority().revokeWorkspaceGrant(f.admin.credential, f.writer.principal.subject, workspaceId)
    f.authority().grantWorkspace(f.admin.credential, f.writer.principal.subject, workspaceId, ['read', 'write', 'delete'])
    release.resolve()
    await expect(pending).rejects.toHaveProperty('code', 'AUTH_FAILED')
    expect(readFileSync(note.path, 'utf8')).toBe(note.content)
    expect(existsSync(join(f.root, 'notes', '.rox-docs'))).toBe(false)
  } finally { release.resolve(); FileDescriptorStore.prototype.read = original }
})

test('active native authority denies missing-principal legacy requests before any read or write', async () => {
  const f = await fixture()
  const note = await create(f, f.connect())
  const legacy = f.connect('legacy-test-token', null)
  await expect(legacy.invoke(RPC_CHANNELS.notes.SAVE, workspaceId, note.id, 'legacy overwrite', note.revision, note.sourceStoreId)).rejects.toHaveProperty('code', 'AUTH_FAILED')
  await expect(legacy.invoke(RPC_CHANNELS.content.RESOLVE, { workspaceId, entityId: `note:${note.nativeId}`, actorPrincipalId: 'spoofed' })).rejects.toHaveProperty('code', 'CHANNEL_NOT_FOUND')
  expect(readFileSync(note.path, 'utf8')).toBe(note.content)
  expect(existsSync(join(f.root, 'notes', '.rox-docs'))).toBe(false)
})


test('native SAVE positional wire rejects source-store string in argument five and shifted operation in argument four without legacy fallback', async () => {
  const f = await fixture()
  const client = f.connect()
  const note = await create(f, client)
  // Native RPC errors keep the generic privacy envelope. Wrong-position
  // metadata must still fail before any canonical or legacy mutation.
  const operation = { operationId: 'wrong-position', expectedRevision: note.nativeRevision!, schemaVersion: 1 }
  await expect(client.invoke(RPC_CHANNELS.notes.SAVE, workspaceId, note.id, 'wrong string writer', note.revision, note.sourceStoreId)).rejects.toMatchObject({ code: 'HANDLER_ERROR', message: 'Request failed' })
  await expect(client.invoke(RPC_CHANNELS.notes.SAVE, workspaceId, note.id, 'shifted writer', operation)).rejects.toMatchObject({ code: 'HANDLER_ERROR', message: 'Request failed' })
  const unchanged = await client.invoke(RPC_CHANNELS.notes.READ, workspaceId, note.id) as NoteDocument
  expect(unchanged.nativeId).toBe(note.nativeId)
  expect(unchanged.nativeRevision).toBe(note.nativeRevision)
  expect(unchanged.content).toBe(note.content)
  expect(readFileSync(note.path, 'utf8')).toBe(note.content)
  expect(existsSync(join(f.root, 'notes', '.rox-docs'))).toBe(false)
})
