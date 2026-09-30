import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { WsRpcServer } from '../../packages/server-core/src/transport/server.ts'
import { registerContentHandlers } from '../../packages/server-core/src/handlers/rpc/content.ts'
import { RPC_CHANNELS, PROTOCOL_VERSION, type NoteDocument } from '../../packages/shared/src/protocol/index.ts'
import { deriveNoteMindMap, parseNoteBlockAddress, resolveNoteBlockId } from '../../packages/core/src/mindmap/derive-note.ts'
import { routes } from '../../apps/electron/src/shared/routes.ts'
import { parseCompoundRoute } from '../../apps/electron/src/shared/route-parser.ts'
import { markdownRevision } from '../../packages/server-core/src/docs/markdown-commit.ts'
import type { ContentResolution } from '../../packages/server-core/src/docs/descriptor-resolver.ts'
import type { BlockTreeResult, NativeMarkerMappingPreview, MarkerMappingCommitResult, GetBlockTreeRequest } from '../../packages/server-core/src/docs/block-tree-service.ts'

type Response<T> = { id: string; type: 'response'; result?: T; error?: { code: string; message: string } }
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function value<T>(response: Response<T>): T {
  expect(response.error).toBeUndefined()
  if (response.result === undefined) throw new Error('Missing RPC result')
  return response.result
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rox-block-rpc-'))
  const otherRoot = await mkdtemp(join(tmpdir(), 'rox-block-other-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }), () => rm(otherRoot, { recursive: true, force: true }))
  const content = '\uFEFF---\r\ntitle: План # retained\r\ncustom: [one, two]\r\n---\r\n# План\r\n- Цитата ^a\r\n- Цитата ^b\r\n- Новая\r\n\r\nПроза 😃\r\n\r\n| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n```md\r\n- literal ^code\r\n```\r\n:::future\r\nopaque\r\n:::'
  await writeFile(join(root, 'plan.md'), content)
  await writeFile(join(otherRoot, 'plan.md'), '# Другой\n- secret ^secret\n')
  let configuredRoot = root
  let ownsWindow = true
  let currentServer: WsRpcServer | undefined
  const clients: WebSocket[] = []
  let changes = 0
  async function start() {
    const server = new WsRpcServer({ host: '127.0.0.1', port: 0, serverId: 'block-test', requireAuth: true,
      validateToken: async token => token === 'test-token',
      resolveLocalClientBinding: candidate => candidate.localClientProof === 'owned-proof'
        ? { workspaceId: 'ws', webContentsId: 84 } : null })
    registerContentHandlers(server, {
      notesRoot: workspaceId => workspaceId === 'ws' ? configuredRoot : null,
      ownsWindow: context => ownsWindow && context.workspaceId === 'ws' && context.webContentsId === 84,
      readNote: async (_workspaceId, id, capturedRoot) => {
        const path = join(capturedRoot, `${id}.md`)
        const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(path))
        return { id, title: 'План', content: body, revision: markdownRevision(body), backlinks: [], tags: [],
          properties: {}, links: [], assetRefs: [], relativePath: `${id}.md`, path, updatedAt: 0,
          createdAt: 0, size: Buffer.byteLength(body) } satisfies NoteDocument
      },
      changed: () => { changes += 1 },
    })
    await server.listen()
    currentServer = server
  }
  await start()
  cleanups.push(async () => { for (const client of clients) client.terminate(); await currentServer?.close() })
  async function connect(proof?: string) {
    if (!currentServer) throw new Error('No RPC server')
    const client = new WebSocket(`ws://127.0.0.1:${currentServer.port}`)
    clients.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('error', reject)
      const onMessage = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as { type: string; error?: { message: string } }
        if (message.type === 'handshake_ack') { client.off('message', onMessage); resolve() }
        if (message.type === 'error') reject(new Error(message.error?.message))
      }
      client.on('message', onMessage)
      client.once('open', () => client.send(JSON.stringify({ id: crypto.randomUUID(), type: 'handshake',
        protocolVersion: PROTOCOL_VERSION, token: 'test-token', workspaceId: 'spoofed', webContentsId: 84,
        localClientProof: proof })))
    })
    return client
  }
  function request<T>(client: WebSocket, channel: string, ...args: unknown[]): Promise<Response<T>> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => { client.off('message', listener); reject(new Error(`RPC timeout: ${channel}`)) }, 15000)
      const listener = (data: WebSocket.RawData) => {
        const message = JSON.parse(data.toString()) as Response<T>
        if (message.type === 'response' && message.id === id) {
          clearTimeout(timer); client.off('message', listener); resolve(message)
        }
      }
      client.on('message', listener)
      client.send(JSON.stringify({ id, type: 'request', channel, args }))
    })
  }
  async function scope(client: WebSocket): Promise<GetBlockTreeRequest> {
    const resolution = value(await request<ContentResolution>(client, RPC_CHANNELS.content.RESOLVE,
      { workspaceId: 'ws', entityId: 'note:plan' }))
    return { ref: resolution.canonicalRef, revision: resolution.revision, authorityEpoch: resolution.origin.authorityEpoch,
      sourceStoreId: resolution.origin.sourceStoreId }
  }
  return { root, content, connect, request, scope, changes: () => changes,
    swapRoot: () => { configuredRoot = otherRoot }, revoke: () => { ownsWindow = false },
    restart: async () => { for (const client of clients) client.terminate(); await currentServer?.close(); await start() } }
}

describe('stable block projection through native authenticated RPC', () => {
  test('read preserves all source bytes and literal aliases across edit/reorder/restart (seed 006)', async () => {
    const f = await fixture()
    let client = await f.connect('owned-proof')
    const initialScope = await f.scope(client)
    const initial = value(await f.request<BlockTreeResult>(client, RPC_CHANNELS.content.GET_BLOCK_TREE, initialScope))
    expect(initial.revision).toBe(markdownRevision(f.content))
    expect(initial.listTree.nodes.map(node => node.nodeId)).toEqual(['a', 'b', undefined])
    expect(initial.listTree.nodes.map(node => node.text)).toEqual(['Цитата', 'Цитата', 'Новая'])
    expect(await readFile(join(f.root, 'plan.md'))).toEqual(Buffer.from(f.content))
    const edited = f.content.replace('- Цитата ^a\r\n- Цитата ^b', '- Changed ^b\r\n- Цитата ^a')
    value(await f.request<{ note: NoteDocument }>(client, RPC_CHANNELS.content.COMMIT_MARKDOWN,
      { workspaceId: 'ws', noteId: 'plan', content: edited, expectedRevision: initialScope.revision,
        authorityEpoch: initialScope.authorityEpoch, sourceStoreId: initialScope.sourceStoreId, operationId: 'reorder-seed-006' }))
    await f.restart()
    client = await f.connect('owned-proof')
    const reloaded = value(await f.request<BlockTreeResult>(client, RPC_CHANNELS.content.GET_BLOCK_TREE, await f.scope(client)))
    expect(reloaded.listTree.nodes.map(node => node.nodeId)).toEqual(['b', 'a', undefined])
    expect(reloaded.identity.mappings.map(mapping => [mapping.blockId, mapping.nodeId])).toEqual([['b', 'b'], ['a', 'a']])
    expect(await readFile(join(f.root, 'plan.md'))).toEqual(Buffer.from(edited))
    expect(reloaded.listTree.retainedRegions.length).toBeGreaterThan(0)
  }, 30000)

  test('authenticated actor, exact revision/epoch and source binding gate all block content', async () => {
    const f = await fixture()
    const client = await f.connect('owned-proof')
    const scope = await f.scope(client)
    const untrusted = await f.connect()
    expect((await f.request(untrusted, RPC_CHANNELS.content.GET_BLOCK_TREE, { ...scope, actorPrincipalId: 'admin' })).error?.code).toBe('CHANNEL_NOT_FOUND')
    expect((await f.request(client, RPC_CHANNELS.content.GET_BLOCK_TREE, { ...scope, revision: markdownRevision('wrong') })).error?.code).toBe('HASH_CONFLICT')
    expect((await f.request(client, RPC_CHANNELS.content.GET_BLOCK_TREE, { ...scope, authorityEpoch: 2 })).error?.code).toBe('DOCUMENT_AUTHORITY_CHANGED')
    expect((await f.request(client, RPC_CHANNELS.content.GET_BLOCK_TREE, { ...scope, ref: { workspaceId: 'other', entityId: 'page:plan' } })).error?.code).toBe('AUTH_FAILED')
    const preview = value(await f.request<NativeMarkerMappingPreview>(client, RPC_CHANNELS.content.PREVIEW_MARKER_MAPPING, scope))
    const markerCommand = { preview, reviewedDigest: preview.digest, operationId: 'wrong-source' }
    f.swapRoot()
    expect((await f.request(client, RPC_CHANNELS.content.APPLY_MARKER_MAPPING, markerCommand)).error?.code).toBe('DOCUMENT_AUTHORITY_CHANGED')
    const swapped = await f.request<BlockTreeResult>(client, RPC_CHANNELS.content.GET_BLOCK_TREE, scope)
    expect(swapped.error?.code).toBe('DOCUMENT_AUTHORITY_CHANGED')
    expect(swapped.result).toBeUndefined()
    f.revoke()
    expect((await f.request(client, RPC_CHANNELS.content.GET_BLOCK_TREE, scope)).error?.code).toBe('AUTH_FAILED')
    expect((await f.request(client, RPC_CHANNELS.content.APPLY_MARKER_MAPPING, markerCommand)).error?.code).toBe('AUTH_FAILED')
    expect(await readFile(join(f.root, 'plan.md'))).toEqual(Buffer.from(f.content))
  }, 30000)

  test('explicit preview commits insertions through native CAS with durable reviewed replay after restart', async () => {
    const f = await fixture()
    let client = await f.connect('owned-proof')
    const scope = await f.scope(client)
    const preview = value(await f.request<NativeMarkerMappingPreview>(client, RPC_CHANNELS.content.PREVIEW_MARKER_MAPPING, scope))
    expect(preview.mapping.addedMarkers).toHaveLength(2)
    expect(await readFile(join(f.root, 'plan.md'))).toEqual(Buffer.from(f.content))
    const command = { preview, reviewedDigest: preview.digest, operationId: 'mapping-once-seed-006' }
    expect((await f.request(client, RPC_CHANNELS.content.APPLY_MARKER_MAPPING, { ...command, reviewedDigest: 'wrong' })).error?.code).toBe('DOCUMENT_VALIDATION_FAILED')
    const first = value(await f.request<MarkerMappingCommitResult>(client, RPC_CHANNELS.content.APPLY_MARKER_MAPPING, command))
    expect(first.blockTree.revision).toBe(first.receipt.revision)
    expect(first.blockTree.listTree.nodes.map(node => node.nodeId)).toEqual(['a', 'b', preview.mapping.addedMarkers[1]!.id])
    expect(first.note.content.startsWith('\uFEFF---\r\ntitle: План # retained')).toBe(true)
    // Remove only reviewed insertion bytes: the full original source is recovered exactly.
    let restored = first.note.content
    for (const patch of preview.mapping.patches) restored = restored.replace(patch.replacement, '')
    expect(Buffer.from(restored)).toEqual(Buffer.from(f.content))
    await f.restart()
    client = await f.connect('owned-proof')
    const replay = value(await f.request<MarkerMappingCommitResult>(client, RPC_CHANNELS.content.APPLY_MARKER_MAPPING, command))
    expect(replay.receipt).toEqual(first.receipt)
    expect(replay.blockTree.identity.mappings).toEqual(first.blockTree.identity.mappings)
    expect((await f.request(client, RPC_CHANNELS.content.APPLY_MARKER_MAPPING, { ...command, operationId: 'stale-new-command' })).error?.code).toBe('HASH_CONFLICT')
    expect(await readFile(join(f.root, 'plan.md'))).toEqual(Buffer.from(first.note.content))
  }, 30000)

  test('real Notes routes resolve imported aliases to stable map sources after authorized native reads', async () => {
    const f = await fixture()
    const aliasBody = f.content.replace('^a\r\n', '^a <!-- block:rox_a -->\r\n')
    await writeFile(join(f.root, 'plan.md'), aliasBody)
    const client = await f.connect('owned-proof')
    const route = routes.view.notes('plan#^a')
    const parsed = parseCompoundRoute(route)
    expect(parsed?.details?.type).toBe('note')
    if (parsed?.details?.type !== 'note') throw new Error('Expected native Notes route')
    const address = parseNoteBlockAddress(parsed.details.id)
    expect(address).toEqual({ noteId: 'plan', blockId: 'a' })
    const scope = await f.scope(client)
    const tree = value(await f.request<BlockTreeResult>(client, RPC_CHANNELS.content.GET_BLOCK_TREE,
      { ...scope, ref: { workspaceId: 'ws', entityId: 'note:' + address.noteId } }))
    const nodeId = resolveNoteBlockId(tree.listTree, address.blockId ?? '')
    expect(nodeId).toBe('rox_a')
    expect(resolveNoteBlockId(tree.listTree, 'missing')).toBeNull()
    const graph = deriveNoteMindMap({ noteId: address.noteId, title: 'План', markdown: aliasBody, listTree: tree.listTree })
    expect(graph.nodes['block:rox_a']?.source).toEqual({ kind: 'block', id: 'rox_a' })
    expect(graph.nodes['block:b']?.source).toEqual({ kind: 'block', id: 'b' })
    expect(graph.nodes['block:rox_a']?.label).toBe(graph.nodes['block:b']?.label)
    const stale = deriveNoteMindMap({ noteId: 'plan', title: 'План', markdown: aliasBody + 'changed', listTree: tree.listTree })
    expect(stale.nodes['block:rox_a']).toBeUndefined()
    expect(stale.nodes['block:b']).toBeUndefined()
    expect(await readFile(join(f.root, 'plan.md'))).toEqual(Buffer.from(aliasBody))
  }, 30000)

  test('duplicate markers are diagnostic readOnly nodes and cannot be silently remapped', async () => {
    const f = await fixture()
    const duplicate = f.content.replace('^b', '^a')
    await writeFile(join(f.root, 'plan.md'), duplicate)
    const client = await f.connect('owned-proof')
    const scope = await f.scope(client)
    const tree = value(await f.request<BlockTreeResult>(client, RPC_CHANNELS.content.GET_BLOCK_TREE, scope))
    expect(tree.identity.status).toBe('readOnly')
    expect(tree.identity.diagnostics.some(diagnostic => diagnostic.code === 'duplicateId' && diagnostic.id === 'a')).toBe(true)
    expect(tree.listTree.nodes.slice(0, 2).map(node => node.identity)).toEqual(['ambiguous', 'ambiguous'])
    expect((await f.request(client, RPC_CHANNELS.content.PREVIEW_MARKER_MAPPING, scope)).error?.code).toBe('HASH_CONFLICT')
    expect(await readFile(join(f.root, 'plan.md'))).toEqual(Buffer.from(duplicate))
    expect(f.changes()).toBe(0)
  }, 30000)
})
