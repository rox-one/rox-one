import i18n from 'i18next'
import type { ElectronAPI } from '../../../shared/types'
import { withClaimRetry } from '../document-writer-retry'
import { createNativeNotesSyncController } from '../native-notes-sync'
import { isNativeNoteDocument } from '../notes-write-authority'

/** Vault folder every recorded transcript is filed under; localized at call time. */
export function transcriptsFolder(): string {
  return i18n.t('transcriptsNotebook.space.name')
}

export interface TranscriptSegmentInput {
  speaker: string
  text: string
  startMs?: number
}

export interface TranscriptRecordInput {
  workspaceId: string
  text: string
  source: 'dictation' | 'global' | 'meeting'
  at?: number
  language?: string | null
  model?: string | null
  durationMs?: number | null
  meetingId?: string | null
  meetingTitle?: string | null
  segments?: TranscriptSegmentInput[] | null
}

export interface TranscriptRecordResult {
  ok: boolean
  noteId?: string
  error?: string
}

type TranscriptNotesApi = Pick<
  ElectronAPI,
  'createNote' | 'readNote' | 'saveNote' | 'deleteNote' | 'nativeData' | 'nativeReplica' | 'listNotes'
>

export interface TranscriptRecordDeps {
  api?: TranscriptNotesApi
  createSyncController?: typeof createNativeNotesSyncController
}

const two = (value: number): string => String(value).padStart(2, '0')

/** `dd.mm.yyyy, HH:MM` in local time, without touching locale APIs. */
function formatStamp(at: number): string {
  const date = new Date(at)
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()}, ` +
    `${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Whole `mm:ss` (minutes are not wrapped at 60 for long recordings). */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${two(Math.floor(total / 60))}:${two(total % 60)}`
}

export function transcriptNoteTitle(input: TranscriptRecordInput): string {
  const stamp = formatStamp(input.at ?? Date.now())
  if (input.source !== 'meeting') return `${i18n.t('transcriptsNotebook.untitled')} ${stamp}`
  const title = input.meetingTitle?.trim() || i18n.t('transcriptsNotebook.untitledMeeting')
  return i18n.t('transcriptsNotebook.noteTitle.meeting', { title, when: stamp })
}

export function transcriptMarkdown(input: TranscriptRecordInput): string {
  const lines = [
    `**${i18n.t('transcriptsNotebook.note.date')}:** ${formatStamp(input.at ?? Date.now())}`,
    `**${i18n.t('transcriptsNotebook.note.source')}:** ${
      input.source === 'meeting' ? i18n.t('transcriptsNotebook.note.source.meeting') : i18n.t('transcriptsNotebook.note.source.dictation')
    }`,
  ]
  const language = input.language?.trim()
  if (language) lines.push(`**${i18n.t('transcriptsNotebook.note.language')}:** ${language}`)
  const model = input.model?.trim()
  if (model) lines.push(`**${i18n.t('transcriptsNotebook.note.model')}:** ${model}`)
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) {
    lines.push(`**${i18n.t('transcriptsNotebook.note.duration')}:** ${formatClock(input.durationMs)}`)
  }
  const segments = input.source === 'meeting' ? input.segments ?? [] : []
  const body = segments.length
    ? segments.map(segment => `**[${formatClock(segment.startMs ?? 0)}] ${segment.speaker}:** ${segment.text}`).join('\n')
    : input.text
  return `${lines.join('\n')}\n\n${body}`
}

/**
 * Write coordination, carried over from the retired notebook writer (see
 * docs/plans/2026-10-08-rox-user-batch.md, «Волна 4»): the notes commit store
 * serialises writers behind a per-directory claim (`withClaimRetry`), and our
 * own concurrent transcripts (a startup re-mirror of several meetings, a
 * dictation filing while another one commits) queue behind each other.
 *
 * `TRANSCRIPT_WRITE_DEADLINE_MS` bounds one queued write so a store call stuck
 * on the native journal cannot wedge every later note.
 */
const TRANSCRIPT_WRITE_DEADLINE_MS = 20_000
let transcriptWriteTail: Promise<unknown> = Promise.resolve()

/** Serialise transcript writes so concurrent callers never race the store claim. */
function enqueueTranscriptWrite<T>(operation: () => Promise<T>): Promise<T> {
  const { promise: deadline, reject } = Promise.withResolvers<never>()
  const timer = setTimeout(() => reject(new Error('Transcript note write timed out')), TRANSCRIPT_WRITE_DEADLINE_MS)
  const run = transcriptWriteTail.then(operation, operation)
  const settled = Promise.race([run, deadline]).finally(() => clearTimeout(timer))
  transcriptWriteTail = settled.catch(() => undefined)
  return settled
}

/** A permanently failed save must not leave an empty transcript stub behind. */
async function discardEmptyStub(api: TranscriptNotesApi, workspaceId: string, noteId: string, title: string): Promise<void> {
  try {
    const current = await api.readNote(workspaceId, noteId)
    const body = (current.content ?? '').trim()
    if (body && body !== `# ${title}`) return
    await api.deleteNote(workspaceId, noteId)
  } catch {
    /* Cleanup is best-effort; the failed save is the reported outcome. */
  }
}

export async function recordTranscript(
  input: TranscriptRecordInput,
  deps?: TranscriptRecordDeps,
): Promise<TranscriptRecordResult> {
  const api = deps?.api ?? window.electronAPI
  try {
    return await enqueueTranscriptWrite(async () => {
      const markdown = transcriptMarkdown(input)
      const title = transcriptNoteTitle(input)
      const created = await withClaimRetry(() => api.createNote(
        input.workspaceId,
        title,
        transcriptsFolder(),
        { operationId: crypto.randomUUID(), expectedRevision: null, schemaVersion: 1 },
      ))
      try {
        const nativeCapable = isNativeNoteDocument(created) &&
          typeof created.nativeId === 'string' && created.nativeId.length > 0 &&
          Number.isSafeInteger(created.nativeRevision) &&
          Boolean(api.nativeReplica) && Boolean(api.nativeData)
        if (nativeCapable) {
          const controller = (deps?.createSyncController ?? createNativeNotesSyncController)()
          try {
            await controller.start(input.workspaceId)
            const queued = await controller.queueSave(created, markdown)
            const receipts = await controller.flush()
            if (!receipts.some(receipt => receipt.operationId === queued.operationId)) {
              throw new Error('Native Notes transcript remains unacknowledged')
            }
            return { ok: true, noteId: created.id }
          } finally {
            try { await controller.stop() } catch { /* stop must never mask the write result */ }
          }
        }
        const saved = await withClaimRetry(() => api.saveNote(
          input.workspaceId,
          created.id,
          markdown,
          created.revision,
          created.sourceStoreId,
        ))
        if (!saved.id || saved.id !== created.id) {
          throw new Error('Notes markdown save returned a different document')
        }
        return { ok: true, noteId: saved.id }
      } catch (error) {
        // The note was created here, so its empty stub belongs to this failure.
        await discardEmptyStub(api, input.workspaceId, created.id, title)
        throw error
      }
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

