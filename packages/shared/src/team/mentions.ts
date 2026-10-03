import type { TeamMemberRef } from './types.ts'

/** Stable handle; the opaque member id suffix prevents collisions across a roster. */
export function mentionHandle(member: TeamMemberRef): string {
  const base = member.username?.trim() || member.email?.split('@')[0]?.trim() || member.displayName.trim()
  const handle = base.toLowerCase().replace(/\s+/g, '.').replace(/[^\p{L}\p{N}._-]/gu, '')
  const stableId = member.userId.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '')
  return `${handle || 'member'}.${stableId || 'unknown'}`
}

const MENTION_RE = /(^|[^\p{L}\p{N}_.@])@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu

/** Raw @handles in text, lowercased, trailing dots trimmed. */
export function extractMentionHandles(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(MENTION_RE)) {
    const handle = m[2]!
    let end = handle.length
    while (end > 0 && handle[end - 1] === '.') end--
    const h = handle.slice(0, end).toLowerCase()
    if (h && !seen.has(h)) {
      seen.add(h)
      out.push(h)
    }
  }
  return out
}

/** Resolve only exact stable handles from the visible organization roster. */
export function resolveMentions(text: string, roster: readonly TeamMemberRef[]): string[] {
  const handles = new Set(extractMentionHandles(text))
  return roster.filter((member) => handles.has(mentionHandle(member))).map((member) => member.userId)
}

/** Members whose handle or name starts with the partial query (for a picker). */
export function suggestMentions(query: string, roster: readonly TeamMemberRef[], limit = 6): TeamMemberRef[] {
  const q = query.replace(/^@/, '').toLowerCase()
  return roster
    .filter((m) => !q || mentionHandle(m).startsWith(q) || m.displayName.toLowerCase().startsWith(q))
    .slice(0, limit)
}

/** The @partial being typed at the caret, or null. */
export function activeMentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before)
  return m ? m[2]! : null
}
