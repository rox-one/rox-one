/**
 * Read-only context-window shares for the inspector dashboard (H3).
 *
 * Counts the same five buckets that make up prompt assembly: system, skills,
 * MCP schemas, transcript, attachments. Token estimate is chars/4 so the UI
 * matches a fixture of the actual assembled strings, not a second store.
 */

export const CONTEXT_SHARE_KINDS = ['system', 'skills', 'mcp', 'transcript', 'attachments'] as const

export type ContextShareKind = (typeof CONTEXT_SHARE_KINDS)[number]

export interface ContextShareInput {
  systemPrompt: string
  skillBodies: readonly string[]
  mcpToolSchemas: readonly string[]
  transcript: readonly { role?: string; content: string }[]
  attachments: readonly { text?: string; size?: number }[]
}

export interface ContextShare {
  kind: ContextShareKind
  chars: number
  tokens: number
  percent: number
}

export function estimateTokensFromChars(chars: number): number {
  if (chars <= 0) return 0
  return Math.ceil(chars / 4)
}

export function charsForAttachments(attachments: ContextShareInput['attachments']): number {
  let total = 0
  for (const attachment of attachments) {
    if (typeof attachment.text === 'string' && attachment.text.length > 0) {
      total += attachment.text.length
      continue
    }
    if (typeof attachment.size === 'number' && Number.isFinite(attachment.size) && attachment.size > 0) {
      total += Math.floor(attachment.size)
    }
  }
  return total
}

export function assembleContextShares(input: ContextShareInput): ContextShare[] {
  const charsByKind: Record<ContextShareKind, number> = {
    system: input.systemPrompt.length,
    skills: input.skillBodies.join('').length,
    mcp: input.mcpToolSchemas.join('').length,
    transcript: input.transcript.map((entry) => entry.content).join('').length,
    attachments: charsForAttachments(input.attachments),
  }
  const totalChars = CONTEXT_SHARE_KINDS.reduce((sum, kind) => sum + charsByKind[kind], 0)
  const shares: ContextShare[] = CONTEXT_SHARE_KINDS.map((kind) => ({
    kind,
    chars: charsByKind[kind],
    tokens: estimateTokensFromChars(charsByKind[kind]),
    percent: totalChars === 0 ? 0 : Math.floor((charsByKind[kind] / totalChars) * 1000) / 10,
  }))
  if (totalChars > 0) {
    const drift = 100 - shares.reduce((sum, share) => sum + share.percent, 0)
    const heaviest = shares.reduce((best, share) => (share.chars > best.chars ? share : best))
    heaviest.percent = Math.round((heaviest.percent + drift) * 10) / 10
  }
  return shares
}

export function sessionMessagesToTranscript(
  messages: readonly { role?: string; content?: unknown; hidden?: boolean }[],
): { role?: string; content: string }[] {
  return messages
    .filter((message) => !message.hidden)
    .map((message) => ({
      role: message.role,
      content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
    }))
}
