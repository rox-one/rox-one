import { RPC_CHANNELS } from '@rox/shared/protocol'
import {
  acceptInvite,
  createOrganization,
  findInviteByToken,
  getLocalIdentity,
  inviteToOrganization,
  listOrgMembers,
  listOrganizations,
  recordOrganizationAccessDenial,
  removeOrganizationMember,
  revokeOrganizationInvite,
  updateMemberRole,
} from '@rox/shared/orgs'
import type {
  AcceptInviteInput,
  CreateOrganizationInput,
  InviteToOrgInput,
  OrgActorIdentity,
  OrgAuditEvent,
  OrgCallerIdentity,
  OrgRole,
} from '@rox/shared/orgs'
import { setWorkspaceOrganization } from '@rox/shared/config'
import {
  ensureLocalUserIdentity,
  loadPreferences,
  updatePreferences,
} from '@rox/shared/config/preferences'
import {
  isClaimableLive,
  rpcOrgsActResult,
  rpcOrgsListResult,
  rpcOrgsReadResult,
} from '@rox/core/rox2'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.orgs.LIST,
  RPC_CHANNELS.orgs.CREATE,
  RPC_CHANNELS.orgs.INVITE,
  RPC_CHANNELS.orgs.ACCEPT,
  RPC_CHANNELS.orgs.LIST_MEMBERS,
  RPC_CHANNELS.orgs.UPDATE_MEMBER_ROLE,
  RPC_CHANNELS.orgs.REMOVE_MEMBER,
  RPC_CHANNELS.orgs.REVOKE_INVITE,
  RPC_CHANNELS.orgs.GET_IDENTITY,
  RPC_CHANNELS.orgs.UPDATE_IDENTITY,
  RPC_CHANNELS.orgs.SET_WORKSPACE_ORG,
] as const

function actorFromContext(ctx: { principal?: { subject: string } }): OrgActorIdentity | undefined {
  const userId = ctx.principal?.subject.trim()
  return userId ? { userId } : undefined
}

function auditDeniedOrganizationMutation<T>(
  ctx: { principal?: { subject: string } },
  orgId: string,
  action: OrgAuditEvent['action'],
  operation: () => T,
): T {
  try {
    return operation()
  } catch (error) {
    const actor = ctx.principal?.subject
    if (actor) recordOrganizationAccessDenial(orgId, actor, action)
    throw error
  }
}

export function registerOrgsHandlers(server: RpcServer, deps: HandlerDeps): void {
  ensureLocalUserIdentity()

  // Organization/account administration needs an Electron-main binding.
  // Only the actor-scoped self-profile handlers explicitly opt into native access.
  const handle: RpcServer['handle'] = (channel, handler, options) =>
    server.handle(channel, handler, { access: 'localElectron', ...options })

  handle(RPC_CHANNELS.orgs.LIST, async (ctx) => {
    const listed = rpcOrgsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const principal = ctx.principal
    const viewerUserId = principal?.subject ?? getLocalIdentity().userId
    return listOrganizations(viewerUserId).map((org) => ({
      ...org,
      viewerAuthority: principal ? 'native' : 'local',
      ...(principal ? { viewerIssuer: principal.issuer } : {}),
    }))
  }, { nativeAction: 'read' })

  handle(RPC_CHANNELS.orgs.CREATE, async (ctx, input: CreateOrganizationInput) => {
    const act = rpcOrgsActResult({ source: 'native', action: 'write', nativeId: input?.name || 'org' })
    if (!isClaimableLive(act)) throw new Error('org create is not live')
    const org = createOrganization(input ?? { name: '' }, actorFromContext(ctx))
    deps.platform.logger.info?.(`Created organization ${org.id}`)
    return org
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.orgs.INVITE, async (ctx, input: InviteToOrgInput) => {
    const act = rpcOrgsActResult({ source: 'native', action: 'write', nativeId: input?.orgId || 'invite' })
    if (!isClaimableLive(act)) throw new Error('org invite is not live')
    return auditDeniedOrganizationMutation(ctx, input?.orgId ?? '', 'invite', () =>
      inviteToOrganization(input, actorFromContext(ctx)),
    )
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.orgs.ACCEPT, async (ctx, input: AcceptInviteInput) => {
    const act = rpcOrgsActResult({ source: 'native', action: 'write', nativeId: input?.token || 'invite' })
    if (!isClaimableLive(act)) throw new Error('org accept is not live')
    const orgId = findInviteByToken(input.token)?.orgId ?? ''
    return auditDeniedOrganizationMutation(ctx, orgId, 'accept', () =>
      acceptInvite(input, actorFromContext(ctx)),
    )
  }, { nativeAction: 'write' })

  handle(
    RPC_CHANNELS.orgs.UPDATE_MEMBER_ROLE,
    async (ctx, orgId: string, userId: string, role: OrgRole) => {
      const act = rpcOrgsActResult({ source: 'native', action: 'write', nativeId: orgId || 'role' })
      if (!isClaimableLive(act)) throw new Error('org role update is not live')
      return auditDeniedOrganizationMutation(ctx, orgId, 'role-change', () => {
        if (!['owner', 'admin', 'member'].includes(role)) throw new Error('Invalid organization role')
        return updateMemberRole(orgId, userId, role, actorFromContext(ctx))
      })
    },
    { nativeAction: 'write' },
  )

  handle(
    RPC_CHANNELS.orgs.REMOVE_MEMBER,
    async (ctx, orgId: string, userId: string) => {
      const act = rpcOrgsActResult({ source: 'native', action: 'write', nativeId: orgId || 'remove-member' })
      if (!isClaimableLive(act)) throw new Error('org member removal is not live')
      return auditDeniedOrganizationMutation(ctx, orgId, 'member-remove', () =>
        removeOrganizationMember(orgId, userId, actorFromContext(ctx)),
      )
    },
    { nativeAction: 'write' },
  )

  handle(
    RPC_CHANNELS.orgs.REVOKE_INVITE,
    async (ctx, orgId: string, inviteId: string) => {
      const act = rpcOrgsActResult({ source: 'native', action: 'write', nativeId: orgId || 'revoke-invite' })
      if (!isClaimableLive(act)) throw new Error('org invite revocation is not live')
      return auditDeniedOrganizationMutation(ctx, orgId, 'invite-revoke', () =>
        revokeOrganizationInvite(orgId, inviteId, actorFromContext(ctx)),
      )
    },
    { nativeAction: 'write' },
  )

  handle(RPC_CHANNELS.orgs.LIST_MEMBERS, async (ctx, orgId: string) => {
    const read = rpcOrgsReadResult({ source: 'native', nativeId: orgId })
    if (!isClaimableLive(read.result)) return []
    const viewerUserId = ctx.principal?.subject ?? getLocalIdentity().userId
    return listOrgMembers(orgId, viewerUserId)
  }, { nativeAction: 'read' })

  handle(RPC_CHANNELS.orgs.GET_IDENTITY, async (ctx): Promise<OrgCallerIdentity> => {
    const read = rpcOrgsReadResult({ source: 'native', nativeId: 'local' })
    if (!isClaimableLive(read.result)) throw new Error('org identity is not live')
    const principal = ctx.principal
    if (principal) {
      if (!deps.nativeData || !ctx.workspaceId) throw new Error('Native self profile unavailable')
      return { userId: principal.subject, authority: 'native', issuer: principal.issuer,
        ...deps.nativeData.authority.getSelfProfile(principal, ctx.workspaceId) }
    }
    return { ...getLocalIdentity(), authority: 'local' }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  handle(
    RPC_CHANNELS.orgs.UPDATE_IDENTITY,
    async (
      ctx,
      updates: { username?: string; email?: string; name?: string },
    ) => {
      const act = rpcOrgsActResult({ source: 'native', action: 'write', nativeId: 'local' })
      if (!isClaimableLive(act)) throw new Error('org identity update is not live')
      if (ctx.principal) {
        if (!deps.nativeData || !ctx.workspaceId) throw new Error('Native self profile unavailable')
        const profile = deps.nativeData.authority.updateSelfProfile(ctx.principal, ctx.workspaceId, { name: updates?.name ?? updates?.username })
        return { userId: ctx.principal.subject, authority: 'native' as const, issuer: ctx.principal.issuer, ...profile }
      }
      ensureLocalUserIdentity()
      const patch: { username?: string; email?: string; name?: string } = {}
      if (typeof updates?.username === 'string') {
        const v = updates.username.trim()
        if (v) patch.username = v
      }
      if (typeof updates?.email === 'string') {
        const v = updates.email.trim()
        if (v) patch.email = v
      }
      if (typeof updates?.name === 'string') {
        const v = updates.name.trim()
        if (v) patch.name = v
      }
      if (Object.keys(patch).length > 0) updatePreferences(patch)
      loadPreferences()
      return getLocalIdentity()
    },
    // A native read grant permits editing only the authenticated actor's
    // private display name; organization/account mutations remain local.
    { access: 'nativeOrLocalElectron', nativeAction: 'read' },
  )

  handle(
    RPC_CHANNELS.orgs.SET_WORKSPACE_ORG,
    async (_ctx, workspaceId: string, orgId: string | null) => {
      if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
        throw new Error('workspaceId is required')
      }
      if (orgId !== null && typeof orgId !== 'string') {
        throw new Error('orgId must be a string or null')
      }
      const act = rpcOrgsActResult({ source: 'native', action: 'write', nativeId: workspaceId.trim() })
      if (!isClaimableLive(act)) throw new Error('org workspace bind is not live')
      return setWorkspaceOrganization(workspaceId.trim(), orgId)
    },
    { access: 'localElectron' },
  )
}

export type { OrgRole }
