import type { ElectronAPI } from '../../../shared/types'
import { toErrorMessage } from '../errors'
import { createNativeNotesSyncController } from '../native-notes-sync'
import { isNativeNoteDocument } from '../notes-write-authority'

/** Vault folder every recorded transcript is filed under. */
export const TRANSCRIPTS_FOLDER = 'Мои транскрипты'

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
  'createNote' | 'readNote' | 'saveNote' | 'nativeData' | 'nativeReplica' | 'listNotes'
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
  if (input.source !== 'meeting') return `Транскрипт ${stamp}`
  const title = input.meetingTitle?.trim()
  return title ? `Встреча «${title}» — ${stamp}` : `Встреча ${stamp}`
}

export function transcriptMarkdown(input: TranscriptRecordInput): string {
  const lines = [
    `**Дата:** ${formatStamp(input.at ?? Date.now())}`,
    `**Источник:** ${input.source === 'meeting' ? 'Встреча' : 'Голосовой ввод'}`,
  ]
  const language = input.language?.trim()
  if (language) lines.push(`**Язык:** ${language}`)
  const model = input.model?.trim()
  if (model) lines.push(`**Модель:** ${model}`)
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) {
    lines.push(`**Длительность:** ${formatClock(input.durationMs)}`)
  }
  const segments = input.source === 'meeting' ? input.segments ?? [] : []
  const body = segments.length
    ? segments.map(segment => `**[${formatClock(segment.startMs ?? 0)}] ${segment.speaker}:** ${segment.text}`).join('\n')
    : input.text
  return `${lines.join('\n')}\n\n${body}`
}

export async function recordTranscript(
  input: TranscriptRecordInput,
  deps?: TranscriptRecordDeps,
): Promise<TranscriptRecordResult> {
  try {
    const api = deps?.api ?? window.electronAPI
    const markdown = transcriptMarkdown(input)
    const created = await api.createNote(
      input.workspaceId,
      transcriptNoteTitle(input),
      TRANSCRIPTS_FOLDER,
      { operationId: crypto.randomUUID(), expectedRevision: null, schemaVersion: 1 },
    )
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
    // Creation returns the opened document without the authenticated source binding;
    // the markdown writer rejects an unbound edit, so re-read unless it is already there.
    const opened = created.revision && created.sourceStoreId
      ? created
      : await api.readNote(input.workspaceId, created.id)
    if (!opened.revision || !opened.sourceStoreId) {
      throw new Error('Notes transcript has no authenticated source binding')
    }
    const saved = await api.saveNote(
      input.workspaceId,
      created.id,
      markdown,
      opened.revision,
      opened.sourceStoreId,
    )
    if (!saved.id || saved.id !== created.id) {
      throw new Error('Notes markdown save returned a different document')
    }
    return { ok: true, noteId: saved.id }
  } catch (err) {
    // RPC failures arrive as plain { code, message } objects: String(err) renders them as "[object Object]".
    return { ok: false, error: toErrorMessage(err) }
  }
}

