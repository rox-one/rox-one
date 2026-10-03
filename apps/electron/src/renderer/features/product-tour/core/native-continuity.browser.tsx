// Production renderer adapters and policies; native IPC/media responses are controlled fixtures.
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { TooltipProvider } from '../../../../../../../packages/ui/src/components/tooltip'
import { PlatformProvider } from '../../../../../../../packages/ui/src/context/PlatformContext'
import en from '../../../../../../../packages/shared/src/i18n/locales/en.json'
import SourceInfoPage from '../../../pages/SourceInfoPage'
import { VoiceDictationControl } from '../../../components/app-shell/input/VoiceDictationControl'
import { AppShellProvider, type AppShellContextType } from '../../../context/AppShellContext'
import { EscapeInterruptProvider } from '../../../context/EscapeInterruptContext'
import { ModalProvider } from '../../../context/ModalContext'
import { DismissibleLayerProvider } from '../../../context/DismissibleLayerContext'
import { NavigationContext } from '../../../contexts/NavigationContext'
import { TourPanelScope, TourRuntimeContext, useTourTarget, type TourRuntimePort } from '../runtime/hooks'
import { productTourCatalogue } from '../catalogue'
import { initialRuntimeState, transition } from './index'
import type { RuntimeState, TourBinding, TourInput, TourSignal, TourTargetRegistration } from '../contracts'
import type { LoadedSource } from '../../../../shared/types'

const binding: TourBinding = { workspaceId: 'native-workspace', panelId: 'native-panel', sessionId: 'native-session', clientProfileId: 'native-profile', runToken: 'native-run' }
const source: LoadedSource = { config: { id: 'source', slug: 'source', name: 'Native source details', type: 'local', provider: 'local', enabled: true, connectionStatus: 'connected', local: { path: '/fixture-source' } }, guide: null, workspaceId: binding.workspaceId, workspaceRootPath: '/fixture-workspace', folderPath: '/fixture-source' }
let state: RuntimeState = initialRuntimeState
const signals: TourSignal[] = []
const targets = new Map<string, TourTargetRegistration>()
const calls = { startVoiceCapture: 0, stopVoiceCapture: 0, copyVoiceText: 0, getSources: 0 }
let transcript = 'Private fixture transcript'
let delivery: 'draft' | 'clipboard' = 'draft'
let trailingSpace = false
let clipboardText = ''
const stream = { getTracks: () => [{ stop() {} }] }
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } })
class FixtureRecorder {
  mimeType = 'audio/webm'
  state = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_stream: unknown) {}
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio fixture']) }); this.onstop?.() }
}
Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FixtureRecorder })
const api = {
  getVoicePrefs: async () => ({ sttEngine: 'cloud-rox', cloudAsrConsent: true, privacyMigrationPending: false, selectedInputDeviceId: null, delivery, trailingSpace }),
  startVoiceCapture: async () => { calls.startVoiceCapture++; return { recordingId: 'fixture-recording', job: 'queued' } },
  grantVoicePermission: async () => {},
  sendVoiceChunk: async () => {},
  stopVoiceCapture: async () => { calls.stopVoiceCapture++; return { job: 'ready', transcript: { text: transcript, noSpeech: !transcript } } },
  copyVoiceText: async ({ text }: { text: string }) => { calls.copyVoiceText++; clipboardText = text; return { ok: true } },
  getSources: async () => { calls.getSources++; return [source] },
  getSourcePermissionsConfig: async () => null,
  getWorkspaceSettings: async () => ({ localMcpEnabled: true }),
  onSourcesChanged: () => () => {},
}
window.electronAPI = api as unknown as typeof window.electronAPI

function send(input: TourInput) { state = transition(state, input).state }
function show() {
  const attempt = state.attempt!
  const target = state.definition!.steps.find(step => step.id === attempt.stepId)!.target
  if (!targets.get(target)?.element.isConnected) throw new Error(`Native target is not mounted: ${target}`)
  send({ type: 'VIEW_READY', runToken: binding.runToken, stepId: attempt.stepId, navigationRevision: 1 })
  send({ type: 'TARGET_READY', runToken: binding.runToken, stepId: attempt.stepId })
}
function Harness({ kind }: { kind: 'voice' | 'source' }) {
  const [draft, setDraft] = useState('Existing draft')
  const [openSource, setOpenSource] = useState(false)
  const voiceDraftTarget = useTourTarget('composer.input')
  const sourceListTarget = useTourTarget('sources.list')
  return kind === 'voice' ? <><textarea aria-label="Draft" ref={voiceDraftTarget} value={draft} onChange={event => setDraft(event.target.value)} /><VoiceDictationControl inputValue={draft} onInputChange={setDraft} /></>
    : <><button ref={sourceListTarget} onClick={() => setOpenSource(true)}>Open source details</button>{openSource && <SourceInfoPage sourceSlug="source" workspaceId={binding.workspaceId} />}</>
}
function Providers({ kind }: { kind: 'voice' | 'source' }) {
  const port = useMemo<TourRuntimePort>(() => ({
    enabled: true,
    capture: () => ({ binding, operationToken: crypto.randomUUID(), at: Date.now() }),
    emit: signal => { signals.push(signal); send({ type: 'SIGNAL', signal }) },
    register: target => { targets.set(target.id, target); return () => { if (targets.get(target.id) === target) targets.delete(target.id) } },
    setCapability: () => () => {},
  }), [])
  // The closed EditPopover reads this real context. Fail if an unexpected shell
  // action is called rather than silently simulating a session mutation.
  const unexpectedShellAction = (): never => { throw new Error('Unexpected shell action in the native continuity fixture') }
  const shell: AppShellContextType = {
    workspaces: [{ id: binding.workspaceId, name: 'Fixture workspace', slug: 'fixture', rootPath: '/fixture-workspace', createdAt: 0 }],
    activeWorkspaceId: binding.workspaceId, activeWorkspaceSlug: 'fixture', llmConnections: [],
    pendingPermissions: new Map(), pendingCredentials: new Map(), sessionOptions: new Map(),
    refreshLlmConnections: unexpectedShellAction, getDraft: unexpectedShellAction,
    getDraftAttachmentRefs: unexpectedShellAction, hydrateDraftAttachments: unexpectedShellAction,
    onCreateSession: unexpectedShellAction, onSendMessage: unexpectedShellAction,
    onRenameSession: unexpectedShellAction, onFlagSession: unexpectedShellAction,
    onUnflagSession: unexpectedShellAction, onArchiveSession: unexpectedShellAction,
    onUnarchiveSession: unexpectedShellAction, onMarkSessionRead: unexpectedShellAction,
    onMarkSessionUnread: unexpectedShellAction, onSetActiveViewingSession: unexpectedShellAction,
    onSessionStatusChange: unexpectedShellAction, onDeleteSession: unexpectedShellAction,
    onOpenFile: unexpectedShellAction, onOpenUrl: unexpectedShellAction,
    onSelectWorkspace: unexpectedShellAction, onOpenSettings: unexpectedShellAction,
    onOpenKeyboardShortcuts: unexpectedShellAction, onOpenStoredUserPreferences: unexpectedShellAction,
    onReset: unexpectedShellAction, onSessionOptionsChange: unexpectedShellAction,
    onInputChange: unexpectedShellAction, onAttachmentsChange: unexpectedShellAction,
  }
  const navigation = { navigate: () => {}, isReady: true, navigationState: { navigator: 'sources' as const, details: kind === 'source' ? { type: 'source' as const, sourceSlug: source.config.slug } : null }, navigationRevision: 1, canGoBack: false, canGoForward: false, goBack: () => {}, goForward: () => {}, updateRightSidebar: () => {}, toggleRightSidebar: () => {}, navigateToSource: () => {}, navigateToSession: () => {} }
  return <AppShellProvider value={shell}><NavigationContext.Provider value={navigation}><EscapeInterruptProvider><PlatformProvider><TooltipProvider><ModalProvider><DismissibleLayerProvider><TourRuntimeContext.Provider value={port}><TourPanelScope {...binding}><Harness kind={kind} /></TourPanelScope></TourRuntimeContext.Provider></DismissibleLayerProvider></ModalProvider></TooltipProvider></PlatformProvider></EscapeInterruptProvider></NavigationContext.Provider></AppShellProvider>
}
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
const root = createRoot(document.getElementById('root')!)
Object.assign(window, { nativeContinuity: {
  start(kind: 'voice' | 'source', emptyTranscript = false, deliveryPreference: 'draft' | 'clipboard' = 'draft', trailingSpacePreference = false) {
    signals.length = 0; targets.clear(); calls.startVoiceCapture = 0; calls.stopVoiceCapture = 0; calls.copyVoiceText = 0; calls.getSources = 0
    transcript = emptyTranscript ? '' : 'Private fixture transcript'
    delivery = deliveryPreference; trailingSpace = trailingSpacePreference; clipboardText = ''
    const tour = productTourCatalogue.find(tour => tour.id === (kind === 'voice' ? 'OBT-06' : 'OBT-07'))!
    state = transition(initialRuntimeState, { type: 'SNAPSHOT', snapshot: { enabled: true, shellReady: true, navigationReady: true, navigationRevision: 1, foreground: true, blockers: [], capabilities: Object.fromEntries(tour.requires.map(id => [id, { state: 'ready' }])) } }).state
    send({ type: 'START', tour, binding, progress: null, startMode: 'new', at: Date.now() })
    root.render(<Providers key={kind + String(emptyTranscript) + delivery + String(trailingSpace)} kind={kind} />)
  },
  show,
  acknowledge() { send({ type: 'ACK', runToken: binding.runToken, stepId: state.attempt!.stepId, at: Date.now() }) },
  snapshot: () => ({ phase: state.phase, stepId: state.attempt?.stepId, evidence: state.attemptEvidence, progress: state.progress, signals, calls }),
  clipboard: () => clipboardText,
} })
