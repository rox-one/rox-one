import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  emptyHistoryIndex,
  historyPage,
  srtFromSegments,
  type HistoryIndex,
  type ProcessingRun,
  type TranscriptRevision,
  type VoiceRecording,
} from './history.ts'

export function historyIndexPath(configDir: string): string {
  return join(configDir, 'voice', 'history.json')
}

export function loadHistoryIndex(configDir: string): HistoryIndex {
  const path = historyIndexPath(configDir)
  if (!existsSync(path)) return emptyHistoryIndex()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as HistoryIndex
    return {
      recordings: Array.isArray(raw.recordings) ? raw.recordings : [],
      revisions: Array.isArray(raw.revisions) ? raw.revisions : [],
      runs: Array.isArray(raw.runs) ? raw.runs : [],
      receipts: Array.isArray(raw.receipts) ? raw.receipts : [],
    }
  } catch {
    return emptyHistoryIndex()
  }
}

export function saveHistoryIndex(configDir: string, index: HistoryIndex): HistoryIndex {
  mkdirSync(join(configDir, 'voice'), { recursive: true })
  writeFileSync(historyIndexPath(configDir), `${JSON.stringify(index, null, 2)}\n`)
  return index
}

export function upsertRecording(index: HistoryIndex, recording: VoiceRecording): HistoryIndex {
  const recordings = index.recordings.filter((item) => item.id !== recording.id)
  recordings.push(recording)
  return { ...index, recordings }
}

export function addRevision(index: HistoryIndex, revision: TranscriptRevision): HistoryIndex {
  return { ...index, revisions: [...index.revisions, revision] }
}

export function addRun(index: HistoryIndex, run: ProcessingRun): HistoryIndex {
  return { ...index, runs: [...index.runs, run] }
}

export function setFavorite(index: HistoryIndex, recordingId: string, favorite: boolean): HistoryIndex {
  return {
    ...index,
    recordings: index.recordings.map((item) => item.id === recordingId ? { ...item, favorite } : item),
  }
}

export function deleteRecording(index: HistoryIndex, recordingId: string): HistoryIndex {
  return {
    recordings: index.recordings.filter((item) => item.id !== recordingId),
    revisions: index.revisions.filter((item) => item.recordingId !== recordingId),
    runs: index.runs.filter((run) => !index.revisions.some((rev) => rev.recordingId === recordingId && rev.id === run.transcriptRevisionId)),
    receipts: index.receipts.filter((item) => item.recordingId !== recordingId),
  }
}

export function exportRecording(index: HistoryIndex, recordingId: string, format: 'txt' | 'srt' | 'json'): string {
  const recording = index.recordings.find((item) => item.id === recordingId)
  if (!recording) throw new Error('Recording not found')
  const revision = index.revisions.find((item) => item.id === recording.selectedRevisionId)
    ?? index.revisions.filter((item) => item.recordingId === recordingId).at(-1)
  if (format === 'json') return JSON.stringify({ recording, revision }, null, 2)
  if (format === 'srt') return srtFromSegments(revision?.segments ?? [])
  return revision?.text ?? ''
}

export { historyPage }
