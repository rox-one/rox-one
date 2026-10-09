/**
 * DreamNotesScanner — finds vault notes the dream has not yet absorbed (spec §9).
 *
 * The dream's step 2 walks the notes vault and turns each changed note into a
 * proposal. "Changed" is a content hash comparison against a watermark:
 * `{configDir}/memory/notes-watermark.json` maps `noteId → sha1(content)`.
 * A note is pending when its current hash differs from the watermark (new,
 * edited, or previously failed). `markProcessed(ids)` rewrites the watermark
 * atomically after a successful step — never before, so a failed distillation
 * retries on the next dream.
 *
 * The watermark file is shared by every bank, so entries are namespaced by the
 * bank's vault (`<bankKey>::<noteId>`). Two workspace banks whose roots both
 * hold `note.md` therefore track it independently instead of colliding on a
 * bare `note` key. The default (root-less, id-less) bank keeps the bare key so
 * the global `main` bank's existing entries survive; entries a workspace bank
 * wrote under the old bare scheme are simply ignored, so those notes are
 * re-distilled once and re-keyed — never mis-attributed to another bank.
 *
 * No LLM lives here. The note source is injected (`listNotes`) so tests and the
 * host can supply the canonical vault index; the built-in default scans
 * Markdown under the directory the canonical resolver picks — by default
 * `resolveDreamNotesRoot`, which mirrors the Notes UI/RPC rule (`notes.ts`
 * `getWorkspaceNotesRoot`): a custom workspace `notesPath`, else
 * `{defaultWorkspacesDir}/{workspaceId}/notes`, falling back to the
 * knowledge-source vault (`{workspaceRoot}/sources/notes/config.json`, the file
 * the knowledge layer reads) when the primary root is absent — or from an
 * explicit `notesDir`.
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs'
import type { Stats } from 'fs'
import { dirname, join, relative } from 'path'
import { isImportProvenancedRelativePath } from '@rox/shared/config'
import { getDefaultWorkspacesDir, loadWorkspaceConfig } from '@rox/shared/workspaces'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import { expandPath } from '@rox/shared/utils/paths'
import { noteIdFromRelativePath } from '../../knowledge/vault-markdown'

export interface DreamNote {
  id: string
  title?: string
  /** ISO timestamp of the last vault write. */
  updatedAt: string
  content: string
}

export interface DreamPendingNote {
  id: string
  title?: string
  content: string
}

export type DreamNoteLister = () => Promise<DreamNote[]>

/**
 * Resolve the notes root a bank's dream should scan, mirroring the Notes
 * UI/RPC (`notes.ts#getWorkspaceNotesRoot`). Returns null when no notes root
 * exists so the notes step honestly reports "no changed notes".
 */
export type DreamNotesRootResolver = (workspaceId: string | null, workspaceRoot: string) => string | null

export interface DreamNotesScannerDeps {
  /** Explicit vault directory for the default Markdown scan. */
  notesDir?: string
  /** Watermark file, `{configDir}/memory/notes-watermark.json`. */
  stateFile: string
  /** Canonical note source; when absent the scanner walks `notesDir`. */
  listNotes?: DreamNoteLister
  /**
   * Canonical notes-root resolver; defaults to `resolveDreamNotesRoot`. The
   * host injects this (or leaves the default) so the dream reads the SAME
   * directory the Notes screen shows for a bank.
   */
  resolveNotesRoot?: DreamNotesRootResolver
}

function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf-8').digest('hex')
}

/**
 * Resolve the vault path the source config stores. Delegates to the app's
 * canonical resolver so `~`, `$HOME`, `${CRAFT_CONFIG_DIR}` and the
 * `$WORKSPACE` / `$SOURCE_DIR` tokens (bare and `${…}`) behave exactly as the
 * knowledge layer's source loader does; relative paths resolve against the
 * workspace root.
 */
function expandNotesPath(raw: string, workspaceRoot: string, sourceDir: string): string {
  return expandPath(raw, workspaceRoot, { WORKSPACE: workspaceRoot, SOURCE_DIR: sourceDir })
}

/** The directory itself when it exists on disk, else null (unmounted roots included). */
function existingDirectoryOrNull(path: string): string | null {
  try {
    return statSync(path).isDirectory() ? path : null
  } catch {
    return null
  }
}

/** Resolve the vault directory from `{workspaceRoot}/sources/notes/config.json`, or null. */
function resolveNotesDirFromWorkspace(workspaceRoot: string): string | null {
  const sourceDir = join(workspaceRoot, 'sources', 'notes')
  try {
    const config: unknown = JSON.parse(readFileSync(join(sourceDir, 'config.json'), 'utf-8'))
    if (!config || typeof config !== 'object') return null
    if ('enabled' in config && config.enabled === false) return null
    if (!('type' in config) || config.type !== 'local') return null
    if (!('local' in config) || !config.local || typeof config.local !== 'object') return null
    if (!('path' in config.local) || typeof config.local.path !== 'string') return null
    return existingDirectoryOrNull(expandNotesPath(config.local.path, workspaceRoot, sourceDir))
  } catch {
    return null
  }
}

const NOTES_DIR = 'notes'

/**
 * Canonical notes root for a bank's dream — the exact rule the Notes UI/RPC
 * uses (`notes.ts#getWorkspaceNotesRoot`), with the knowledge-source vault as
 * an explicit fallback:
 *
 *  1. custom workspace `notesPath` (`{workspaceRoot}/config.json`) → that path,
 *     even when it does not exist yet: the Notes UI uses (and creates) it, so
 *     the dream must stay on it and report "no changed notes" rather than
 *     silently scanning a different vault;
 *  2. else `{defaultWorkspacesDir}/{workspaceId}/notes` (the isolated app-data
 *     root the Notes screen falls back to);
 *  3. else `{workspaceRoot}/sources/notes/config.json` (`local.path`, expanded);
 *  4. nothing exists → null, so the notes step reports "no changed notes".
 *
 * `workspaceId` is null for the global `main` bank, which has no default notes
 * directory and therefore falls straight through to the source vault.
 */
export function resolveDreamNotesRoot(workspaceId: string | null, workspaceRoot: string): string | null {
  if (!workspaceRoot) return null
  const config = loadWorkspaceConfig(workspaceRoot)
  if (config?.notesPath) return config.notesPath
  if (workspaceId) {
    const defaultRoot = existingDirectoryOrNull(join(getDefaultWorkspacesDir(), workspaceId, NOTES_DIR))
    if (defaultRoot) return defaultRoot
  }
  return resolveNotesDirFromWorkspace(workspaceRoot)
}

function firstHeading(content: string, fallback: string): string {
  const match = /^#{1,6}\s+(.+?)\s*$/m.exec(content)
  return match ? match[1].trim() : fallback
}

/** Top-level dirs the Notes UI/RPC (`notes.ts`) and vault index never list. */
const SKIP_DIRS: Record<string, true> = { assets: true, templates: true }

/**
 * Deterministic recursive Markdown listing (sorted, Notes-RPC namespace ids).
 * Mirrors the Notes UI/RPC (`notes.ts#listMarkdownFiles`) and vault index
 * (`vault-index.ts`) exclusions so `pendingNoteIds` matches `listNotes()`:
 * dot-entries (`.trash/**`, `.craft`, `.git`), the top-level `assets` and
 * `templates` directories, and import-provenanced paths (`imports/**`,
 * `assets/imports/**`).
 */
function scanMarkdownNotes(root: string): DreamNote[] {
  const out: DreamNote[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      let stats: Stats
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      const rel = relative(root, full).replace(/\\/g, '/')
      if (isImportProvenancedRelativePath(rel)) continue
      if (stats.isDirectory()) {
        const top = rel.split('/')[0] ?? rel
        if (SKIP_DIRS[top]) continue
        walk(full)
      } else if (stats.isFile() && name.toLowerCase().endsWith('.md')) {
        // Ids share the Notes RPC namespace (vault-relative POSIX, no `.md`) so
        // `pendingNoteIds` intersects `listNotes()` ids — see notes.ts
        // `noteIdFromRelativePath` (same derivation) and vault-index.ts.
        const id = noteIdFromRelativePath(rel)
        const content = readFileSync(full, 'utf-8')
        out.push({
          id,
          title: firstHeading(content, name.replace(/\.md$/i, '')),
          updatedAt: stats.mtime.toISOString(),
          content,
        })
      }
    }
  }
  walk(root)
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Parse the watermark file; anything malformed degrades to "nothing absorbed yet". */
function readWatermark(stateFile: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(stateFile, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Watermark namespace for a bank: its vault root, else workspace id, else the flat default. */
function bankKeyFor(workspaceRoot?: string, workspaceId?: string | null): string {
  if (workspaceRoot) return `root:${workspaceRoot}`
  if (workspaceId) return `ws:${workspaceId}`
  return ''
}

/** Namespaced watermark key; the flat default bank keeps the bare note id. */
function watermarkKey(bank: string, noteId: string): string {
  return bank ? `${bank}::${noteId}` : noteId
}

interface BankCache {
  key: string
  workspaceRoot?: string
  workspaceId: string | null
  /** Monotonic listing order, used only to break ties when a bank is not named. */
  seq: number
  notes: Map<string, DreamNote>
}

export class DreamNotesScanner {
  private readonly deps: DreamNotesScannerDeps
  /**
   * Content caches keyed by bank (vault root / workspace id), one per listed
   * batch. `markProcessed` reads these instead of a single "last" cache, so a
   * concurrent `listPending` for another bank cannot lose the ids a run just
   * listed.
   */
  private readonly banks = new Map<string, BankCache>()
  private seq = 0

  constructor(deps: DreamNotesScannerDeps) {
    this.deps = deps
  }

  private async loadNotes(workspaceRoot?: string, workspaceId?: string | null): Promise<DreamNote[]> {
    if (this.deps.listNotes) return this.deps.listNotes()
    let dir = this.deps.notesDir ?? null
    if (!dir && workspaceRoot) {
      const resolver = this.deps.resolveNotesRoot ?? resolveDreamNotesRoot
      dir = resolver(workspaceId ?? null, workspaceRoot)
    }
    if (!dir || !existsSync(dir)) return []
    return scanMarkdownNotes(dir)
  }

  /** Notes whose current content hash differs from the watermark (sorted by id). */
  async listPending(workspaceRoot?: string, workspaceId?: string | null): Promise<DreamPendingNote[]> {
    const notes = await this.loadNotes(workspaceRoot, workspaceId)
    const key = bankKeyFor(workspaceRoot, workspaceId)
    this.banks.set(key, {
      key,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      workspaceId: workspaceId ?? null,
      seq: ++this.seq,
      notes: new Map(notes.map((note) => [note.id, note])),
    })
    const watermark = readWatermark(this.deps.stateFile)
    const pending: DreamPendingNote[] = []
    for (const note of notes) {
      if (watermark[watermarkKey(key, note.id)] === sha1(note.content)) continue
      pending.push({ id: note.id, title: note.title, content: note.content })
    }
    pending.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return pending
  }

  /**
   * Current content for the given note ids, bypassing the watermark: a forced
   * dream run (`memory:dreamRun` with `noteIds`) distils exactly these notes
   * even when unchanged. Ids absent from the bank's vault are dropped; the
   * result keeps the requested order and is de-duplicated. The bank's cache is
   * refreshed so a following `markProcessed(ids)` records their hashes.
   */
  async listByIds(
    ids: string[],
    workspaceRoot?: string,
    workspaceId?: string | null,
  ): Promise<DreamPendingNote[]> {
    if (ids.length === 0) return []
    const notes = await this.loadNotes(workspaceRoot, workspaceId)
    const key = bankKeyFor(workspaceRoot, workspaceId)
    const byId = new Map(notes.map((note) => [note.id, note]))
    this.banks.set(key, {
      key,
      ...(workspaceRoot ? { workspaceRoot } : {}),
      workspaceId: workspaceId ?? null,
      seq: ++this.seq,
      notes: byId,
    })
    const seen = new Set<string>()
    const out: DreamPendingNote[] = []
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const note = byId.get(id)
      if (note) out.push({ id: note.id, title: note.title, content: note.content })
    }
    return out
  }

  /** The bank whose most recent listing holds `id`, or the flat default bank. */
  private bankForId(id: string): string {
    let best: BankCache | null = null
    for (const cache of this.banks.values()) {
      if (!cache.notes.has(id)) continue
      if (!best || cache.seq > best.seq) best = cache
    }
    return best?.key ?? ''
  }

  private async reloadBank(
    key: string,
    cache: BankCache | undefined,
    workspaceRoot?: string,
    workspaceId?: string | null,
  ): Promise<BankCache> {
    const root = cache?.workspaceRoot ?? workspaceRoot
    const id = cache?.workspaceId ?? workspaceId ?? null
    const notes = await this.loadNotes(root, id)
    const next: BankCache = {
      key,
      ...(root ? { workspaceRoot: root } : {}),
      workspaceId: id,
      seq: ++this.seq,
      notes: new Map(notes.map((note) => [note.id, note])),
    }
    this.banks.set(key, next)
    return next
  }

  /**
   * Absorb the given notes: their current content hash becomes the watermark.
   * Callers may name the bank (`workspaceRoot`/`workspaceId`); when omitted the
   * bank is recovered from the per-bank caches. Ids with no cached (or
   * re-listable) content are skipped. The write is atomic (tmp + rename) so a
   * crash never leaves a torn watermark.
   */
  async markProcessed(ids: string[], workspaceRoot?: string, workspaceId?: string | null): Promise<void> {
    if (ids.length === 0) return
    const explicit = workspaceRoot !== undefined || workspaceId !== undefined
    const buckets = new Map<string, { key: string; ids: string[]; cache?: BankCache }>()
    for (const id of ids) {
      const key = explicit ? bankKeyFor(workspaceRoot, workspaceId) : this.bankForId(id)
      const bucket = buckets.get(key) ?? { key, ids: [], cache: this.banks.get(key) }
      bucket.ids.push(id)
      buckets.set(key, bucket)
    }
    const watermark = readWatermark(this.deps.stateFile)
    for (const bucket of buckets.values()) {
      let cache = bucket.cache
      if (!cache || bucket.ids.some((id) => !cache!.notes.has(id))) {
        cache = await this.reloadBank(bucket.key, cache, workspaceRoot, workspaceId)
      }
      for (const id of bucket.ids) {
        const note = cache.notes.get(id)
        if (!note) continue
        watermark[watermarkKey(bucket.key, id)] = sha1(note.content)
      }
    }
    mkdirSync(dirname(this.deps.stateFile), { recursive: true })
    atomicWriteFileSync(this.deps.stateFile, `${JSON.stringify(watermark, null, 2)}\n`)
  }
}