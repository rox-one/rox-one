/** Isolated React test entrypoint with the real ChatDisplay, split, dock and ingress. */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore } from 'jotai'
import { initReactI18next } from 'react-i18next'
import { setupI18n } from '../../../packages/shared/src/i18n/setupI18n'
import { ChatDisplay, type ChatDisplayHandle } from '../../../apps/electron/src/renderer/components/app-shell/ChatDisplay'
import { ChatRuntimeSplit, RuntimeMapDock } from '../../../apps/electron/src/renderer/components/runtime-map'
import { ingressRuntimeTraceEvent, type RuntimeTraceAPI } from '../../../apps/electron/src/renderer/event-processor/runtime-trace-ingress'
import { ThemeProvider } from '../../../apps/electron/src/renderer/context/ThemeContext'
import { FocusProvider } from '../../../apps/electron/src/renderer/context/FocusContext'
import { EscapeInterruptProvider } from '../../../apps/electron/src/renderer/context/EscapeInterruptContext'
import { ModalProvider } from '../../../apps/electron/src/renderer/context/ModalContext'
import { TooltipProvider } from '../../../packages/ui/src/components/tooltip'
import { AppShellProvider, type AppShellContextType } from '../../../apps/electron/src/renderer/context/AppShellContext'
import { NavigationContext } from '../../../apps/electron/src/renderer/contexts/NavigationContext'
import { DEFAULT_NAVIGATION_STATE, type Session, type Message, type FileAttachment, type LoadedSource } from '../../../apps/electron/src/shared/types'
import type { RuntimeEvent } from '../../../packages/core/src/runtime-trace/types'
import { createBrowserPerformanceHarness } from './browser-performance'
import { createChatHistoryFixture } from '../../fixtures/runtime-map/chat-history'
import { editorMessages, seedEditorFixture } from '../../fixtures/runtime-map/editor'
import '../../../apps/electron/src/renderer/index.css'
import './harness.css'

setupI18n([initReactI18next])
const SessionWorkflowEditor = React.lazy(() => import('../../../apps/electron/src/renderer/components/session-workbench/SessionWorkflowEditor').then(module => ({ default: module.SessionWorkflowEditor })))
const CatalogHarness = React.lazy(() => import('./CatalogHarness'))
const scope = { workspaceId: 'fixture-workspace', sessionId: 'fixture-session' }
const flags = new URL(location.href).searchParams
const catalogMode = flags.get('catalog') === 'skills' ? 'skills' : flags.get('catalog') === 'integrations' ? 'integrations' : undefined
const history = flags.has('editor') ? editorMessages : flags.has('history') ? createChatHistoryFixture() : []
const editorStorageKeys = flags.has('editor') ? seedEditorFixture(scope.sessionId) : undefined
const store = createStore()
const listeners = new Set<() => void>()
let received: RuntimeEvent[] = []
const diagnostics = { chatMounts: 0, activeChatMounts: 0, chatSends: 0, permissionResponses: 0, credentialResponses: 0, sourceConnections: 1, receivedEvents: 0, selectedMessage: '', openedBranch: '' }
const call = async <T,>(path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`http://127.0.0.1:4177${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) throw new Error((await response.json()).error)
  return await response.json() as T
}
const api: RuntimeTraceAPI = {
  getRuntimeTraceSnapshot: query => call('/snapshot', query),
  readRuntimeTraceEvents: query => call('/read-events', query),
  readRuntimeTracePayload: query => call('/read-payload', query),
}
const preload = {
  ...api, getSendMessageKey: async () => 'enter', readPreferences: async () => ({ content: '{}' }),
  identityGetState: async () => ({ annotationActorId: 'fixture-user', profile: { displayName: 'Test user' } }),
  getColorTheme: async () => 'pierre', getWorkspaceColorTheme: async () => null,
  getSystemTheme: async () => false, getPlatform: async () => 'linux',
  getAvailableModels: async () => [], getLlmConnections: async () => [],
  getSources: () => call('/catalog/sources'), getSkills: () => call('/catalog/skills'),
  listBundledSkillPacks: () => call('/catalog/packs'), getSkillUsage: () => call('/catalog/usage'),
  setBundledSkillsDisabled: (disabled: string[]) => call('/catalog/set-bundled-disabled', disabled),
  listLlmConnectionsWithStatus: () => call('/catalog/models'),
  onSkillsChanged: () => () => {}, onBundledSkillsChanged: () => () => {}, onSkillsPendingChanged: () => () => {},
  onSourcesChanged: () => () => {}, onLlmConnectionsChanged: () => () => {},
  getLogoUrl: async () => null, readWorkspaceImage: async () => null,
  listMemoryProposals: async () => [], onMemoryProposalCreated: () => () => {}, onMemoryProposalUpdated: () => () => {},
  onMemoryChanged: () => () => {},
  getSessionProvenance: async () => null,
  onSystemThemeChange: () => () => {}, onThemePreferencesChange: () => () => {}, onWorkspaceThemeChange: () => () => {},
  broadcastThemePreferences: async () => {},
}
window.electronAPI = preload as unknown as typeof window.electronAPI
const source = new EventSource('http://127.0.0.1:4177/events')
source.onmessage = message => {
  const event = JSON.parse(message.data) as RuntimeEvent
  ingressRuntimeTraceEvent(store, event, scope.workspaceId, api)
  if (!received.some(item => item.eventId === event.eventId)) received = [...received, event]
  diagnostics.receivedEvents = received.length
  for (const listener of listeners) listener()
}
window.addEventListener('beforeunload', () => source.close(), { once: true })

function eventMessage(event: RuntimeEvent): Message | undefined {
  if (event.kind === 'run.accepted') return { id: event.messageId ?? event.eventId, role: 'user', content: event.payload.prompt.text ?? '', timestamp: event.receivedAt }
  if (event.kind === 'run.started' || event.kind === 'run.completed') return undefined
  const content = event.kind === 'context.captured' ? 'Контекст принят. Исходный и фактический запрос сохранены.'
    : event.kind === 'plan.published' ? event.payload.plan.tasks.map(task => task.title).join(' → ')
    : event.kind === 'agent.assigned' ? `${event.payload.assignment.name}: ${event.payload.assignment.task.text}`
    : event.kind === 'tool.completed' ? event.payload.result?.text ?? event.payload.error ?? ''
    : event.kind === 'terminal.completed' ? `stdout: ${event.payload.stdout?.text}; stderr: ${event.payload.stderr?.text}`
    : event.kind === 'result.published' ? event.payload.content.text ?? ''
    : event.kind === 'acceptance.completed' ? `${event.payload.acceptance.criterion}: ${event.payload.acceptance.status}`
    : event.kind === 'approval.requested' ? event.payload.description : event.kind
  return { id: event.messageId ?? event.eventId, role: 'assistant', content, timestamp: event.receivedAt, isIntermediate: event.kind !== 'result.published', turnId: 'fixture-turn' }
}

function ActualChat({ events, draft, setDraft, attachments, setAttachments, chatRef }: {
  events: RuntimeEvent[]; draft: string; setDraft: (value: string) => void; attachments: FileAttachment[]; setAttachments: (value: FileAttachment[]) => void; chatRef: React.RefObject<ChatDisplayHandle | null>
}) {
  useEffect(() => { diagnostics.chatMounts++; diagnostics.activeChatMounts++; return () => { diagnostics.activeChatMounts-- } }, [])
  const session: Session = { ...scope, id: scope.sessionId, workspaceName: 'Isolated runtime test', lastMessageAt: events.at(-1)?.receivedAt ?? 0,
    messages: [...history, ...events.map(eventMessage).filter((message): message is Message => !!message)],
    isProcessing: events.length > 0 && !events.some(event => event.kind === 'run.completed'), permissionMode: 'ask' }
  const pending = [...events].reverse().find(event => event.kind === 'approval.requested' || event.kind === 'approval.resolved')
  return <ChatDisplay ref={chatRef} session={session} workspaceId={scope.workspaceId} currentModel="fixture/model" onModelChange={() => {}}
    onSendMessage={() => { diagnostics.chatSends++ }} onOpenFile={() => {}} onOpenUrl={() => {}}
    inputValue={draft} onInputChange={setDraft} attachmentsValue={attachments} onAttachmentsChange={setAttachments}
    sources={[]} skills={[]} permissionMode="ask" connectionUnavailable={false}
    pendingPermission={pending?.kind === 'approval.requested' ? { requestId: pending.payload.id, toolName: 'fixture_shell', command: 'printf fixture', description: pending.payload.description } : undefined}
    onRespondToPermission={() => { diagnostics.permissionResponses++ }}
    pendingCredential={flags.has('credential') ? { type: 'credential', requestId: 'fixture-credential', sessionId: scope.sessionId, sourceSlug: 'fixture-source', sourceName: 'Fixture credential', mode: 'bearer', description: 'Изолированная проверка pending credential; ничего не отправляется' } : undefined}
    onRespondToCredential={() => { diagnostics.credentialResponses++ }} />
}

function Harness() {
  const events = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => received)
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(flags.has('credential') ? 'Существующий черновик' : ''), [attachments, setAttachments] = useState<FileAttachment[]>([])
  const chatRef = useRef<ChatDisplayHandle>(null)
  const [error, setError] = useState('')
  const [catalogSnapshot, setCatalogSnapshot] = useState<{ workspaceId: string; workspaceRootPath: string; sources: LoadedSource[] }>()
  useEffect(() => {
    if (!catalogMode) return
    void call<{ workspaceId: string; workspaceRootPath: string; sources: LoadedSource[] }>('/catalog/snapshot').then(setCatalogSnapshot).catch(failure => setError(String(failure)))
  }, [])
  const guarded = async (path: string) => { try { await call(path, {}); setError('') } catch (failure) { setError(String(failure)) } }
  const shell: AppShellContextType = {
    workspaces: [], activeWorkspaceId: scope.workspaceId, activeWorkspaceSlug: 'fixture', llmConnections: [], refreshLlmConnections: async () => {},
    pendingPermissions: new Map(), pendingCredentials: new Map(), sessionOptions: new Map(),
    getDraft: () => draft, getDraftAttachmentRefs: () => [], hydrateDraftAttachments: async () => attachments,
    onCreateSession: async () => { throw new Error('Creating sessions is disabled in this isolated fixture') }, onSendMessage: () => { diagnostics.chatSends++ },
    onRenameSession: () => {}, onFlagSession: () => {}, onUnflagSession: () => {}, onArchiveSession: () => {}, onUnarchiveSession: () => {},
    onMarkSessionRead: () => {}, onMarkSessionUnread: () => {}, onSetActiveViewingSession: () => {}, onSessionStatusChange: () => {}, onDeleteSession: async () => false,
    onOpenFile: () => {}, onOpenUrl: () => {}, onSelectWorkspace: () => {}, onOpenSettings: () => {}, onOpenKeyboardShortcuts: () => {}, onOpenStoredUserPreferences: () => {}, onReset: () => {},
    onSessionOptionsChange: () => {}, onInputChange: (_, value) => setDraft(value), onAttachmentsChange: (_, value) => setAttachments(value), isFocusedPanel: true,
  }
  const navigation = { navigate: () => {}, isReady: true, navigationState: DEFAULT_NAVIGATION_STATE, navigationRevision: 0,
    canGoBack: false, canGoForward: false, goBack: () => {}, goForward: () => {}, updateRightSidebar: () => {}, toggleRightSidebar: () => {}, navigateToSource: () => {}, navigateToSession: () => {} }
  const chat = <ActualChat events={events} draft={draft} setDraft={setDraft} attachments={attachments} setAttachments={setAttachments} chatRef={chatRef} />
  const openMessage = (messageId: string) => { diagnostics.selectedMessage = messageId; chatRef.current?.scrollToMessage(messageId) }
  const editor = flags.has('editor') ? <React.Suspense fallback={<span role="status">Загрузка существующего редактора</span>}><SessionWorkflowEditor sessionId={scope.sessionId} messages={editorMessages} onOpenMessage={openMessage}
    relatedBranches={[{ id: 'old-branch', name: 'Retained branch', fromMessageId: 'editor-user' }]} onOpenSession={sessionId => { diagnostics.openedBranch = sessionId }} /></React.Suspense> : undefined
  if (catalogMode) return error ? <div role="alert">{error}</div> : catalogSnapshot
    ? <React.Suspense fallback={<span role="status">Загрузка каталога</span>}><CatalogHarness {...catalogSnapshot} mode={catalogMode} withSourceList={flags.get('sourceList') === '1'} /></React.Suspense>
    : <span role="status">Чтение временного каталога</span>
  return <AppShellProvider value={shell}><NavigationContext.Provider value={navigation}><FocusProvider><EscapeInterruptProvider><ModalProvider><TooltipProvider>
    <div className="runtime-test-shell">
      <div className="runtime-test-banner" role="status">Изолированный тест · детерминированный исполнитель · без запросов к моделям</div>
      <nav className="runtime-test-controls">
        <button data-testid="start-run" onClick={() => guarded('/start')}>Отправить тестовый запрос</button>
        <button data-testid="step-run" onClick={() => guarded('/step')}>Следующее событие</button>
        <button data-testid="toggle-map" onClick={() => setOpen(value => !value)}>Карта</button>
        <button data-testid="attach-fixture" onClick={() => setAttachments([{ type: 'text', path: '/isolated/fixture.txt', name: 'fixture.txt', mimeType: 'text/plain', size: 7, text: 'fixture' }])}>Добавить тестовое вложение</button>
        <span data-testid="received-count">{events.length}</span>
        {error && <span role="alert">{error}</span>}
      </nav>
      <ChatRuntimeSplit chat={chat} open={open} scopeKey="fixture-workspace:fixture-session:test-panel"
        map={<RuntimeMapDock {...scope} panelId="test-panel" editor={editor} requestedRootRunId={flags.get('traceRoot') ?? undefined} selectedEventId={flags.get('event') ?? undefined} eventRequestId={1} onClose={() => setOpen(false)} onOpenMessage={openMessage} />} />
      <output data-testid="draft-value" className="runtime-test-diagnostics">{draft}</output>
      <output data-testid="attachments-count" className="runtime-test-diagnostics">{attachments.length}</output>
    </div>
  </TooltipProvider></ModalProvider></EscapeInterruptProvider></FocusProvider></NavigationContext.Provider></AppShellProvider>
}
Object.assign(window, { runtimeDiagnostics: diagnostics, runtimeTestAPI: api, runtimeStore: store, runtimeEditorStorageKeys: editorStorageKeys, runtimePerformance: createBrowserPerformanceHarness(store, scope) })
createRoot(document.getElementById('root')!).render(<Provider store={store}><ThemeProvider defaultMode={new URL(location.href).searchParams.get('theme') === 'dark' ? 'dark' : 'light'}><Harness /></ThemeProvider></Provider>)
