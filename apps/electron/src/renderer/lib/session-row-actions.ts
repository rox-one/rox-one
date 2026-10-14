import type { Message } from '@rox/core'
import { messageActionId } from './message-action-id'

/**
 * Pure helpers behind the compact session-row hover actions (fork, copy
 * transcript). The row wires them to the session loader, clipboard and toasts.
 */

function isTranscriptMessage(message: Message): boolean {
  return !message.hidden && !message.isPending && !message.isQueued && (message.role === 'user' || message.role === 'assistant')
}

/** Server id of the newest committed user/assistant message, i.e. a fork of the whole session. */
export function latestBranchableMessageId(messages: readonly Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (!isTranscriptMessage(message) || message.isStreaming) continue
    return messageActionId(messages as Message[], message.id)
  }
  return null
}

export interface TranscriptLabels {
  user: string
  assistant: string
  tool: string
}

/** Whole session as Markdown: title, then every visible turn (tool calls collapsed to one line). */
export function sessionTranscriptToMarkdown(
  session: { name?: string; messages: readonly Message[] },
  labels: TranscriptLabels,
): string {
  const parts: string[] = []
  if (session.name?.trim()) parts.push(`# ${session.name.trim()}`)
  for (const message of session.messages) {
    if (message.hidden || message.isQueued) continue
    if (message.role === 'tool') {
      const name = message.toolDisplayName ?? message.toolName
      if (name) parts.push(`> ${labels.tool}: ${name}`)
      continue
    }
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const text = message.content?.trim()
    if (!text) continue
    parts.push(`## ${message.role === 'user' ? labels.user : labels.assistant}\n\n${text}`)
  }
  return parts.join('\n\n') + (parts.length ? '\n' : '')
}
