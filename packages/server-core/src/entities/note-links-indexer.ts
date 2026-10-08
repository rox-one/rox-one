/**
 * W1-02 (#1499) — Note-mention indexer.
 *
 * On every note persistence event the server re-extracts the note's
 * explicit-syntax links and reconciles its outgoing rows in the workspace
 * link store (`<root>/.rox/entity-links.sqlite`): new links are added, stale
 * ones removed, atomically per note and idempotently. A deleted note loses
 * all its outgoing links. Any change pushes `entities:linksChanged` so
 * backlinks panels refresh.
 *
 * Explicit syntax only (approved rules): `[[kind:id|label]]`, `![[…]]`
 * (relation `embeds`), `[[plain title]]` (→ note), `rox://…` links. Bare
 * `kind:id` in prose never links. Frontmatter, fenced code blocks and inline
 * code spans are not scanned. The note text is never rewritten.
 *
 * Inert when `entities.links.v1` is off: the enabled check runs before any
 * file read or store open, so flag-off behaviour is identical to main.
 *
 * Kept in its own module (and only importing the stable `extract.ts`
 * exports) so the stacked #1505 classifier move stays a clean merge.
 */

import { isEntitiesLinksEnabled } from '@rox/shared/feature-flags'
import { entityRefKey, type EntityRef, type EntityRelation } from '@rox/core/entities'
import { extractRoxDeepLinks, parseWikilinkTarget } from './extract.ts'
import { getEntityLinkStore, type DesiredOutgoingLink } from './link-store.ts'
import { getEntitiesWorkbenchFlags } from './workbench-flags.ts'

/** Author recorded on indexer-written links. */
export const NOTE_LINKS_INDEXER_ACTOR = 'system:notes-indexer'

export interface NoteLink {
  to: EntityRef
  relation: Extract<EntityRelation, 'mentions' | 'embeds'>
  /** 1-based line of the first occurrence in the saved file. */
  line: number
}

/** `[[target|alias]]` / `![[target|alias]]` — same shape as `wikilinkTargetsToRefs`. */
const WIKILINK_RE = /(!?)\[\[([^\]\n|]+?)(?:\|[^\]\n]*)?\]\]/g
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/** Blank out inline code spans so `[[x]]` inside backticks never links. */
function stripInlineCode(line: string): string {
  return line.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, match => ' '.repeat(match.length))
}

/**
 * Extract the explicit-syntax links of a Markdown note, keyed by
 * `(relation, to)` in first-seen order with the line of first occurrence.
 */
export function extractNoteLinks(markdown: string, self?: EntityRef): NoteLink[] {
  const out: NoteLink[] = []
  const seen = new Set<string>()
  const selfKey = self ? entityRefKey(self) : null
  const push = (to: EntityRef, relation: NoteLink['relation'], line: number) => {
    const refKey = entityRefKey(to)
    if (refKey === selfKey) return
    const key = `${relation} ${refKey}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ to, relation, line })
  }

  const lines = markdown.split(/\r?\n/)
  let index = 0
  // YAML frontmatter is metadata, not body.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && (line.trim() === '---' || line.trim() === '...'))
    if (end > 0) index = end + 1
  }
  let fence: { char: string; length: number } | null = null
  for (; index < lines.length; index++) {
    const raw = lines[index] ?? ''
    const fenceMatch = FENCE_RE.exec(raw)
    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence.char && fenceMatch[1]!.length >= fence.length && raw.trim() === fenceMatch[1]) fence = null
      continue
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1]![0]!, length: fenceMatch[1]!.length }
      continue
    }
    const text = stripInlineCode(raw)
    const lineNo = index + 1
    for (const match of text.matchAll(WIKILINK_RE)) {
      const inner = (match[2] ?? '').trim()
      if (!inner) continue
      const ref = parseWikilinkTarget(inner)
      if (ref) push(ref, match[1] === '!' ? 'embeds' : 'mentions', lineNo)
    }
    for (const link of extractRoxDeepLinks(text)) push(link.to, 'mentions', lineNo)
  }
  return out
}

export interface NoteLinksWorkspace {
  id: string
  rootPath: string
}

export interface NoteLinksIndexerOptions {
  /** Live flag check (default: `entities.links.v1` via the workbench-flag source + env override). */
  isEnabled?: () => boolean
  /** Push `entities:linksChanged` for a workspace. */
  notify?: (workspaceId: string) => void
  logger?: Pick<Console, 'warn'>
}

export interface NoteLinksIndexer {
  isEnabled(): boolean
  /** Reconcile a saved note's outgoing links. Returns true when the store changed. */
  index(workspace: NoteLinksWorkspace, noteId: string, content: string): boolean
  /** Drop a deleted (or moved-away) note's outgoing links. Returns true when the store changed. */
  remove(workspace: NoteLinksWorkspace, noteId: string): boolean
  /** Drop the outgoing links of every note under a moved-away folder. */
  removeFolder(workspace: NoteLinksWorkspace, folder: string): boolean
}

export function noteEntityRef(noteId: string): EntityRef {
  return { kind: 'note', id: noteId }
}

export function createNoteLinksIndexer(options: NoteLinksIndexerOptions = {}): NoteLinksIndexer {
  const isEnabled = options.isEnabled ?? (() => isEntitiesLinksEnabled(getEntitiesWorkbenchFlags()))
  const logger = options.logger ?? console
  const notify = (workspaceId: string) => {
    try {
      options.notify?.(workspaceId)
    } catch (error) {
      logger.warn('[entities] linksChanged push failed:', error)
    }
  }
  return {
    isEnabled,
    index(workspace, noteId, content) {
      if (!isEnabled() || !noteId) return false
      const from = noteEntityRef(noteId)
      const desired: DesiredOutgoingLink[] = extractNoteLinks(content, from).map(link => ({
        to: link.to,
        relation: link.relation,
        anchor: { line: link.line },
      }))
      const result = getEntityLinkStore(workspace.rootPath).replaceOutgoing(from, desired, NOTE_LINKS_INDEXER_ACTOR)
      const changed = result.added + result.updated + result.removed > 0
      if (changed) notify(workspace.id)
      return changed
    },
    remove(workspace, noteId) {
      if (!isEnabled() || !noteId) return false
      const removed = getEntityLinkStore(workspace.rootPath).removeOutgoing(noteEntityRef(noteId)) > 0
      if (removed) notify(workspace.id)
      return removed
    },
    removeFolder(workspace, folder) {
      const prefix = folder.replace(/\/+$/, '')
      if (!isEnabled() || !prefix) return false
      const removed = getEntityLinkStore(workspace.rootPath).removeOutgoingByIdPrefix('note', `${prefix}/`) > 0
      if (removed) notify(workspace.id)
      return removed
    },
  }
}
