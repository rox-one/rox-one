import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { VoiceHistorySettings } from '../../../VoiceHistorySettings'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import ru from '../../../../../../../../../packages/shared/src/i18n/locales/ru.json'
import '../../../../../index.css'

// Private synthetic histories only: no native recording, credentials, or OS clipboard are accessed.
const query = new URLSearchParams(location.search)
const calls: Array<{ method: string; args?: unknown }> = []
let resolveDetail: ((value: unknown) => void) | undefined, resolveAudio: ((value: unknown) => void) | undefined
const wav = new Uint8Array(2044), view = new DataView(wav.buffer)
const chars = (at: number, text: string) => Array.from(text).forEach((char, index) => wav[at + index] = char.charCodeAt(0))
chars(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); chars(8, 'WAVE'); chars(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); chars(36, 'data'); view.setUint32(40, wav.length - 44, true)
const audioBase64 = btoa(String.fromCharCode(...wav))
const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', wav)), byte => byte.toString(16).padStart(2, '0')).join('')
const records = ['recording-one', 'recording-two'].map((id, index) => ({ id, favorite: false, state: 'finalized', audioPath: '', selectedRevisionId: `revision-${index}`, createdAt: index + 1 }))
const revisions = records.map((record, index) => ({ id: `revision-${index}`, recordingId: record.id, kind: 'asr', text: index ? 'Second transcript' : 'Original first transcript', segments: [{ startMs: 0, endMs: 1000, text: 'Original first transcript' }], createdAt: index + 1 }))
const detail = (id: string) => ({ recording: records.find(item => item.id === id), revisions: revisions.filter(item => item.recordingId === id), runs: [] })
const audio = () => ({ audioBase64, offset: 0, totalBytes: wav.length, hash, token: 'f'.repeat(64), mimeType: 'audio/wav' })
const record = (method: string, args?: unknown) => calls.push({ method, args })
const api = {
  getRuntimeEnvironment: () => query.get('runtime') === 'web' ? 'web' : 'electron',
  onVoiceJob: () => () => record('unsubscribe'),
  async listVoiceHistory(args: { search?: string; cursor?: string }) {
    record('listVoiceHistory', args)
    if (query.get('failedList') === 'true') throw new Error('Synthetic list failure')
    const search = args.search?.toLowerCase()
    return { page: records.filter(item => !search || revisions.some(revision => revision.recordingId === item.id && revision.text.toLowerCase().includes(search))), continueCursor: null, isDone: true }
  },
  async getVoiceHistoryItem({ id }: { id: string }) {
    record('getVoiceHistoryItem', { id })
    if (query.get('deferredDetail') === 'true' && id === 'recording-one') return new Promise(resolve => { resolveDetail = resolve })
    return detail(id)
  },
  async favoriteVoiceRecording(args: { id: string; favorite: boolean }) { record('favoriteVoiceRecording', args); records.find(item => item.id === args.id)!.favorite = args.favorite; return { ok: true } },
  async editVoiceTranscript(args: { id: string; expectedRevisionId: string; text: string }) {
    record('editVoiceTranscript', args)
    if (query.get('staleEdit') === 'true') throw new Error('Synthetic stale revision')
    const current = records.find(item => item.id === args.id)!
    if (current.selectedRevisionId !== args.expectedRevisionId) throw new Error('Synthetic stale revision')
    const id = 'manual-revision'; revisions.push({ id, recordingId: args.id, kind: 'manual', text: args.text, segments: [], createdAt: 3 }); current.selectedRevisionId = id
    return { ok: true, revisionId: id }
  },
  async selectVoiceTranscript(args: { id: string; expectedRevisionId: string; revisionId: string }) { record('selectVoiceTranscript', args); records.find(item => item.id === args.id)!.selectedRevisionId = args.revisionId; return { ok: true } },
  async copyVoiceText(args: { text: string }) { record('copyVoiceText', args); return { ok: true } },
  async readVoiceRecordingAudio(args: unknown) { record('readVoiceRecordingAudio', args); if (query.get('deferredAudio') === 'true') return new Promise(resolve => { resolveAudio = resolve }); return audio() },
  async exportVoiceRecording(args: { id: string; format: string }) {
    record('exportVoiceRecording', args)
    const d = detail(args.id), revision = revisions.find(item => item.id === d.recording!.selectedRevisionId)!
    return { text: args.format === 'json' ? JSON.stringify({ recording: d.recording, revision }) : args.format === 'srt' ? '1\n00:00:00,000 --> 00:00:01,000\n' + revision.text : revision.text }
  },
  async deleteVoiceRecording(args: { id: string }) { record('deleteVoiceRecording', args); records.splice(records.findIndex(item => item.id === args.id), 1); return { ok: true } },
}
window.electronAPI = api as unknown as typeof window.electronAPI
const createUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = blob => { record('createObjectURL', { size: blob instanceof Blob ? blob.size : null }); return createUrl(blob) }
URL.revokeObjectURL = url => { record('revokeObjectURL'); revokeUrl(url) }
await i18n.use(initReactI18next).init({ lng: query.get('lang') ?? 'en', resources: { en: { translation: en }, ru: { translation: ru } }, interpolation: { escapeValue: false } })
const root = createRoot(document.getElementById('root')!)
;(window as any).__historyFixture = { calls, unmount: () => root.unmount(), resolveDetail: () => resolveDetail?.(detail('recording-one')), resolveAudio: () => resolveAudio?.(audio()) }
root.render(<VoiceHistorySettings />)
