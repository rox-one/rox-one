// Real provider, repositories, registries and product controls; only OS/media and native API responses are controlled.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import { TooltipProvider } from '../../../../../../../../packages/ui/src/components/tooltip'
import { PlatformProvider } from '../../../../../../../../packages/ui/src/context/PlatformContext'
import { AppShellProvider, type AppShellContextType } from '../../../../context/AppShellContext'
import { EscapeInterruptProvider } from '../../../../context/EscapeInterruptContext'
import { ModalProvider, useModalRegistry } from '../../../../context/ModalContext'
import { DismissibleLayerProvider, useDismissibleLayerRegistry } from '../../../../context/DismissibleLayerContext'
import { NavigationContext } from '../../../../contexts/NavigationContext'
import { focusedPanelIdAtom, panelStackAtom } from '../../../../atoms/panel-stack'
import { VoiceDictationControl } from '../../../../components/app-shell/input/VoiceDictationControl'
import ConnectionsPage from '../../../../pages/ConnectionsPage'
import { routes } from '../../../../../shared/routes'
import { parseRouteToNavigationState } from '../../../../../shared/route-parser'
import { ProductTourProvider, ProductTourHost, useProductLearning } from '../../runtime/ProductTourProvider'
import { useTourTarget } from '../../runtime/hooks'
import type { ConnectionAuditRow } from '../../../../pages/connections-list'

const query = new URLSearchParams(location.search)
const kind = query.get('kind') === 'fabric' ? 'fabric' : 'voice'
const store = createStore()
const route = kind === 'voice' ? routes.view.allSessions('native-session') : routes.view.connections()
store.set(focusedPanelIdAtom, 'native-panel')
store.set(panelStackAtom, [{ id: 'native-panel', route, proportion: 1, panelType: 'other', laneId: 'main' }])
// Production opt-in is deliberately set for this isolated browser proof.
// eslint-disable-next-line craft-agent/no-localstorage
localStorage.setItem('craft-feature-product-tour-v1', 'true')
const calls = { microphone: 0, stoppedTracks: 0, start: 0, grant: 0, stop: 0, cancel: 0, list: 0, audit: 0, writes: 0 }
const media: Array<{ resolve: (value: MediaStream) => void; reject: (reason: unknown) => void }> = []
const audit: Array<{ workspaceId: string; resolve: (value: ConnectionAuditRow[]) => void; reject: (reason: unknown) => void }> = []
const hotkeys = new Set<(payload: { command: 'toggle' | 'cancel' }) => void>()
const stream = { getTracks: () => [{ stop() { calls.stoppedTracks++ } }] } as unknown as MediaStream
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => {
  calls.microphone++
  return new Promise<MediaStream>((resolve, reject) => media.push({ resolve, reject }))
} } })
class Recorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['fixture audio']) }); this.onstop?.() }
}
Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: Recorder })
window.electronAPI = {
  getSessionMessages: async () => [],
  getVoicePrefs: async () => ({ sttEngine: 'cloud-rox', cloudAsrConsent: true, privacyMigrationPending: false, selectedInputDeviceId: null, delivery: 'draft', trailingSpace: false }),
  onVoiceHotkey: (listener: (payload: { command: 'toggle' | 'cancel' }) => void) => { hotkeys.add(listener); return () => { hotkeys.delete(listener) } },
  startVoiceCapture: async () => { calls.start++; return { recordingId: `native-recording-${calls.start}`, job: 'queued' } },
  grantVoicePermission: async () => { calls.grant++ }, sendVoiceChunk: async () => {},
  stopVoiceCapture: async () => { calls.stop++; return { job: 'ready', transcript: { text: 'PRIVATE FIXTURE TRANSCRIPT', noSpeech: false } } },
  cancelVoiceCapture: async () => { calls.cancel++ },
  workgraph: {
    listConnections: async (workspaceId: string) => { calls.list++; if (query.has('list-failure')) throw new Error('list_unavailable'); return query.has('tall-services') ? Array.from({ length: 40 }, (_, index) => ({ id: `public-connection-${index}`, workspaceId, integrationId: 'github', credentialRefId: `public-reference-${index}`, storageMode: 'reference', scopes: [] })) : [] },
    listConnectionAudit: ({ workspaceId }: { workspaceId: string }) => { calls.audit++; return new Promise<ConnectionAuditRow[]>((resolve, reject) => audit.push({ workspaceId, resolve, reject })) },
  },
} as unknown as typeof window.electronAPI

const unexpected = (): never => { calls.writes++; throw new Error('Unexpected product action in native handoff fixture') }
const shell: AppShellContextType = {
  workspaces: ['workspace-a', 'workspace-b'].map(id => ({ id, name: 'Fixture workspace', slug: id, rootPath: '/fixture-workspace', createdAt: 0 })),
  activeWorkspaceId: 'workspace-a', activeWorkspaceSlug: 'workspace-a', llmConnections: [],
  pendingPermissions: new Map(), pendingCredentials: new Map(), sessionOptions: new Map(),
  refreshLlmConnections: unexpected, getDraft: unexpected, getDraftAttachmentRefs: unexpected, hydrateDraftAttachments: unexpected,
  onCreateSession: unexpected, onSendMessage: unexpected, onRenameSession: unexpected, onFlagSession: unexpected, onUnflagSession: unexpected,
  onArchiveSession: unexpected, onUnarchiveSession: unexpected, onMarkSessionRead: unexpected, onMarkSessionUnread: unexpected,
  onSetActiveViewingSession: unexpected, onSessionStatusChange: unexpected, onDeleteSession: unexpected, onOpenFile: unexpected, onOpenUrl: unexpected,
  onSelectWorkspace: unexpected, onOpenSettings: unexpected, onOpenKeyboardShortcuts: unexpected, onOpenStoredUserPreferences: unexpected,
  onReset: unexpected, onSessionOptionsChange: unexpected, onInputChange: unexpected, onAttachmentsChange: unexpected,
}
const fixture = {
  controller: null as ReturnType<typeof useProductLearning>,
  snapshot: () => ({}), cancelPrompt: () => {}, unmountVoice: () => {}, switchWorkspace: (_id: string) => {},
  acceptMicrophone: (index = 0) => media[index]!.resolve(stream),
  denyMicrophone: (index = 0) => media[index]!.reject(new DOMException('Permission denied', 'NotAllowedError')),
  settleAudit(index: number, outcome: 'ready' | 'denied' = 'ready') {
    if (outcome === 'denied') audit[index]!.reject(new Error('audit_unavailable'))
    else audit[index]!.resolve([{ connectionId: 'fixture-connection', eventType: `public-event-${index}`, occurredAt: 1, actorId: null, outcome: 'allowed', payloadDigest: 'public-digest' }])
  },
}
Object.assign(window, { nativeHandoff: fixture })

function Controls() {
  const controller = useProductLearning()
  const modals = useModalRegistry()
  const layers = useDismissibleLayerRegistry()
  const [draft, setDraft] = useState('Existing draft')
  const [mounted, setMounted] = useState(true)
  const input = useTourTarget('composer.input')
  fixture.controller = controller
  fixture.unmountVoice = () => setMounted(false)
  fixture.cancelPrompt = () => { modals.closeTopModal() }
  fixture.snapshot = () => ({ state: controller?.state, capabilities: controller?.capabilities, calls: { ...calls },
    nativeModals: modals.getSnapshot().filter(layer => !layer.id.startsWith('product-tour-')).length,
    nativeLayers: layers.getSnapshot().filter(layer => !layer.id.startsWith('product-tour-')).length,
    auditRequests: audit.map(request => ({ workspaceId: request.workspaceId })),
  })
  return <main style={{ padding: 60, height: '100vh', boxSizing: 'border-box' }}>
    {kind === 'voice' ? <><textarea aria-label="Draft" ref={input} value={draft} onChange={event => setDraft(event.target.value)} />{mounted && <VoiceDictationControl inputValue={draft} onInputChange={setDraft} />}</> : <ConnectionsPage />}
    <ProductTourHost />
  </main>
}
const navigation = {
  navigate: async () => {}, isReady: true, navigationState: parseRouteToNavigationState(route)!, navigationRevision: 1,
  canGoBack: false, canGoForward: false, goBack() {}, goForward() {}, updateRightSidebar() {}, toggleRightSidebar() {}, navigateToSource() {}, navigateToSession() {},
}
function App() {
  const [workspaceId, setWorkspaceId] = useState('workspace-a')
  fixture.switchWorkspace = setWorkspaceId
  return <Provider store={store}><AppShellProvider value={{ ...shell, activeWorkspaceId: workspaceId, activeWorkspaceSlug: workspaceId }}><NavigationContext.Provider value={navigation}>
    <EscapeInterruptProvider><PlatformProvider><TooltipProvider><ModalProvider><DismissibleLayerProvider>
      <ProductTourProvider workspaceId={workspaceId} shellReady><Controls /></ProductTourProvider>
    </DismissibleLayerProvider></ModalProvider></TooltipProvider></PlatformProvider></EscapeInterruptProvider>
  </NavigationContext.Provider></AppShellProvider></Provider>
}
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
createRoot(document.getElementById('root')!).render(<App />)
