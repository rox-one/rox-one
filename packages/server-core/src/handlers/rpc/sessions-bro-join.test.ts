import { afterEach, describe, expect, it } from 'bun:test'
import { BroInviteStore, parseInviteUrl, type JoinResult, type RoxAccount } from '@rox/shared/collaboration'
import { RPC_CHANNELS, type BroInviteCommandResult } from '@rox/shared/protocol'
import {
  BroInviteService,
  resetBroInviteServiceForTests,
  setBroInviteService,
} from '../../collaboration/bro-invite-service'
import { SessionManager } from '../../sessions/SessionManager'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'

const owner: RoxAccount = { accountId: 'owner', username: 'ada', displayName: 'Ada' }
const joiner: RoxAccount = { accountId: 'joiner', username: 'bro', displayName: 'Bro' }

function createHarness(account: RoxAccount | null = joiner) {
  let mintedKeys = 0
  const store = new BroInviteStore(() => 1_000, length => new Uint8Array(length).fill(++mintedKeys))
  const card = store.createInvite({ sessionId: 'invited-session', owner, role: 'viewer' })
  setBroInviteService(new BroInviteService(store, async () => account))
  const manager = new SessionManager()
  const target = {
    id: card.sessionId,
    workspace: { id: 'invited-workspace', name: 'Invited workspace', rootPath: '/tmp/bro-join-fixture' },
    agent: null,
    messages: [],
    messagesLoaded: true,
    isProcessing: false,
  }
  const sessions = (manager as unknown as { sessions: Map<string, typeof target> }).sessions
  sessions.set(target.id, target)
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle: (channel, handler) => { handlers.set(channel, handler) },
    push() {},
    async invokeClient() {},
    hasClientCapability: () => false,
    findClientsWithCapability: () => [],
  }
  registerSessionsHandlers(server, {
    sessionManager: manager,
    platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } },
  } as unknown as HandlerDeps)
  const context: RequestContext = { clientId: 'joining-client', workspaceId: 'current-workspace', webContentsId: null }

  return {
    store, card, target, sessions,
    mintedKeys: () => mintedKeys,
    invite: () => store.getInvite(parseInviteUrl(card.url)!.joinKey)!,
    async join(url = card.url): Promise<JoinResult> {
      return handlers.get(RPC_CHANNELS.sessions.COMMAND)!(context, 'current-page-session', { type: 'joinBroInvite', url })
    },
    async createInvite(sessionId: string): Promise<BroInviteCommandResult> {
      return handlers.get(RPC_CHANNELS.sessions.COMMAND)!(context, sessionId, { type: 'inviteBro', role: 'editor' })
    },
  }
}

afterEach(() => { resetBroInviteServiceForTests() })

describe('joinBroInvite RPC target validation', () => {
  it('does not mint an invitation for a missing source session', async () => {
    const harness = createHarness(owner)
    harness.sessions.delete(harness.target.id)

    expect(await harness.createInvite(harness.target.id)).toEqual({ success: false, error: 'invalid', errorCode: 'invalid' })
    expect(harness.mintedKeys()).toBe(1)

    harness.sessions.set(harness.target.id, harness.target)
    expect(await harness.createInvite(harness.target.id)).toMatchObject({ success: true, role: 'editor' })
    expect(harness.mintedKeys()).toBe(2)
  })

  it('returns the invited session workspace independently of the caller page and consumes it once', async () => {
    const harness = createHarness()

    expect(await harness.join()).toEqual({
      ok: true, sessionId: harness.target.id, workspaceId: harness.target.workspace.id,
      role: 'viewer', accountId: joiner.accountId,
    })
    expect(harness.invite().usedAt).toBe(1_000)
    expect(harness.store.listPresence(harness.target.id).map(member => member.accountId)).toEqual(['owner', 'joiner'])
    expect(await harness.join()).toEqual({ ok: false, error: 'reused' })
  })

  it('does not consume an invite to a deleted session and allows it after the session is restored', async () => {
    const harness = createHarness()
    harness.sessions.delete(harness.target.id)

    expect(await harness.join()).toEqual({ ok: false, error: 'invalid' })
    expect(harness.invite().usedAt).toBeUndefined()
    expect(harness.store.listPresence(harness.target.id).map(member => member.accountId)).toEqual(['owner'])

    harness.sessions.set(harness.target.id, harness.target)
    expect(await harness.join()).toMatchObject({ ok: true, workspaceId: 'invited-workspace' })
  })

  it('leaves the one-time invite unused for malformed URLs and mismatched invitation identities', async () => {
    const harness = createHarness()
    for (const invalid of [
      'not a URL',
      harness.card.url.replace('https:', 'http:'),
      harness.card.url.replace('bro.rox.one', 'evil.example'),
      harness.card.url.replace('/@ada/', '/@somebody-else/'),
      harness.card.url.replace('/invited-session/', '/missing-session/'),
    ]) {
      expect(await harness.join(invalid)).toEqual({ ok: false, error: 'invalid' })
      expect(harness.invite().usedAt).toBeUndefined()
    }
    expect(await harness.join()).toMatchObject({ ok: true, workspaceId: 'invited-workspace' })
  })

  it('preserves the membership denial without consuming an existing session invite', async () => {
    const harness = createHarness(null)
    expect(await harness.join()).toEqual({ ok: false, error: 'membership_required' })
    expect(harness.invite().usedAt).toBeUndefined()
  })
})
