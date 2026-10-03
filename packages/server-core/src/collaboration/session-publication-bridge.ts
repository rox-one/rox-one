import type { Session } from '@rox/shared/protocol'
import {
  MAX_SESSION_PUBLICATION_BYTES,
  MAX_SESSION_PUBLICATION_MESSAGES,
  MAX_SESSION_PUBLICATION_NAME_LENGTH,
  MAX_SESSION_PUBLICATION_WORKSPACE_NAME_LENGTH,
  requireSessionPublicationInput,
  type SessionPublicationInput,
} from '@rox/shared/collaboration/session-publication'

/** Display limits use UTF-16 lengths, without publishing half a Unicode scalar. */
function boundedDisplayName(value: string, maximum: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maximum) return trimmed
  const end = trimmed.charCodeAt(maximum - 1)
  return trimmed.slice(0, end >= 0xd800 && end <= 0xdbff ? maximum - 1 : maximum)
}

/** Selected canonical server data only. Renderer session/owner claims never enter this projection. */
export function projectSessionForCollaboration(session: Session, workspaceName = session.workspaceName): SessionPublicationInput {
  const eligible = session.messages.filter(message => (message.role === 'user' || message.role === 'assistant') && !message.isIntermediate)
  const messages: SessionPublicationInput['messages'] = []
  const name = session.name ? boundedDisplayName(session.name, MAX_SESSION_PUBLICATION_NAME_LENGTH) : ''
  const envelope: SessionPublicationInput = {
    workspaceName: boundedDisplayName(workspaceName, MAX_SESSION_PUBLICATION_WORKSPACE_NAME_LENGTH),
    ...(name ? { name } : {}),
    lastMessageAt: session.lastMessageAt || 0,
    messages: [],
    // false is one byte longer than true, so this reserves the larger envelope.
    transcriptTruncated: false,
  }
  const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
  // Bound the entire UTF-8 JSON envelope, including escaped metadata and commas.
  let remaining = MAX_SESSION_PUBLICATION_BYTES - encodedBytes(envelope)
  for (let index = eligible.length - 1; index >= 0 && messages.length < MAX_SESSION_PUBLICATION_MESSAGES; index -= 1) {
    const message = eligible[index]!
    const projected = { id: message.id, role: message.role as 'user' | 'assistant', content: message.content, timestamp: message.timestamp }
    const bytes = encodedBytes(projected) + (messages.length > 0 ? 1 : 0)
    if (bytes > remaining) break
    remaining -= bytes
    messages.unshift(projected)
  }
  return requireSessionPublicationInput({ ...envelope, messages, transcriptTruncated: messages.length !== eligible.length })
}
