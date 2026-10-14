/**
 * teamChat:* RPC — Slack-like team messenger (phase 1): org-scoped channels,
 * private group chats, membership, public-channel subscriptions and messages.
 *
 * The actor is the server-verified principal (or the local device identity on
 * a local Electron server, like orgs:*). Every call re-checks durable org
 * membership in orgs.json; nothing client-supplied is trusted as authority.
 * teamChat:changed carries only ids — windows refetch through the guarded RPCs.
 */
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getLocalIdentity, getOrganizationMembership, loadOrgsStore } from '@rox/shared/orgs'
import {
  getTeamChatStore,
  type CreateTeamChannelInput,
  type ListTeamMessagesInput,
  type TeamChatActor,
  type TeamChatOrgDirectory,
} from '@rox/shared/team-chat'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.teamChat.LIST_CHANNELS,
  RPC_CHANNELS.teamChat.CREATE_CHANNEL,
  RPC_CHANNELS.teamChat.JOIN,
  RPC_CHANNELS.teamChat.LEAVE,
  RPC_CHANNELS.teamChat.ADD_MEMBERS,
  RPC_CHANNELS.teamChat.SET_SUBSCRIBED,
  RPC_CHANNELS.teamChat.ARCHIVE,
  RPC_CHANNELS.teamChat.LIST_MESSAGES,
  RPC_CHANNELS.teamChat.POST,
  RPC_CHANNELS.teamChat.MARK_READ,
] as const

export const orgsTeamChatDirectory: TeamChatOrgDirectory = {
  roleOf: (orgId, userId) => getOrganizationMembership(orgId, userId)?.role ?? null,
  memberIds: (orgId) => loadOrgsStore().members.filter((m) => m.orgId === orgId).map((m) => m.userId),
}

function actorOf(ctx: { principal?: { subject: string } }): TeamChatActor {
  const userId = ctx.principal?.subject.trim() || getLocalIdentity().userId
  if (!userId) throw new Error('Authenticated subject is required')
  return { userId }
}

export function registerTeamChatHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const store = () => getTeamChatStore(orgsTeamChatDirectory)
  const handle: RpcServer['handle'] = (channel, handler, options) =>
    server.handle(channel, handler, { access: 'localElectron', ...options })
  const changed = (orgId: string, channelId?: string) =>
    pushTyped(server, RPC_CHANNELS.teamChat.CHANGED, { to: 'all' }, { orgId, ...(channelId ? { channelId } : {}) })

  handle(RPC_CHANNELS.teamChat.LIST_CHANNELS, async (ctx, orgId: string) =>
    store().listChannels(orgId, actorOf(ctx)), { nativeAction: 'read' })

  handle(RPC_CHANNELS.teamChat.CREATE_CHANNEL, async (ctx, input: CreateTeamChannelInput) => {
    const view = store().createChannel(input, actorOf(ctx))
    changed(view.orgId, view.id)
    return view
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.teamChat.JOIN, async (ctx, channelId: string) => {
    const view = store().joinChannel(channelId, actorOf(ctx))
    changed(view.orgId, view.id)
    return view
  }, { nativeAction: 'write' })

  // The client-supplied orgId arg is ignored: broadcast with the channel's own org.
  handle(RPC_CHANNELS.teamChat.LEAVE, async (ctx, channelId: string) => {
    const { orgId } = store().leaveChannel(channelId, actorOf(ctx))
    changed(orgId, channelId)
    return { ok: true }
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.teamChat.ADD_MEMBERS, async (ctx, channelId: string, userIds: string[]) => {
    const view = store().addMembers(channelId, userIds, actorOf(ctx))
    changed(view.orgId, view.id)
    return view
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.teamChat.SET_SUBSCRIBED, async (ctx, channelId: string, subscribed: boolean) => {
    const view = store().setSubscribed(channelId, subscribed, actorOf(ctx))
    changed(view.orgId, view.id)
    return view
  }, { nativeAction: 'write' })

  // The client-supplied orgId arg is ignored: broadcast with the channel's own org.
  handle(RPC_CHANNELS.teamChat.ARCHIVE, async (ctx, channelId: string) => {
    const { orgId } = store().archiveChannel(channelId, actorOf(ctx))
    changed(orgId, channelId)
    return { ok: true }
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.teamChat.LIST_MESSAGES, async (ctx, input: ListTeamMessagesInput) =>
    store().listMessages(input, actorOf(ctx)), { nativeAction: 'read' })

  handle(RPC_CHANNELS.teamChat.POST, async (ctx, channelId: string, text: string) => {
    const { message, orgId } = store().postMessageWithOrg(channelId, text, actorOf(ctx))
    changed(orgId, channelId)
    return message
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.teamChat.MARK_READ, async (ctx, channelId: string) => {
    store().markRead(channelId, actorOf(ctx))
    return { ok: true }
  }, { nativeAction: 'write' })
}
