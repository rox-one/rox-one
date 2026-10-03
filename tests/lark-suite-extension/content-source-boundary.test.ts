import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { WsRpcServer } from '../../packages/server-core/src/transport/server.ts'
import { registerContentHandlers } from '../../packages/server-core/src/handlers/rpc/content.ts'
import { RPC_CHANNELS, PROTOCOL_VERSION, type NoteDocument } from '../../packages/shared/src/protocol/index.ts'
import { markdownRevision } from '../../packages/server-core/src/docs/markdown-commit.ts'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const WORKSPACE = 'source-workspace'
const FOREIGN_BODY = '# PRIVATE_SOURCE_FROM_OTHER_ROOT\n'
const INITIAL_BODY = '# Native source\n'
const COMMITTED_BODY = '# Successfully committed native bytes\n'
const C = RPC_CHANNELS.content

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'rox-content-source-boundary-'))
  cleanups.push(() => rm(temporary, { recursive: true, force: true }))
  const originalRoot = join(temporary, 'native'), foreignRoot = join(temporary, 'other-source')
  await mkdir(originalRoot); await mkdir(foreignRoot)
  await writeFile(join(originalRoot, 'plan.md'), INITIAL_BODY)
  await writeFile(join(foreignRoot, 'plan.md'), FOREIGN_BODY)
  let currentRoot = originalRoot
  let ownsWindow = true
  let beforeReadReturn: ((body: string) => Promise<void> | void) | null = null
  let duringChanged: (() => Promise<void> | void) | null = null
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, serverId: 'content-source-boundary', requireAuth: true,
    validateToken: async token => token === 'source-boundary-test-token',
    resolveLocalClientBinding: candidate => candidate.localClientProof === 'server-owned-proof'
      ? { workspaceId: WORKSPACE, webContentsId: 42 } : null,
  })
  registerContentHandlers(server, {
    notesRoot: workspaceId => workspaceId === WORKSPACE ? currentRoot : null,
    ownsWindow: context => ownsWindow && context.webContentsId === 42 && context.workspaceId === WORKSPACE,
    readNote: async (workspaceId, id) => {
      if (workspaceId !== WORKSPACE || id !== 'plan') throw new Error('not found')
      const firstBody = await readFile(join(currentRoot, 'plan.md'), 'utf8')
      await beforeReadReturn?.(firstBody)
      // This port intentionally observes a live root lookup. The handler must
      // fence both the binding and authority across an awaited source read.
      const path = join(currentRoot, 'plan.md')
      const body = await readFile(path, 'utf8')
      return { id, title: 'Plan', content: body, revision: markdownRevision(body), backlinks: [], tags: [], properties: {}, links: [], assetRefs: [],
        relativePath: 'plan.md', path, updatedAt: 0, createdAt: 0, size: Buffer.byteLength(body) } as NoteDocument
    },
    changed: async () => { await duringChanged?.() },
  })
  await server.listen()
  cleanups.push(() => server.close())
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
  cleanups.push(() => ws.terminate())
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('handshake timed out')), 5000)
    ws.once('error', error => { clearTimeout(timeout); reject(error) })
    const listener = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString())
      if (message.type === 'handshake_ack') { clearTimeout(timeout); ws.off('message', listener); resolve() }
    }
    ws.on('message', listener)
  })
  ws.on('open', () => ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'handshake', protocolVersion: PROTOCOL_VERSION,
    token: 'source-boundary-test-token', workspaceId: 'spoofed', webContentsId: 42, localClientProof: 'server-owned-proof' })))
  await ready
  const request = (channel: string, ...args: unknown[]): Promise<any> => new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const timeout = setTimeout(() => { ws.off('message', listener); reject(new Error(`request timed out: ${channel}`)) }, 15000)
    const listener = (data: WebSocket.RawData) => {
      const response = JSON.parse(data.toString())
      if (response.id === id && response.type === 'response') { clearTimeout(timeout); ws.off('message', listener); resolve(response) }
    }
    ws.on('message', listener)
    ws.send(JSON.stringify({ id, type: 'request', channel, args }))
  })
  return { originalRoot, foreignRoot, request,
    switchRoot: () => { currentRoot = foreignRoot }, restoreRoot: () => { currentRoot = originalRoot },
    revoke: () => { ownsWindow = false }, restoreWindow: () => { ownsWindow = true },
    beforeReadReturn: (callback: typeof beforeReadReturn) => { beforeReadReturn = callback },
    duringChanged: (callback: typeof duringChanged) => { duringChanged = callback },
  }
}
async function command(f: Awaited<ReturnType<typeof fixture>>, operationId: string) {
  const resolved = await f.request(C.RESOLVE, { workspaceId: WORKSPACE, entityId: 'note:plan' })
  expect(resolved.error).toBeUndefined()
  expect(resolved.result.status).toBe('ok')
  expect(resolved.result.origin.sourceStoreId).toMatch(/^native-notes:source-workspace:/)
  return { workspaceId: WORKSPACE, noteId: 'plan', expectedRevision: resolved.result.revision, authorityEpoch: 1,
    sourceStoreId: resolved.result.origin.sourceStoreId as string, operationId, content: COMMITTED_BODY }
}
function expectUnavailable(response: any) {
  expect(response.error?.code).toBe('DOCUMENT_RESULT_UNAVAILABLE')
  expect(response.result).toBeUndefined()
  expect(JSON.stringify(response)).not.toContain(FOREIGN_BODY.trim())
}

// These tests deliberately permit a successful durable write followed by an
// unavailable readback. A denied result must retain the exact operation for replay.
describe('native Docs source and authorization boundaries over real WebSocket transport', () => {
  test('does not return another root body when the source changes after durable publication', async () => {
    const f = await fixture()
    const mutation = await command(f, 'published-before-source-switch')
    let switched = false
    f.beforeReadReturn(body => {
      if (body === COMMITTED_BODY && !switched) { switched = true; f.switchRoot() }
    })
    const response = await f.request(C.COMMIT_MARKDOWN, mutation)
    expect(switched).toBe(true)
    expectUnavailable(response)
    expect(await readFile(join(f.originalRoot, 'plan.md'), 'utf8')).toBe(COMMITTED_BODY)
    expect(await readFile(join(f.foreignRoot, 'plan.md'), 'utf8')).toBe(FOREIGN_BODY)
    f.beforeReadReturn(null); f.restoreRoot()
    const receipt = await f.request(C.GET_COMMIT_RECEIPT, WORKSPACE, 'plan', mutation.operationId, mutation.sourceStoreId)
    expect(receipt.error).toBeUndefined()
    expect(receipt.result.operationId).toBe(mutation.operationId)
    expect(receipt.result.revision).toBe(markdownRevision(COMMITTED_BODY))
    const replay = await f.request(C.COMMIT_MARKDOWN, mutation)
    expect(replay.result.receipt).toEqual(receipt.result)
    expect(replay.result.note.content).toBe(COMMITTED_BODY)
  }, 30000)

  test('does not return a body when its managed window is revoked during changed notification', async () => {
    const f = await fixture()
    const mutation = await command(f, 'published-before-window-revocation')
    let changedCalled = false
    f.duringChanged(async () => { changedCalled = true; await Promise.resolve(); f.revoke() })
    const response = await f.request(C.COMMIT_MARKDOWN, mutation)
    expect(changedCalled).toBe(true)
    expectUnavailable(response)
    expect(await readFile(join(f.originalRoot, 'plan.md'), 'utf8')).toBe(COMMITTED_BODY)
    f.duringChanged(null); f.restoreWindow()
    const receipt = await f.request(C.GET_COMMIT_RECEIPT, WORKSPACE, 'plan', mutation.operationId, mutation.sourceStoreId)
    expect(receipt.result.revision).toBe(markdownRevision(COMMITTED_BODY))
    const replay = await f.request(C.COMMIT_MARKDOWN, mutation)
    expect(replay.result.receipt).toEqual(receipt.result)
    expect(replay.result.note.content).toBe(COMMITTED_BODY)
  }, 30000)

  test('fences source binding across an authorized resolver read', async () => {
    const f = await fixture()
    let switched = false
    f.beforeReadReturn(() => { if (!switched) { switched = true; f.switchRoot() } })
    const response = await f.request(C.RESOLVE, { workspaceId: WORKSPACE, entityId: 'note:plan' })
    expect(switched).toBe(true)
    expect(JSON.stringify(response)).not.toContain(FOREIGN_BODY.trim())
    expect(Boolean(response.error) || response.result?.status === 'error').toBe(true)
    f.beforeReadReturn(null); f.restoreRoot()
    const restored = await f.request(C.RESOLVE, { workspaceId: WORKSPACE, entityId: 'note:plan' })
    expect(restored.error).toBeUndefined()
    expect(restored.result.content).toBe(INITIAL_BODY)
  }, 30000)

  test('rejects an old source command before writing when another root has identical note bytes', async () => {
    const f = await fixture()
    await writeFile(join(f.foreignRoot, 'plan.md'), INITIAL_BODY)
    const mutation = await command(f, 'old-source-identical-content')
    f.switchRoot()
    const foreign = await f.request(C.RESOLVE, { workspaceId: WORKSPACE, entityId: 'note:plan' })
    expect(foreign.result.revision).toBe(mutation.expectedRevision)
    expect(foreign.result.origin.sourceStoreId).not.toBe(mutation.sourceStoreId)
    const response = await f.request(C.COMMIT_MARKDOWN, mutation)
    expect(response.error?.code).toBe('DOCUMENT_AUTHORITY_CHANGED')
    expect(response.result).toBeUndefined()
    expect(await readFile(join(f.originalRoot, 'plan.md'), 'utf8')).toBe(INITIAL_BODY)
    expect(await readFile(join(f.foreignRoot, 'plan.md'), 'utf8')).toBe(INITIAL_BODY)
    const receipt = await f.request(C.GET_COMMIT_RECEIPT, WORKSPACE, 'plan', mutation.operationId, mutation.sourceStoreId)
    expect(receipt.error?.code).toBe('DOCUMENT_AUTHORITY_CHANGED')
    const rebound = await f.request(C.COMMIT_MARKDOWN, { ...mutation, sourceStoreId: foreign.result.origin.sourceStoreId, operationId: 'new-source-identical-content' })
    expect(rebound.error).toBeUndefined()
    expect(rebound.result.note.content).toBe(COMMITTED_BODY)
    expect(await readFile(join(f.originalRoot, 'plan.md'), 'utf8')).toBe(INITIAL_BODY)
  }, 30000)
})
