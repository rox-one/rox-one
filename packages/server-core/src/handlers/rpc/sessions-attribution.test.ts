import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodedError, RPC_CHANNELS, type ErrorCode } from '@rox/shared/protocol'
import { sessionPersistenceQueue } from '@rox/shared/sessions'
import { SessionManager } from '../../sessions/SessionManager'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'

const roots: string[] = []
afterEach(async () => {
  await sessionPersistenceQueue.flushAll()
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

interface Fixture {
  id: string
  workspace: { id: string; name: string; rootPath: string }
  agent: null
  messages: unknown[]
  messagesLoaded: boolean
  isProcessing: boolean
  visibility?: 'shared' | 'read-only' | 'suggest' | 'draft'
  owner?: { kind: 'account' | 'agent'; id: string; displayName: string; assignedAt: number; assignedBy: string }
  creator?: { accountId: string; displayName: string; kind: 'profile' | 'channel' | 'agent' }
  participants?: Array<{ accountId: string; displayName: string; username: string; kind: 'profile' | 'channel' | 'agent' }>
}

function createHarness(overrides: Partial<Fixture> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rox-attribution-rpc-'))
  roots.push(root)
  const manager = new SessionManager()
  const target: Fixture = {
    id: 'attributed-session',
    workspace: { id: 'attributed-workspace', name: 'Attributed workspace', rootPath: root },
    agent: null, messages: [], messagesLoaded: true, isProcessing: false,
    creator: { accountId: 'installation', displayName: 'Local', kind: 'profile' },
    participants: [{ accountId: 'installation', displayName: 'Local', username: 'installation', kind: 'profile' }],
    ...overrides,
  }
  const sessions = (manager as unknown as { sessions: Map<string, Fixture> }).sessions
  sessions.set(target.id, target)

  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle: (channel: string, handler: HandlerFn) => { handlers.set(channel, handler) },
    push() {}, async invokeClient() {}, hasClientCapability: () => false, findClientsWithCapability: () => [],
  } as unknown as RpcServer
  registerSessionsHandlers(server, {
    sessionManager: manager,
    platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } },
  } as unknown as HandlerDeps)
  const ctx: RequestContext = { clientId: 'local-client', workspaceId: target.workspace.id, webContentsId: null }

  // Ack the way a real durable send does, so the handler resolves accepted.
  const stubSend = (messageId = 'm1') => async (
    _sessionId: string, _message: string, _attachments?: unknown, _stored?: unknown, _options?: unknown,
    _existing?: string, _retry?: boolean, onAck?: (persistedId: string) => void,
  ) => { onAck?.(messageId) }

  return {
    manager, target, ctx,
    assignOwner: (owner: unknown) => handlers.get(RPC_CHANNELS.sessions.ASSIGN_OWNER)!(ctx, target.id, owner),
    send: (message = 'hi') => handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)!(ctx, target.id, message),
    command: (command: unknown) => handlers.get(RPC_CHANNELS.sessions.COMMAND)!(ctx, target.id, command),
    stubSend,
  }
}

async function expectCode(promise: Promise<unknown>, code: ErrorCode) {
  try {
    await promise
    throw new Error('expected the call to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(CodedError)
    expect((error as CodedError).code).toBe(code)
  }
}

describe('sessions:assignOwner handler (a1.3)', () => {
  it('assigns and clears the owner while preserving the creator', async () => {
    const harness = createHarness()
    await harness.assignOwner({ kind: 'account', id: 'ada', displayName: 'Ada' })

    expect(harness.target.owner).toMatchObject({ kind: 'account', id: 'ada', displayName: 'Ada', assignedBy: 'installation' })
    expect(harness.target.creator).toEqual({ accountId: 'installation', displayName: 'Local', kind: 'profile' })
    expect(harness.target.participants?.map(participant => participant.accountId)).toEqual(['installation', 'ada'])

    await harness.assignOwner(null)
    expect(harness.target.owner).toBeUndefined()
    expect(harness.target.creator).toEqual({ accountId: 'installation', displayName: 'Local', kind: 'profile' })
  })
})

describe('server-side visibility enforcement (a2.5)', () => {
  it('blocks a non-owner send on read-only with SESSION_READ_ONLY', async () => {
    const harness = createHarness({
      visibility: 'read-only',
      owner: { kind: 'account', id: 'ada', displayName: 'Ada', assignedAt: 1, assignedBy: 'installation' },
    })
    await expectCode(harness.send(), 'SESSION_READ_ONLY')
  })

  it('blocks a non-owner send on draft with SESSION_OWNER_ONLY', async () => {
    const harness = createHarness({
      visibility: 'draft',
      owner: { kind: 'account', id: 'ada', displayName: 'Ada', assignedAt: 1, assignedBy: 'installation' },
    })
    await expectCode(harness.send(), 'SESSION_OWNER_ONLY')
  })

  it('allows shared and suggest sends and binds the writer as a participant', async () => {
    for (const visibility of ['shared', 'suggest'] as const) {
      const harness = createHarness({ visibility })
      harness.manager.sendMessage = harness.stubSend()
      expect(await harness.send()).toEqual({ accepted: true, messageId: 'm1' })
      expect(harness.target.participants?.map(participant => participant.accountId)).toEqual(['installation'])
    }
  })

  it('allows the owner to write to read-only and draft sessions', async () => {
    for (const visibility of ['read-only', 'draft'] as const) {
      const harness = createHarness({
        visibility,
        owner: { kind: 'account', id: 'installation', displayName: 'Local', assignedAt: 1, assignedBy: 'installation' },
      })
      harness.manager.sendMessage = harness.stubSend()
      expect(await harness.send()).toEqual({ accepted: true, messageId: 'm1' })
    }
  })

  it('applies the same rule to session commands, leaving presence commands open', async () => {
    const harness = createHarness({
      visibility: 'read-only',
      owner: { kind: 'account', id: 'ada', displayName: 'Ada', assignedAt: 1, assignedBy: 'installation' },
    })
    harness.manager.renameSession = async () => {}
    await expectCode(harness.command({ type: 'rename', name: 'Nope' }), 'SESSION_READ_ONLY')

    // A presence beacon is not a write and must still pass for a read-only viewer.
    expect(await harness.command({ type: 'setTyping', typing: true })).toBeUndefined()
  })

  it('lets a draft owner rename and rejects a non-owner', async () => {
    const harness = createHarness({ visibility: 'draft' })
    harness.manager.renameSession = async () => {}
    // No owner assigned: the creator (installation) may write.
    expect(await harness.command({ type: 'rename', name: 'Fine' })).toBeUndefined()

    harness.target.owner = { kind: 'account', id: 'ada', displayName: 'Ada', assignedAt: 1, assignedBy: 'installation' }
    await expectCode(harness.command({ type: 'rename', name: 'Nope' }), 'SESSION_OWNER_ONLY')
  })
})