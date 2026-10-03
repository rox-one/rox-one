/**
 * Session-scoped “Позвать Бро” service.
 *
 * Account membership is resolved server-side. Renderer-supplied IDs are
 * never treated as authorization claims.
 */

import { getCredentialManager, type CredentialManager } from '@craft-agent/shared/credentials'
import { getConfigDir, getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { join } from 'node:path'
import { SqliteBroInviteStore } from '@craft-agent/shared/collaboration/durable-store'
import type { Session } from '@craft-agent/shared/protocol'
import {
  slugifyUsername,
  type BroInviteStorage,
  type BroInviteCard,
  type JoinResult,
  type PresenceMember,
  type RoxAccount,
} from '@craft-agent/shared/collaboration'
import { RemoteBroInvitationError, RemoteBroInviteClient, type RemoteBroInviteClientOptions } from './remote-bro-invite-client.ts'
import { projectSessionForCollaboration } from './session-publication-bridge.ts'

export type AccountResolver = () => Promise<RoxAccount | null>
export interface BroRemoteTarget { client: RemoteBroInviteClient; workspaceId: string; workspaceName?: string }
export interface BroInviteServiceOptions {
  remoteConfigured?: (localWorkspaceId: string) => boolean
  resolveRemote?: (localWorkspaceId: string) => Promise<BroRemoteTarget | null>
}
export interface WorkspaceBroTargetPorts {
  getWorkspace: (localWorkspaceId: string) => { projectAuthority?: { url: string; workspaceId: string; workspaceName?: string } } | null
  credentials: Pick<CredentialManager, 'get'>
  collaborationUrl?: string
  clientOptions?: Pick<RemoteBroInviteClientOptions, 'fetch' | 'timeoutMs'>
}

/** Reuses the authority's encrypted JWT slot; Rox SaaS account tokens never leave their origin. */
export async function resolveWorkspaceBroTarget(localWorkspaceId: string, ports?: WorkspaceBroTargetPorts): Promise<BroRemoteTarget | null> {
  const getWorkspace = ports?.getWorkspace ?? getWorkspaceByNameOrId
  const configuredAuthority = getWorkspace(localWorkspaceId)?.projectAuthority
  if (!configuredAuthority) return null
  const authority = { ...configuredAuthority }
  const base = new URL(authority.url.replace(/^ws/, 'http'))
  const configured = ports ? ports.collaborationUrl : process.env.ROX_COLLABORATION_SERVICE_URL
  if (configured) {
    const override = new URL(configured)
    if (override.origin !== base.origin || override.pathname !== '/' || override.username || override.password || override.search || override.hash) {
      throw new RemoteBroInvitationError('remote_unavailable')
    }
  }
  const matches = () => {
    const current = getWorkspace(localWorkspaceId)?.projectAuthority
    return !!current && current.url === authority.url && current.workspaceId === authority.workspaceId
  }
  const bearer = async () => {
    // Do not continue using a credential after the workspace is disconnected/reconfigured.
    if (!matches()) return null
    const credential = await (ports?.credentials ?? getCredentialManager()).get({ type: 'service_oauth', workspaceId: localWorkspaceId, name: 'rox-workspace-authority' })
    return matches() && credential?.tokenType === 'Bearer' && typeof credential.expiresAt === 'number' && credential.expiresAt > Date.now()
      ? credential.value || null : null
  }
  return { client: new RemoteBroInviteClient(configured || base.href, bearer, {
    ...ports?.clientOptions,
    // The existing authority configuration already permits HTTP only on loopback.
    allowLoopbackHttp: base.protocol === 'http:',
  }), workspaceId: authority.workspaceId, workspaceName: authority.workspaceName }
}

function remoteCode(error: unknown): 'membership_required' | 'forbidden' | 'invalid' | 'remote_unavailable' {
  return error instanceof RemoteBroInvitationError ? error.code : 'remote_unavailable'
}

export async function resolveRoxAccountFromCredentials(): Promise<RoxAccount | null> {
  const session = await getCredentialManager().getRoxCloudSession()
  if (!session?.userId) return null
  const username = slugifyUsername(session.email || session.name || session.userId)
  return {
    accountId: session.userId,
    username,
    displayName: session.name || username,
  }
}

export class BroInviteService {
  constructor(
    private readonly store: BroInviteStorage,
    private readonly resolveAccount: AccountResolver,
    private readonly options: BroInviteServiceOptions = {},
  ) {}

  usesRemote(localWorkspaceId: string | null | undefined): boolean {
    return !!localWorkspaceId && !!this.options.remoteConfigured?.(localWorkspaceId)
  }

  async invite(
    sessionId: string,
    role: 'editor' | 'viewer' = 'editor',
    scope?: { workspaceId: string; session: Session },
  ): Promise<{ success: true; card: BroInviteCard } | { success: false; error: string; errorCode: string }> {
    if (scope && this.usesRemote(scope.workspaceId)) {
      try {
        const remote = await this.options.resolveRemote?.(scope.workspaceId)
        if (!remote) throw new RemoteBroInvitationError('remote_unavailable')
        await remote.client.publishSession(remote.workspaceId, sessionId, projectSessionForCollaboration(scope.session, remote.workspaceName))
        const card = await remote.client.invite(remote.workspaceId, sessionId, role)
        return { success: true, card }
      } catch (error) { const code = remoteCode(error); return { success: false, error: code, errorCode: code } }
    }
    const account = await this.resolveAccount()
    if (!account) {
      return { success: false, error: 'Rox account required', errorCode: 'membership_required' }
    }
    const card = this.store.createInvite({ sessionId, owner: account, role, ...(scope ? { workspaceId: scope.workspaceId } : {}) })
    return { success: true, card }
  }

  async join(url: string, localWorkspaceId?: string | null): Promise<JoinResult> {
    if (localWorkspaceId && this.usesRemote(localWorkspaceId)) {
      try {
        const remote = await this.options.resolveRemote?.(localWorkspaceId)
        if (!remote) throw new RemoteBroInvitationError('remote_unavailable')
        const result = await remote.client.join(url, remote.workspaceId)
        // Central membership is useful only when the actual admitted snapshot can be opened.
        if (result.ok && (!result.remoteSession || result.workspaceId !== remote.workspaceId)) throw new RemoteBroInvitationError('remote_unavailable')
        return result
      } catch (error) { return { ok: false, error: remoteCode(error) } }
    }
    const account = await this.resolveAccount()
    return this.store.join(url, account)
  }

  async revoke(joinKey: string, localWorkspaceId?: string | null): Promise<{ success: boolean }> {
    if (localWorkspaceId && this.usesRemote(localWorkspaceId)) {
      const remote = await this.options.resolveRemote?.(localWorkspaceId)
      if (!remote) throw new RemoteBroInvitationError('remote_unavailable')
      return remote.client.revoke(remote.workspaceId, joinKey)
    }
    const account = await this.resolveAccount()
    if (!account) return { success: false }
    return { success: this.store.revoke(joinKey, account.accountId) }
  }

  async listPresence(sessionId: string, localWorkspaceId?: string | null): Promise<PresenceMember[]> {
    if (localWorkspaceId && this.usesRemote(localWorkspaceId)) {
      const remote = await this.options.resolveRemote?.(localWorkspaceId)
      if (!remote) throw new RemoteBroInvitationError('remote_unavailable')
      return remote.client.listPresence(remote.workspaceId, sessionId)
    }
    return this.store.listPresence(sessionId, localWorkspaceId ?? undefined)
  }

  close(): void {
    this.store.close?.()
  }
}

let singleton: BroInviteService | null = null

export function getBroInviteService(): BroInviteService {
  if (!singleton) {
    singleton = new BroInviteService(new SqliteBroInviteStore(join(getConfigDir(), 'collaboration', 'local-invitations.sqlite')), resolveRoxAccountFromCredentials, {
      remoteConfigured: workspaceId => !!getWorkspaceByNameOrId(workspaceId)?.projectAuthority,
      resolveRemote: resolveWorkspaceBroTarget,
    })
  }
  return singleton
}

export function setBroInviteService(service: BroInviteService): void {
  if (singleton !== service) singleton?.close()
  singleton = service
}

export function disposeBroInviteService(): void {
  singleton?.close()
  singleton = null
}

export const resetBroInviteServiceForTests = disposeBroInviteService
