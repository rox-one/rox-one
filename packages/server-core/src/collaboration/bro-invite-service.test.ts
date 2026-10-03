import { describe, expect, it } from 'bun:test'
import { BroInviteStore, type RoxAccount } from '@craft-agent/shared/collaboration'
import { BroInviteService, resolveWorkspaceBroTarget, type WorkspaceBroTargetPorts } from './bro-invite-service.ts'

const owner: RoxAccount = {
  accountId: 'acc_owner',
  username: 'ada',
  displayName: 'Ada',
}

describe('BroInviteService membership', () => {
  it('routes to the explicit workspace authority using only its live encrypted service bearer', async () => {
    const authority = { url: 'wss://collaboration.example/', workspaceId: '12345678-1234-1234-1234-123456789abc', workspaceName: 'Remote team' }
    let credentialReads = 0
    let token = 'verified.workspace.jwt'
    const requests: Array<{ url: string; token: string | null }> = []
    const card = new BroInviteStore(() => 1).createInvite({ sessionId: 'sess-1', owner, role: 'viewer' })
    const target = await resolveWorkspaceBroTarget('local-workspace', {
      getWorkspace: () => ({ projectAuthority: authority }),
      credentials: { async get(id) {
        credentialReads += 1
        expect(id).toEqual({ type: 'service_oauth', workspaceId: 'local-workspace', name: 'rox-workspace-authority' })
        return { value: token, tokenType: 'Bearer', expiresAt: Date.now() + 10000 }
      } },
      clientOptions: { fetch: (async (url, init) => {
        requests.push({ url: String(url), token: new Headers(init?.headers).get('authorization') })
        return Response.json(card)
      }) as typeof fetch },
    })
    expect(target).toMatchObject({ workspaceId: authority.workspaceId, workspaceName: 'Remote team' })
    await target!.client.invite(authority.workspaceId, 'sess-1', 'viewer')
    token = 'rotated.workspace.jwt'
    await target!.client.invite(authority.workspaceId, 'sess-1', 'viewer')
    expect(credentialReads).toBe(2)
    expect(requests).toEqual([
      { url: `https://collaboration.example/v1/workspaces/${authority.workspaceId}/sessions/sess-1/bro-invites`, token: 'Bearer verified.workspace.jwt' },
      { url: `https://collaboration.example/v1/workspaces/${authority.workspaceId}/sessions/sess-1/bro-invites`, token: 'Bearer rotated.workspace.jwt' },
    ])
    authority.url = 'wss://changed.example/'
    await expect(target!.client.invite(authority.workspaceId, 'sess-1', 'viewer')).rejects.toMatchObject({ code: 'membership_required' })
    expect(requests).toHaveLength(2)
  })

  it('rejects a different collaboration origin before reading any credentials', async () => {
    let reads = 0
    const ports: WorkspaceBroTargetPorts = {
      getWorkspace: () => ({ projectAuthority: { url: 'wss://authority.example/', workspaceId: '12345678-1234-1234-1234-123456789abc' } }),
      credentials: { async get() { reads += 1; throw new Error('Credentials must not be read') } },
      collaborationUrl: 'https://evil.example/',
    }
    await expect(resolveWorkspaceBroTarget('local-workspace', ports)).rejects.toMatchObject({ code: 'remote_unavailable' })
    expect(reads).toBe(0)
    expect(await resolveWorkspaceBroTarget('local-workspace', { ...ports, getWorkspace: () => null })).toBeNull()
  })

  it('suppresses a bearer if the authority disconnects while encrypted credentials are being read', async () => {
    let connected = true
    let requests = 0
    const target = await resolveWorkspaceBroTarget('local-workspace', {
      getWorkspace: () => connected ? { projectAuthority: { url: 'wss://authority.example/', workspaceId: '12345678-1234-1234-1234-123456789abc' } } : null,
      credentials: { async get() { connected = false; return { value: 'live.workspace.jwt', tokenType: 'Bearer', expiresAt: Date.now() + 10000 } } },
      clientOptions: { fetch: (async () => { requests += 1; throw new Error('Must not contact detached authority') }) as unknown as typeof fetch },
    })
    await expect(target!.client.invite(target!.workspaceId, 'sess-1')).rejects.toMatchObject({ code: 'membership_required' })
    expect(requests).toBe(0)
  })

  it('refuses invite and join without a Rox account', async () => {
    const service = new BroInviteService(new BroInviteStore(() => 1), async () => null)
    const invited = await service.invite('sess-1')
    expect(invited.success).toBe(false)
    if (!invited.success) expect(invited.errorCode).toBe('membership_required')
    const joined = await service.join('https://bro.rox.one/@ada/sess-1/' + 'ab'.repeat(16))
    expect(joined).toEqual({ ok: false, error: 'membership_required' })
  })

  it('issues a one-time invite card for an authenticated owner', async () => {
    const service = new BroInviteService(new BroInviteStore(() => 1), async () => owner)
    const invited = await service.invite('sess-1', 'viewer')
    expect(invited.success).toBe(true)
    if (invited.success) {
      expect(invited.card.kind).toBe('collaboration')
      expect(invited.card.role).toBe('viewer')
      expect(invited.card.url).toContain('https://bro.rox.one/@ada/sess-1/')
    }
  })
})
