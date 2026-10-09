import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOCAL_ROX_CALLER } from '@rox/shared/auth'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { CodedError, RPC_CHANNELS, type ErrorCode, type Session } from '@rox/shared/protocol'
import { sessionPersistenceQueue } from '@rox/shared/sessions'
import { SessionManager } from '../../sessions/SessionManager'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerIdentityHandlers } from './identity'
import { registerSessionsHandlers } from './sessions'

const roots: string[] = []
let previousCwd: string
// Host config binding writes workspace files into cwd; keep every test off the repo root.
beforeEach(() => {
  previousCwd = process.cwd()
  const cwd = mkdtempSync(join(tmpdir(), 'rox-attribution-cwd-'))
  roots.push(cwd)
  process.chdir(cwd)
})
afterEach(async () => {
  process.chdir(previousCwd)
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
  isArchived?: boolean
  visibility?: 'shared' | 'read-only' | 'suggest' | 'draft'
  owner?: { kind: 'account' | 'agent'; id: string; displayName: string; assignedAt: number; assignedBy: string }
  creator?: { accountId: string; displayName: string; kind: 'profile' | 'channel' | 'agent' }
  participants?: Array<{ accountId: string; displayName: string; username: string; kind: 'profile' | 'channel' | 'agent' }>
}

const OTHER_OWNER = { kind: 'account' as const, id: 'ada', displayName: 'Ada', assignedAt: 1, assignedBy: 'installation' }
const LOCAL_OWNER = { kind: 'account' as const, id: 'installation', displayName: 'Local', assignedAt: 1, assignedBy: 'installation' }

/** Native workspace registry lookup reads config.json before the authority gate. */
function seedNativeWorkspace(workspaceId: string): void {
  const dir = resolveConfigDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    workspaces: [{ id: workspaceId, rootPath: process.cwd(), name: 'fixture', kind: 'personal' }],
  }))
}

function createHarness(overrides: Partial<Fixture> & { principal?: string; native?: boolean } = {}) {
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
  // Test seam: inject the managed-session fixture into the private registry.
  const sessionRegistry = manager as unknown as { sessions: Map<string, Fixture> }
  sessionRegistry.sessions.set(target.id, target)
  // The workspace collection, without the real rank-backfill/persistence side effects.
  manager.getSessions = () => [target as unknown as Session]
  // Handlers await session init; the fixture registry is already the full state.
  manager.waitForInit = async () => {}

  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle: (channel: string, handler: HandlerFn) => { handlers.set(channel, handler) },
    push() {}, async invokeClient() {}, hasClientCapability: () => false, findClientsWithCapability: () => [],
    isRequestContextCurrent: () => true,
  } as unknown as RpcServer
  const nativeData = overrides.native
    ? { authority: { authorize: () => true, isRegisteredWorkspace: () => true } }
    : undefined
  registerSessionsHandlers(server, {
    sessionManager: manager,
    nativeData,
    platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } },
  } as unknown as HandlerDeps)
  const ctx: RequestContext = {
    clientId: 'local-client', workspaceId: target.workspace.id, webContentsId: null,
    ...(overrides.principal ? { principal: { issuer: 'rox:cloud', subject: overrides.principal, credentialId: 'c', credentialVersion: 1 } } : {}),
  }

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
    bulkUpdate: (patch: Record<string, unknown>, ids: string[] = [target.id]) => handlers.get(RPC_CHANNELS.sessions.BULK_UPDATE)!(
      ctx, { workspaceId: target.workspace.id, ids, patch },
    ),
    get: () => handlers.get(RPC_CHANNELS.sessions.GET)!(ctx),
    stubSend,
  }
}

function createIdentityHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle: (channel: string, handler: HandlerFn) => { handlers.set(channel, handler) },
    push() {}, onShutdown() {},
  } as unknown as RpcServer
  registerIdentityHandlers(server, {
    platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } },
  } as unknown as HandlerDeps)
  const ctx: RequestContext = { clientId: 'local-client', workspaceId: 'attributed-workspace', webContentsId: null }
  return {
    getState: () => handlers.get(RPC_CHANNELS.identity.GET_STATE)!(ctx) as Promise<{ sessionActorId?: string }>,
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

describe('assignOwner honours the visibility rule (a2.5)', () => {
  it('denies a non-owner self-assignment on read-only and draft sessions', async () => {
    for (const [visibility, code] of [['read-only', 'SESSION_READ_ONLY'], ['draft', 'SESSION_OWNER_ONLY']] as const) {
      const harness = createHarness({ visibility, owner: OTHER_OWNER })
      await expectCode(harness.assignOwner({ kind: 'account', id: 'installation', displayName: 'Local' }), code)
      // The escalation this blocked: the self-assignment must not unlock writes.
      expect(harness.target.owner).toMatchObject({ id: 'ada' })
      await expectCode(harness.send(), code)
    }
  })

  it('still lets the creator and the current owner assign and clear on a draft', async () => {
    const creatorOwned = createHarness({ visibility: 'draft' })
    await creatorOwned.assignOwner({ kind: 'account', id: 'installation', displayName: 'Local' })
    expect(creatorOwned.target.owner).toMatchObject({ id: 'installation' })
    await creatorOwned.assignOwner(null)
    expect(creatorOwned.target.owner).toBeUndefined()

    const owner = createHarness({ visibility: 'draft', owner: LOCAL_OWNER })
    await owner.assignOwner({ kind: 'account', id: 'installation', displayName: 'Local' })
    expect(owner.target.owner).toMatchObject({ id: 'installation' })
  })

  it('keeps shared sessions assignable by any actor', async () => {
    const harness = createHarness({ visibility: 'shared', owner: OTHER_OWNER })
    await harness.assignOwner(null)
    expect(harness.target.owner).toBeUndefined()
  })
})

describe('bulk update honours the visibility rule (a2.5)', () => {
  it('denies a non-owner bulk mutation on read-only and draft sessions', async () => {
    for (const [visibility, code] of [['read-only', 'SESSION_READ_ONLY'], ['draft', 'SESSION_OWNER_ONLY']] as const) {
      const harness = createHarness({ visibility, owner: OTHER_OWNER })
      await expectCode(harness.bulkUpdate({ isArchived: true }), code)
      expect(harness.target.isArchived).toBeUndefined()
    }
  })

  it('applies a bulk mutation on a shared session', async () => {
    const harness = createHarness({ visibility: 'shared', owner: OTHER_OWNER })
    harness.manager.bulkUpdateSessions = async () => ({ ok: [harness.target.id], failed: [] })
    expect(await harness.bulkUpdate({ isArchived: true })).toEqual({ ok: [harness.target.id], failed: [] })
  })

  it('leaves unknown ids to the existing per-id failure reporting', async () => {
    const harness = createHarness({ visibility: 'draft', owner: OTHER_OWNER })
    harness.manager.bulkUpdateSessions = async (_workspaceId, { ids }) => ({
      ok: [], failed: ids.map(id => ({ id, error: 'not_found' })),
    })
    expect(await harness.bulkUpdate({ isArchived: true }, ['ghost']))
      .toEqual({ ok: [], failed: [{ id: 'ghost', error: 'not_found' }] })
  })
})

describe('sharing commands honour the visibility rule for native callers (a2.5)', () => {
  it('denies a non-owner native share on another actor read-only/draft session', async () => {
    for (const [visibility, code] of [['read-only', 'SESSION_READ_ONLY'], ['draft', 'SESSION_OWNER_ONLY']] as const) {
      const harness = createHarness({ visibility, owner: OTHER_OWNER, principal: 'bob' })
      await expectCode(harness.command({ type: 'shareToViewer' }), code)
      await expectCode(harness.command({ type: 'revokeShare' }), code)
      await expectCode(harness.command({ type: 'inviteBro', role: 'viewer' }), code)
    }
  })
})

describe('native session snapshot carries attribution (a1.3/a2.5)', () => {
  it('survives sessions:get for a principal caller', async () => {
    const harness = createHarness({
      visibility: 'read-only',
      owner: OTHER_OWNER,
      principal: 'bob',
      native: true,
    })
    seedNativeWorkspace(harness.target.workspace.id)

    const snapshots = await harness.get() as Array<Record<string, unknown>>
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      visibility: 'read-only',
      owner: expect.objectContaining({ id: 'ada' }),
      creator: expect.objectContaining({ accountId: 'installation' }),
      participants: [expect.objectContaining({ accountId: 'installation' })],
    })
  })
})

describe('local actor id space (a2.5)', () => {
  it('surfaces the compared id so a desktop self-assignment keeps write access', async () => {
    const identity = createIdentityHarness()
    const state = await identity.getState()
    expect(state.sessionActorId).toBe(LOCAL_ROX_CALLER.subject)

    const harness = createHarness({ visibility: 'draft' })
    harness.manager.sendMessage = harness.stubSend()
    await harness.assignOwner({ kind: 'account', id: state.sessionActorId!, displayName: 'Local' })
    expect(await harness.send()).toEqual({ accepted: true, messageId: 'm1' })

    // The id-space mismatch the fix removes: the cloud account id locks the desktop out.
    const cloud = createHarness({ visibility: 'draft' })
    await cloud.assignOwner({ kind: 'account', id: 'rox-account-ada', displayName: 'Ada' })
    await expectCode(cloud.send(), 'SESSION_OWNER_ONLY')
  })
})