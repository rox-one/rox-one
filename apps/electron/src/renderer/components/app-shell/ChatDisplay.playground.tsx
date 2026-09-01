import * as React from 'react'
import { Circle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChatDisplay } from './ChatDisplay'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { NavigationContext } from '@/contexts/NavigationContext'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { PLAYGROUND_VIEWPORT_PRESETS, type PlaygroundViewportPresetId } from '@/playground/registry/types'
import { ensureMockElectronAPI, mockSources } from '@/playground/mock-utils'
import { DEFAULT_NAVIGATION_STATE, type FileAttachment, type Session } from '../../../shared/types'
import type { LabelConfig } from '@craft-agent/shared/labels'
import type { SessionStatus } from '@/config/session-status-config'

const WORKSPACE_ID = 'screen-chat-display-workspace'
const SESSION_ID = 'screen-chat-display-session'
const FIXED_NOW = new Date('2026-09-01T10:30:00.000Z').getTime()

const noop = () => {}
const asyncNoop = async () => {}
const log = (name: string) => (...args: unknown[]) => {
  console.log(`[ChatDisplay Playground] ${name}`, args)
}

const labels: LabelConfig[] = [
  { id: 'bug', name: 'Bug', color: { light: '#EF4444', dark: '#F87171' } },
  { id: 'ux', name: 'UX', color: { light: '#0EA5E9', dark: '#38BDF8' } },
]

const sessionStatuses: SessionStatus[] = [
  {
    id: 'todo',
    label: 'Todo',
    resolvedColor: 'var(--muted-foreground)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    resolvedColor: 'var(--info)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'done',
    label: 'Done',
    resolvedColor: 'var(--success)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'closed',
  },
]

const session: Session = {
  id: SESSION_ID,
  workspaceId: WORKSPACE_ID,
  workspaceName: 'ROX Playground',
  name: 'Audit UI development loop',
  lastMessageAt: FIXED_NOW,
  messages: [
    {
      id: 'chat-screen-user-1',
      role: 'user',
      content: 'Audit the renderer dev loop and show the smallest safe path for ROX.',
      timestamp: FIXED_NOW - 8 * 60_000,
    },
    {
      id: 'chat-screen-assistant-1',
      role: 'assistant',
      content:
        'The renderer already has most of the right building blocks. The missing piece is a stable preview loop:\n\n' +
        '- colocated Playground stories for production screens\n' +
        '- deterministic fixtures instead of live IPC\n' +
        '- one visual route that designers and agents can both open\n\n' +
        'I would start with the shell and one full chat surface, then expand toward settings and browser screens.',
      timestamp: FIXED_NOW - 7 * 60_000,
      turnId: 'chat-screen-turn-1',
    },
    {
      id: 'chat-screen-user-2',
      role: 'user',
      content: 'Keep it concrete. What should be visible in the first pass?',
      timestamp: FIXED_NOW - 5 * 60_000,
    },
    {
      id: 'chat-screen-assistant-2',
      role: 'assistant',
      content:
        'First pass should render a full desktop conversation with:\n\n' +
        '```ts\n' +
        'type StoryGate = "static-fixture" | "no-ipc" | "screen-layout"\n' +
        '```\n\n' +
        'That catches spacing, markdown, input chrome, status badges, and overflow behavior before any runtime work is involved.',
      timestamp: FIXED_NOW - 4 * 60_000,
      turnId: 'chat-screen-turn-2',
    },
    {
      id: 'chat-screen-error-1',
      role: 'error',
      content: 'Mock transport returned no result for a background health read.',
      timestamp: FIXED_NOW - 3 * 60_000,
      errorTitle: 'Preview-only error state',
      errorDetails: ['source=playground', 'retry=false', 'sideEffects=none'],
    },
    {
      id: 'chat-screen-status-1',
      role: 'status',
      content: 'Renderer preview is using static fixtures',
      timestamp: FIXED_NOW - 2 * 60_000,
    },
  ],
  isProcessing: false,
  permissionMode: 'ask',
  sessionStatus: 'in-progress',
  labels: ['ux'],
  enabledSourceSlugs: ['github-api'],
  workingDirectory: '/Users/marklindgreen/Git/_worktrees/rox-ui-dev-loop',
  sessionFolderPath: '/mock/sessions/screen-chat-display',
  model: 'rox/standard',
  llmConnection: 'rox-kimi',
  thinkingLevel: 'medium',
  supportsBranching: false,
  memoryMode: 'temporary',
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
  canGoBack: false,
  canGoForward: false,
  goBack: noop,
  goForward: noop,
  updateRightSidebar: noop,
  toggleRightSidebar: noop,
  navigateToSource: noop,
  navigateToSession: noop,
}

function ChatDisplayScreenStory() {
  const { t } = useTranslation()
  const [model, setModel] = React.useState('rox/standard')
  const [permissionMode, setPermissionMode] = React.useState(session.permissionMode ?? 'ask')
  const [inputValue, setInputValue] = React.useState('')
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])

  ensureMockElectronAPI()

  return (
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
          />
            </div>
          </ModalProvider>
        </AppShellProvider>
      </FocusProvider>
    </NavigationContext.Provider>
  )
}

const viewportIds: PlaygroundViewportPresetId[] = ['desktop', 'tablet', 'mobile']

export default viewportIds.map((viewportId) => definePlaygroundStory({
  id: `screen-chat-display-${viewportId}`,
  name: `Chat Display Screen (${PLAYGROUND_VIEWPORT_PRESETS[viewportId].name})`,
  category: 'Chat',
  level: 'Screens',
  description: 'Production ChatDisplay with deterministic messages and no live session runtime.',
  component: ChatDisplayScreenStory,
  props: [],
  layout: 'full',
  viewport: PLAYGROUND_VIEWPORT_PRESETS[viewportId],
}))
