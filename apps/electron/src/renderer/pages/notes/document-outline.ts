export interface DocumentOutlineItem {
  id: string
  title: string
  level: number
  line: number
  ordinal: number
  slug: string
}

export interface DocumentOutline {
  title: string
  items: DocumentOutlineItem[]
  isBodyEmpty: boolean
}

export type NoteRailKind = 'vault' | 'outline' | 'inspector'

export const NOTE_RAIL_WIDTHS: Record<NoteRailKind, {
  collapsed: number
  default: number
  min: number
  max: number
}> = {
  vault: { collapsed: 44, default: 300, min: 240, max: 390 },
  outline: { collapsed: 38, default: 232, min: 184, max: 320 },
  inspector: { collapsed: 36, default: 320, min: 280, max: 420 },
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const FENCE_RE = /^\s*(```|~~~)/

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugifyHeading(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'heading'
}

export function clampNoteRailWidth(kind: NoteRailKind, width: number): number {
  const bounds = NOTE_RAIL_WIDTHS[kind]
  if (!Number.isFinite(width)) return bounds.default
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)))
}

export function getNoteRailWidth(
  kind: NoteRailKind,
  collapsed: boolean,
  expandedWidth?: number,
): number {
  const bounds = NOTE_RAIL_WIDTHS[kind]
  return collapsed ? bounds.collapsed : clampNoteRailWidth(kind, expandedWidth ?? bounds.default)
}

export function parseStoredRailCollapsed(raw: string | null, fallback = false): boolean {
  if (raw == null) return fallback
  try {
    return Boolean(JSON.parse(raw))
  } catch {
    return fallback
  }
}

export function parseStoredRailWidth(kind: NoteRailKind, raw: string | null): number {
  if (raw == null) return NOTE_RAIL_WIDTHS[kind].default
  return clampNoteRailWidth(kind, Number(raw))
}

export function parseDocumentOutline(markdown: string, title = 'Untitled'): DocumentOutline {
  const withoutFrontmatter = markdown.replace(FRONTMATTER_RE, '')
  const lines = withoutFrontmatter.split(/\r?\n/)
  const usedSlugs = new Map<string, number>()
  const items: DocumentOutlineItem[] = []
  let inFence = false
  let headingOrdinal = 0

  lines.forEach((line, index) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      return
    }
    if (inFence) return

    const match = line.match(HEADING_RE)
    if (!match) return

    const text = stripInlineMarkdown(match[2] ?? '')
    if (!text) return

    const baseSlug = slugifyHeading(text)
    const slugCount = usedSlugs.get(baseSlug) ?? 0
    usedSlugs.set(baseSlug, slugCount + 1)
    const slug = slugCount === 0 ? baseSlug : `${baseSlug}-${slugCount + 1}`

    items.push({
      id: `${index + 1}:${slug}`,
      title: text,
      level: match[1].length,
      line: index + 1,
      ordinal: headingOrdinal,
      slug,
    })
    headingOrdinal += 1
  })

  return {
    title: title.trim() || 'Untitled',
    items,
    isBodyEmpty: withoutFrontmatter.trim().length === 0,
  }
}
