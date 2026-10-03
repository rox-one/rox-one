import type { Message } from '@craft-agent/core'

/** Mounted optimistic ids are stable UI keys; commands need the server id. */
export function messageActionId(messages: Message[], messageId: string): string {
  return messages.find(message => message.id === messageId || message.backendMessageId === messageId)?.backendMessageId ?? messageId
}
