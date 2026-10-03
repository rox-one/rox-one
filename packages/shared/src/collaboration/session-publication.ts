/** A bounded transcript snapshot. It carries no local paths or editing capability. */
export interface RemoteSessionProjection {
  id: string
  workspaceId: string
  workspaceName: string
  name?: string
  lastMessageAt: number
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }>
  access: 'read-only'
  publishedAt: number
  transcriptTruncated: boolean
}

export type SessionPublicationInput = Omit<RemoteSessionProjection, 'id' | 'workspaceId' | 'access' | 'publishedAt'>
export const MAX_SESSION_PUBLICATION_BYTES = 56 * 1024
export const MAX_SESSION_PUBLICATION_MESSAGES = 200
export const MAX_SESSION_PUBLICATION_WORKSPACE_NAME_LENGTH = 240
export const MAX_SESSION_PUBLICATION_NAME_LENGTH = 1000

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error('invalid_session_publication')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) throw new Error('invalid_session_publication')
  return value
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid_session_publication')
  return value
}

/** Strictly accepts published content, never owner/account or native session fields. */
export function requireSessionPublicationInput(value: unknown): SessionPublicationInput {
  const input = record(value, ['workspaceName', 'name', 'lastMessageAt', 'messages', 'transcriptTruncated'])
  if (!Array.isArray(input.messages) || input.messages.length > MAX_SESSION_PUBLICATION_MESSAGES || typeof input.transcriptTruncated !== 'boolean') {
    throw new Error('invalid_session_publication')
  }
  const result: SessionPublicationInput = {
    workspaceName: text(input.workspaceName, MAX_SESSION_PUBLICATION_WORKSPACE_NAME_LENGTH),
    ...(input.name === undefined ? {} : { name: text(input.name, MAX_SESSION_PUBLICATION_NAME_LENGTH) }),
    lastMessageAt: timestamp(input.lastMessageAt),
    transcriptTruncated: input.transcriptTruncated,
    messages: input.messages.map(value => {
      const message = record(value, ['id', 'role', 'content', 'timestamp'])
      if (message.role !== 'user' && message.role !== 'assistant') throw new Error('invalid_session_publication')
      return { id: text(message.id, 128), role: message.role, content: text(message.content, MAX_SESSION_PUBLICATION_BYTES, true), timestamp: timestamp(message.timestamp) }
    }),
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_SESSION_PUBLICATION_BYTES) throw new Error('invalid_session_publication')
  return result
}

export function requireRemoteSessionProjection(value: unknown): RemoteSessionProjection {
  const projection = record(value, ['id', 'workspaceId', 'workspaceName', 'name', 'lastMessageAt', 'messages', 'access', 'publishedAt', 'transcriptTruncated'])
  if (projection.access !== 'read-only' || typeof projection.id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(projection.id)
    || ['.', '..'].includes(projection.id) || typeof projection.workspaceId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(projection.workspaceId)) throw new Error('invalid_session_publication')
  return { ...requireSessionPublicationInput({ workspaceName: projection.workspaceName, ...(projection.name === undefined ? {} : { name: projection.name }),
    lastMessageAt: projection.lastMessageAt, messages: projection.messages, transcriptTruncated: projection.transcriptTruncated }),
    id: projection.id, workspaceId: projection.workspaceId, access: 'read-only', publishedAt: timestamp(projection.publishedAt) }
}
