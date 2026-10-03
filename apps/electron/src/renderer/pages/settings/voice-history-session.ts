import type { ElectronAPI } from '../../../shared/types'
import type { TranscriptRevision, VoiceRecording } from '@rox/shared/voice/history'

export type VoiceHistoryDetail = { recording: VoiceRecording; revisions: TranscriptRevision[] }
export function voiceHistoryDetail(value: unknown, id: string): VoiceHistoryDetail {
  const detail = value as { recording?: VoiceRecording; revisions?: TranscriptRevision[] } | undefined
  if (!detail?.recording || detail.recording.id !== id || !Array.isArray(detail.revisions)
    || (detail.recording.selectedRevisionId !== undefined && !detail.revisions.some(item => item.id === detail.recording!.selectedRevisionId && item.recordingId === id))
    || detail.revisions.some(item => item.recordingId !== id || typeof item.id !== 'string' || typeof item.text !== 'string' || !Array.isArray(item.segments))) {
    throw new Error('Voice history is unavailable')
  }
  return { recording: { ...detail.recording, audioPath: '' }, revisions: detail.revisions }
}

/** Every frame is actor-scoped and bounded; verify the complete original before playback. */
export async function readVoiceAudio(api: Pick<ElectronAPI, 'readVoiceRecordingAudio'>, id: string, isCurrent: () => boolean): Promise<Blob | null> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  let offset = 0, total = 0, token: string | undefined, hash = '', mimeType = ''
  do {
    if (!isCurrent()) return null
    const chunk = await api.readVoiceRecordingAudio({ id, offset, token })
    if (!isCurrent()) return null
    if (!chunk || chunk.offset !== offset || !Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes <= 0 || chunk.totalBytes > 200 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(chunk.hash) || !/^[a-f0-9]{64}$/.test(chunk.token)
      || !['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4'].includes(chunk.mimeType)
      || typeof chunk.audioBase64 !== 'string' || chunk.audioBase64.length > 262144) throw new Error('Invalid voice audio frame')
    if (offset === 0) { total = chunk.totalBytes; token = chunk.token; hash = chunk.hash; mimeType = chunk.mimeType }
    if (chunk.totalBytes !== total || chunk.token !== token || chunk.hash !== hash || chunk.mimeType !== mimeType) throw new Error('Voice audio changed')
    const text = atob(chunk.audioBase64)
    if (!text.length || text.length > 192 * 1024 || offset + text.length > total || (offset + text.length < total && text.length !== 192 * 1024)) throw new Error('Invalid voice audio size')
    const bytes = Uint8Array.from(text, char => char.charCodeAt(0))
    parts.push(bytes); offset += bytes.length
  } while (offset < total)
  const bytes = new Uint8Array(total)
  let position = 0
  for (const part of parts) { bytes.set(part, position); position += part.length }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  if (!isCurrent()) return null
  if (digest !== hash) throw new Error('Voice audio integrity check failed')
  return new Blob([bytes], { type: mimeType })
}
