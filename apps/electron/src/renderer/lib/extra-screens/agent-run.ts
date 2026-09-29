/**
 * Local agent runs for the extra screens (brief, radar sweep, decision
 * extraction). Each run is an ordinary Rox session in the read-only
 * `safe` permission mode — visible in Sessions and the Agent Center, and it
 * cannot execute commands or send anything outward.
 */
export interface AgentRunRequest {
  workspaceId: string
  name: string
  prompt: string
  labels?: string[]
}

export async function startAgentRun(request: AgentRunRequest): Promise<string> {
  const api = window.electronAPI
  const session = await api.createSession(request.workspaceId, {
    name: request.name,
    permissionMode: 'safe',
    ...(request.labels?.length ? { labels: request.labels } : {}),
  })
  await api.sendMessage(session.id, request.prompt)
  return session.id
}

export interface AgentRunSnapshot {
  exists: boolean
  processing: boolean
  /** Text of the last final assistant message, if any. */
  text: string | null
  updatedAt: number | null
}

type LoadedMessage = { role?: string; content?: string; timestamp?: number; isIntermediate?: boolean }

export function lastAssistantText(messages: readonly LoadedMessage[] | undefined): { text: string; at: number | null } | null {
  if (!messages) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role === 'assistant' && !message.isIntermediate && typeof message.content === 'string' && message.content.trim()) {
      return { text: message.content.trim(), at: typeof message.timestamp === 'number' ? message.timestamp : null }
    }
  }
  return null
}

export async function readAgentRun(sessionId: string): Promise<AgentRunSnapshot> {
  try {
    const session = (await window.electronAPI.getSessionMessages(sessionId)) as
      | { isProcessing?: boolean; messages?: LoadedMessage[] }
      | null
    if (!session) return { exists: false, processing: false, text: null, updatedAt: null }
    const last = lastAssistantText(session.messages)
    return {
      exists: true,
      processing: Boolean(session.isProcessing),
      text: last?.text ?? null,
      updatedAt: last?.at ?? null,
    }
  } catch {
    return { exists: false, processing: false, text: null, updatedAt: null }
  }
}

/**
 * Extract the first fenced ```json block (or a bare top-level JSON array/object)
 * from agent output. Returns undefined when nothing parses.
 */
export function extractJsonBlock(text: string | null | undefined): unknown {
  if (!text) return undefined
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidates = [fence?.[1], text]
  for (const candidate of candidates) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    const start = trimmed.search(/[[{]/)
    if (start < 0) continue
    const open = trimmed[start]
    const close = open === '[' ? ']' : '}'
    const end = trimmed.lastIndexOf(close)
    if (end <= start) continue
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      // try next candidate
    }
  }
  return undefined
}
