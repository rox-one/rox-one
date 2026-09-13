export type RecordingState = 'recording' | 'finalized' | 'cancelled' | 'failed' | 'recovered'
export interface VoiceRecording {
  id: string; createdAt: number; deviceId?: string; sessionRef?: string; durationMs: number
  audioPath: string; hash: string; format: string; state: RecordingState; favorite: boolean
  selectedRevisionId?: string; selectedRunId?: string
}
export type TranscriptKind = 'asr' | 'manual'
export interface TranscriptRevision {
  id: string; recordingId: string; kind: TranscriptKind; parentId?: string; modelId: string
  modelRevision?: string; routeVersion?: string; detectedLanguage?: string; text: string
  segments: { startMs: number; endMs: number; text: string }[]
  words?: { startMs: number; endMs: number; text: string }[]
  createdAt: number
}
export interface ProcessingRun {
  id: string; transcriptRevisionId: string; profileSnapshot: string; promptVersion: string; inputHash: string
  requestedModel: string; actualModel?: string; outputText: string; outputLanguage: string; answerLanguage: string
  enrichmentRef?: string; status: 'ready' | 'degraded' | 'failed' | 'cancelled'; error?: string
  usage?: { tokensIn?: number; tokensOut?: number; searchCalls?: number }
}
export interface DeliveryReceipt {
  recordingId: string; targetType: 'draft' | 'clipboard' | 'external'; targetId?: string
  draftRevision?: number; runId?: string; status: 'pending' | 'delivered' | 'skipped' | 'stale'
}
export interface HistoryIndex {
  recordings: VoiceRecording[]; revisions: TranscriptRevision[]; runs: ProcessingRun[]; receipts: DeliveryReceipt[]
}
export function emptyHistoryIndex(): HistoryIndex {
  return { recordings: [], revisions: [], runs: [], receipts: [] }
}
export function historyPage(index: HistoryIndex, query: { cursor?: string; limit?: number; search?: string; favorite?: boolean; status?: RecordingState; modelId?: string }): { page: VoiceRecording[]; continueCursor: string | null; isDone: boolean } {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
  let items = [...index.recordings].sort((a, b) => b.createdAt - a.createdAt)
  if (query.favorite) items = items.filter((item) => item.favorite)
  if (query.status) items = items.filter((item) => item.state === query.status)
  if (query.search) {
    const needle = query.search.toLowerCase()
    items = items.filter((item) => index.revisions.filter((rev) => rev.recordingId === item.id).some((rev) => rev.text.toLowerCase().includes(needle)) || item.id.includes(needle))
  }
  if (query.modelId) {
    const ids = new Set(index.revisions.filter((rev) => rev.modelId === query.modelId).map((rev) => rev.recordingId))
    items = items.filter((item) => ids.has(item.id))
  }
  const start = query.cursor ? items.findIndex((item) => item.id === query.cursor) + 1 : 0
  const page = items.slice(Math.max(start, 0), Math.max(start, 0) + limit)
  const last = page[page.length - 1]
  const continueCursor = last && page.length === limit ? last.id : null
  return { page, continueCursor, isDone: !continueCursor || start + limit >= items.length }
}
export function srtFromSegments(segments: { startMs: number; endMs: number; text: string }[]): string {
  return segments.map((seg, index) => `${index + 1}\n${formatSrtTime(seg.startMs)} --> ${formatSrtTime(seg.endMs)}\n${seg.text.trim()}\n`).join('\n')
}
function formatSrtTime(ms: number): string {
  const clamped = Math.max(0, ms)
  const hours = Math.floor(clamped / 3_600_000)
  const minutes = Math.floor((clamped % 3_600_000) / 60_000)
  const seconds = Math.floor((clamped % 60_000) / 1000)
  const millis = clamped % 1000
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`
}
function pad(value: number, size: number): string { return String(value).padStart(size, '0') }
