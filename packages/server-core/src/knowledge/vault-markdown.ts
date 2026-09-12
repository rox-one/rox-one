/**
 * Canonical Markdown extractors for the local vault index (Issue 06 / W1-B).
 * Markdown files remain the source of truth; this module only projects structure.
 */
import { basename } from 'node:path'
import matter from 'gray-matter'

export const WIKILINK_RE = /\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g
export const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.*)$/gm
export const FOOTNOTE_REF_RE = /\[\^([^\]]+)\]/g
export const TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/gm
export const HASHTAG_RE = /(^|[\s(])#([A-Za-z0-9_/-]+)/g
export const MD_ASSET_RE = /!?\[[^\]]*\]\(([^)]+)\)/g
const SESSION_TARGET_RE = /^(?:session:|@session\/)(.+)$/i
const CALENDAR_TARGET_RE = /^(?:calendar:)?(\d{4}-\d{2}-\d{2})$/i
const DAILY_PATH_RE = /^daily\/(\d{4}-\d{2}-\d{2})(?:\.md)?$/i

export interface ParsedWikiLink {
  target: string
  heading?: string
  alias?: string
  line: number
}

export interface ParsedFootnote {
  footnoteId: string
  definition: boolean
  line: number
  text: string
}

export interface ParsedTask {
  line: number
  checked: boolean
  text: string
}

export interface ParsedBlock {
  id: string
  line: number
  text: string
}

export interface ParsedSessionRef {
  sessionId: string
  line: number
}

export interface ParsedCalendarRef {
  date: string
  line: number
}

export interface ParsedVaultNote {
  properties: Record<string, unknown>
  body: string
  title: string
  aliases: string[]
  tags: string[]
  links: ParsedWikiLink[]
  footnotes: ParsedFootnote[]
  tasks: ParsedTask[]
  blocks: ParsedBlock[]
  assetRefs: string[]
  sessionRefs: ParsedSessionRef[]
  calendarRefs: ParsedCalendarRef[]
}

export function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}

export function stripMdExtension(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

export function noteIdFromRelativePath(relativePath: string): string {
  return stripMdExtension(toSlashPath(relativePath))
}

export function lineForIndex(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,\n]+/).map(part => part.trim()).filter(Boolean)
  }
  return []
}

function extractTags(body: string, properties: Record<string, unknown>): string[] {
  const tags = new Set<string>()
  for (const tag of stringList(properties.tags)) {
    tags.add(tag.replace(/^#/, '').trim())
  }
  for (const match of body.matchAll(HASHTAG_RE)) {
    if (match[2]) tags.add(match[2])
  }
  return [...tags].sort((a, b) => a.localeCompare(b))
}

function extractAliases(properties: Record<string, unknown>, title: string): string[] {
  const aliases = new Set<string>([
    ...stringList(properties.aliases),
    ...stringList(properties.alias),
  ])
  aliases.delete(title)
  return [...aliases].sort((a, b) => a.localeCompare(b))
}

export function parseVaultMarkdown(content: string, relativePath: string): ParsedVaultNote {
  let properties: Record<string, unknown> = {}
  let body = content
  try {
    const parsed = matter(content)
    properties = parsed.data as Record<string, unknown>
    body = parsed.content
  } catch {
    properties = {}
    body = content
  }

  const id = noteIdFromRelativePath(relativePath)
  const title = typeof properties.title === 'string' && properties.title.trim()
    ? properties.title.trim()
    : basename(id)

  const links: ParsedWikiLink[] = []
  for (const match of content.matchAll(WIKILINK_RE)) {
    const heading = match[2]?.replace(/^#/, '').trim()
    const alias = match[3]?.trim()
    links.push({
      target: match[1]!.trim(),
      ...(heading ? { heading } : {}),
      ...(alias ? { alias } : {}),
      line: lineForIndex(content, match.index ?? 0),
    })
  }

  const footnotes: ParsedFootnote[] = []
  const defined = new Set<string>()
  for (const match of content.matchAll(FOOTNOTE_DEF_RE)) {
    const footnoteId = match[1]!.trim()
    defined.add(footnoteId)
    footnotes.push({
      footnoteId,
      definition: true,
      line: lineForIndex(content, match.index ?? 0),
      text: match[2] ?? '',
    })
  }
  for (const match of content.matchAll(FOOTNOTE_REF_RE)) {
    const footnoteId = match[1]!.trim()
    if (defined.has(footnoteId) && content.slice(match.index ?? 0).startsWith(`[^${footnoteId}]:`)) continue
    footnotes.push({
      footnoteId,
      definition: false,
      line: lineForIndex(content, match.index ?? 0),
      text: '',
    })
  }

  const tasks: ParsedTask[] = []
  for (const match of content.matchAll(TASK_RE)) {
    tasks.push({
      line: lineForIndex(content, match.index ?? 0),
      checked: match[2] !== ' ',
      text: (match[3] ?? '').trim(),
    })
  }

  const lines = content.split(/\r?\n/)
  const blocks: ParsedBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const match = line.match(/\s\^([A-Za-z0-9_-]+)\s*$/)
    if (!match?.[1]) continue
    blocks.push({
      id: match[1],
      line: i + 1,
      text: line.replace(/\s\^[A-Za-z0-9_-]+\s*$/, '').trim(),
    })
  }

  const assetRefs = new Set<string>()
  for (const match of content.matchAll(MD_ASSET_RE)) {
    const ref = match[1]?.trim()
    if (ref && !/^[a-z]+:\/\//i.test(ref)) assetRefs.add(ref)
  }

  const sessionRefs: ParsedSessionRef[] = []
  const calendarRefs: ParsedCalendarRef[] = []
  const dailyMatch = DAILY_PATH_RE.exec(toSlashPath(relativePath))
  if (dailyMatch?.[1]) {
    calendarRefs.push({ date: dailyMatch[1], line: 1 })
  }
  for (const link of links) {
    const session = SESSION_TARGET_RE.exec(link.target)
    if (session?.[1]) {
      sessionRefs.push({ sessionId: session[1].trim(), line: link.line })
    }
    const calendar = CALENDAR_TARGET_RE.exec(link.target)
    if (calendar?.[1]) {
      calendarRefs.push({ date: calendar[1], line: link.line })
    }
  }

  return {
    properties,
    body,
    title,
    aliases: extractAliases(properties, title),
    tags: extractTags(body, properties),
    links,
    footnotes,
    tasks,
    blocks,
    assetRefs: [...assetRefs].sort(),
    sessionRefs,
    calendarRefs,
  }
}
