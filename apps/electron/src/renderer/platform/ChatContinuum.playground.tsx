import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import { Circle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChatDisplay } from '@/components/app-shell/ChatDisplay'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { NavigationContext } from '@/contexts/NavigationContext'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { PLAYGROUND_VIEWPORT_PRESETS, type PlaygroundViewportPresetId } from '@/playground/registry/types'
import { ensureMockElectronAPI, mockSources } from '@/playground/mock-utils'
import { DEFAULT_NAVIGATION_STATE, type FileAttachment, type Session } from '../../shared/types'
import type { PermissionRequest, CredentialRequest } from '../../shared/types'
import { featureDialogArtifactsV1Atom, featureDialogContinuumV1Atom } from '@/atoms/unified-shell'
import { KEYS, getKeyString } from '@/lib/local-storage'
import type { LabelConfig } from '@rox/shared/labels'
import type { SessionStatus } from '@/config/session-status-config'

const WORKSPACE_ID = 'screen-chat-continuum-workspace'
const SESSION_ID = 'screen-chat-continuum-session'
const FIXED_NOW = new Date('2026-09-01T10:30:00.000Z').getTime()

/** A real 1×1 PNG, base64 — the only inline image the fixture carries. */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const noop = () => {}
const asyncNoop = async () => {}
const log = (name: string) => (...args: unknown[]) => {
  console.log(`[ChatContinuum Playground] ${name}`, args)
}

const labels: LabelConfig[] = [
  { id: 'bug', name: 'Bug', color: { light: 'var(--status-danger)', dark: 'var(--status-danger)' } },
  { id: 'ux', name: 'UX', color: { light: 'var(--info)', dark: 'var(--info)' } },
]

const sessionStatuses: SessionStatus[] = [
  {
    id: 'todo',
    label: 'Todo',
    resolvedColor: 'var(--muted-foreground)',
    icon: <Circle className="icon-caption" />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    resolvedColor: 'var(--info)',
    icon: <Circle className="icon-caption" />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'done',
    label: 'Done',
    resolvedColor: 'var(--success)',
    icon: <Circle className="icon-caption" />,
    iconColorable: true,
    category: 'closed',
  },
]

/**
 * Deterministic fixture whose turn stream exercises every continuum surface:
 * an inline run artifact, an inline diff artifact, an inline screenshot and a
 * reasoning row — plus a pending permission so the inline approval card lands
 * in the flow. No live IPC, no randomised data.
 */
const session: Session = {
  id: SESSION_ID,
  workspaceId: WORKSPACE_ID,
  workspaceName: 'ROX Playground',
  name: 'Renderer preview loop',
  lastMessageAt: FIXED_NOW,
  messages: [
    {
      id: 'continuum-user-1',
      role: 'user',
      content: 'Run the renderer tests and show me the failing diff.',
      timestamp: FIXED_NOW - 9 * 60_000,
    },
    {
      id: 'continuum-thinking-1',
      role: 'thinking',
      content:
        'Сначала прогоню тесты, затем сравню правку с ожидаемым поведением и покажу только изменённые строки.',
      timestamp: FIXED_NOW - 8 * 60_000,
      turnId: 'continuum-turn-1',
      isStreaming: false,
    },
    {
      id: 'continuum-tool-bash-1',
      role: 'tool',
      content: 'bun test apps/electron --filter renderer\n\n✗ 2 failing, 148 passing (1.8s)',
      toolName: 'Bash',
      toolUseId: 'continuum-tool-bash-1',
      toolInput: { command: 'bun test apps/electron --filter renderer' },
      toolResult: '✗ 2 failing, 148 passing (1.8s)',
      toolStatus: 'completed',
      timestamp: FIXED_NOW - 7 * 60_000,
      turnId: 'continuum-turn-1',
    },
    {
      id: 'continuum-assistant-1',
      role: 'assistant',
      content:
        'Two renderer tests fail on the headless timing assertion. The failure is local to the marker clock, not the layout.',
      timestamp: FIXED_NOW - 6 * 60_000,
      turnId: 'continuum-turn-1',
    },
    {
      id: 'continuum-user-2',
      role: 'user',
      content: 'Apply the small fix and capture the screenshot state.',
      timestamp: FIXED_NOW - 5 * 60_000,
    },
    {
      id: 'continuum-tool-edit-1',
      role: 'tool',
      content: 'Updated marker-clock.ts',
      toolName: 'Edit',
      toolUseId: 'continuum-tool-edit-1',
      toolInput: {
        file_path: 'apps/electron/src/renderer/lib/marker-clock.ts',
        old_string: 'const label = format(date, "HH:MM")\nreturn label',
        new_string: 'const label = format(date, "HH:mm")\nreturn label',
      },
      toolResult: 'Updated marker-clock.ts',
      toolStatus: 'completed',
      timestamp: FIXED_NOW - 4 * 60_000,
      turnId: 'continuum-turn-2',
    },
    {
      id: 'continuum-tool-shot-1',
      role: 'tool',
      content: PIXEL_PNG,
      toolName: 'mcp__browser__screenshot',
      toolUseId: 'continuum-tool-shot-1',
      toolInput: { url: 'app://renderer/preview' },
      toolResult: PIXEL_PNG,
      toolStatus: 'completed',
      timestamp: FIXED_NOW - 3 * 60_000,
      turnId: 'continuum-turn-2',
    },
    {
      id: 'continuum-assistant-2',
      role: 'assistant',
      content: 'Fix applied. The screenshot shows the fixed clock. Approve the next command to continue.',
      timestamp: FIXED_NOW - 2 * 60_000,
      turnId: 'continuum-turn-2',
    },
    {
      id: 'continuum-status-1',
      role: 'status',
      content: 'Renderer preview is using static fixtures',
      timestamp: FIXED_NOW - 90_000,
    },
  ],
  isProcessing: false,
  permissionMode: 'ask',
  sessionStatus: 'in-progress',
  labels: ['ux'],
  enabledSourceSlugs: ['github-api'],
  workingDirectory: '/Users/marklindgreen/Git/_worktrees/rox-ui-dev-loop',
  sessionFolderPath: '/mock/sessions/screen-chat-continuum',
  model: 'rox/standard',
  llmConnection: 'rox-kimi',
  thinkingLevel: 'medium',
  supportsBranching: false,
  memoryMode: 'temporary',
}

const pendingPermission: PermissionRequest = {
  sessionId: SESSION_ID,
  requestId: 'continuum-permission-1',
  toolName: 'Bash',
  command: 'bun test apps/electron --filter renderer --update',
  description: 'Записать обновлённые снимки и повторно прогнать тесты рендерера.',
}

const pendingCredential: CredentialRequest = {
  sessionId: SESSION_ID,
  requestId: 'continuum-credential-1',
  sourceSlug: 'github-api',
  sourceName: 'GitHub',
  type: 'credential',
  mode: 'bearer',
  description: 'Токен нужен, чтобы прочитать статус проверок.',
  hint: 'github_pat_…',
}

const playgroundContext: AppShellContextType = {
  workspaces: [{
    id: WORKSPACE_ID,
    name: 'ROX Playground',
    slug: 'rox-playground',
    rootPath: '/mock/workspaces/rox-playground',
    createdAt: FIXED_NOW - 24 * 60 * 60_000,
  }],
  activeWorkspaceId: WORKSPACE_ID,
  activeWorkspaceSlug: 'rox-playground',
  llmConnections: [],
  refreshLlmConnections: asyncNoop,
  pendingPermissions: new Map(),
  pendingCredentials: new Map(),
  getDraft: () => '',
  getDraftAttachmentRefs: () => [],
  hydrateDraftAttachments: async () => [],
  sessionOptions: new Map(),
  onCreateSession: async () => session,
  onSendMessage: log('onSendMessage'),
  onRenameSession: log('onRenameSession'),
  onFlagSession: log('onFlagSession'),
  onUnflagSession: log('onUnflagSession'),
  onArchiveSession: log('onArchiveSession'),
  onUnarchiveSession: log('onUnarchiveSession'),
  onMarkSessionRead: log('onMarkSessionRead'),
  onMarkSessionUnread: log('onMarkSessionUnread'),
  onSetActiveViewingSession: log('onSetActiveViewingSession'),
  onSessionStatusChange: log('onSessionStatusChange'),
  onDeleteSession: async () => false,
  onOpenFile: log('onOpenFile'),
  onOpenUrl: log('onOpenUrl'),
  onSelectWorkspace: log('onSelectWorkspace'),
  onOpenSettings: log('onOpenSettings'),
  onOpenKeyboardShortcuts: log('onOpenKeyboardShortcuts'),
  onOpenStoredUserPreferences: log('onOpenStoredUserPreferences'),
  onReset: log('onReset'),
  onSessionOptionsChange: log('onSessionOptionsChange'),
  onInputChange: log('onInputChange'),
  onAttachmentsChange: log('onAttachmentsChange'),
  isFocusedPanel: true,
}

const playgroundNavigationContext: React.ComponentProps<typeof NavigationContext.Provider>['value'] = {
  navigate: log('navigate'),
  isReady: true,
  navigationState: DEFAULT_NAVIGATION_STATE,
  navigationRevision: 0,
  canGoBack: false,
  canGoForward: false,
  goBack: noop,
  goForward: noop,
  updateRightSidebar: noop,
  toggleRightSidebar: noop,
  navigateToSource: noop,
  navigateToSession: noop,
}

/**
 * Hydrates the isolated store with both G5 dialog flags ON, restoring storage
 * on unmount (the pilot flags ship OFF — never persist a QA fixture ON).
 */
function HydrateDialogFlags({ children }: { children: React.ReactNode }) {
  const setContinuum = useSetAtom(featureDialogContinuumV1Atom)
  const setArtifacts = useSetAtom(featureDialogArtifactsV1Atom)
  React.useEffect(() => {
    const keys = [getKeyString(KEYS.featureDialogContinuumV1), getKeyString(KEYS.featureDialogArtifactsV1)]
    const previous = keys.map((key) => localStorage.getItem(key))
    setContinuum(true)
    setArtifacts(true)
    return () => {
      keys.forEach((key, index) => {
        const value = previous[index]
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      })
    }
  }, [setContinuum, setArtifacts])
  return <>{children}</>
}

function ChatContinuumScreenStory() {
  const { t } = useTranslation()
  const store = React.useMemo(() => createStore(), [])
  const [model, setModel] = React.useState('rox/standard')
  const [permissionMode, setPermissionMode] = React.useState(session.permissionMode ?? 'ask')
  const [inputValue, setInputValue] = React.useState('')
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])

  ensureMockElectronAPI()

  return (
    <JotaiProvider store={store}>
      <HydrateDialogFlags>
        <NavigationContext.Provider value={playgroundNavigationContext}>
          <FocusProvider>
            <AppShellProvider value={playgroundContext}>
              <ModalProvider>
                <div className="flex h-full min-h-0 bg-background">
                  <ChatDisplay
                    session={session}
                    onSendMessage={log('onSendMessage')}
                    onOpenFile={log('onOpenFile')}
                    onOpenUrl={log('onOpenUrl')}
                    currentModel={model}
                    onModelChange={setModel}
                    permissionMode={permissionMode}
                    onPermissionModeChange={setPermissionMode}
                    inputValue={inputValue}
                    onInputChange={setInputValue}
                    attachmentsValue={attachments}
                    onAttachmentsChange={setAttachments}
                    sources={mockSources}
                    onSourcesChange={log('onSourcesChange')}
                    labels={labels}
                    onLabelsChange={log('onLabelsChange')}
                    sessionStatuses={sessionStatuses}
                    onSessionStatusChange={log('onSessionStatusChange')}
                    workspaceId={WORKSPACE_ID}
                    workingDirectory={session.workingDirectory}
                    onWorkingDirectoryChange={noop}
                    sessionFolderPath={session.sessionFolderPath}
                    placeholder={t('chatInput.placeholder.workOn')}
                    pendingPermission={pendingPermission}
                    onRespondToPermission={log('onRespondToPermission')}
                    pendingCredential={pendingCredential}
                    onRespondToCredential={log('onRespondToCredential')}
                  />
                </div>
              </ModalProvider>
            </AppShellProvider>
          </FocusProvider>
        </NavigationContext.Provider>
      </HydrateDialogFlags>
    </JotaiProvider>
  )
}

const viewportIds: PlaygroundViewportPresetId[] = ['desktop', 'tablet', 'mobile']

export default viewportIds.map((viewportId) => definePlaygroundStory({
  id: `screen-chat-continuum-${viewportId}`,
  name: `Chat Continuum Screen (${PLAYGROUND_VIEWPORT_PRESETS[viewportId].name})`,
  category: 'Chat',
  level: 'Screens',
  description:
    'Dialog continuum (feature-dialog-continuum + feature-dialog-artifacts) over a deterministic fixture: spine gutter, reasoning row, inline run/diff/screenshot artifacts and inline approval cards. Both flags hydrated ON.',
  component: ChatContinuumScreenStory,
  props: [],
  layout: 'full',
  viewport: PLAYGROUND_VIEWPORT_PRESETS[viewportId],
}))