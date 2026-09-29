import type { TeamMemberRef } from './types.ts'

/** Handle used in @mentions: username, else email local-part, else slugified name. */
export function mentionHandle(member: TeamMemberRef): string {
  const base = member.username?.trim() || member.email?.split('@')[0]?.trim() || member.displayName.trim()
  return base
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
}

const MENTION_RE = /(^|[^\p{L}\p{N}_.@])@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu

/** Raw @handles in text, lowercased, trailing dots trimmed. */
export function extractMentionHandles(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(MENTION_RE)) {
    const h = m[2]!.replace(/[.]+$/, '').toLowerCase()
    if (h && !out.includes(h)) out.push(h)
  }
  return out
}

/** Resolve @handles in text against the real roster; unknown handles are ignored. */
export function resolveMentions(text: string, roster: readonly TeamMemberRef[]): string[] {
  const handles = extractMentionHandles(text)
  if (handles.length === 0) return []
  const ids: string[] = []
  for (const member of roster) {
    if (handles.includes(mentionHandle(member)) && !ids.includes(member.userId)) ids.push(member.userId)
  }
  return ids
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
