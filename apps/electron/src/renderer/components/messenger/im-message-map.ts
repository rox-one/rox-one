/**
 * Map native `im:*` message events into the TeamChannelMessage shape the
 * messenger UI already renders. Seq is synthesized from createdAt ordering
 * when the native client does not expose a channel sequence.
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
