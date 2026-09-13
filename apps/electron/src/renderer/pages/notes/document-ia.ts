/**
 * Issue 07 — Notes document IA: portable Markdown structure + persisted rails.
 * Canonical structure lives in Markdown so save/reopen and external editors round-trip.
 */

export const NOTES_RAIL_STORAGE_KEY = 'notes:rails:v1'
export const NOTES_FOLD_STORAGE_PREFIX = 'notes:folds:'

export const DEFAULT_NOTES_RAIL_LAYOUT = {
  vault: 280,
  toc: 180,
  comments: 220,
  inspector: 260,
  vaultCollapsed: false,
  tocCollapsed: false,
  commentsCollapsed: false,
  inspectorCollapsed: true,
} as const

export type NotesRailLayout = {
  vault: number
  toc: number
  comments: number
  inspector: number
  vaultCollapsed: boolean
  tocCollapsed: boolean
  commentsCollapsed: boolean
}

export type NoteFootnote = { id: string; body: string }
export type NoteBlockId = { id: string; preview: string }
export type NoteWikiLink = { target: string; alias?: string; embed: boolean }
export type NoteColumnLayout = { columns: number; cells: string[] }
export type NoteInlineComment = {
  id: string
  quote: string
  body: string
  createdAt: number
}
export type NoteFold = { id: string; heading: string }
export type NoteTaskItem = { text: string; checked: boolean; folded: boolean }
export type NoteBreadcrumb = { id: string; label: string; folder?: string }

export type NoteDocumentStructure = {
  headings: Array<{ level: number; text: string; folded: boolean }>
  tasks: NoteTaskItem[]
  footnotes: NoteFootnote[]
  blockIds: NoteBlockId[]
  wikiLinks: NoteWikiLink[]
  columns: NoteColumnLayout[]
  comments: NoteInlineComment[]
  folds: NoteFold[]
  spoilers: string[]
  embeds: string[]
  tables: number
  horizontalRules: number
}

const RAIL_MIN = 140
const RAIL_MAX = 480

function clampRail(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(value)))
}

export function parseNotesRailLayout(raw: string | null): NotesRailLayout {
  const fallback: NotesRailLayout = {
    vault: DEFAULT_NOTES_RAIL_LAYOUT.vault,
    toc: DEFAULT_NOTES_RAIL_LAYOUT.toc,
    comments: DEFAULT_NOTES_RAIL_LAYOUT.comments,
    inspector: DEFAULT_NOTES_RAIL_LAYOUT.inspector,
    vaultCollapsed: DEFAULT_NOTES_RAIL_LAYOUT.vaultCollapsed,
    tocCollapsed: DEFAULT_NOTES_RAIL_LAYOUT.tocCollapsed,
    commentsCollapsed: DEFAULT_NOTES_RAIL_LAYOUT.commentsCollapsed,
  }
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<NotesRailLayout>
    return {
      vault: clampRail(Number(parsed.vault), fallback.vault),
      toc: clampRail(Number(parsed.toc), fallback.toc),
      comments: clampRail(Number(parsed.comments), fallback.comments),
      inspector: clampRail(Number(parsed.inspector), fallback.inspector),
      vaultCollapsed: parsed.vaultCollapsed === true,
      tocCollapsed: parsed.tocCollapsed === true,
      commentsCollapsed: parsed.commentsCollapsed === true,
    }
  } catch {
    return fallback
  }
}

export function serializeNotesRailLayout(layout: NotesRailLayout): string {
  return JSON.stringify(parseNotesRailLayout(JSON.stringify(layout)))
}

export function notesFoldStorageKey(noteId: string): string {
  return `${NOTES_FOLD_STORAGE_PREFIX}${noteId}`
}

export function parsePersistedFolds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

export function serializePersistedFolds(ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)])
}

export function noteBreadcrumbs(noteId: string, title: string): NoteBreadcrumb[] {
  const segments = noteId.split('/').filter(Boolean)
  const crumbs: NoteBreadcrumb[] = [{ id: 'vault', label: 'vault' }]
  let folder = ''
  for (const segment of segments.slice(0, -1)) {
    folder = folder ? `${folder}/${segment}` : segment
    crumbs.push({ id: `folder:${folder}`, label: segment, folder })
  }
  crumbs.push({ id: `note:${noteId}`, label: title || segments.at(-1) || noteId })
  return crumbs
}

const WIKI_RE = /(!)?\[\[([^\]\n|#]+?)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g
const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.+)$/gm
const FOOTNOTE_REF_RE = /\[\^([^\]]+)\]/g
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9_-]{3,})\s*$/gm
const COMMENT_RE = /<!--\s*rox:comment\s+id="([^"]+)"\s+quote="([^"]*)"\s+created="(\d+)"\s*-->\n?([\s\S]*?)<!--\s*\/rox:comment\s*-->/g
const FOLD_RE = /<details\s+data-rox-fold="([^"]+)">\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi
const SPOILER_RE = /^>\s*\[!spoiler\]\s*$/gim
const TABLE_RE = /^\|.+\|\s*$/gm
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/gm
const TASK_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+?)(?:\s+<!--\s*folded\s*-->)?\s*$/gm
const EMBED_MD_RE = /!\[[^\]]*\]\(([^)]+)\)/g

export function extractWikiLinks(markdown: string): NoteWikiLink[] {
  const links: NoteWikiLink[] = []
  const re = new RegExp(WIKI_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    const target = (match[2] ?? '').trim()
    if (!target) continue
    const alias = match[3]?.trim()
    links.push({ target, alias: alias || undefined, embed: match[1] === '!' })
  }
  return links
}

export function extractFootnotes(markdown: string): NoteFootnote[] {
  const notes: NoteFootnote[] = []
  const seen = new Set<string>()
  const defRe = new RegExp(FOOTNOTE_DEF_RE.source, 'gm')
  let match: RegExpExecArray | null
  while ((match = defRe.exec(markdown)) !== null) {
    const id = match[1]!.trim()
    if (seen.has(id)) continue
    seen.add(id)
    notes.push({ id, body: match[2]!.trim() })
  }
  const refRe = new RegExp(FOOTNOTE_REF_RE.source, 'g')
  while ((match = refRe.exec(markdown)) !== null) {
    const id = match[1]!.trim()
    if (seen.has(id) || markdown.includes(`[^${id}]:`)) continue
    seen.add(id)
    notes.push({ id, body: '' })
  }
  return notes
}

export function extractBlockIds(markdown: string): NoteBlockId[] {
  const ids: NoteBlockId[] = []
  for (const line of markdown.split('\n')) {
    const match = /(?:^|\s)\^([A-Za-z0-9_-]{3,})\s*$/.exec(line)
    if (!match) continue
    ids.push({
      id: match[1]!,
      preview: line.replace(/\s*\^[A-Za-z0-9_-]{3,}\s*$/, '').trim(),
    })
  }
  return ids
}

export function extractComments(markdown: string): NoteInlineComment[] {
  const comments: NoteInlineComment[] = []
  const re = new RegExp(COMMENT_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    comments.push({
      id: match[1]!,
      quote: decodeCommentAttr(match[2] ?? ''),
      body: (match[4] ?? '').trim(),
      createdAt: Number(match[3]),
    })
  }
  return comments
}

export function serializeComment(comment: NoteInlineComment): string {
  return [
    `<!-- rox:comment id="${comment.id}" quote="${encodeCommentAttr(comment.quote)}" created="${comment.createdAt}" -->`,
    comment.body,
    '<!-- /rox:comment -->',
  ].join('\n')
}

export function upsertMarkdownComment(markdown: string, comment: NoteInlineComment): string {
  const existing = extractComments(markdown)
  const next = existing.some((item) => item.id === comment.id)
    ? existing.map((item) => (item.id === comment.id ? comment : item))
    : [...existing, comment]
  let body = markdown.replace(new RegExp(COMMENT_RE.source, 'g'), '').trimEnd()
  if (next.length === 0) return body
  return `${body}\n\n${next.map(serializeComment).join('\n\n')}\n`
}

export function serializeColumns(cells: string[]): string {
  const columns = Math.min(3, Math.max(2, cells.length || 2))
  const filled = Array.from({ length: columns }, (_, index) => cells[index]?.trim() ?? '')
  const inner = filled.map((cell) => `:::column\n${cell}\n:::`).join('\n')
  return `:::columns ${columns}\n${inner}\n:::`
}

export function extractColumns(markdown: string): NoteColumnLayout[] {
  const layouts: NoteColumnLayout[] = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const header = /^:::columns\s+(\d+)\s*$/.exec(lines[i]!)
    if (!header) continue
    const cells: string[] = []
    let current: string[] | null = null
    let j = i + 1
    for (; j < lines.length; j += 1) {
      const line = lines[j]!
      if (line === ':::') {
        if (current) {
          cells.push(current.join('\n').trim())
          current = null
          continue
        }
        break
      }
      if (line === ':::column') {
        if (current) cells.push(current.join('\n').trim())
        current = []
        continue
      }
      if (current) current.push(line)
    }
    if (current) cells.push(current.join('\n').trim())
    layouts.push({ columns: Number(header[1]), cells })
    i = j
  }
  return layouts
}

export function wrapFoldedHeading(heading: string, content: string): string {
  const id = foldIdForHeading(heading)
  return `<details data-rox-fold="${id}"><summary>${heading}</summary>\n\n${content.trim()}\n</details>`
}

export function foldIdForHeading(heading: string): string {
  return heading.replace(/^#+\s*/, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section'
}

export function applyPersistentFolds(markdown: string, foldedHeadingIds: readonly string[]): string {
  if (foldedHeadingIds.length === 0) return markdown
  const folded = new Set(foldedHeadingIds)
  const lines = markdown.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!heading) {
      out.push(line)
      continue
    }
    const id = foldIdForHeading(heading[2]!)
    if (!folded.has(id)) {
      out.push(line)
      continue
    }
    const level = heading[1]!.length
    const body: string[] = []
    let j = i + 1
    while (j < lines.length) {
      const next = /^(#{1,6})\s+/.exec(lines[j]!)
      if (next && next[1]!.length <= level) break
      body.push(lines[j]!)
      j += 1
    }
    out.push(wrapFoldedHeading(line, body.join('\n')))
    i = j - 1
  }
  return out.join('\n')
}

export function extractFolds(markdown: string): NoteFold[] {
  const folds: NoteFold[] = []
  const re = new RegExp(FOLD_RE.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    folds.push({ id: match[1]!, heading: match[2]!.trim() })
  }
  return folds
}

export function sanitizePastedMarkdown(raw: string): string {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/data:text\/html[^)\s]*/gi, '')
}

export type NoteCommandKind = 'bang' | 'at'
export type NoteCommandSubject =
  | 'session'
  | 'agent'
  | 'project'
  | 'task'
  | 'person'
  | 'entity'
  | 'action'

export type NoteCommandItem = {
  id: string
  kind: NoteCommandKind
  subject: NoteCommandSubject
  label: string
  insert: string
}

export function matchNoteCommands(
  query: string,
  catalog: readonly NoteCommandItem[],
): NoteCommandItem[] {
  const trimmed = query.trim()
  if (!trimmed.startsWith('!') && !trimmed.startsWith('@')) return []
  const kind: NoteCommandKind = trimmed.startsWith('!') ? 'bang' : 'at'
  const needle = trimmed.slice(1).toLowerCase()
  return catalog.filter((item) => {
    if (item.kind !== kind) return false
    if (!needle) return true
    return item.label.toLowerCase().includes(needle) || item.insert.toLowerCase().includes(needle)
  })
}

export function defaultNoteCommands(input: {
  sessions: Array<{ id: string; title: string }>
  agents: Array<{ id: string; label: string }>
  projects: Array<{ id: string; name: string }>
  tasks: Array<{ id: string; text: string }>
  people: Array<{ id: string; name: string }>
  entities: Array<{ id: string; name: string }>
}): NoteCommandItem[] {
  const bang: NoteCommandItem[] = [
    { id: 'bang:new-session', kind: 'bang', subject: 'action', label: 'New session', insert: '!session' },
    { id: 'bang:ask-agent', kind: 'bang', subject: 'action', label: 'Ask agent', insert: '!agent' },
    { id: 'bang:new-task', kind: 'bang', subject: 'action', label: 'Create task', insert: '!task' },
  ]
  const at: NoteCommandItem[] = [
    ...input.sessions.map((session) => ({
      id: `at:session:${session.id}`,
      kind: 'at' as const,
      subject: 'session' as const,
      label: session.title,
      insert: `@session:${session.id}`,
    })),
    ...input.agents.map((agent) => ({
      id: `at:agent:${agent.id}`,
      kind: 'at' as const,
      subject: 'agent' as const,
      label: agent.label,
      insert: `@agent:${agent.id}`,
    })),
    ...input.projects.map((project) => ({
      id: `at:project:${project.id}`,
      kind: 'at' as const,
      subject: 'project' as const,
      label: project.name,
      insert: `@project:${project.id}`,
    })),
    ...input.tasks.map((task) => ({
      id: `at:task:${task.id}`,
      kind: 'at' as const,
      subject: 'task' as const,
      label: task.text,
      insert: `@task:${task.id}`,
    })),
    ...input.people.map((person) => ({
      id: `at:person:${person.id}`,
      kind: 'at' as const,
      subject: 'person' as const,
      label: person.name,
      insert: `@person:${person.id}`,
    })),
    ...input.entities.map((entity) => ({
      id: `at:entity:${entity.id}`,
      kind: 'at' as const,
      subject: 'entity' as const,
      label: entity.name,
      insert: `@entity:${entity.id}`,
    })),
  ]
  return [...bang, ...at]
}

export function parseNoteDocument(markdown: string): NoteDocumentStructure {
  const headings: NoteDocumentStructure['headings'] = []
  const folded = new Set(extractFolds(markdown).map((fold) => fold.id))
  for (const line of markdown.split('\n')) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const text = match[2]!.replace(/[#*_`]/g, '').replace(/\s*\^[A-Za-z0-9_-]{3,}\s*$/, '').trim()
    headings.push({
      level: match[1]!.length,
      text,
      folded: folded.has(foldIdForHeading(text)),
    })
  }

  const tasks: NoteTaskItem[] = []
  const taskRe = new RegExp(TASK_RE.source, 'gm')
  let taskMatch: RegExpExecArray | null
  while ((taskMatch = taskRe.exec(markdown)) !== null) {
    tasks.push({
      text: taskMatch[3]!.trim(),
      checked: taskMatch[2] !== ' ',
      folded: /<!--\s*folded\s*-->/.test(taskMatch[0]!),
    })
  }

  const wikiLinks = extractWikiLinks(markdown)
  const embeds = [
    ...wikiLinks.filter((link) => link.embed).map((link) => link.target),
    ...[...markdown.matchAll(EMBED_MD_RE)].map((match) => match[1]!.trim()),
  ]

  return {
    headings,
    tasks,
    footnotes: extractFootnotes(markdown),
    blockIds: extractBlockIds(markdown),
    wikiLinks,
    columns: extractColumns(markdown),
    comments: extractComments(markdown),
    folds: extractFolds(markdown),
    spoilers: [...markdown.matchAll(SPOILER_RE)].map(() => 'spoiler'),
    embeds,
    tables: countMarkdownTables(markdown),
    horizontalRules: [...markdown.matchAll(HR_RE)].length,
  }
}

export function roundTripNoteMarkdown(markdown: string): string {
  const comments = extractComments(markdown)
  let next = markdown
  for (const comment of comments) {
    next = upsertMarkdownComment(next, comment)
  }
  return next.replace(/\s+$/g, '\n')
}

function countMarkdownTables(markdown: string): number {
  const lines = markdown.split('\n')
  let count = 0
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (TABLE_RE.test(lines[i]!) && /^\|?\s*:?-{3,}/.test(lines[i + 1]!)) count += 1
  }
  return count
}

function encodeCommentAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\n/g, ' ')
}

function decodeCommentAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

export const FOOTNOTE_SNIPPET = 'See note.[^1]\n\n[^1]: '
export const TABLE_SNIPPET = '| A | B |\n| --- | --- |\n|  |  |\n'
export const SPOILER_SNIPPET = '> [!spoiler]\n> \n'
export const EMBED_SNIPPET = '![['
export const TWO_COLUMN_SNIPPET = serializeColumns(['', ''])
export const THREE_COLUMN_SNIPPET = serializeColumns(['', '', ''])
export const HR_SHORTCUT = 'Mod-Shift--'
