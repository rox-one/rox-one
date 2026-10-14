/**
 * Playbooks notebook store (С-12/С-13/С-15, docs/specs/2026-10-09-dev-space-and-playbooks,
 * D12). The notebook list is renderer-local state; the durable per-notebook
 * knowledge (sources, note, questions) is reconstructed from the existing
 * source-index facade on open. Persistence uses a dedicated localStorage key
 * (the shared `KEYS` registry is owned by В1 and is not extended here).
 *
 * Codebook notebooks (С-15, В5) persist their ordered cell pipeline in the same
 * record: `cells` is the `CodebookCell` list the server executes, so the
 * notebook is a single source of truth and no second store is introduced.
 */
import type { CodebookCell, CodebookCellKind } from '@rox/shared/playbooks'

export type NotebookMode = 'knowledge' | 'codebook'

export interface PlaybookNotebook {
  readonly id: string
  readonly name: string
  readonly mode: NotebookMode
  readonly createdAt: number
  readonly updatedAt: number
  readonly sourceSlugs: readonly string[]
  readonly note: string
  /** Bound repo/playbook project; absent → podcast uses the `playbooks` container. */
  readonly projectSlug?: string
  /** Codebook cell pipeline (С-15); empty/absent for knowledge notebooks. */
  readonly cells?: readonly CodebookCell[]
}

/** Defensive parse of one persisted codebook cell — a malformed cell is dropped. */
function parseCell(entry: unknown): CodebookCell | null {
  if (typeof entry !== 'object' || entry === null) return null
  const record = entry as Record<string, unknown>
  const kind = record.kind
  if (kind !== 'script' && kind !== 'agent' && kind !== 'artifact') return null
  if (typeof record.id !== 'string') return null
  return {
    id: record.id,
    kind,
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.command === 'string' ? { command: record.command } : {}),
    ...(Array.isArray(record.args) ? { args: record.args.filter((arg): arg is string => typeof arg === 'string') } : {}),
    ...(record.cwd === 'repository' || record.cwd === 'workspace' ? { cwd: record.cwd } : {}),
    ...(typeof record.prompt === 'string' ? { prompt: record.prompt } : {}),
    ...(typeof record.artifactId === 'string' ? { artifactId: record.artifactId } : {}),
  }
}

/** Codebook cell helpers (С-15): id allocation and an empty cell per kind. */
export function newCodebookCellId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `cell_${crypto.randomUUID()}`
  return `cell_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function createCodebookCell(kind: CodebookCellKind): CodebookCell {
  return { id: newCodebookCellId(), kind }
}

const STORAGE_KEY = 'rox.playbooks.notebooks.v1'

/** Defensive parse — a malformed entry is dropped, never thrown. */
export function parseNotebooks(raw: string | null): PlaybookNotebook[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((entry): PlaybookNotebook[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const record = entry as Record<string, unknown>
    const { id, name, mode, createdAt, updatedAt, sourceSlugs, note } = record
    if (typeof id !== 'string' || typeof name !== 'string') return []
    if (mode !== 'knowledge' && mode !== 'codebook') return []
    return [
      {
        id,
        name,
        mode,
        createdAt: typeof createdAt === 'number' ? createdAt : Date.now(),
        updatedAt: typeof updatedAt === 'number' ? updatedAt : Date.now(),
        sourceSlugs: Array.isArray(sourceSlugs)
          ? sourceSlugs.filter((slug): slug is string => typeof slug === 'string')
          : [],
        note: typeof note === 'string' ? note : '',
        ...(typeof record.projectSlug === 'string' ? { projectSlug: record.projectSlug } : {}),
        ...(Array.isArray(record.cells) ? { cells: record.cells.flatMap((cell) => { const parsed = parseCell(cell); return parsed ? [parsed] : [] }) } : {}),
      },
    ]
  })
}

export function loadNotebooks(): PlaybookNotebook[] {
  if (typeof localStorage === 'undefined') return []
  return parseNotebooks(localStorage.getItem(STORAGE_KEY))
}

export function saveNotebooks(notebooks: readonly PlaybookNotebook[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notebooks))
  } catch {
    /* quota/unavailable — the surface keeps working in-memory */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTEBOOKS_CHANGED_EVENT))
}

/** Fired (same window) after every save; other windows get the native `storage` event. */
export const NOTEBOOKS_CHANGED_EVENT = 'rox:playbooks-notebooks-changed'
const OPEN_INTENT_EVENT = 'rox:playbooks-open-intent'
let pendingOpenId: string | null = null
let pendingOpenTimer: ReturnType<typeof setTimeout> | null = null
/** An intent nobody consumed (navigation blocked) expires instead of firing on a later visit. */
const OPEN_INTENT_TTL_MS = 5_000

/** Subscribe to notebook list changes from this window or another one. */
export function subscribeNotebooks(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) listener() }
  window.addEventListener(NOTEBOOKS_CHANGED_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(NOTEBOOKS_CHANGED_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Deep-link into a notebook: the Playbooks route has no id segment, so the
 * caller records the intent before navigating and the page consumes it on
 * mount (or live, when it is already open).
 */
export function requestOpenNotebook(id: string): void {
  pendingOpenId = id
  if (pendingOpenTimer) clearTimeout(pendingOpenTimer)
  pendingOpenTimer = setTimeout(() => { pendingOpenId = null; pendingOpenTimer = null }, OPEN_INTENT_TTL_MS)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_INTENT_EVENT))
}

export function takeOpenNotebookIntent(): string | null {
  const id = pendingOpenId
  pendingOpenId = null
  if (pendingOpenTimer) { clearTimeout(pendingOpenTimer); pendingOpenTimer = null }
  return id
}

export function subscribeOpenNotebookIntent(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(OPEN_INTENT_EVENT, listener)
  return () => window.removeEventListener(OPEN_INTENT_EVENT, listener)
}

/** Create, persist and return a new notebook at the top of the list. */
export function addNotebook(name: string, mode: NotebookMode): PlaybookNotebook {
  const notebook = createNotebook(name, mode)
  saveNotebooks([notebook, ...loadNotebooks()])
  return notebook
}

export function newNotebookId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `nb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function createNotebook(name: string, mode: NotebookMode): PlaybookNotebook {
  const now = Date.now()
  return { id: newNotebookId(), name, mode, createdAt: now, updatedAt: now, sourceSlugs: [], note: '', ...(mode === 'codebook' ? { cells: [] } : {}) }
}