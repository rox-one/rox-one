/**
 * Transcripts notebook — the Notes space «Мои записи/Мои транскрипты».
 *
 * Every recorded audio message (dictation) and every transcribed meeting lands
 * here as a plain Markdown note: paragraphs as delivered, no auto-send. The
 * space is an ordinary Notes folder, so it shows up in the Notes sidebar tree
 * without any extra registry.
 *
 * The write is idempotent: the note body carries a content-addressed anchor
 * comment, so re-saving the same transcript (retry, reload, second window) is a
 * no-op instead of a duplicate note.
 *
 * Contract (frozen): `saveTranscriptToNotebook({ title, text, source, createdAt? })`.
 * It resolves when the transcript is stored (or when this host has no Notes at
 * all) and rejects when a store attempt failed, so fire-and-forget callers can
 * attach a `.catch()` and retrying callers can retry.
 */
import i18n from 'i18next'
import { activeWorkspaceContextAtom } from '@/atoms/workspace-context'
import { getShellStore } from '@/platform/shell-store'
import type { LocalTranscriptSegment } from '../../shared/meetings-local'
import type { ElectronAPI, NoteDocument } from '../../shared/types'
import { hasNativeNotesTransport } from './notes-capability'
import { isNativeNoteDocument } from './notes-write-authority'

export type TranscriptNotebookSource = 'dictation' | 'meeting'

export interface TranscriptNotebookInput {
  /** Base note title; the notebook keeps it verbatim. */
  title: string
  /** Transcript text. Blank lines separate paragraphs. */
  text: string
  source: TranscriptNotebookSource
  createdAt?: number
}

/** Segments separated by a longer pause start a new paragraph. */
const PARAGRAPH_GAP_MS = 2_000
const ANCHOR_PREFIX = 'rox-transcript'

function translate(key: string, ru: string, en: string): string {
  const value = i18n.t(key)
  if (value !== key) return value
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'ru'
  return language.startsWith('ru') ? ru : en
}

/** Localized date + time stamp used inside transcript note titles. */
export function transcriptNoteStamp(at: number): string {
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'ru'
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(at))
  } catch {
    return new Date(at).toLocaleString()
  }
}

/** Groups transcript segments into readable paragraphs (pauses and speaker changes). */
export function transcriptSegmentsToText(segments: readonly LocalTranscriptSegment[]): string {
  const paragraphs: string[] = []
  let current: string[] = []
  let previous: LocalTranscriptSegment | null = null
  const flush = () => {
    if (current.length) paragraphs.push(current.join(' '))
    current = []
  }
  for (const segment of segments) {
    const text = segment.text.trim()
    if (!text) continue
    if (previous && (segment.startMs - previous.endMs > PARAGRAPH_GAP_MS || (segment.speakerId ?? null) !== (previous.speakerId ?? null))) flush()
    current.push(text)
    previous = segment
  }
  flush()
  return paragraphs.join('\n\n')
}

/** FNV-1a (32-bit) — deterministic, dependency-free content anchor. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

async function resolveWorkspaceId(api: ElectronAPI): Promise<string | null> {
  const active = getShellStore().get(activeWorkspaceContextAtom)
  if (active) return active
  if (api.getWindowWorkspace) return await api.getWindowWorkspace()
  return null
}

/** Native notes require the native transport *and* a native identity authority. */
async function resolveNativeAuthority(api: ElectronAPI): Promise<boolean> {
  if (api.getOrgIdentity) {
    try {
      const identity = await api.getOrgIdentity()
      if (identity.authority === 'native') return true
      if (identity.authority === 'local') return false
    } catch {
      /* fall back to transport capability */
    }
  }
  return hasNativeNotesTransport(api)
}

/** Claim-gate errors raised by the markdown commit store are transient: retry them. */
const CLAIM_RETRY_DELAYS_MS = [0, 400, 1000, 2000, 4000, 6000]

/** `MarkdownCommitError` reaches the renderer either as an Error or as a plain RPC object. */
function claimMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    const code = (error as { code?: unknown }).code
    const parts = [typeof message === 'string' ? message : '', typeof code === 'string' ? code : '', (() => {
      try { return JSON.stringify(error) } catch { return '' }
    })()]
    return parts.filter(Boolean).join(' ')
  }
  return error instanceof Error ? error.message : ''
}

function isClaimContention(error: unknown): boolean {
  return /Document claim requires recovery|Document writer is busy|rateLimited/i.test(claimMessage(error))
}

/** The notes commit store serializes writers behind a per-directory claim; a loss is retryable. */
async function withClaimRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (const delay of CLAIM_RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      return await operation()
    } catch (error) {
      if (!isClaimContention(error)) throw error
      lastError = error
    }
  }
  throw lastError
}

/**
 * Serializes notebook writes. A startup re-mirror publishes several meetings at once, and the
 * store's per-directory claim gate makes concurrent writers lose to each other; a single tail
 * keeps our own writes out of each other's way.
 */
let notebookWriteTail: Promise<unknown> = Promise.resolve()

/** Upper bound for one queued notebook write before the queue moves on. */
const NOTEBOOK_WRITE_DEADLINE_MS = 20_000

function enqueueNotebookWrite<T>(operation: () => Promise<T>): Promise<T> {
  // A store call can block on the native journal; the deadline keeps one stuck write from
  // wedging every later transcript (the caller still treats the result as best-effort).
  const deadline = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('transcripts-notebook write timed out')), NOTEBOOK_WRITE_DEADLINE_MS)
  })
  const run = notebookWriteTail.then(operation, operation)
  const settled = Promise.race([run, deadline])
  notebookWriteTail = settled.catch(() => undefined)
  return settled
}

/** A permanently failed save must not leave an empty transcript stub behind. */
async function discardEmptyStub(api: ElectronAPI, workspaceId: string, noteId: string, title: string): Promise<void> {
  try {
    const current = await api.readNote(workspaceId, noteId)
    const body = (current.content ?? '').trim()
    if (body && body !== `# ${title}`) return
    await api.deleteNote(workspaceId, noteId)
  } catch {
    /* Cleanup is best-effort; the failed save is the reported outcome. */
  }
}

async function writeNotebookNote(api: ElectronAPI, workspaceId: string, folder: string, input: TranscriptNotebookInput, text: string, native: boolean): Promise<void> {
  const digest = fnv1a([input.source, String(input.createdAt ?? 0), text].join('\u0000'))
  const anchor = `<!-- ${ANCHOR_PREFIX}:${digest} -->`
  const notes = await api.listNotes(workspaceId)
  const inFolder = notes.filter((note) => {
    const parts = note.id.split('/')
    parts.pop()
    return parts.join('/') === folder
  })
  for (const note of inFolder) {
    if ((await api.readNote(workspaceId, note.id)).content.includes(anchor)) return
  }
  // Titles must stay unique inside the folder: the native create path derives the
  // note id from the title and would otherwise overwrite a sibling transcript.
  const taken = new Set(inFolder.map((note) => note.title))
  const base = input.title.trim() || translate('transcriptsNotebook.untitled', 'Транскрипт', 'Transcript')
  let title = base
  for (let index = 2; taken.has(title); index += 1) title = `${base} (${index})`
  const created: NoteDocument = await withClaimRetry(() => api.createNote(workspaceId, title, folder,
    native ? { operationId: `transcript-note:${digest}`, expectedRevision: null, schemaVersion: 1, recoverCreation: true } : undefined))
  const body = [created.content?.trimEnd() || `# ${title}`, text, anchor].filter(Boolean).join('\n\n')
  try {
    if (isNativeNoteDocument(created)) {
      if (!created.nativeId || !Number.isSafeInteger(created.nativeRevision) || (created.nativeRevision ?? 0) < 1) {
        throw new Error(translate('transcriptsNotebook.error.saveFailed', 'Не удалось сохранить транскрипт в заметки', 'Could not save the transcript to Notes'))
      }
      await withClaimRetry(() => api.saveNote(workspaceId, created.id, `${body}\n`, undefined,
        { operationId: `transcript-note-save:${digest}`, expectedRevision: created.nativeRevision!, schemaVersion: 1 }))
      return
    }
    const opened = created.revision && created.sourceStoreId
      ? created
      : await withClaimRetry(() => api.readNote(workspaceId, created.id))
    if (!opened.revision || !opened.sourceStoreId) {
      throw new Error(translate('transcriptsNotebook.error.saveFailed', 'Не удалось сохранить транскрипт в заметки', 'Could not save the transcript to Notes'))
    }
    await withClaimRetry(() => api.saveNote(workspaceId, created.id, `${body}\n`, opened.revision, opened.sourceStoreId))
  } catch (error) {
    await discardEmptyStub(api, workspaceId, created.id, title)
    throw error
  }
}

/**
 * Stores one transcript as a note inside the notebook space.
 *
 * Best-effort by design: callers may fire-and-forget (`void ... .catch(() => {})`).
 * Rejects only when a store attempt actually failed, so a retrying caller can
 * retry; a host without Notes resolves as a no-op.
 */
export async function saveTranscriptToNotebook(input: TranscriptNotebookInput): Promise<void> {
  const text = input.text.trim()
  if (!text) return
  const api = window.electronAPI
  if (!api || !api.createNote || !api.listNotes || !api.readNote || !api.saveNote) return
  try {
    await enqueueNotebookWrite(async () => {
      const workspaceId = await resolveWorkspaceId(api)
      if (!workspaceId) {
        throw new Error(translate('transcriptsNotebook.error.noWorkspace', 'Не удалось определить рабочее пространство', 'Workspace is unavailable'))
      }
      const native = await resolveNativeAuthority(api)
      // Notes folders are implicit: the nested «Мои записи/Мои транскрипты» space
      // appears in the sidebar tree as soon as the first transcript lands in it.
      const parent = translate('transcriptsNotebook.space.parent', 'Мои записи', 'My records')
      const name = translate('transcriptsNotebook.space.name', 'Мои транскрипты', 'My transcripts')
      await writeNotebookNote(api, workspaceId, `${parent}/${name}`, input, text, native)
    })
  } catch (error) {
    console.warn('[transcripts-notebook] transcript not saved', error)
    throw error
  }
}