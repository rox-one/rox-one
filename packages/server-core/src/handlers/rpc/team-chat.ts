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
  checkImChannelMembership,
  fetchImPresence,
  getTeamChatStore,
  mintLiveKitToken,
  publishImServiceEventBestEffort,
  resolveCallCredentials,
  summarizeCall,
  toMessengerCallEvent,
  TeamChatError,
  type TeamChannelCall,
  type CreateTeamChannelInput,
  type ListTeamMessagesInput,
  type TeamChatActor,
  type TeamChatOrgDirectory,
} from '@rox/shared/team-chat'
import { createLiveKitWebhookHttpIngress, type LiveKitWebhookHttpIngress } from '../../team-chat/livekit-webhook-http.ts'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { getCredentialManager } from '@rox/shared/credentials'
import { getDefaultLlmConnection, getLlmConnection } from '@rox/shared/config'
import { ROX_DEFAULT_CONNECTION_SLUG, ROX_GATEWAY_BASE_URL } from '@rox/shared/config/rox-public-models'

/** What clients get: the live transcript stays on the host. */
function callView(call: TeamChannelCall | null): TeamChannelCall | null {
  return call ? { ...call, transcript: [], transcriptSegments: call.transcript.length } : null
}

/** Summarize an ended call with the user's Rox connection; best effort, never throws. */
async function summarizeEndedCall(call: TeamChannelCall): Promise<string | null> {
  if (!call.transcript.length) return null
  try {
    // Rox models only: use the Rox connection (default if it is Rox, else the built-in Rox slug).
    const def = getDefaultLlmConnection()
    const defBase = def ? getLlmConnection(def)?.baseUrl : undefined
    const slug = def && (!defBase || defBase.replace(/\/+$/, '') === ROX_GATEWAY_BASE_URL) ? def : ROX_DEFAULT_CONNECTION_SLUG
    const apiKey = await getCredentialManager().getLlmApiKey(slug)
    if (!apiKey) return null
    const baseUrl = ROX_GATEWAY_BASE_URL
    const segments = [...call.transcript].sort((a, b) => a.startMs - b.startMs)
    return (await summarizeCall({ segments, baseUrl, apiKey }))?.text ?? null
  } catch {
    return null
  }
}

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
  RPC_CHANNELS.teamChat.CALL_JOIN,
  RPC_CHANNELS.teamChat.CALL_LEAVE,
  RPC_CHANNELS.teamChat.CALL_SYNC,
  RPC_CHANNELS.teamChat.CALL_TRANSCRIPT,
  RPC_CHANNELS.teamChat.PRESENCE,
  RPC_CHANNELS.teamChat.SEARCH,
] as const

export const orgsTeamChatDirectory: TeamChatOrgDirectory = {
  roleOf: (orgId, userId) => getOrganizationMembership(orgId, userId)?.role ?? null,
  memberIds: (orgId) => loadOrgsStore().members.filter((m) => m.orgId === orgId).map((m) => m.userId),
}

/**
 * Best-effort messenger contract v1.1 service-event for a local call message.
 * Skips call.transcript when the contract-required transcriptUrl is absent.
 */
function publishCallServiceEvent(
  channelId: string,
  message: { kind?: string; event?: string; callId?: string; createdAt: number },
  call: TeamChannelCall,
  opts: { transcriptUrl?: string; summary?: string } = {},
): void {
  const mapped = toMessengerCallEvent(message as never, call, opts)
  if (!mapped) return
  if (mapped.type === 'call.transcript' && !mapped.transcriptUrl) return
  publishImServiceEventBestEffort(channelId, mapped as never)
}

/** Local in-call overlay for presence: anyone currently in any visible channel call. */
function localInCallIds(actor: TeamChatActor): Set<string> {
  const chat = getTeamChatStore(orgsTeamChatDirectory)
  const ids = new Set<string>()
  for (const membership of loadOrgsStore().members.filter(m => m.userId === actor.userId)) {
    for (const channel of chat.listChannels(membership.orgId, actor)) {
      for (const participantId of channel.activeCall?.participantIds ?? []) ids.add(participantId)
    }
  }
  return ids
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

  // Calls: messenger contract v1.1 membership via /v1/im when reachable; else local store.
  // The LiveKit secret never leaves this process; only the short-lived token does.
  handle(RPC_CHANNELS.teamChat.CALL_JOIN, async (ctx, channelId: string, displayName?: string) => {
    const actor = actorOf(ctx)
    const creds = resolveCallCredentials()
    if (!creds.livekitUrl || !creds.livekitApiKey || !creds.livekitApiSecret) throw new Error('Calls are not configured')
    // Remote membership gate (403 = definitive deny). Unreachable /im → local joinCall check.
    const remote = await checkImChannelMembership(channelId, actor.userId)
    if (remote === 'not-member') throw new TeamChatError('FORBIDDEN', 'Join the channel to call')
    const { call, orgId, started } = store().joinCall(channelId, actor)
    const name = typeof displayName === 'string' ? displayName.trim().slice(0, 80) : ''
    const token = mintLiveKitToken({ apiKey: creds.livekitApiKey, apiSecret: creds.livekitApiSecret,
      identity: actor.userId, ...(name ? { name } : {}), room: call.roomName })
    if (started) {
      publishCallServiceEvent(channelId, {
        kind: 'system', event: 'call.started', callId: call.id, createdAt: call.startedAt,
      }, call)
    }
    changed(orgId, channelId)
    return { call: callView(call)!, url: creds.livekitUrl, token }
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.teamChat.CALL_LEAVE, async (ctx, channelId: string) => {
    const actor = actorOf(ctx)
    const { orgId, call, ended } = store().leaveCall(channelId, actor)
    changed(orgId, channelId)
    if (ended && call) {
      publishCallServiceEvent(channelId, {
        kind: 'system', event: 'call.ended', callId: call.id, createdAt: call.endedAt ?? Date.now(),
      }, call)
      if (call.transcript.length) {
        // Last one out: post the AI summary next to the transcript when it is ready.
        void summarizeEndedCall(call).then((summary) => {
          if (!summary) return
          try {
            if (store().postCallSummaryAsSystem(channelId, call.id, summary)) {
              changed(orgId, channelId)
              // Contract requires transcriptUrl for call.transcript; skip remote until media is wired.
              publishCallServiceEvent(channelId, {
                kind: 'summary', callId: call.id, createdAt: Date.now(),
              }, call, { summary })
            }
          } catch { /* channel archived meanwhile */ }
        })
      }
    }
    return { call: callView(call), ended }
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.teamChat.CALL_SYNC, async (ctx, channelId: string, participantIds: string[]) => {
    const { orgId, call } = store().syncCallParticipants(channelId, participantIds, actorOf(ctx))
    changed(orgId, channelId)
    return callView(call)
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.teamChat.CALL_TRANSCRIPT, async (ctx, channelId: string, callId: string, segments: unknown[]) => {
    const { orgId, added } = store().appendCallTranscript(channelId, callId, segments, actorOf(ctx))
    if (added) changed(orgId, channelId)
    return { added }
  }, { nativeAction: 'write' })

  // «О канале» presence: /v1/im/presence when Messenger is up; else in-call + self.
  handle(RPC_CHANNELS.teamChat.PRESENCE, async (ctx, userIds: unknown) => {
    const actor = actorOf(ctx)
    const ids = (Array.isArray(userIds) ? userIds : [])
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128)
      .slice(0, 100)
    const unique = [...new Set(ids)]
    const remote = await fetchImPresence(unique)
    const inCall = localInCallIds(actor)
    return unique.map((userId) => {
      if (inCall.has(userId)) return { userId, status: 'call' as const, source: remote ? 'im' as const : 'local' as const }
      const hit = remote?.find((row) => row.userId === userId)
      if (hit) {
        const status = hit.status === 'offline' ? 'offline' as const : 'online' as const
        return { userId, status, source: 'im' as const }
      }
      return {
        userId,
        status: (userId === actor.userId ? 'online' : 'offline') as 'online' | 'offline',
        source: 'local' as const,
      }
    })
  }, { nativeAction: 'read' })

  handle(RPC_CHANNELS.teamChat.SEARCH, async (ctx, orgId: string, query: string) =>
    store().searchMessages(orgId, query, actorOf(ctx)), { nativeAction: 'read' })
}


/**
 * LiveKit webhook ingress for the local RPC HTTP port.
 * Installed only when LiveKit API key+secret resolve (builtin or CONFIG_DIR override).
 * Ends calls on room_finished / emptying participant_left and posts the AI summary
 * the same way CALL_LEAVE does when the last client leave RPC is lost.
 */
export function createTeamChatLiveKitWebhookIngress(
  notifyChanged: (orgId: string, channelId: string) => void,
): LiveKitWebhookHttpIngress | null {
  const creds = resolveCallCredentials()
  if (!creds.livekitApiKey || !creds.livekitApiSecret) return null
  return createLiveKitWebhookHttpIngress({
    getStore: () => getTeamChatStore(orgsTeamChatDirectory),
    onChanged: notifyChanged,
    onCallEnded: ({ orgId, channelId, call }) => {
      publishCallServiceEvent(channelId, {
        kind: 'system', event: 'call.ended', callId: call.id, createdAt: call.endedAt ?? Date.now(),
      }, call)
      void summarizeEndedCall(call).then((summary) => {
        if (!summary) return
        try {
          if (getTeamChatStore(orgsTeamChatDirectory).postCallSummaryAsSystem(channelId, call.id, summary)) {
            notifyChanged(orgId, channelId)
            publishCallServiceEvent(channelId, {
              kind: 'summary', callId: call.id, createdAt: Date.now(),
            }, call, { summary })
          }
        } catch { /* channel archived meanwhile */ }
      })
    },
  })
}
