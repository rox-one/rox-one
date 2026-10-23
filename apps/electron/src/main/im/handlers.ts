/**
 * im:* RPC — native chat-core messenger relay (deliverable 4).
 *
 * Thin forwarding layer over `ImService`: request channels delegate to the
 * native client, and the client's callbacks are pushed to every renderer as
 * `im:message` / `im:presence` / `im:typing` / `im:statusChanged` events. All
 * channels are LOCAL_ONLY (routing.ts) — the relay runs in this process.
 *
 * When the native module is absent (or the messenger flag is off), every
 * request resolves to `{ ok: false, reason, fallback: 'team-chat' }`; the
 * renderer then uses the JSON team-chat store (`teamChat:*`). Registration is
 * unconditional so the channel contract is always advertised.
 */

import { RPC_CHANNELS } from '@rox/shared/protocol/channels'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handlers/handler-deps'
import { getImService, type ImService } from './service'
import type { ImListMessagesInput } from './types'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.im.STATUS,
  RPC_CHANNELS.im.SUBSCRIBE_CHANNEL,
  RPC_CHANNELS.im.UNSUBSCRIBE_CHANNEL,
  RPC_CHANNELS.im.LIST_MESSAGES,
  RPC_CHANNELS.im.SEND_MESSAGE,
  RPC_CHANNELS.im.SEARCH_MESSAGES,
  RPC_CHANNELS.im.MARK_READ,
  RPC_CHANNELS.im.PUBLISH_TYPING,
] as const

/** Validate the renderer-supplied list-messages input at the IPC boundary. */
function parseListMessagesInput(input: unknown): ImListMessagesInput | null {
  if (typeof input !== 'object' || input === null) return null
  if (!('channelId' in input) || typeof input.channelId !== 'string' || !input.channelId) return null
  const parsed: ImListMessagesInput = { channelId: input.channelId }
  if ('beforeSeq' in input && typeof input.beforeSeq === 'number') parsed.beforeSeq = input.beforeSeq
  if ('limit' in input && typeof input.limit === 'number') parsed.limit = input.limit
  return parsed
}

function readChannelId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function registerImHandlers(server: RpcServer, _deps: HandlerDeps, service: ImService = getImService()): void {
  const handle: RpcServer['handle'] = (channel, handler, options) =>
    server.handle(channel, handler, { access: 'localElectron', ...options })

  // Forward native client callbacks to every renderer as im:* events.
  service.setPush({
    message: (message) => pushTyped(server, RPC_CHANNELS.im.MESSAGE, { to: 'all' }, message),
    presence: (presence) => pushTyped(server, RPC_CHANNELS.im.PRESENCE, { to: 'all' }, presence),
    typing: (typing) => pushTyped(server, RPC_CHANNELS.im.TYPING, { to: 'all' }, typing),
    status: (status) => pushTyped(server, RPC_CHANNELS.im.STATUS_CHANGED, { to: 'all' }, status),
  })

  handle(RPC_CHANNELS.im.STATUS, async () => service.ensureStarted(), { nativeAction: 'read' })

  handle(RPC_CHANNELS.im.SUBSCRIBE_CHANNEL, async (_ctx, channelId: unknown) => {
    const id = readChannelId(channelId)
    if (!id) return { ok: false, reason: 'INVALID_CHANNEL' }
    return service.subscribeChannel(id)
  }, { nativeAction: 'subscribe' })

  handle(RPC_CHANNELS.im.UNSUBSCRIBE_CHANNEL, async (_ctx, channelId: unknown) => {
    const id = readChannelId(channelId)
    if (!id) return { ok: false, reason: 'INVALID_CHANNEL' }
    return service.unsubscribeChannel(id)
  }, { nativeAction: 'subscribe' })

  handle(RPC_CHANNELS.im.LIST_MESSAGES, async (_ctx, input: unknown) => {
    const parsed = parseListMessagesInput(input)
    if (!parsed) return { ok: false, reason: 'INVALID_INPUT' }
    return service.listMessages(parsed)
  }, { nativeAction: 'read' })

  handle(RPC_CHANNELS.im.SEND_MESSAGE, async (_ctx, channelId: unknown, text: unknown) => {
    const id = readChannelId(channelId)
    if (!id || typeof text !== 'string') return { ok: false, reason: 'INVALID_INPUT' }
    return service.sendMessage(id, text)
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.im.SEARCH_MESSAGES, async (_ctx, query: unknown, opts: unknown) => {
    if (typeof query !== 'string' || !query.trim()) return { ok: false, reason: 'INVALID_INPUT' }
    let parsed: { channelId?: string; limit?: number } | undefined
    if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
      const rec = opts as Record<string, unknown>
      parsed = {}
      if (typeof rec.channelId === 'string' && rec.channelId) parsed.channelId = rec.channelId
      if (typeof rec.limit === 'number') parsed.limit = rec.limit
    }
    return service.searchMessages(query, parsed)
  }, { nativeAction: 'read' })

  handle(RPC_CHANNELS.im.MARK_READ, async (_ctx, channelId: unknown) => {
    const id = readChannelId(channelId)
    if (!id) return { ok: false, reason: 'INVALID_CHANNEL' }
    return service.markRead(id)
  }, { nativeAction: 'write' })

  handle(RPC_CHANNELS.im.PUBLISH_TYPING, async (_ctx, channelId: unknown, isTyping: unknown) => {
    const id = readChannelId(channelId)
    if (!id || typeof isTyping !== 'boolean') return { ok: false, reason: 'INVALID_INPUT' }
    return service.publishTyping(id, isTyping)
  }, { nativeAction: 'write' })
}
