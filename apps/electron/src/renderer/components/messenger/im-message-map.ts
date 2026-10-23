/**
 * Map native `im:*` message events into the TeamChannelMessage shape the
 * messenger UI already renders. Seq is synthesized from createdAt ordering
 * when the native client does not expose a channel sequence.
 *
 * Live im lists are the source of truth for body/order/ids; local team-chat
 * dual-write enrichments (reply/thread/attachments) are overlaid by id.
 */
import type { TeamChannelMessage } from '@rox/shared/team-chat'
import type { ImMessageEvent } from '@rox/shared/protocol'

export function imMessageToTeam(message: ImMessageEvent, seq = 0): TeamChannelMessage {
  const out: TeamChannelMessage = {
    id: message.id,
    channelId: message.channelId,
    seq,
    senderId: message.senderId,
    text: message.text,
    createdAt: message.createdAt,
    kind: 'text',
  }
  if (typeof message.editedAt === 'number') out.editedAt = message.editedAt
  if (typeof message.deletedAt === 'number') out.deletedAt = message.deletedAt
  if (message.replyToId) {
    out.replyToId = message.replyToId
    out.threadId = message.threadId ?? message.replyToId
  } else if (message.threadId) {
    out.threadId = message.threadId
  }
  return out
}

export function imMessagesToTeam(messages: readonly ImMessageEvent[]): TeamChannelMessage[] {
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return sorted.map((message, index) => imMessageToTeam(message, index + 1))
}

/**
 * Overlay local dual-write fields onto a live im message list by id.
 * im remains authoritative for text/sender/createdAt/order; local wins for
 * replyToId, threadId, and attachments when present.
 */
export function mergeLocalEnrichments(
  imMessages: readonly TeamChannelMessage[],
  localMessages: readonly TeamChannelMessage[],
): TeamChannelMessage[] {
  if (!localMessages.length) return [...imMessages]
  const localById = new Map(localMessages.map((m) => [m.id, m]))
  return imMessages.map((message) => {
    const local = localById.get(message.id)
    if (!local) return message
    let changed = false
    const out: TeamChannelMessage = { ...message }
    if (local.replyToId && local.replyToId !== out.replyToId) {
      out.replyToId = local.replyToId
      changed = true
    }
    if (local.threadId && local.threadId !== out.threadId) {
      out.threadId = local.threadId
      changed = true
    } else if (out.replyToId && !out.threadId) {
      out.threadId = out.replyToId
      changed = true
    }
    if (local.attachments?.length) {
      out.attachments = local.attachments
      changed = true
    }
    return changed ? out : message
  })
}
