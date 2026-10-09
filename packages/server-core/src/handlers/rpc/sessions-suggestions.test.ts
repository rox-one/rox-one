import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodedError, RPC_CHANNELS, type ErrorCode, type Session, type SessionSuggestion } from '@rox/shared/protocol'
import { sessionPersistenceQueue } from '@rox/shared/sessions'
import { SessionManager } from '../../sessions/SessionManager'
import { SessionSuggestionStore, resetSessionSuggestionStore } from '../../collaboration/session-suggestions'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'

const roots: string[] = []
let previousCwd: string
beforeEach(() => {
  previousCwd = process.cwd()
  const cwd = mkdtempSync(join(tmpdir(), 'rox-suggest-cwd-'))
  roots.push(cwd)
  process.chdir(cwd)
})
afterEach(async () => {
  process.chdir(previousCwd)
  await sessionPersistenceQueue.flushAll()
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

const OWNER = { kind: 'account' as const, id: 'ada', displayName: 'Ada', assignedAt: 1, assignedBy: 'installation' }
const LOCAL_OWNER = { kind: 'account' as const, id: 'installation', displayName: 'Local', assignedAt: 1, assignedBy: 'installation' }

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
  resetSessionSuggestionStore()
  const root = mkdtempSync(join(tmpdir(), 'rox-suggest-rpc-'))
  roots.push(root)
  const manager = new SessionManager()
  const target: Fixture = {
    id: 'suggest-session',
    workspace: { id: 'suggest-workspace', name: 'Suggest workspace', rootPath: root },
    agent: null, messages: [], messagesLoaded: true, isProcessing: false,
    creator: { accountId: 'installation', displayName: 'Local', kind: 'profile' },
    participants: [{ accountId: 'installation', displayName: 'Local', username: 'installation', kind: 'profile' }],
    ...overrides,
  }
  const sessionRegistry = manager as unknown as { sessions: Map<string, Fixture> }
  sessionRegistry.sessions.set(target.id, target)
  manager.getSessions = () => [target as unknown as Session]
  manager.waitForInit = async () => {}

  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle: (channel: string, handler: HandlerFn) => { handlers.set(channel, handler) },
    push() {}, async invokeClient() {}, hasClientCapability: () => false, findClientsWithCapability: () => [],
    isRequestContextCurrent: () => true,
  } as unknown as RpcServer
  registerSessionsHandlers(server, {
    sessionManager: manager,
    platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } },
  } as unknown as HandlerDeps)

  const ctx: RequestContext = {
    clientId: 'local-client', workspaceId: target.workspace.id, webContentsId: null,
  }

  // "Exactly one INSERT" evidence: every dispatch through the normal send path.
  const dispatches: string[] = []
  manager.sendMessage = (async (
    _sessionId: string, message: string, _attachments?: unknown, _stored?: unknown, _options?: unknown,
    _existing?: string, _retry?: boolean, onAck?: (messageId: string) => void,
  ) => {
    dispatches.push(message)
    onAck?.(`dispatch-${dispatches.length}`)
  }) as SessionManager['sendMessage']

  return {
    manager, target, ctx, dispatches,
    send: (message = 'hi') => handlers.get(RPC_CHANNELS.sessions.SEND_MESSAGE)!(ctx, target.id, message),
    command: (command: unknown) => handlers.get(RPC_CHANNELS.sessions.COMMAND)!(ctx, target.id, command),
    suggestAdd: (body: string) => handlers.get(RPC_CHANNELS.sessions.SUGGEST_ADD)!(ctx, target.id, body) as Promise<SessionSuggestion>,
    suggestList: () => handlers.get(RPC_CHANNELS.sessions.SUGGEST_LIST)!(ctx, target.id) as Promise<SessionSuggestion[]>,
    suggestResolve: (id: string, resolution: 'accepted' | 'dismissed') =>
      handlers.get(RPC_CHANNELS.sessions.SUGGEST_RESOLVE)!(ctx, target.id, id, resolution) as Promise<{ suggestion: SessionSuggestion; dispatched: boolean }>,
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

describe('suggest session direct-write refusal (a2.5)', () => {
  it('refuses a non-owner send with SESSION_SUGGEST_ONLY', async () => {
    const harness = createHarness({ visibility: 'suggest', owner: OWNER })
    await expectCode(harness.send(), 'SESSION_SUGGEST_ONLY')
    // The same visibility gate applies to commands (rename is a write).
    await expectCode(harness.command({ type: 'rename', name: 'Nope' }), 'SESSION_SUGGEST_ONLY')
    expect(harness.dispatches).toEqual([])
  })

  it('still lets the owner write directly to a suggest session', async () => {
    const harness = createHarness({ visibility: 'suggest', owner: LOCAL_OWNER })
    expect(await harness.send()).toEqual({ accepted: true, messageId: 'dispatch-1' })
    expect(harness.dispatches).toEqual(['hi'])
  })
})

describe('session suggestions (a2.5)', () => {
  it('binds a non-owner suggestion to the caller and rejects non-suggest sessions', async () => {
    const suggest = createHarness({ visibility: 'suggest', owner: OWNER })
    const added = await suggest.suggestAdd('  Please use UTC timestamps.  ')
    expect(added).toMatchObject({
      sessionId: 'suggest-session',
      body: 'Please use UTC timestamps.',
      state: 'pending',
      author: { accountId: 'installation', displayName: 'Local', kind: 'profile' },
    })

    const shared = createHarness({ visibility: 'shared', owner: OWNER })
    await expectCode(shared.suggestAdd('nope'), 'SESSION_SUGGESTION_INVALID')
    await expectCode(suggest.suggestAdd('   '), 'SESSION_SUGGESTION_INVALID')
  })

  it('accepts a suggestion with exactly one dispatch and never dispatches a replay', async () => {
    const harness = createHarness({ visibility: 'suggest', owner: LOCAL_OWNER })
    const added = await harness.suggestAdd('Add a changelog entry')

    const first = await harness.suggestResolve(added.id, 'accepted')
    expect(first.dispatched).toBe(true)
    expect(first.suggestion).toMatchObject({ state: 'accepted', resolvedBy: 'installation', dispatchedMessageId: 'dispatch-1' })
    expect(harness.dispatches).toEqual(['Add a changelog entry'])

    // Replay: same resolve, no second insert.
    const replay = await harness.suggestResolve(added.id, 'accepted')
    expect(replay.dispatched).toBe(false)
    expect(replay.suggestion.dispatchedMessageId).toBe('dispatch-1')
    expect(harness.dispatches).toEqual(['Add a changelog entry'])
  })

  it('dismisses without dispatching and refuses a non-owner resolve', async () => {
    const owner = createHarness({ visibility: 'suggest', owner: LOCAL_OWNER })
    const added = await owner.suggestAdd('Maybe rename this')
    const dismissed = await owner.suggestResolve(added.id, 'dismissed')
    expect(dismissed.dispatched).toBe(false)
    expect(dismissed.suggestion).toMatchObject({ state: 'dismissed', resolvedBy: 'installation' })
    expect(owner.dispatches).toEqual([])

    const nonOwner = createHarness({ visibility: 'suggest', owner: OWNER })
    const pending = await nonOwner.suggestAdd('not mine to resolve')
    await expectCode(nonOwner.suggestResolve(pending.id, 'accepted'), 'SESSION_SUGGEST_ONLY')
    expect(nonOwner.dispatches).toEqual([])
  })

  it('lists suggestions with their states for every reader', async () => {
    const harness = createHarness({ visibility: 'suggest', owner: LOCAL_OWNER })
    const first = await harness.suggestAdd('one')
    await harness.suggestAdd('two')
    await harness.suggestResolve(first.id, 'accepted')

    const listed = await harness.suggestList()
    expect(listed.map(entry => [entry.body, entry.state])).toEqual([['one', 'accepted'], ['two', 'pending']])
    expect(listed[0]!.dispatchedMessageId).toBe('dispatch-1')
  })

  it('refuses an unknown suggestion id with SESSION_SUGGESTION_NOT_FOUND', async () => {
    const harness = createHarness({ visibility: 'suggest', owner: LOCAL_OWNER })
    await expectCode(harness.suggestResolve('ghost', 'dismissed'), 'SESSION_SUGGESTION_NOT_FOUND')
  })
})

describe('session suggestion store limits', () => {
  it('evicts an oldest resolved entry before a pending cap refusal', () => {
    let n = 0
    const store = new SessionSuggestionStore({ capPerSession: 2, newId: () => `s${++n}` })
    const author = { accountId: 'installation', displayName: 'Local', kind: 'profile' as const }
    const first = store.add('s', author, 'one')
    store.add('s', author, 'two')
    // Third entry at the cap with a resolved victim: the resolved one is dropped.
    store.resolve('s', first.id, 'dismissed', 'installation', async () => 'never')
    const third = store.add('s', author, 'three')
    expect(store.list('s').map(entry => entry.body)).toEqual(['two', 'three'])

    // Every remaining entry pending: the cap is a refusal, not a silent drop.
    let error: unknown
    try {
      store.add('s', author, 'four')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(CodedError)
    expect((error as CodedError).code).toBe('SESSION_SUGGESTION_LIMIT')
    expect(store.list('s').some(entry => entry.id === third.id)).toBe(true)
  })

  it('rolls back an accepted claim when the dispatch fails, so a retry can dispatch', async () => {
    const store = new SessionSuggestionStore()
    const author = { accountId: 'installation', displayName: 'Local', kind: 'profile' as const }
    const added = store.add('s', author, 'retry me')
    await expect(store.resolve('s', added.id, 'accepted', 'installation', async () => { throw new Error('boom') }))
      .rejects.toThrow('boom')
    expect(store.list('s')[0]!.state).toBe('pending')

    const retried = await store.resolve('s', added.id, 'accepted', 'installation', async () => 'msg-1')
    expect(retried).toMatchObject({ dispatched: true })
    expect(store.list('s')[0]!.dispatchedMessageId).toBe('msg-1')
  })
})