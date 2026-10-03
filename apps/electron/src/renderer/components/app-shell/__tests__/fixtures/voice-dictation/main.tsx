import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Toaster } from 'sonner'
import { TooltipProvider } from '../../../../../../../../../packages/ui/src/components/tooltip'
import { VoiceDictationControl } from '../../../input/VoiceDictationControl'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../../index.css'

// No native microphone, network transcription or shared key is used here.
const query = new URLSearchParams(location.search)
const calls: Array<{ method: string; args?: unknown }> = []
let prefs = { sttEngine: 'cloud-rox', cloudAsrConsent: query.get('consent') !== 'false', privacyMigrationPending: query.get('migration') === 'true', selectedInputDeviceId: null }
let resolveStop: ((value: unknown) => void) | undefined
let resolveConsent: ((value: unknown) => void) | undefined
let resolveGrant: (() => void) | undefined
let resolveStart: (() => void) | undefined
let resolveMedia: ((value: unknown) => void) | undefined
let rejectedMedia = false
let hotkeyListener: ((payload: { command: 'toggle' | 'ptt-down' | 'ptt-up' | 'cancel' }) => void) | undefined
const audioBytes = query.get('largeAudio') === 'true' ? 5 * 1024 * 1024 + 123 : 3
const audioPayload = new Uint8Array(audioBytes)
for (let index = 0; index < audioPayload.length; index++) audioPayload[index] = index % 251
const stream = { getTracks: () => [{ stop: () => record('stopTrack') }] }
const transcript = { text: 'Synthetic first paragraph.\n\nSynthetic second paragraph.', requestedModelId: 'nova-3', resolvedModelId: 'nova-3', noSpeech: false }
const record = (method: string, args?: unknown) => calls.push({ method, args })
const api = {
  async getVoicePrefs() { return prefs },
  async saveVoicePrefs(patch: object) {
    record('saveVoicePrefs', patch)
    prefs = { ...prefs, ...patch }
    if (query.get('deferredConsent') === 'true') return new Promise((resolve) => { resolveConsent = resolve })
    return prefs
  },
  onVoiceChanged: () => () => {}, onVoiceJob: () => () => {},
  onVoiceHotkey: (listener: NonNullable<typeof hotkeyListener>) => {
    hotkeyListener = listener
    return () => { if (hotkeyListener === listener) hotkeyListener = undefined }
  },
  async startVoiceCapture(args: unknown) {
    record('startVoiceCapture', args)
    if (query.get('deferredStart') === 'true') await new Promise<void>((resolve) => { resolveStart = resolve })
    return { job: 'queued' }
  },
  async grantVoicePermission() {
    record('grantVoicePermission')
    if (query.get('deferredGrant') === 'true') await new Promise<void>((resolve) => { resolveGrant = resolve })
  },
  async sendVoiceChunk(args: unknown) { record('sendVoiceChunk', args) },
  async stopVoiceCapture() {
    record('stopVoiceCapture')
    record('asrOnStop')
    if (query.get('deferredStop') === 'true') return new Promise((resolve) => { resolveStop = resolve })
    return { job: 'ready', transcript }
  },
  async transcribeVoice() { record('transcribeVoice'); throw new Error('Duplicate ASR is forbidden') },
  async cancelVoiceCapture() {
    record('cancelVoiceCapture')
    if (query.get('rejectCancel') === 'true') throw { code: 'AUTH_FAILED', message: 'Synthetic revoked native grant' }
  },
}
window.electronAPI = api as unknown as typeof window.electronAPI
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  async getUserMedia() {
    record('getUserMedia')
    if (query.get('rejectMediaOnce') === 'true' && !rejectedMedia) {
      rejectedMedia = true
      throw new DOMException('Synthetic microphone denial', 'NotAllowedError')
    }
    if (query.get('deferredMedia') === 'true') return new Promise((resolve) => { resolveMedia = resolve })
    return stream
  },
} })
class SyntheticRecorder {
  mimeType = 'audio/webm'; state = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_stream: unknown) {}
  start() { record('recorderStart'); this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([audioPayload], { type: this.mimeType }) })
    this.onstop?.()
  }
}
Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: SyntheticRecorder })
const fixture = {
  calls,
  audioBytes,
  unmount: () => {},
  remount: () => {},
  cancel: () => hotkeyListener?.({ command: 'cancel' }),
  resolveStop: () => resolveStop?.({ job: 'ready', transcript }),
  resolveConsent: () => resolveConsent?.(prefs),
  resolveGrant: () => resolveGrant?.(),
  resolveStart: () => resolveStart?.(),
  resolveMedia: () => resolveMedia?.(stream),
}
;(window as any).__voiceFixture = fixture
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
function App() {
  const [value, setValue] = useState('Existing draft')
  const [visible, setVisible] = useState(true)
  fixture.unmount = () => setVisible(false)
  fixture.remount = () => setVisible(true)
  return <TooltipProvider><main className="p-8"><textarea aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
    {visible && <VoiceDictationControl inputValue={value} onInputChange={setValue} />}<Toaster /></main></TooltipProvider>
}
createRoot(document.getElementById('root')!).render(<App />)
