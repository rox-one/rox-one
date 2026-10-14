/**
 * Pure helpers for chat object actions (#21 object chips, task from answer,
 * #22 «Поручить агенту»). No React, no IPC — unit-tested in isolation.
 */
import { canonicalEntityTarget, sanitizeMentionLabel } from '@rox/ui/markdown'

export interface MessageObject {
  /** Canonical ref literal, e.g. `task:abc`. */
  ref: string
  label: string | null
}

const REF_RE = /(?<!\\)\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g
export const MAX_MESSAGE_OBJECTS = 8

/** Unique entity refs mentioned in a message, in order of appearance. Plain wikilinks are skipped. */
export function extractMessageObjects(text: string, limit = MAX_MESSAGE_OBJECTS): MessageObject[] {
  const out: MessageObject[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(REF_RE)) {
    const ref = canonicalEntityTarget(m[1] ?? '')
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    const label = m[2] !== undefined ? sanitizeMentionLabel(m[2]) : ''
    out.push({ ref, label: label || null })
    if (out.length >= limit) break
  }
  return out
}

/** Strip the most common inline Markdown so a line reads as a plain title. */
function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
    .replace(/\[\[[^\]|\n]+\|([^\]\n]*)\]\]/g, '$1')
    .replace(/\[\[([^\]\n]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const TASK_TITLE_MAX = 120
export const TASK_NOTES_MAX = 4000

export interface TaskDraft { title: string; notes: string }

/** A personal-task draft from an agent answer; notes link back to the session. */
export function taskDraftFromAnswer(text: string, session: { id: string; name?: string | null } | null, fallbackTitle: string): TaskDraft {
  let title = ''
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    title = plainLine(line)
    if (title) break
  }
  if (!title) title = fallbackTitle
  if (title.length > TASK_TITLE_MAX) title = `${title.slice(0, TASK_TITLE_MAX - 1).trimEnd()}…`
  let body = text.trim()
  if (body.length > TASK_NOTES_MAX) body = `${body.slice(0, TASK_NOTES_MAX - 1).trimEnd()}…`
  const link = session ? `[[session:${session.id}|${sanitizeMentionLabel(session.name || session.id)}]]` : ''
  return { title, notes: link ? `${body}\n\n${link}` : body }
}

/** «Поручить агенту» prompt for an object (or an answer when `context` is given). */
export function delegationPromptFor(object: MessageObject | null, heading: string, context?: string): string {
  const parts = [heading]
  if (object) parts.push(object.label ? `[[${object.ref}|${sanitizeMentionLabel(object.label)}]]` : `[[${object.ref}]]`)
  if (context?.trim()) parts.push(context.trim().slice(0, TASK_NOTES_MAX))
  return parts.join('\n\n')
}
