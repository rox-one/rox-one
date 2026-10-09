/**
 * Behavioral coverage for the dictation hosts and the transcript writer.
 *
 * The native `voice:hotkey` event is broadcast to every mounted listener, so
 * the renderer must arbitrate exactly one reaction per press:
 *   - an active (on-screen) composer control owns the capture;
 *   - without one, the global host records and drafts a new session.
 *
 * These cases mount the real components (composer control + global host) in a
 * happy-dom window and stub only the OS boundary (electronAPI, getUserMedia,
 * MediaRecorder). They also pin the release handshake of the composer
 * (`VoiceDictationControl`): after a push-to-talk release the final transcript
 * is inserted first and the dictation ownership is released last, and a
 * cloud-consent start waits for the host to leave its modal (aria-hidden) state
 * instead of dropping the first capture.
 *
 * One dictation must produce exactly one transcript note: the composer and the
 * global host both file through `lib/transcripts/notes.ts` — the single writer.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Root } from 'react-dom/client'
import en from '../../../../../../packages/shared/src/i18n/locales/en.json'
import { installDom, uninstallDom } from '../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'

// The happy-dom window must exist before React DOM, Radix and the production
// components are evaluated: static imports run first, so those modules are
// loaded dynamically after the DOM install.
const dom = installDom()
afterAll(() => uninstallDom())

const { createRoot } = await import('react-dom/client')
const { act, useState } = await import('react')
const { default: i18n } = await import('i18next')
const { initReactI18next } = await import('react-i18next')
const { getDefaultStore } = await import('jotai')
const { VoiceDictationControl } = await import('../../components/app-shell/input/VoiceDictationControl')
const { GlobalVoiceDictation } = await import('../global-dictation')
const { currentOwner, releaseDictation } = await import('../dictation-ownership')
const { activeComposerPresent } = await import('../composer-presence')
const { windowWorkspaceIdAtom } = await import('@/atoms/sessions')
const { transcriptsFolder } = await import('@/lib/transcripts/notes')
const { TooltipProvider } = await import('../../../../../../packages/ui/src/components/tooltip')

await i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en } },
  keySeparator: false,
  interpolation: { escapeValue: false },
})

const WORKSPACE_ID = 'ws-voice-1'
const TRANSCRIPT_TEXT = 'Synthetic first paragraph.\n\nSynthetic second paragraph.'

type Call = { method: string; args?: unknown }

let calls: Call[] = []
const record = (method: string, args?: unknown): void => { calls.push({ method, args }) }
const countOf = (method: string): number => calls.filter(call => call.method === method).length

const hotkeyListeners = new Set<(payload: { command: string; recordingId?: string }) => void>()

let prefs: Record<string, unknown> = {}
let deferredStop = false
let resolveStop: ((value: unknown) => void) | undefined
let recordingSequence = 0
let noteSequence = 0

const readyJob = () => ({
  job: 'ready',
  transcript: {
    text: TRANSCRIPT_TEXT,
    requestedModelId: 'nova-3',
    resolvedModelId: 'nova-3',
    detectedLanguage: 'en',
    durationMs: 1200,
    noSpeech: false,
  },
})

/** Markdown-note result (no native identity), so notes.ts takes its save path. */
const createdNote = (title: string) => ({
  id: `note-${++noteSequence}`,
  title,
  path: `${title}.md`,
  relativePath: `${title}.md`,
  tags: [],
  properties: {},
  links: [],
  assetRefs: [],
  updatedAt: 0,
  createdAt: 0,
  size: 0,
  content: '',
  backlinks: [],
  revision: 1,
  sourceStoreId: 'store-1',
})

const electronAPI = {
  getVoicePrefs: async () => prefs,
  saveVoicePrefs: async (patch: Record<string, unknown>) => { record('saveVoicePrefs', patch); prefs = { ...prefs, ...patch }; return prefs },
  onVoiceChanged: () => () => {},
  onVoiceJob: () => () => {},
  onVoiceHotkey: (listener: (payload: { command: string; recordingId?: string }) => void) => { hotkeyListeners.add(listener); return () => { hotkeyListeners.delete(listener) } },
  startVoiceCapture: async (args: unknown) => { record('startVoiceCapture', args); recordingSequence += 1; return { job: 'queued', recordingId: `synthetic-recording-${recordingSequence}` } },
  grantVoicePermission: async () => { record('grantVoicePermission') },
  sendVoiceChunk: async (args: unknown) => { record('sendVoiceChunk', args) },
  stopVoiceCapture: async () => {
    record('stopVoiceCapture')
    if (deferredStop) {
      const { promise, resolve } = Promise.withResolvers<unknown>()
      resolveStop = resolve
      return promise
    }
    return readyJob()
  },
  cancelVoiceCapture: async () => { record('cancelVoiceCapture') },
  copyVoiceText: async (args: unknown) => { record('copyVoiceText', args); return { ok: true } },
  publishVoiceLevel: (level: number) => { record('publishVoiceLevel', level) },
  createNote: async (workspaceId: string, title: string, folder?: string, options?: unknown) => {
    record('createNote', { workspaceId, title, folder, options })
    return createdNote(title)
  },
  saveNote: async (workspaceId: string, id: string, _content: string, _revision?: number, _sourceStoreId?: string) => {
    record('saveNote', { workspaceId, id })
    return { id }
  },
  readNote: async () => { throw new Error('readNote is not used for markdown transcripts') },
  listNotes: async () => [],
}

class SyntheticRecorder {
  mimeType = 'audio/webm'
  state = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_stream: unknown) {}
  start(): void { record('recorderStart'); this.state = 'recording' }
  stop(): void {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }) })
    this.onstop?.()
  }
}

const stream = { getTracks: () => [{ stop: () => record('stopTrack') }] }

/** Interface the test drives: the composer draft and its visibility controls. */
const ui = {
  draft: 'Existing draft',
  setComposerVisible: (_visible: boolean) => {},
  setHostHidden: (_hidden: boolean) => {},
}

function Harness() {
  const [draft, setDraft] = useState('Existing draft')
  const [composerVisible, setComposerVisible] = useState(true)
  const [hostHidden, setHostHidden] = useState(false)
  ui.draft = draft
  ui.setComposerVisible = setComposerVisible
  ui.setHostHidden = setHostHidden
  return (
    <TooltipProvider>
      <GlobalVoiceDictation />
      {composerVisible && (
        <div aria-hidden={hostHidden ? 'true' : undefined} data-testid="composer-wrap">
          <VoiceDictationControl inputValue={draft} onInputChange={setDraft} sessionId="session-1" />
        </div>
      )}
    </TooltipProvider>
  )
}

let container: HTMLDivElement
let root: Root
let navigateEvents: Array<{ route: unknown; newPanel?: boolean; targetLaneId?: string }> = []
let originalBlob: PropertyDescriptor | undefined
let originalMediaRecorder: PropertyDescriptor | undefined
let originalMediaDevices: PropertyDescriptor | undefined
let originalNodeFilter: PropertyDescriptor | undefined

const flush = async (): Promise<void> => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
const wait = async (ms: number): Promise<void> => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }

const fireHotkey = async (command: 'toggle' | 'ptt-down' | 'ptt-up' | 'cancel'): Promise<void> => {
  await act(async () => {
    for (const listener of [...hotkeyListeners]) listener({ command })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const composerHost = (): HTMLElement | null => container.querySelector<HTMLElement>('[data-voice-dictation-host]')
const composerButton = (): HTMLButtonElement => {
  const button = composerHost()?.querySelector('button')
  if (!button) throw new Error('Composer dictation button is not mounted')
  return button
}

const basePrefs = {
  sttEngine: 'cloud-rox',
  cloudAsrConsent: true,
  privacyMigrationPending: false,
  delivery: 'draft',
  trailingSpace: false,
  selectedInputDeviceId: null,
}

/** Renders the harness with the given voice preferences already in effect. */
const renderHarness = async (overrides: Record<string, unknown> = {}): Promise<void> => {
  prefs = { ...basePrefs, ...overrides }
  root = createRoot(container)
  await act(async () => { root.render(<Harness />) })
  await flush()
}

beforeAll(() => {
  originalBlob = Object.getOwnPropertyDescriptor(globalThis, 'Blob')
  originalMediaRecorder = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder')
  originalNodeFilter = Object.getOwnPropertyDescriptor(globalThis, 'NodeFilter')
  // Radix's focus scope walks the DOM with NodeFilter; the shared DOM helper
  // predates the dialog and does not install it.
  Object.defineProperty(globalThis, 'NodeFilter', { configurable: true, writable: true, value: dom.NodeFilter })
  // Bun keeps its own `navigator` global (the DOM helper only replaces missing
  // globals), so the capture stub must land on the navigator the app reads.
  originalMediaDevices = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices')
  // happy-dom's FileReader only accepts its own Blob, so keep the DOM Blob in
  // charge for the whole file; the recorder stubs follow the same boundary.
  Object.defineProperty(globalThis, 'Blob', { configurable: true, writable: true, value: dom.Blob })
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: SyntheticRecorder })
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => { record('getUserMedia'); return stream } },
  })
})

beforeEach(async () => {
  calls = []
  navigateEvents = []
  deferredStop = false
  resolveStop = undefined
  recordingSequence = 0
  noteSequence = 0
  hotkeyListeners.clear()
  prefs = { ...basePrefs }
  getDefaultStore().set(windowWorkspaceIdAtom, WORKSPACE_ID)
  Object.defineProperty(dom, 'electronAPI', { configurable: true, writable: true, value: electronAPI })
  window.addEventListener('rox-navigate', captureNavigate)
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  window.removeEventListener('rox-navigate', captureNavigate)
  const owner = currentOwner()
  if (owner) releaseDictation(owner)
})

afterAll(() => {
  if (originalBlob) Object.defineProperty(globalThis, 'Blob', originalBlob)
  if (originalMediaRecorder) Object.defineProperty(globalThis, 'MediaRecorder', originalMediaRecorder)
  if (originalMediaDevices) Object.defineProperty(globalThis.navigator, 'mediaDevices', originalMediaDevices)
  if (originalNodeFilter) Object.defineProperty(globalThis, 'NodeFilter', originalNodeFilter)
})

function captureNavigate(event: Event): void {
  const detail = (event as CustomEvent<{ route: unknown; newPanel?: boolean; targetLaneId?: string }>).detail
  if (detail) navigateEvents.push({ route: detail.route, newPanel: detail.newPanel, targetLaneId: detail.targetLaneId })
}

describe('single dictation arbiter', () => {
  it('both hosts mounted: one hotkey toggle starts exactly one capture and the composer owns it', async () => {
    await renderHarness()
    expect(composerHost()).not.toBeNull()
    expect(activeComposerPresent()).toBe(true)

    await fireHotkey('toggle')
    await flush()

    expect(countOf('getUserMedia')).toBe(1)
    expect(countOf('startVoiceCapture')).toBe(1)
    expect(countOf('recorderStart')).toBe(1)
    expect(navigateEvents).toEqual([])

    await fireHotkey('toggle')
    await flush()

    expect(countOf('stopVoiceCapture')).toBe(1)
    expect(ui.draft).toBe(`Existing draft ${TRANSCRIPT_TEXT}`)
    expect(navigateEvents).toEqual([])
    // The global host never got a second chance to draft its own session.
    expect(countOf('startVoiceCapture')).toBe(1)
  })

  it('without a mounted composer the global host reacts exactly once and drafts a new session', async () => {
    await renderHarness()
    await act(async () => { ui.setComposerVisible(false) })
    await flush()
    expect(composerHost()).toBeNull()
    expect(activeComposerPresent()).toBe(false)

    await fireHotkey('toggle')
    await flush()

    expect(countOf('getUserMedia')).toBe(1)
    expect(countOf('startVoiceCapture')).toBe(1)
    expect(countOf('recorderStart')).toBe(1)

    await fireHotkey('toggle')
    await flush()

    expect(countOf('stopVoiceCapture')).toBe(1)
    expect(navigateEvents).toHaveLength(1)
    expect(navigateEvents[0].newPanel).toBe(true)
    expect(navigateEvents[0].targetLaneId).toBe('main')
    expect(String(navigateEvents[0].route)).toContain('action/new-session')
    expect(String(navigateEvents[0].route)).toContain('input=Synthetic+first+paragraph')
    expect(ui.draft).toBe('Existing draft')
  })

  it('a composer that cannot receive the transcript (hidden host) leaves the hotkey to the global host', async () => {
    await renderHarness()
    await act(async () => { ui.setHostHidden(true) })
    await flush()
    expect(composerHost()).not.toBeNull()
    expect(activeComposerPresent()).toBe(false)

    await fireHotkey('toggle')
    await flush()
    expect(countOf('getUserMedia')).toBe(1)
    expect(countOf('startVoiceCapture')).toBe(1)

    await fireHotkey('toggle')
    await flush()
    expect(navigateEvents).toHaveLength(1)
    expect(String(navigateEvents[0].route)).toContain('action/new-session')
    expect(ui.draft).toBe('Existing draft')
  })

  it('active composer presence follows the host visibility, not its mount state', async () => {
    await renderHarness()
    const host = composerHost()
    expect(host).not.toBeNull()
    expect(activeComposerPresent()).toBe(true)

    await act(async () => { host?.setAttribute('hidden', '') })
    expect(activeComposerPresent()).toBe(false)

    await act(async () => { host?.removeAttribute('hidden') })
    expect(activeComposerPresent()).toBe(true)

    await act(async () => { host?.remove() })
    expect(activeComposerPresent()).toBe(false)
  })
})

describe('single transcript writer', () => {
  it('one dictation files exactly one note, without duplicates', async () => {
    await renderHarness()
    await fireHotkey('toggle')
    await flush()
    await fireHotkey('toggle')
    await flush()

    expect(countOf('createNote')).toBe(1)
    expect(countOf('saveNote')).toBe(1)
    const created = calls.find(call => call.method === 'createNote')?.args as { workspaceId: string; folder: string; title: string }
    expect(created.workspaceId).toBe(WORKSPACE_ID)
    expect(created.folder).toBe(transcriptsFolder())
    expect(created.title).toMatch(/^Transcript \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/)

    // A second, global dictation files exactly one more note.
    await act(async () => { ui.setComposerVisible(false) })
    await flush()
    await fireHotkey('toggle')
    await flush()
    await fireHotkey('toggle')
    await flush()

    expect(countOf('createNote')).toBe(2)
    expect(countOf('saveNote')).toBe(2)
  })
})

describe('composer release handshake', () => {
  it('push-to-talk release inserts the final transcript before releasing dictation ownership', async () => {
    await renderHarness()
    deferredStop = true

    await fireHotkey('ptt-down')
    await flush()
    expect(countOf('getUserMedia')).toBe(1)
    expect(countOf('recorderStart')).toBe(1)
    expect(currentOwner()).not.toBeNull()

    await fireHotkey('ptt-up')
    await flush()
    // The capture is transcribing: the composer keeps ownership and the draft
    // is untouched until the final transcript arrives.
    expect(countOf('stopVoiceCapture')).toBe(1)
    expect(ui.draft).toBe('Existing draft')
    expect(currentOwner()).not.toBeNull()

    resolveStop?.(readyJob())
    await flush()
    expect(ui.draft).toBe(`Existing draft ${TRANSCRIPT_TEXT}`)
    expect(currentOwner()).toBeNull()
    expect(countOf('createNote')).toBe(1)
  })

  it('cloud consent start waits for the composer host to leave its modal state', async () => {
    await renderHarness({ cloudAsrConsent: false, privacyMigrationPending: true })

    await act(async () => { composerButton().click() })
    await flush()
    // Consent dialog is open; nothing has touched the microphone yet.
    expect(countOf('getUserMedia')).toBe(0)

    // Radix marks the app tree aria-hidden while its modal is live and keeps it
    // hidden until the exit animation ends. The wrapper models that window.
    await act(async () => { ui.setHostHidden(true) })
    const allowButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Allow Deepgram'))
    expect(allowButton).toBeDefined()
    await act(async () => { allowButton?.click() })
    await flush()
    expect(countOf('saveVoicePrefs')).toBe(1)
    // The composer host is still hidden: the start must wait for its release
    // instead of failing its own visibility guard.
    expect(countOf('getUserMedia')).toBe(0)

    await act(async () => { ui.setHostHidden(false) })
    await wait(80)
    expect(countOf('getUserMedia')).toBe(1)
    expect(countOf('startVoiceCapture')).toBe(1)
  })
})