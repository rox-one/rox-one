// Actual provider, input, registries and file reading. Only readonly native bootstrap
// and thumbnail delivery are controlled; no session or domain writes are simulated.
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Provider, createStore } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import { TooltipProvider } from '../../../../../../../../../packages/ui/src/components/tooltip'
import { PlatformProvider } from '../../../../../../../../../packages/ui/src/context/PlatformContext'
import { ModalProvider, useModalRegistry } from '../../../../../context/ModalContext'
import { DismissibleLayerProvider, useDismissibleLayerRegistry } from '../../../../../context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '../../../../../context/EscapeInterruptContext'
import { AppShellProvider, type AppShellContextType } from '../../../../../context/AppShellContext'
import { NavigationContext } from '../../../../../contexts/NavigationContext'
import { FreeFormInput } from '../../../../../components/app-shell/input/FreeFormInput'
import { focusedPanelIdAtom, panelStackAtom } from '../../../../../atoms/panel-stack'
import { parseRouteToNavigationState } from '../../../../../../shared/route-parser'
import { ProductTourProvider, ProductTourHost, useProductLearning } from '../../ProductTourProvider'
import { createLearningProfileRepository, createLearningScopeKey, createProgressRepository } from '../../../persistence'

const store = createStore()
const unexpected = (): never => { throw new Error('Unexpected native write in file-dialog fixture') }
interface FileDialogFixture {
  controller: ReturnType<typeof useProductLearning>; workspaceId: string; sessionId: string; mounted: boolean;
  thumbnails: Array<{ resolve: () => void }>; holdReads: boolean; switchAfterRead: boolean; scopeSwitchDone: boolean;
  attachmentWrites: Array<{ workspaceId: string; sessionId: string; names: string[] }>;
  closeCallbacks: Array<() => void>; addPeerLayer(): void; removePeerLayer(): void;
  layers(): string[]; closeDialog(): void; render(): void; switchScope(workspaceId: string, sessionId: string): void; releaseRead(index?: number): void;
  read(workspaceId?: string): ReturnType<ReturnType<typeof createProgressRepository>['read']>;
}
const f: FileDialogFixture = (window as any).nativeFileDialog = {
  controller: null as unknown as ReturnType<typeof useProductLearning>,
  workspaceId: 'workspace-a', sessionId: 'session-a', mounted: true,
  thumbnails: [] as Array<{ resolve: () => void }>, holdReads: false, switchAfterRead: false, scopeSwitchDone: false,
  attachmentWrites: [] as Array<{ workspaceId: string; sessionId: string; names: string[] }>,
  closeCallbacks: [], addPeerLayer: () => {}, removePeerLayer: () => {},
  layers: () => [] as string[], closeDialog: () => {}, render: () => {},
  switchScope(workspaceId: string, sessionId: string) { f.workspaceId = workspaceId; f.sessionId = sessionId; f.render() },
  releaseRead(index = 0) { f.thumbnails[index]?.resolve() },
  async read(workspaceId = f.workspaceId) {
    const profile = await createLearningProfileRepository().read()
    if (profile.status === 'failed') throw new Error('Expected real local profile')
    return createProgressRepository().read(createLearningScopeKey(profile.value.clientProfileId, workspaceId), 'OBT-05')
  },
}
window.electronAPI = {
  getSessionMessages: async () => [], listMeetings: async () => [],
  // Present in the real preload; this attachment-only exercise must never submit/store.
  storeAttachment: unexpected,
  getAutoCapitalisation: async () => false, getSendMessageKey: async () => 'enter', getSpellCheck: async () => false,
  getFilePath: (file: File) => `/fixture/${file.name}`,
  generateThumbnail: async () => {
    if (f.holdReads) await new Promise<void>(resolve => { f.thumbnails.push({ resolve }) })
    if (f.switchAfterRead) {
      // Resolve the actual readonly response, then commit a scope change between
      // the production read continuation and React's scheduled attachment effects.
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {
        f.switchScope('workspace-b', 'session-b'); f.scopeSwitchDone = true
      })))
    }
    return null
  },
} as unknown as typeof window.electronAPI
localStorage.setItem('craft-feature-product-tour-v1', 'true')
store.set(focusedPanelIdAtom, 'panel-a')
const recordedRegistries = new WeakSet<object>()
let unregisterPeer = () => {}
const root = createRoot(document.getElementById('root')!)
function Harness() {
  f.controller = useProductLearning()
  const modal = useModalRegistry()
  const layers = useDismissibleLayerRegistry()
  if (!recordedRegistries.has(modal)) {
    recordedRegistries.add(modal)
    const actualRegister = modal.registerModal
    // Retain the real registry's native close callbacks to deliver a stale OS close.
    // The production registry still owns every registration and unregistration.
    modal.registerModal = (id, close, priority) => {
      if (id.startsWith('native-file-picker-')) f.closeCallbacks.push(close)
      return actualRegister(id, close, priority)
    }
  }
  f.addPeerLayer = () => { unregisterPeer = modal.registerModal('unrelated-native-layer', () => {}) }
  f.removePeerLayer = () => unregisterPeer()
  f.layers = () => [...modal.getSnapshot(), ...layers.getSnapshot()].map(layer => layer.id).filter(id => !id.startsWith('product-tour-'))
  f.closeDialog = () => { modal.closeTopModal() }
  const workspaceId = f.workspaceId
  const sessionId = f.sessionId
  return <main style={{ padding: 100, width: 700 }}>
    {f.mounted && <FreeFormInput workspaceId={workspaceId} sessionId={sessionId} currentModel="rox/r1-max" onModelChange={unexpected} onSubmit={unexpected}
      attachmentsValue={[]} onAttachmentsChange={files => f.attachmentWrites.push({ workspaceId, sessionId, names: files.map(file => file.name) })} />}
    <ProductTourHost />
  </main>
}
f.render = () => {
  const route = `allSessions/session/${f.sessionId}`
  store.set(panelStackAtom, [{ id: 'panel-a', route: route as any, proportion: 1, panelType: 'session', laneId: 'main' }])
  const shell: AppShellContextType = {
    workspaces: [{ id: f.workspaceId, name: 'Fixture', slug: 'fixture', rootPath: '/fixture', createdAt: 0 }], activeWorkspaceId: f.workspaceId,
    activeWorkspaceSlug: 'fixture', llmConnections: [], pendingPermissions: new Map(), pendingCredentials: new Map(), sessionOptions: new Map(),
    refreshLlmConnections: unexpected, getDraft: unexpected, getDraftAttachmentRefs: unexpected, hydrateDraftAttachments: unexpected,
    onCreateSession: unexpected, onSendMessage: unexpected, onRenameSession: unexpected, onFlagSession: unexpected, onUnflagSession: unexpected,
    onArchiveSession: unexpected, onUnarchiveSession: unexpected, onMarkSessionRead: unexpected, onMarkSessionUnread: unexpected,
    onSetActiveViewingSession: unexpected, onSessionStatusChange: unexpected, onDeleteSession: unexpected, onOpenFile: unexpected, onOpenUrl: unexpected,
    onSelectWorkspace: unexpected, onOpenSettings: unexpected, onOpenKeyboardShortcuts: unexpected, onOpenStoredUserPreferences: unexpected,
    onReset: unexpected, onSessionOptionsChange: unexpected, onInputChange: unexpected, onAttachmentsChange: unexpected,
  }
  const navigationState = parseRouteToNavigationState(route)
  if (!navigationState) throw new Error('Expected a real session route')
  const navigation = { navigate: unexpected, isReady: true, navigationRevision: 1, navigationState,
    canGoBack: false, canGoForward: false, goBack: unexpected, goForward: unexpected, updateRightSidebar: unexpected, toggleRightSidebar: unexpected,
    navigateToSource: unexpected, navigateToSession: unexpected }
  flushSync(() => root.render(<Provider store={store}><AppShellProvider value={shell}><NavigationContext.Provider value={navigation}><EscapeInterruptProvider>
    <PlatformProvider><TooltipProvider><ModalProvider><DismissibleLayerProvider><ProductTourProvider workspaceId={f.workspaceId} shellReady><Harness /></ProductTourProvider>
    </DismissibleLayerProvider></ModalProvider></TooltipProvider></PlatformProvider></EscapeInterruptProvider></NavigationContext.Provider></AppShellProvider></Provider>))
}
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
f.render()
