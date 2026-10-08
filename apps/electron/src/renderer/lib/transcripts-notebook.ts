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
  const created: NoteDocument = await api.createNote(workspaceId, title, folder,
    native ? { operationId: `transcript-note:${digest}`, expectedRevision: null, schemaVersion: 1, recoverCreation: true } : undefined)
  const body = [created.content?.trimEnd() || `# ${title}`, text, anchor].filter(Boolean).join('\n\n')
  if (isNativeNoteDocument(created)) {
    if (!created.nativeId || !Number.isSafeInteger(created.nativeRevision) || (created.nativeRevision ?? 0) < 1) {
      throw new Error(translate('transcriptsNotebook.error.saveFailed', 'Не удалось сохранить транскрипт в заметки', 'Could not save the transcript to Notes'))
    }
    await api.saveNote(workspaceId, created.id, `${body}\n`, undefined,
      { operationId: `transcript-note-save:${digest}`, expectedRevision: created.nativeRevision!, schemaVersion: 1 })
    return
  }
  const opened = created.revision && created.sourceStoreId ? created : await api.readNote(workspaceId, created.id)
  if (!opened.revision || !opened.sourceStoreId) {
    throw new Error(translate('transcriptsNotebook.error.saveFailed', 'Не удалось сохранить транскрипт в заметки', 'Could not save the transcript to Notes'))
  }
  await api.saveNote(workspaceId, created.id, `${body}\n`, opened.revision, opened.sourceStoreId)
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
  } catch (error) {
    console.warn('[transcripts-notebook] transcript not saved', error)
    throw error
  }
}