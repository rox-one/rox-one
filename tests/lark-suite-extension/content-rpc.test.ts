import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { WsRpcServer } from '../../packages/server-core/src/transport/server.ts'
import { registerContentHandlers } from '../../packages/server-core/src/handlers/rpc/content.ts'
import { RPC_CHANNELS, PROTOCOL_VERSION, type NoteDocument } from '../../packages/shared/src/protocol/index.ts'
import { markdownRevision } from '../../packages/server-core/src/docs/markdown-commit.ts'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rox-content-rpc-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const content = '\uFEFF---\r\ntitle: План # keep\r\n---\r\n# План\r\n- Билет ^ticket\r\n'
  await writeFile(join(root, 'plan.md'), content)
  let ownsWindow = true
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, serverId: 'content-test', requireAuth: true,
    validateToken: async token => token === 'content-test-token',
    resolveLocalClientBinding: candidate => candidate.localClientProof === 'server-owned-proof'
      ? { workspaceId: 'ws', webContentsId: 42 } : null,
  })
  registerContentHandlers(server, {
    notesRoot: workspaceId => workspaceId === 'ws' ? root : null,
    ownsWindow: context => ownsWindow && context.webContentsId === 42 && context.workspaceId === 'ws',
    readNote: async (workspaceId, id) => {
      if (workspaceId !== 'ws' || id !== 'plan') throw new Error('not found')
      const body = await readFile(join(root, 'plan.md'), 'utf8')
      return { id, title: 'План', content: body, revision: markdownRevision(body), backlinks: [], tags: [], properties: {}, links: [], assetRefs: [], relativePath: 'plan.md', path: join(root, 'plan.md'), updatedAt: 0, createdAt: 0, size: Buffer.byteLength(body) } as NoteDocument
    },
    changed: () => {},
  })
  await server.listen()
  const port = server.port
  cleanups.push(() => server.close())
  const connect = async (proof?: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    cleanups.push(() => ws.close())
    const ack = new Promise<any>((resolve, reject) => {
      ws.on('error', reject)
      ws.on('message', data => { const message = JSON.parse(data.toString()); if (message.type === 'handshake_ack') resolve(message); if (message.type === 'error') reject(new Error(message.error?.message)) })
    })
    ws.on('open', () => ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'handshake', protocolVersion: PROTOCOL_VERSION, token: 'content-test-token', workspaceId: 'spoofed', webContentsId: 42, localClientProof: proof })))
    await ack
    return ws
  }
  const request = (ws: WebSocket, channel: string, ...args: unknown[]): Promise<any> => new Promise(resolve => {
    const id = crypto.randomUUID()
    const listener = (data: WebSocket.RawData) => {
      const result = JSON.parse(data.toString())
      if (result.id === id && result.type === 'response') { ws.off('message', listener); resolve(result) }
    }
    ws.on('message', listener)
    ws.send(JSON.stringify({ id, type: 'request', channel, args }))
  })
  return { root, content, connect, request, revoke: () => { ownsWindow = false } }
}

describe('native Docs RPC over a real WebSocket', () => {
  test('does not treat a supplied webContentsId or actor field as a local principal', async () => {
    const f = await fixture()
    const untrusted = await f.connect()
    const denied = await f.request(untrusted, RPC_CHANNELS.content.RESOLVE, { workspaceId: 'ws', entityId: 'note:plan', actorPrincipalId: 'admin' })
    expect(denied.error.code).toBe('CHANNEL_NOT_FOUND')
    expect(await readFile(join(f.root, 'plan.md'), 'utf8')).toBe(f.content)
  })

  test('resolves note/page aliases without writing and commits exact bytes with durable replay', async () => {
    const f = await fixture()
    const ws = await f.connect('server-owned-proof')
    const note = await f.request(ws, RPC_CHANNELS.content.RESOLVE, { workspaceId: 'ws', entityId: 'note:plan' })
    const page = await f.request(ws, RPC_CHANNELS.content.RESOLVE, { workspaceId: 'ws', entityId: 'page:plan' })
    expect(note.result.canonicalRef.entityId).toBe('page:plan')
    expect(page.result.origin).toEqual(note.result.origin)
    expect(note.result.descriptorState).toBe('inferredLegacy')
    expect(await readFile(join(f.root, 'plan.md'), 'utf8')).toBe(f.content)
    const command = { workspaceId: 'ws', noteId: 'plan', expectedRevision: note.result.revision, authorityEpoch: 1, sourceStoreId: note.result.origin.sourceStoreId, operationId: 'save-once', content: f.content + '\r\nДополнение\r\n', actorPrincipalId: 'spoofed-user' }
    const first = await f.request(ws, RPC_CHANNELS.content.COMMIT_MARKDOWN, command)
    expect(first.error).toBeUndefined()
    expect(first.result.note.content).toBe(command.content)
    expect(first.result.receipt.actorPrincipalId).not.toBe('spoofed-user')
    const replay = await f.request(ws, RPC_CHANNELS.content.COMMIT_MARKDOWN, command)
    expect(replay.result.receipt).toEqual(first.result.receipt)
    const stale = await f.request(ws, RPC_CHANNELS.content.COMMIT_MARKDOWN, { ...command, operationId: 'stale' })
    expect(stale.error.code).toBe('HASH_CONFLICT')
    expect(stale.error.message).toContain('revision conflict')
    expect(await readFile(join(f.root, 'plan.md'), 'utf8')).toBe(command.content)
  })

  test('rejects a foreign workspace and rechecks window authorization after connection', async () => {
    const f = await fixture()
    const ws = await f.connect('server-owned-proof')
    const foreign = await f.request(ws, RPC_CHANNELS.content.RESOLVE, { workspaceId: 'other', entityId: 'note:plan' })
    expect(foreign.error.message).toContain('denied')
    expect(foreign.error.code).toBe('AUTH_FAILED')
    f.revoke()
    const revoked = await f.request(ws, RPC_CHANNELS.content.RESOLVE, { workspaceId: 'ws', entityId: 'note:plan' })
    expect(revoked.error.message).toContain('denied')
    expect(revoked.error.code).toBe('AUTH_FAILED')
  })
})
