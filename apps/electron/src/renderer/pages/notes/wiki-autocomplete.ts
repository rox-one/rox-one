import { aliasesFromProperties } from '@craft-agent/shared/knowledge/vault-insights'

export type WikiLinkNote = {
  id: string
  title: string
  relativePath?: string
  properties?: Record<string, unknown>
}

function stripMdExtension(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

export function parseWikiCreateTarget(raw: string): { title: string; folder?: string } {
  const clean = stripMdExtension(raw.trim()).replace(/^\/+|\/+$/g, '')
  const parts = clean.split('/').filter(Boolean)
  const title = parts.pop() || clean
  return { title, folder: parts.length > 0 ? parts.join('/') : undefined }
}

export function wikiNoteAliases(note: WikiLinkNote): string[] {
  return aliasesFromProperties(note.properties)
}

function haystack(note: WikiLinkNote): string[] {
  return [
    note.title,
    note.id,
    note.relativePath?.replace(/\.md$/i, '') ?? '',
    note.id.split('/').pop() ?? '',
    ...wikiNoteAliases(note),
  ]
}

function normalizeWikiTarget(value: string): string {
  return stripMdExtension(value.trim()).toLowerCase()
}

export function noteMatchesWikiTarget(note: WikiLinkNote, target: string): boolean {
  const normalized = normalizeWikiTarget(target)
  if (!normalized) return false
  if (normalizeWikiTarget(note.id) === normalized) return true
  if (normalizeWikiTarget(note.title) === normalized) return true
  if (normalizeWikiTarget(note.id.split('/').pop() ?? '') === normalized) return true
  return wikiNoteAliases(note).some((alias) => normalizeWikiTarget(alias) === normalized)
}

export function findNoteByWikiTarget<T extends WikiLinkNote>(notes: readonly T[], target: string): T | null {
  return notes.find((note) => noteMatchesWikiTarget(note, target)) ?? null
}

function scoreWikiMatch(note: WikiLinkNote, query: string): number {
  if (!query) return 1
  const fields = haystack(note).map((value) => value.toLowerCase()).filter(Boolean)
  if (fields.some((value) => value === query)) return 3
  if (fields.some((value) => value.startsWith(query))) return 2
  if (fields.some((value) => value.includes(query))) return 1
  return 0
}

export function wikiMatchSubtitle(note: WikiLinkNote, query: string): string {
  const path = (note.relativePath ?? note.id).replace(/\.md$/i, '')
  const q = query.trim().toLowerCase()
  const alias = wikiNoteAliases(note).find((value) => {
    const lower = value.toLowerCase()
    return q ? lower.includes(q) && lower !== note.title.toLowerCase() : lower !== note.title.toLowerCase()
  })
  return alias ? `${path} · ${alias}` : path
}

export function matchWikiLinkCandidates<T extends WikiLinkNote>(
  notes: readonly T[],
  query: string,
  options?: { excludeId?: string; limit?: number },
): T[] {
  const q = query.trim().toLowerCase()
  const excludeId = options?.excludeId
  const limit = options?.limit ?? 8
  return notes
    .filter((note) => note.id !== excludeId)
    .map((note) => ({ note, score: scoreWikiMatch(note, q) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.note.title < b.note.title ? -1 : a.note.title > b.note.title ? 1 : 0
    })
    .slice(0, limit)
    .map((item) => item.note)
}
