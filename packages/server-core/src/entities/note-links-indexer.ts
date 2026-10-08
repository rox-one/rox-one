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
 * Ownership (review 4): the indexer only reconciles and deletes rows it
 * wrote itself (`created_by = NOTE_LINKS_INDEXER_ACTOR`, relation `mentions`
 * or `embeds`). Manual links (`relates-to`, a role, a block anchor) from the
 * same note survive every save. Line anchors are refreshed silently: moving
 * links down by inserting a line is not a link change (no revision bump, no
 * push).
 *
 * Bounded work on the main thread: lines longer than
 * `NOTE_LINKS_MAX_LINE_CHARS` are skipped and scanning stops after
 * `NOTE_LINKS_MAX_SCAN_BYTES` (logged); both scanners are linear per line.
 *
 * Phantom sources: rows of notes deleted/renamed while the flag was off are
 * pruned when the store is first used after the flag turns on (and on every
 * later off → on transition); backlinks additionally hide sources that can
 * no longer be found (`noteLinkSourceExists`).
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
import { getEntityLinkStore, type DesiredOutgoingLink, type EntityLinkStore, type OutgoingOwnership } from './link-store.ts'
import { getEntitiesWorkbenchFlags, onEntitiesWorkbenchFlagsChanged } from './workbench-flags.ts'

/** Author recorded on indexer-written links. */
export const NOTE_LINKS_INDEXER_ACTOR = 'system:notes-indexer'

/** The rows the indexer owns: its own author, its own relations. */
export const NOTE_LINKS_INDEXER_OWNERSHIP: OutgoingOwnership = Object.freeze({
  createdBy: NOTE_LINKS_INDEXER_ACTOR,
  relations: Object.freeze(['mentions', 'embeds'] as const),
})

/** Lines longer than this are not scanned (pasted blobs, minified data). */
export const NOTE_LINKS_MAX_LINE_CHARS = 20_000
/** Scanning stops once this many UTF-8 bytes of the note were consumed. */
export const NOTE_LINKS_MAX_SCAN_BYTES = 2 * 1024 * 1024

export interface NoteLink {
  to: EntityRef
  relation: Extract<EntityRelation, 'mentions' | 'embeds'>
  /** 1-based line of the first occurrence in the saved file. */
  line: number
}

/**
 * `[[target|alias]]` / `![[target|alias]]` — same shape as
 * `wikilinkTargetsToRefs`, with bounded target/alias lengths so a line full
 * of unmatched `[[` costs O(line × 512), not O(line²).
 */
const WIKILINK_RE = /(!?)\[\[([^\]\n|]{1,512}?)(?:\|[^\]\n]{0,512})?\]\]/g
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Blank out inline code spans so `[[x]]` inside backticks never links.
 * Linear scan (CommonMark pairing: a backtick run closes at the next run of
 * the same length; an unmatched run is literal), replacing the previous
 * backreference regex that was quadratic on many unmatched runs.
 */
function stripInlineCode(line: string): string {
  if (!line.includes('`')) return line
  const starts: number[] = []
  const ends: number[] = []
  for (let i = 0; i < line.length;) {
    if (line.charCodeAt(i) !== 96) { i++; continue }
    let j = i
    while (j < line.length && line.charCodeAt(j) === 96) j++
    starts.push(i)
    ends.push(j)
    i = j
  }
  const next = new Array<number>(starts.length).fill(-1)
  const lastByLength = new Map<number, number>()
  for (let k = starts.length - 1; k >= 0; k--) {
    const length = ends[k]! - starts[k]!
    next[k] = lastByLength.get(length) ?? -1
    lastByLength.set(length, k)
  }
  let out = ''
  let cursor = 0
  for (let k = 0; k < starts.length;) {
    const close = next[k]!
    if (close < 0) { k++; continue }
    out += line.slice(cursor, starts[k]) + ' '.repeat(ends[close]! - starts[k]!)
    cursor = ends[close]!
    k = close + 1
  }
  return out + line.slice(cursor)
}

export interface ExtractNoteLinksOptions {
  /** Receives one line per capped note (skipped long lines / truncated scan). */
  logger?: Pick<Console, 'warn'>
  /** Shown in the cap log line (e.g. the note id). */
  label?: string
}

/**
 * Extract the explicit-syntax links of a Markdown note, keyed by
 * `(relation, to)` in first-seen order with the line of first occurrence.
 */
export function extractNoteLinks(markdown: string, self?: EntityRef, options: ExtractNoteLinksOptions = {}): NoteLink[] {
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
  let scannedBytes = 0
  let skippedLines = 0
  let truncatedAtLine = 0
  for (; index < lines.length; index++) {
    const raw = lines[index] ?? ''
    scannedBytes += Buffer.byteLength(raw, 'utf8') + 1
    if (scannedBytes > NOTE_LINKS_MAX_SCAN_BYTES) {
      truncatedAtLine = index + 1
      break
    }
    if (raw.length > NOTE_LINKS_MAX_LINE_CHARS) {
      skippedLines += 1
      continue
    }
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
  if (skippedLines > 0 || truncatedAtLine > 0) {
    const what = [
      skippedLines > 0 ? `skipped ${skippedLines} line(s) over ${NOTE_LINKS_MAX_LINE_CHARS} chars` : '',
      truncatedAtLine > 0 ? `stopped at line ${truncatedAtLine} (note over ${NOTE_LINKS_MAX_SCAN_BYTES} bytes)` : '',
    ].filter(Boolean).join('; ')
    ;(options.logger ?? console).warn(`[entities] note link scan capped${options.label ? ` for ${options.label}` : ''}: ${what}`)
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

// ── Phantom-source pruning (review 4, owner decision) ──────────────────────
//
// Note ops that happen while the flag is OFF never touch the store, so a
// note deleted/renamed then would keep its outgoing rows forever. The
// enable generation bumps on every observed off → on transition (the first
// enabled observation counts); each workspace store is pruned once per
// generation, on first use.

type NoteSourceProbe = (workspace: NoteLinksWorkspace, noteId: string) => boolean

let noteSourceProbe: NoteSourceProbe | null = null
let lastObservedEnabled = false
let enableGeneration = 0
const prunedGeneration = new Map<string, number>()

/**
 * The Notes handlers register how to tell whether a note id still exists.
 * Returns a disposer (clears the probe only if it is still this one).
 */
export function setNoteLinksSourceProbe(probe: NoteSourceProbe | null): () => void {
  noteSourceProbe = probe
  return () => { if (noteSourceProbe === probe) noteSourceProbe = null }
}

/** Record the live flag value; an off → on transition re-arms pruning. */
export function observeEntitiesLinksEnabled(enabled: boolean): boolean {
  if (enabled && !lastObservedEnabled) enableGeneration += 1
  lastObservedEnabled = enabled
  return enabled
}

// Main publishes renderer toggles through the workbench-flag source; observe
// them eagerly so a transition is seen even when no note op ran meanwhile.
onEntitiesWorkbenchFlagsChanged(flags => { observeEntitiesLinksEnabled(isEntitiesLinksEnabled(flags)) })

/**
 * False only when the source is a note the Notes handlers can no longer
 * find. Unknown kinds, no registered probe or a probe error count as present
 * (never hide or prune on uncertainty).
 */
export function noteLinkSourceExists(workspace: NoteLinksWorkspace, ref: EntityRef): boolean {
  if (ref.kind !== 'note' || !noteSourceProbe) return true
  try {
    return noteSourceProbe(workspace, ref.id)
  } catch {
    return true
  }
}

/** Remove indexer-owned rows whose source note no longer exists. Returns rows removed. */
export function pruneMissingNoteLinkSources(workspace: NoteLinksWorkspace, store: EntityLinkStore = getEntityLinkStore(workspace.rootPath)): number {
  if (!noteSourceProbe) return 0
  let removed = 0
  for (const id of store.outgoingSourceIds('note', NOTE_LINKS_INDEXER_OWNERSHIP)) {
    if (noteLinkSourceExists(workspace, noteEntityRef(id))) continue
    removed += store.removeOutgoing(noteEntityRef(id), NOTE_LINKS_INDEXER_OWNERSHIP)
  }
  return removed
}

/**
 * Prune once per enable generation per workspace (first store use after the
 * flag turned on). Call only while enabled. Returns rows removed.
 */
export function ensureNoteLinksPruned(workspace: NoteLinksWorkspace, logger: Pick<Console, 'warn'> = console): number {
  if (!noteSourceProbe || enableGeneration === 0) return 0
  if (prunedGeneration.get(workspace.rootPath) === enableGeneration) return 0
  prunedGeneration.set(workspace.rootPath, enableGeneration)
  try {
    return pruneMissingNoteLinkSources(workspace)
  } catch (error) {
    logger.warn('[entities] pruning links of missing notes failed:', error)
    return 0
  }
}

/** Test seam. */
export function __resetNoteLinksPruneStateForTests(): void {
  noteSourceProbe = null
  lastObservedEnabled = false
  enableGeneration = 0
  prunedGeneration.clear()
}

// ── Native-path ordering (review 4) ────────────────────────────────────────

export interface NoteLinksRevision {
  /** Journal entity id; revisions only compare within one entity. */
  nativeId: string
  revision: number
}

export interface NoteLinksSerializer {
  /**
   * Run `job` after every earlier job for `(workspaceId, noteId)` settled.
   * With a `revision`, the job is skipped when an equal or newer revision of
   * the same entity was already applied for that note (an out-of-order,
   * stale read never overwrites newer links). `reset` forgets the note's
   * revision first (a newly created entity). Job errors are logged.
   */
  run(workspaceId: string, noteId: string, job: () => void | Promise<void>, options?: { revision?: NoteLinksRevision; reset?: boolean; tombstone?: NoteLinksRevision }): Promise<void>
}

export function createNoteLinksSerializer(logger: Pick<Console, 'warn'> = console): NoteLinksSerializer {
  const chains = new Map<string, Promise<void>>()
  const applied = new Map<string, NoteLinksRevision>()
  return {
    run(workspaceId, noteId, job, options = {}) {
      const key = `${workspaceId}\u0000${noteId}`
      const step = async () => {
        if (options.reset) applied.delete(key)
        const revision = options.revision
        if (revision) {
          const seen = applied.get(key)
          if (seen && seen.nativeId === revision.nativeId && revision.revision <= seen.revision) return
        }
        await job()
        if (revision) applied.set(key, revision)
        if (options.tombstone) applied.set(key, options.tombstone)
      }
      const run = (chains.get(key) ?? Promise.resolve()).then(step).catch(error => {
        logger.warn('[entities] note link indexing failed:', error)
      })
      chains.set(key, run)
      void run.then(() => { if (chains.get(key) === run) chains.delete(key) })
      return run
    },
  }
}

export function createNoteLinksIndexer(options: NoteLinksIndexerOptions = {}): NoteLinksIndexer {
  const readEnabled = options.isEnabled ?? (() => isEntitiesLinksEnabled(getEntitiesWorkbenchFlags()))
  const isEnabled = () => observeEntitiesLinksEnabled(readEnabled())
  const logger = options.logger ?? console
  const notify = (workspaceId: string) => {
    try {
      options.notify?.(workspaceId)
    } catch (error) {
      logger.warn('[entities] linksChanged push failed:', error)
    }
  }
  const prune = (workspace: NoteLinksWorkspace): boolean => ensureNoteLinksPruned(workspace, logger) > 0
  return {
    isEnabled,
    index(workspace, noteId, content) {
      if (!isEnabled() || !noteId) return false
      const pruned = prune(workspace)
      const from = noteEntityRef(noteId)
      const desired: DesiredOutgoingLink[] = extractNoteLinks(content, from, { logger, label: noteId }).map(link => ({
        to: link.to,
        relation: link.relation,
        anchor: { line: link.line },
      }))
      const result = getEntityLinkStore(workspace.rootPath).replaceOutgoing(from, desired, NOTE_LINKS_INDEXER_OWNERSHIP)
      // Anchor-only refreshes are not a link change: no push.
      const changed = pruned || result.added + result.removed > 0
      if (changed) notify(workspace.id)
      return changed
    },
    remove(workspace, noteId) {
      if (!isEnabled() || !noteId) return false
      const pruned = prune(workspace)
      const removed = getEntityLinkStore(workspace.rootPath).removeOutgoing(noteEntityRef(noteId), NOTE_LINKS_INDEXER_OWNERSHIP) > 0
      if (removed || pruned) notify(workspace.id)
      return removed || pruned
    },
    removeFolder(workspace, folder) {
      const prefix = folder.replace(/\/+$/, '')
      if (!isEnabled() || !prefix) return false
      const pruned = prune(workspace)
      const removed = getEntityLinkStore(workspace.rootPath).removeOutgoingByIdPrefix('note', `${prefix}/`, NOTE_LINKS_INDEXER_OWNERSHIP) > 0
      if (removed || pruned) notify(workspace.id)
      return removed || pruned
    },
  }
}
