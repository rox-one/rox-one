import { afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { BroInviteStore, parseInviteUrl, type BroInviteStorage } from '@craft-agent/shared/collaboration'
import { SqliteBroInviteStore } from '@craft-agent/shared/collaboration/durable-store'
import { createWorkspaceHttpHandler } from '../../../../apps/workspace-service/src/http.ts'
import { createVerifiedActorResolver, type PersistedAuthSession } from '../../../../apps/workspace-service/src/auth/verified-actor.ts'
import { WorkspaceBroInvitationAuthority, type HostedSessionScope } from '../../../../apps/workspace-service/src/modules/collaboration/invitations.ts'
import { SqliteHostedSessionRegistry } from '../../../../apps/workspace-service/src/modules/collaboration/session-publication-registry.ts'
import { BroInviteService, resetBroInviteServiceForTests, setBroInviteService } from './bro-invite-service.ts'
import { registerSessionsHandlers } from '../handlers/rpc/sessions.ts'
import { RPC_CHANNELS, type Session, type SessionCommand } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '../transport/index.ts'
import type { HandlerDeps } from '../handlers/handler-deps.ts'
import type { AuthenticatedActor, SharedProjectAuthority } from '@craft-agent/shared/workspace-domain/identity/contracts'
import { RemoteBroInviteClient } from './remote-bro-invite-client.ts'
import { projectSessionForCollaboration } from './session-publication-bridge.ts'
import { MAX_SESSION_PUBLICATION_BYTES } from '@craft-agent/shared/collaboration/session-publication'

const servers: Server[] = []
afterEach(async () => {
  resetBroInviteServiceForTests()
  for (const server of servers.splice(0)) {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    server.closeAllConnections()
    await closed
  }
})

async function fixture(store: BroInviteStorage = new BroInviteStore(), hostedSessions?: HostedSessionScope) {
  const issuer = 'https://identity.fixture.invalid'
  const audience = 'rox-workspace'
  const keys = await generateKeyPair('EdDSA')
  const workspaceId: string = randomUUID()
  const otherWorkspaceId: string = randomUUID()
  const sessionId = 'shared-session'
  const sessions = new Map<string, PersistedAuthSession>()
  const memberships = new Map<string, string[]>()
  const identities = new Map<string, string>()
  const tokens = new Map<string, string>()
  const people: Record<string, { principalId: string; sessionId: string }> = {}
  for (const name of ['owner', 'joiner', 'stranger']) {
    const principalId = randomUUID()
    const authSessionId = randomUUID()
    const subject = randomUUID()
    people[name] = { principalId, sessionId: authSessionId }
    identities.set(subject, principalId)
    memberships.set(principalId, [workspaceId, otherWorkspaceId])
    sessions.set(authSessionId, { issuer, subject, principalId, sessionId: authSessionId,
      deviceId: `${name}-device`, expiresAt: Date.now() + 120000, revokedAt: null })
    tokens.set(name, await new SignJWT({ sid: authSessionId }).setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(issuer).setAudience(audience).setSubject(subject).setExpirationTime('2m').sign(keys.privateKey))
  }
  const resolver = createVerifiedActorResolver<AuthenticatedActor>({ issuer, audience,
    algorithms: ['EdDSA'], keySource: { jwks: { keys: [await exportJWK(keys.publicKey)] } } }, {
    resolvePrincipal: async (tokenIssuer, subject) => tokenIssuer === issuer ? identities.get(subject) ?? null : null,
    resolveSession: async input => sessions.get(input.verifiedSessionId ?? '') ?? null,
    findSession: async (tokenIssuer, id) => tokenIssuer === issuer ? sessions.get(id) ?? null : null,
  }, { listActiveWorkspaceIds: async principalId => memberships.get(principalId) ?? [] }, input => ({
    principalId: input.principalId, deviceId: input.deviceId, sessionId: input.sessionId,
    expiresAt: input.expiresAt, authenticatedWorkspaceIds: input.authenticatedWorkspaceIds,
  }))
  let exists = true
  let beforeResolve: (() => void) | undefined
  const collaboration = new WorkspaceBroInvitationAuthority(store, hostedSessions ?? { async resolveSession(workspace, id) {
    beforeResolve?.()
    return exists && [workspaceId, otherWorkspaceId].includes(workspace) && id === sessionId
      ? { ownerPrincipalId: people.owner!.principalId } : null
  } })
  const unused = async () => { throw new Error('unrelated project route') }
  const authority: SharedProjectAuthority = { createSharedProject: unused, getProject: unused, listProjects: unused, replayEvents: unused }
  const handler = createWorkspaceHttpHandler({ authority, actorResolver: resolver, collaborationAuthority: collaboration })
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const client = (name: string) => new RemoteBroInviteClient(baseUrl, async () => tokens.get(name) ?? null, { allowLoopbackHttp: true })
  return { workspaceId, otherWorkspaceId, sessionId, people, store, sessions, memberships, baseUrl, client, tokens,
    setExists: (value: boolean) => { exists = value }, beforeResolve: (callback: () => void) => { beforeResolve = callback } }
}

describe('authenticated Bro invitation transport', () => {
  it.each([
    { workspaceName: 'W'.repeat(241), expectedWorkspaceName: 'W'.repeat(240), name: 'N'.repeat(1001), expectedName: 'N'.repeat(1000) },
    { workspaceName: `${'W'.repeat(239)}😀`, expectedWorkspaceName: 'W'.repeat(239), name: `${'N'.repeat(999)}🚀`, expectedName: 'N'.repeat(999) },
  ])('publishes valid canonical display names within remote limits without splitting Unicode scalars', async metadata => {
    const directory = await mkdtemp(join(tmpdir(), 'rox-bro-display-limits-'))
    const sessions = new SqliteHostedSessionRegistry(join(directory, 'sessions.sqlite'))
    try {
      const f = await fixture(new BroInviteStore(), sessions)
      const source: Session = { id: f.sessionId, workspaceId: 'owner-local-workspace', workspaceName: metadata.workspaceName,
        name: metadata.name, lastMessageAt: 1, isProcessing: false,
        messages: [{ id: 'user-1', role: 'user', content: 'Shared content stays unchanged', timestamp: 1 }] }
      const service = new BroInviteService(new BroInviteStore(), async () => { throw new Error('Use the authority bearer') }, {
        remoteConfigured: () => true,
        resolveRemote: async () => ({ client: f.client('owner'), workspaceId: f.workspaceId, workspaceName: metadata.workspaceName }),
      })
      const result = await service.invite(source.id, 'viewer', { workspaceId: source.workspaceId, session: source })
      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected a usable remote invitation')
      const joined = await f.client('joiner').join(result.card.url, f.workspaceId)
      expect(joined).toMatchObject({ ok: true, remoteSession: {
        workspaceName: metadata.expectedWorkspaceName, name: metadata.expectedName, messages: source.messages, transcriptTruncated: false,
      } })
      // Canonical host projection adapts display metadata; HTTP still rejects an oversized claim.
      await expect(f.client('owner').publishSession(f.workspaceId, source.id, {
        workspaceName: metadata.workspaceName, name: metadata.name, lastMessageAt: 1, messages: [], transcriptTruncated: false,
      })).rejects.toMatchObject({ code: 'invalid' })
    } finally {
      sessions.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('budgets escaped metadata and message separators before publishing the unchanged recent transcript window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rox-bro-envelope-limit-'))
    const sessions = new SqliteHostedSessionRegistry(join(directory, 'sessions.sqlite'))
    try {
      const f = await fixture(new BroInviteStore(), sessions)
      const source: Session = { id: f.sessionId, workspaceId: 'owner-local-workspace', workspaceName: `W${'\u0001'.repeat(238)}Z`,
        name: `N${'\u0000'.repeat(998)}Z`, lastMessageAt: 2, isProcessing: false, messages: [
          { id: 'older', role: 'user', content: 'X'.repeat(4000), timestamp: 1 },
          { id: 'recent', role: 'assistant', content: '\n'.repeat(24000), timestamp: 2 },
        ] }
      const input = projectSessionForCollaboration(source)
      expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeLessThanOrEqual(MAX_SESSION_PUBLICATION_BYTES)
      expect(input.messages).toEqual([{ id: 'recent', role: 'assistant', content: source.messages[1]!.content, timestamp: 2 }])
      expect(input.transcriptTruncated).toBe(true)
      const service = new BroInviteService(new BroInviteStore(), async () => null, {
        remoteConfigured: () => true,
        resolveRemote: async () => ({ client: f.client('owner'), workspaceId: f.workspaceId }),
      })
      const result = await service.invite(source.id, 'viewer', { workspaceId: source.workspaceId, session: source })
      expect(result.success).toBe(true)
      if (!result.success) throw new Error('Expected a usable remote invitation')
      const joined = await f.client('joiner').join(result.card.url, f.workspaceId)
      expect(joined).toMatchObject({ ok: true, remoteSession: { messages: input.messages, transcriptTruncated: true } })
    } finally {
      sessions.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('publishes from the owner app RPC and delivers to an independent app an admitted read-only snapshot after service storage restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rox-two-host-bro-'))
    const invitationsPath = join(directory, 'invitations.sqlite')
    const sessionsPath = join(directory, 'sessions.sqlite')
    let invitations = new SqliteBroInviteStore(invitationsPath)
    let sessions = new SqliteHostedSessionRegistry(sessionsPath)
    const store: BroInviteStorage = {
      createInvite: input => invitations.createInvite(input), join: (url, account) => invitations.join(url, account),
      revoke: (key, actor) => invitations.revoke(key, actor), getInvite: key => invitations.getInvite(key),
      listPresence: (sessionId, workspaceId) => invitations.listPresence(sessionId, workspaceId),
    }
    const scope: HostedSessionScope = {
      resolveSession: (workspaceId, sessionId) => sessions.resolveSession(workspaceId, sessionId),
      publishSession: (actor, workspaceId, sessionId, input) => sessions.publishSession(actor, workspaceId, sessionId, input),
      readProjection: (workspaceId, sessionId) => sessions.readProjection(workspaceId, sessionId),
    }
    try {
      const f = await fixture(store, scope)
      const source: Session = { id: f.sessionId, workspaceId: 'owner-local-workspace', workspaceName: 'Local owner workspace', name: 'A shared conversation',
        lastMessageAt: 101, isProcessing: false, workingDirectory: '/private/owner-path', messages: [
          { id: 'user-1', role: 'user', content: 'Please review the plan', timestamp: 100 },
          { id: 'tool-1', role: 'tool', content: 'private tool output', toolInput: { secret: 'never publish' }, timestamp: 100 },
          { id: 'assistant-1', role: 'assistant', content: 'Here is the plan', timestamp: 101 },
        ] }
      const app = (name: string, localId: string, localSessions: Map<string, Session>) => {
        const localStore = new BroInviteStore()
        const service = new BroInviteService(localStore, async () => { throw new Error('Rox SaaS credentials must not be used') }, {
          remoteConfigured: id => id === localId,
          resolveRemote: async id => id === localId ? { client: f.client(name), workspaceId: f.workspaceId, workspaceName: 'Remote team' } : null,
        })
        const handlers = new Map<string, HandlerFn>()
        const server = { handle: (channel: string, handler: HandlerFn) => handlers.set(channel, handler), push() {}, async invokeClient() {},
          hasClientCapability: () => false, findClientsWithCapability: () => [] } as RpcServer
        registerSessionsHandlers(server, { sessionManager: { getSession: async (id: string) => localSessions.get(id) ?? null },
          platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } } } as unknown as HandlerDeps)
        return { service, localStore, command: async (id: string, command: SessionCommand) => {
          setBroInviteService(service)
          return handlers.get(RPC_CHANNELS.sessions.COMMAND)!({ clientId: `${name}-app`, workspaceId: localId, webContentsId: null }, id, command)
        } }
      }
      const ownerApp = app('owner', source.workspaceId, new Map([[source.id, source]]))
      const joinerSessions = new Map<string, Session>()
      const joinerApp = app('joiner', 'joiner-local-workspace', joinerSessions)
      const created = await ownerApp.command(source.id, { type: 'inviteBro', role: 'editor' })
      expect(created).toMatchObject({ success: true, role: 'editor' })
      expect(ownerApp.localStore.getInvite(parseInviteUrl(created.url)!.joinKey)).toBeUndefined()
      invitations.close(); sessions.close()
      invitations = new SqliteBroInviteStore(invitationsPath)
      sessions = new SqliteHostedSessionRegistry(sessionsPath)
      const joined = await joinerApp.command(source.id, { type: 'joinBroInvite', url: created.url })
      expect(joined).toMatchObject({ ok: true, accountId: f.people.joiner!.principalId, role: 'editor', workspaceId: f.workspaceId })
      expect(joined.remoteSession).toEqual({ id: f.sessionId, workspaceId: f.workspaceId, workspaceName: 'Remote team', name: source.name,
        lastMessageAt: 101, access: 'read-only', publishedAt: expect.any(Number), transcriptTruncated: false,
        messages: [source.messages[0], source.messages[2]] })
      expect(joinerSessions.size).toBe(0)
      expect(joinerApp.localStore.listPresence(source.id)).toEqual([])
      expect(await joinerApp.command(source.id, { type: 'listBroPresence' })).toHaveLength(2)
      expect(await joinerApp.command(source.id, { type: 'joinBroInvite', url: created.url })).toEqual({ ok: false, error: 'reused' })
      await expect(f.client('stranger').readProjection(f.workspaceId, source.id)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(f.client('joiner').publishSession(f.workspaceId, source.id, { workspaceName: 'Injected', lastMessageAt: 1, messages: [], transcriptTruncated: false }))
        .rejects.toMatchObject({ code: 'forbidden' })
      const injected = await fetch(`${f.baseUrl}/v1/workspaces/${f.workspaceId}/sessions/${source.id}/bro-publication`, {
        method: 'POST', headers: { authorization: `Bearer ${f.tokens.get('joiner')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceName: 'Injected', lastMessageAt: 1, messages: [], transcriptTruncated: false, ownerPrincipalId: f.people.owner!.principalId }),
      })
      expect(injected.status).toBe(400)
      f.memberships.set(f.people.joiner!.principalId, [])
      await expect(f.client('joiner').readProjection(f.workspaceId, source.id)).rejects.toMatchObject({ code: 'forbidden' })
    } finally {
      invitations.close(); sessions.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('redeems a durable central invitation after the store is reopened between device calls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rox-remote-bro-'))
    const path = join(directory, 'invitations.sqlite')
    let current = new SqliteBroInviteStore(path)
    const store: BroInviteStorage = {
      createInvite: input => current.createInvite(input), join: (url, account) => current.join(url, account),
      revoke: (key, id) => current.revoke(key, id), getInvite: key => current.getInvite(key),
      listPresence: (id, workspace) => current.listPresence(id, workspace),
    }
    try {
      const f = await fixture(store)
      const card = await f.client('owner').invite(f.workspaceId, f.sessionId)
      current.close()
      current = new SqliteBroInviteStore(path)
      expect(await f.client('joiner').join(card.url)).toMatchObject({ ok: true, workspaceId: f.workspaceId,
        accountId: f.people.joiner!.principalId })
      current.close()
      current = new SqliteBroInviteStore(path)
      expect(await f.client('joiner').join(card.url)).toEqual({ ok: false, error: 'reused' })
      expect(await f.client('owner').listPresence(f.workspaceId, f.sessionId)).toHaveLength(2)
    } finally {
      current.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('joins from a separate client with verified principal and shared workspace, then rejects reuse', async () => {
    const f = await fixture()
    const card = await f.client('owner').invite(f.workspaceId, f.sessionId, 'viewer')
    const joined = await f.client('joiner').join(card.url)
    expect(joined).toEqual({ ok: true, workspaceId: f.workspaceId, sessionId: f.sessionId,
      role: 'viewer', accountId: f.people.joiner!.principalId })
    expect(await f.client('joiner').join(card.url)).toEqual({ ok: false, error: 'reused' })
    expect((await f.client('owner').listPresence(f.workspaceId, f.sessionId)).map(member => member.accountId))
      .toEqual([f.people.owner!.principalId, f.people.joiner!.principalId])
    expect(await f.client('joiner').listPresence(f.workspaceId, f.sessionId)).toHaveLength(2)
    await expect(f.client('stranger').listPresence(f.workspaceId, f.sessionId)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(f.client('joiner').listPresence(f.otherWorkspaceId, f.sessionId)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('requires canonical session ownership and rejects client-supplied owner identities', async () => {
    const f = await fixture()
    await expect(f.client('joiner').invite(f.workspaceId, f.sessionId)).rejects.toMatchObject({ code: 'forbidden' })
    const injected = await fetch(`${f.baseUrl}/v1/workspaces/${f.workspaceId}/sessions/${f.sessionId}/bro-invites`, {
      method: 'POST', headers: { authorization: `Bearer ${f.tokens.get('joiner')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'editor', ownerPrincipalId: f.people.owner!.principalId }),
    })
    expect(injected.status).toBe(400)
  })

  it('leaves an invitation unused when the app is bound to a different workspace on the same authority', async () => {
    const f = await fixture()
    const card = await f.client('owner').invite(f.workspaceId, f.sessionId)
    expect(await f.client('joiner').join(card.url, f.otherWorkspaceId)).toEqual({ ok: false, error: 'invalid' })
    expect(f.store.getInvite(parseInviteUrl(card.url)!.joinKey)!.usedAt).toBeUndefined()
    expect(await f.client('joiner').join(card.url)).toMatchObject({ ok: true, workspaceId: f.workspaceId })
  })

  it('leaves a scoped app invitation unused if its authority cannot deliver a published projection', async () => {
    const f = await fixture()
    const card = await f.client('owner').invite(f.workspaceId, f.sessionId)
    await expect(f.client('joiner').join(card.url, f.workspaceId)).rejects.toMatchObject({ code: 'remote_unavailable' })
    expect(f.store.getInvite(parseInviteUrl(card.url)!.joinKey)!.usedAt).toBeUndefined()
  })

  it('observes revoked workspace access before consuming and permits a later authorized retry', async () => {
    const f = await fixture()
    const card = await f.client('owner').invite(f.workspaceId, f.sessionId)
    f.memberships.set(f.people.joiner!.principalId, [])
    await expect(f.client('joiner').join(card.url)).rejects.toMatchObject({ code: 'forbidden' })
    expect(f.store.getInvite(parseInviteUrl(card.url)!.joinKey)!.usedAt).toBeUndefined()
    f.memberships.set(f.people.joiner!.principalId, [f.workspaceId])
    expect(await f.client('joiner').join(card.url)).toMatchObject({ ok: true })
  })

  it('revalidates authentication after awaited canonical session lookup', async () => {
    const f = await fixture()
    const card = await f.client('owner').invite(f.workspaceId, f.sessionId)
    f.beforeResolve(() => { f.sessions.get(f.people.joiner!.sessionId)!.revokedAt = Date.now() })
    await expect(f.client('joiner').join(card.url)).rejects.toMatchObject({ code: 'membership_required' })
    expect(f.store.getInvite(parseInviteUrl(card.url)!.joinKey)!.usedAt).toBeUndefined()
  })

  it('does not consume an invitation when its canonical session was deleted', async () => {
    const f = await fixture()
    const card = await f.client('owner').invite(f.workspaceId, f.sessionId)
    f.setExists(false)
    expect(await f.client('joiner').join(card.url)).toEqual({ ok: false, error: 'invalid' })
    expect(f.store.getInvite(parseInviteUrl(card.url)!.joinKey)!.usedAt).toBeUndefined()
    f.setExists(true)
    expect(await f.client('joiner').join(card.url)).toMatchObject({ ok: true })
  })

  it('allows only the verified owner to revoke and rejects cross-workspace keys', async () => {
    const f = await fixture()
    const card = await f.client('owner').invite(f.workspaceId, f.sessionId)
    const key = parseInviteUrl(card.url)!.joinKey
    await expect(f.client('joiner').revoke(f.workspaceId, key)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(f.client('owner').revoke(f.otherWorkspaceId, key)).rejects.toMatchObject({ code: 'forbidden' })
    expect(await f.client('owner').revoke(f.workspaceId, key)).toEqual({ success: true })
    expect(await f.client('joiner').join(card.url)).toEqual({ ok: false, error: 'revoked' })
  })

  it('requires a valid trusted JWT and never redirects bearer credentials', async () => {
    const f = await fixture()
    const missing = await fetch(`${f.baseUrl}/v1/collaboration/bro-invites/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'invalid' }),
    })
    expect(missing.status).toBe(401)
    const bad = new RemoteBroInviteClient(f.baseUrl, async () => 'forged.token.value', { allowLoopbackHttp: true })
    await expect(bad.invite(f.workspaceId, f.sessionId)).rejects.toMatchObject({ code: 'membership_required' })
    expect(() => new RemoteBroInviteClient('http://public.example', async () => 'token', { allowLoopbackHttp: true })).toThrow('HTTPS')
    expect(() => new RemoteBroInviteClient('https://user:password@example.com', async () => 'token')).toThrow('HTTPS')
  })
})
