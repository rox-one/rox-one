/**
 * G6 «Пути» — production `SessionLanes` playground story.
 *
 * Mounts the real `components/app-shell/SessionLanes` under the flag path used
 * by `SessionList` (featureSessionLanesV1Atom ON), inside an isolated jotai
 * store. The store is hydrated with `loadedSessionsAtom` + `sessionAtomFamily`
 * so the numeric unread chip (derived from `countUnreadMessages`) is
 * demonstrable: a loaded session shows its count, an unloaded one keeps the
 * legacy dot.
 *
 * File-discovered via `import.meta.glob('../../**\/*.playground.tsx')`, so no
 * registry index edit is needed.
 */
import * as React from 'react'
import { Circle } from 'lucide-react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { PLAYGROUND_VIEWPORT_PRESETS } from '@/playground/registry/types'
import { PlaygroundAppShellProvider } from '@/playground/PlaygroundAppShellProvider'
import { SessionLanes } from '@/components/app-shell/SessionLanes'
import { SessionListProvider, type SessionListContextValue } from '@/context/SessionListContext'
import { loadedSessionsAtom, sessionAtomFamily, type SessionMeta } from '@/atoms/sessions'
import type { SessionStatus } from '@/config/session-status-config'
import type { LabelConfig } from '@rox/shared/labels'
import type { Message, Session } from '../../shared/types'

const WORKSPACE_ID = 'playground-workspace'
const FIXED_NOW = new Date('2026-09-01T10:30:00.000Z').getTime()

const lane = (name: string): string => `[SessionLanes Playground] ${name}`

function message(id: string, role: Message['role'], content: string, offsetMinutes: number, extra?: Partial<Message>): Message {
  return { id, role, content, timestamp: FIXED_NOW - offsetMinutes * 60_000, ...extra }
}

/** Loaded session with three unread final assistant messages → numeric chip «3». */
const unreadLoadedSession: Session = {
  id: 'lane-demo-1',
  workspaceId: WORKSPACE_ID,
  workspaceName: 'Playground',
  name: 'Разбор рендер-цикла',
  lastMessageAt: FIXED_NOW - 2 * 60_000,
  messages: [
    message('lane-demo-1-m1', 'user', 'Где узкое место в списке сессий?', 8),
    message('lane-demo-1-m2', 'assistant', 'Один проход по memoized строкам.', 6),
    message('lane-demo-1-m3', 'assistant', 'Полосы группируются за O(n).', 5),
    message('lane-demo-1-m4', 'assistant', 'Счётчики непрочитанного — карта по loadedSessions.', 4),
  ],
  isProcessing: false,
  lastReadMessageId: 'lane-demo-1-m1',
  hasUnread: true,
  lastFinalMessageId: 'lane-demo-1-m4',
  lastMessageRole: 'assistant',
}

/** Loaded, processing session — no unread. */
const runningSession: Session = {
  id: 'lane-demo-3',
  workspaceId: WORKSPACE_ID,
  workspaceName: 'Playground',
  name: 'Пересобрать индекс',
  lastMessageAt: FIXED_NOW - 60_000,
  messages: [
    message('lane-demo-3-m1', 'user', 'Пересобери индекс поиска.', 3),
    message('lane-demo-3-m2', 'assistant', 'Запускаю переиндексацию…', 1, { isIntermediate: true }),
  ],
  isProcessing: true,
  lastMessageRole: 'assistant',
}

/** Read, loaded session — no badge. */
const readSession: Session = {
  id: 'lane-demo-4',
  workspaceId: WORKSPACE_ID,
  workspaceName: 'Playground',
  name: 'Прочитанная заметка',
  lastMessageAt: FIXED_NOW - 60 * 60_000,
  messages: [
    message('lane-demo-4-m1', 'user', 'Кратко: что решили?', 70),
    message('lane-demo-4-m2', 'assistant', 'Оставили плоский путь под флагом.', 65),
  ],
  isProcessing: false,
  lastReadMessageId: 'lane-demo-4-m2',
  hasUnread: false,
  lastFinalMessageId: 'lane-demo-4-m2',
  lastMessageRole: 'assistant',
}

/** Archived, loaded session. */
const archivedSession: Session = {
  id: 'lane-demo-5',
  workspaceId: WORKSPACE_ID,
  workspaceName: 'Playground',
  name: 'Архивный черновик',
  lastMessageAt: FIXED_NOW - 24 * 60 * 60_000,
  messages: [
    message('lane-demo-5-m1', 'user', 'Черновик идеи.', 24 * 60),
    message('lane-demo-5-m2', 'assistant', 'Свернул в архив.', 24 * 60 - 5),
  ],
  isProcessing: false,
  lastReadMessageId: 'lane-demo-5-m2',
  hasUnread: false,
  isArchived: true,
  lastFinalMessageId: 'lane-demo-5-m2',
}

const loadedSessions: Session[] = [unreadLoadedSession, runningSession, readSession, archivedSession]

/** Rows handed to the real component (mirrors SessionList's `flatRows`). */
const rows: SessionMeta[] = [
  {
    id: 'lane-demo-1',
    name: 'Разбор рендер-цикла',
    workspaceId: WORKSPACE_ID,
    lastMessageAt: unreadLoadedSession.lastMessageAt,
    hasUnread: true,
    lastFinalMessageId: 'lane-demo-1-m4',
    lastMessageRole: 'assistant',
  },
  {
    // No loaded session → count unknown → legacy dot.
    id: 'lane-demo-2',
    name: 'Незагруженная сессия',
    workspaceId: WORKSPACE_ID,
    lastMessageAt: FIXED_NOW - 9 * 60_000,
    hasUnread: true,
    lastFinalMessageId: 'lane-demo-2-m1',
    lastMessageRole: 'assistant',
  },
  {
    id: 'lane-demo-3',
    name: 'Пересобрать индекс',
    workspaceId: WORKSPACE_ID,
    lastMessageAt: runningSession.lastMessageAt,
    isProcessing: true,
    lastMessageRole: 'assistant',
  },
  {
    id: 'lane-demo-4',
    name: 'Прочитанная заметка',
    workspaceId: WORKSPACE_ID,
    lastMessageAt: readSession.lastMessageAt,
    hasUnread: false,
    lastFinalMessageId: 'lane-demo-4-m2',
    lastMessageRole: 'assistant',
  },
  {
    id: 'lane-demo-5',
    name: 'Архивный черновик',
    workspaceId: WORKSPACE_ID,
    lastMessageAt: archivedSession.lastMessageAt,
    isArchived: true,
    hasUnread: false,
    lastFinalMessageId: 'lane-demo-5-m2',
  },
]

const sessionStatuses: SessionStatus[] = [
  { id: 'todo', label: 'Todo', resolvedColor: 'var(--muted-foreground)', icon: <Circle className="icon-caption" />, iconColorable: true, category: 'open' },
  { id: 'in-progress', label: 'In Progress', resolvedColor: 'var(--info)', icon: <Circle className="icon-caption" />, iconColorable: true, category: 'open' },
  { id: 'done', label: 'Done', resolvedColor: 'var(--success)', icon: <Circle className="icon-caption" />, iconColorable: true, category: 'closed' },
]

const labels: LabelConfig[] = [
  { id: 'bug', name: 'Bug', color: { light: 'var(--status-danger)', dark: 'var(--status-danger)' } },
  { id: 'ux', name: 'UX', color: { light: 'var(--info)', dark: 'var(--info)' } },
]

const listContext: SessionListContextValue = {
  onRenameClick: (id, name) => console.log(lane('onRenameClick'), id, name),
  onSessionStatusChange: (id, state) => console.log(lane('onSessionStatusChange'), id, state),
  onFlag: (id) => console.log(lane('onFlag'), id),
  onUnflag: (id) => console.log(lane('onUnflag'), id),
  onArchive: (id) => console.log(lane('onArchive'), id),
  onUnarchive: (id) => console.log(lane('onUnarchive'), id),
  onMarkUnread: (id) => console.log(lane('onMarkUnread'), id),
  onDelete: async (id) => {
    console.log(lane('onDelete'), id)
    return false
  },
  onLabelsChange: (id, next) => console.log(lane('onLabelsChange'), id, next),
  onSetProjectId: (id, projectId) => console.log(lane('onSetProjectId'), id, projectId),
  projects: [],
  onSelectSessionById: (id) => console.log(lane('onSelectSessionById'), id),
  onOpenInNewWindow: (item) => console.log(lane('onOpenInNewWindow'), item.id),
  onSendToWorkspace: (ids) => console.log(lane('onSendToWorkspace'), ids),
  onFocusZone: () => {},
  onKeyDown: () => {},
  sessionStatuses,
  flatLabels: labels,
  labels,
  isMultiSelectActive: false,
  contentSearchResults: new Map(),
  hasPendingPrompt: () => false,
}

function SessionLanesStory() {
  const [selectedId, setSelectedId] = React.useState<string | null>('lane-demo-1')
  const store = React.useMemo(() => {
    const next = createStore()
    next.set(loadedSessionsAtom, new Set(loadedSessions.map((session) => session.id)))
    for (const session of loadedSessions) next.set(sessionAtomFamily(session.id), session)
    return next
  }, [])

  return (
    <JotaiProvider store={store}>
      <PlaygroundAppShellProvider>
        <SessionListProvider value={listContext}>
          <div className="flex h-[560px] w-[392px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-canvas">
            <div className="flex h-[var(--chrome-panel-header-height)] shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-elevated px-2">
              <span className="text-body font-semibold text-text-primary">Сессии</span>
              <span className="rounded-[var(--radius-control)] bg-surface-hover px-1 text-caption font-medium tabular-nums text-text-secondary">
                {rows.length}
              </span>
            </div>
            <SessionLanes rows={rows.map((item) => ({ item }))} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </SessionListProvider>
      </PlaygroundAppShellProvider>
    </JotaiProvider>
  )
}

export default definePlaygroundStory({
  id: 'screen-session-lanes',
  name: 'Session Lanes — счётчики непрочитанного',
  category: 'Session List',
  level: 'Screens',
  description:
    'Production SessionLanes (G6 «Пути») mounted under featureSessionLanesV1 with an isolated store hydrated from loadedSessionsAtom + sessionAtomFamily. A loaded session shows the numeric unread chip (3); an unloaded one keeps the legacy dot. Flag OFF leaves the flat SessionList path untouched.',
  component: SessionLanesStory,
  props: [],
  layout: 'centered',
  previewOverflow: 'hidden',
  viewport: PLAYGROUND_VIEWPORT_PRESETS.desktop,
})