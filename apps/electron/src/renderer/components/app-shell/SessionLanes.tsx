/**
 * SessionLanes (G6 «Пути») — the flat session list as dense status lanes.
 *
 * Lanes render the operational reading order the workspace actually needs —
 * Закреплённые → Требуют ответа → В работе → Прочитано → Архив — instead of a
 * mutually-exclusive display mode. The grouping is derived (O(n)) from the rows
 * the caller already memoized, so a 4000-row list costs one pass.
 *
 * Behaviour: sticky collapsible lane headers, a 14px status gutter
 * (see LaneRule), tabular unread/count chips, hover quick actions wired to the
 * existing session callbacks + SessionMenu, one preview line on the selected
 * row, and roving j/k traversal that never fires while typing.
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNowStrict } from 'date-fns'
import type { Locale } from 'date-fns'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Mail,
  MoreHorizontal,
  Pin,
  PinOff,
  Play,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Spinner } from '@rox/ui'
import { atom, useAtomValue } from 'jotai'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SessionMenu } from './SessionMenu'
import { LaneRule, deriveLaneStatus, type LaneStatus } from './LaneRule'
import { useSessionListContext, type SessionListContextValue } from '@/context/SessionListContext'
import { useAppShellContext } from '@/context/AppShellContext'
import { hasTransferTargets } from './transfer-targets'
import { countUnreadMessages, getSessionTitle, getSessionPreviewText, hasUnreadMeta, shortTimeLocale } from '@/utils/session'
import { collectionDisplayAtom } from '@/atoms/collection-display'
import { loadedSessionsAtom, sessionAtomFamily, type SessionMeta } from '@/atoms/sessions'

/**
 * sessionId → number of unread final assistant messages, for sessions whose
 * messages are actually loaded (loadedSessionsAtom). Recomputed only when a
 * loaded session's atom changes — O(loaded) once, then O(1) per rendered row.
 * SessionMeta carries no numeric counter (only `hasUnread`), so the count is
 * derived from the full Session; sessions with unloaded messages are absent
 * from the map and fall back to the legacy unread dot.
 */
const laneUnreadCountsAtom = atom<Map<string, number>>((get) => {
  const counts = new Map<string, number>()
  for (const id of get(loadedSessionsAtom)) {
    const session = get(sessionAtomFamily(id))
    if (!session) continue
    const count = countUnreadMessages(session)
    if (count > 0) counts.set(id, count)
  }
  return counts
})

/** Structural row: SessionList's `SessionListRow` is assignable to this. */
export interface LaneRow {
  item: SessionMeta
}

export type LaneId = 'pinned' | 'attention' | 'running' | 'read' | 'archive'

const LANE_ORDER: readonly LaneId[] = ['pinned', 'attention', 'running', 'read', 'archive']

const LANE_STATUS_ICON: Record<LaneStatus, typeof Play> = {
  running: Play,
  waiting: AlertTriangle,
  blocked: ShieldAlert,
  done: Check,
  idle: CircleSlash,
}

/** Status → text-safe icon colour (never the only carrier of meaning). */
const LANE_STATUS_COLOR: Record<LaneStatus, string> = {
  running: 'var(--status-running)',
  waiting: 'var(--status-warning)',
  blocked: 'var(--status-danger)',
  done: 'var(--status-success)',
  idle: 'var(--status-neutral)',
}

/** Guard mirrored from PanelStackContainer: j/k never fires while typing. */
const EDITABLE_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="menu"], [role="listbox"], [role="tree"], [data-terminal], .xterm, .monaco-editor, .cm-editor'

/** The rule status a lane shows before any row refines it. */
const LANE_BASE_STATUS: Record<LaneId, LaneStatus> = {
  pinned: 'running',
  attention: 'waiting',
  running: 'running',
  read: 'done',
  archive: 'idle',
}

function formatRelative(timestamp: number | undefined): string | undefined {
  if (!timestamp) return undefined
  return formatDistanceToNowStrict(new Date(timestamp), { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })
}

interface LaneBucket {
  id: LaneId
  status: LaneStatus
  items: SessionMeta[]
}

interface SessionLanesProps {
  /** Memoized rows from SessionList (same pass as the flat list). */
  rows: readonly LaneRow[]
  selectedId?: string | null
  onSelect: (sessionId: string) => void
  className?: string
  density?: 'compact' | 'comfortable'
}

export function SessionLanes({ rows, selectedId, onSelect, className, density = 'compact' }: SessionLanesProps) {
  const { t } = useTranslation()
  const ctx = useSessionListContext()
  const { workspaces } = useAppShellContext()
  const collectionDisplay = useAtomValue(collectionDisplayAtom)
  const unreadCounts = useAtomValue(laneUnreadCountsAtom)
  const effectiveDensity = collectionDisplay.density ?? density
  const canSendToWorkspace = hasTransferTargets(workspaces)

  const [collapsed, setCollapsed] = useState<readonly LaneId[]>(() => ['archive'])
  const [focusId, setFocusId] = useState<string | null>(selectedId ?? null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement | null>())

  const lanes = useMemo<LaneBucket[]>(() => {
    const buckets = {} as Record<LaneId, LaneBucket>
    for (const id of LANE_ORDER) {
      buckets[id] = { id, status: LANE_BASE_STATUS[id], items: [] }
    }
    for (const { item } of rows) {
      const status = deriveLaneStatus(item, ctx.hasPendingPrompt?.(item.id) ?? false)
      const laneId: LaneId = item.isArchived
        ? 'archive'
        : item.isFlagged
          ? 'pinned'
          : status === 'waiting' || status === 'blocked'
            ? 'attention'
            : status === 'running'
              ? 'running'
              : 'read'
      const bucket = buckets[laneId]
      bucket.items.push(item)
      // The lane's rule reflects its strongest live state.
      if (status === 'blocked') bucket.status = 'blocked'
      else if (status === 'waiting' && bucket.status !== 'blocked') bucket.status = 'waiting'
    }
    return LANE_ORDER.map((id) => buckets[id])
  }, [rows, ctx])

  const flat = useMemo(() => lanes.flatMap((lane) => (collapsed.includes(lane.id) ? [] : lane.items)), [lanes, collapsed])

  const currentFocus = focusId ?? selectedId ?? flat[0]?.id ?? null

  const move = useCallback((delta: number) => {
    const index = flat.findIndex((item) => item.id === currentFocus)
    const next = flat[Math.max(0, Math.min(flat.length - 1, (index < 0 ? 0 : index) + delta))]
    if (!next) return
    setFocusId(next.id)
    rowRefs.current.get(next.id)?.focus()
  }, [flat, currentFocus])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.target instanceof Element && event.target.closest(EDITABLE_TARGET_SELECTOR)) return
    switch (event.key) {
      case 'j':
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        return
      case 'k':
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        return
      case 'Home':
        event.preventDefault()
        move(-flat.length)
        return
      case 'End':
        event.preventDefault()
        move(flat.length)
        return
      case 'Enter': {
        if (!currentFocus) return
        event.preventDefault()
        onSelect(currentFocus)
        return
      }
      default:
    }
  }

  const toggleLane = (id: LaneId) => {
    setCollapsed((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))
  }

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-2', className)}
      role="list"
      aria-label={t('session.lane.listLabel', { defaultValue: 'Сессии по состояниям' })}
      data-focus-zone="navigator"
      data-list-role="sessions"
      data-density={effectiveDensity}
      data-testid="session-lanes"
      onKeyDown={handleKeyDown}
    >
      {lanes.map((lane) => {
        const isCollapsed = collapsed.includes(lane.id)
        const unreadCount = lane.items.filter(hasUnreadMeta).length
        return (
          <div key={lane.id} role="group" aria-label={t(`session.lane.${lane.id}`, { defaultValue: lane.id })} data-lane={lane.id} data-lane-count={lane.items.length}>
            <div className="sticky top-0 z-sticky flex h-7 items-center gap-1 bg-surface-canvas px-2">
              <button
                type="button"
                onClick={() => toggleLane(lane.id)}
                aria-expanded={!isCollapsed}
                aria-label={t(`session.lane.${lane.id}`, { defaultValue: lane.id })}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {isCollapsed ? <ChevronRight className="icon-status" /> : <ChevronDown className="icon-status" />}
              </button>
              <span className="text-caption font-medium uppercase caps-label text-text-secondary">
                {t(`session.lane.${lane.id}`, { defaultValue: lane.id })}
              </span>
              <span className="rounded-[var(--radius-control)] bg-surface-hover px-1 text-caption font-medium numeric text-text-secondary">
                {lane.items.length}
              </span>
              {unreadCount > 0 ? (
                <span className="rounded-full bg-accent/15 px-1.5 text-caption font-semibold numeric text-accent-text" data-lane-unread-chip={lane.id}>
                  {unreadCount}
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-1">
                {lane.items.some((item) => item.isProcessing) ? (
                  <span className="flex items-center gap-1 text-caption text-text-secondary">
                    <Spinner className="text-caption" />
                    {t('session.lane.runningHint', { defaultValue: 'идёт работа' })}
                  </span>
                ) : null}
              </span>
            </div>
            {isCollapsed ? null : lane.items.length === 0 ? (
              <p className="px-4 py-3 text-small text-text-secondary" data-lane-empty={lane.id}>
                {t(`session.lane.empty.${lane.id}`, { defaultValue: 'Полоса пуста' })}
              </p>
            ) : (
              lane.items.map((item, index) => (
                <LaneItem
                  key={item.id}
                  item={item}
                  laneStatus={lane.status}
                  selected={item.id === selectedId}
                  tabIndex={item.id === currentFocus ? 0 : -1}
                  isFirst={index === 0}
                  canSendToWorkspace={canSendToWorkspace}
                  onSelect={() => onSelect(item.id)}
                  onFocus={() => setFocusId(item.id)}
                  registerRef={(node) => { rowRefs.current.set(item.id, node) }}
                  ctx={ctx}
                  unreadCount={unreadCounts.get(item.id)}
                />
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}

interface LaneItemProps {
  item: SessionMeta
  laneStatus: LaneStatus
  selected: boolean
  tabIndex: number
  isFirst: boolean
  canSendToWorkspace: boolean
  onSelect: () => void
  onFocus: () => void
  registerRef: (node: HTMLButtonElement | null) => void
  ctx: SessionListContextValue
  /** Numeric unread count when the session's messages are loaded (>0); undefined otherwise. */
  unreadCount?: number
}

function LaneItem({
  item,
  laneStatus,
  selected,
  tabIndex,
  isFirst,
  canSendToWorkspace,
  onSelect,
  onFocus,
  registerRef,
  ctx,
  unreadCount,
}: LaneItemProps) {
  const { t } = useTranslation()
  const { workspaces } = useAppShellContext()
  const title = getSessionTitle(item)
  const unread = hasUnreadMeta(item)
  const preview = getSessionPreviewText(item)
  const time = formatRelative(item.lastMessageAt)
  const workspaceName = workspaces.find((workspace) => workspace.id === item.workspaceId)?.name
  const StatusIcon = LANE_STATUS_ICON[laneStatus]
  const statusLabel = t(`session.lane.status.${laneStatus}`, { defaultValue: laneStatus })
  const expanded = selected && Boolean(preview)
  // Known count (session messages loaded) → numeric chip; otherwise keep the dot.
  const hasKnownCount = unreadCount !== undefined && unreadCount > 0
  const unreadBadge = hasKnownCount ? String(unreadCount) : '•'
  const unreadAriaLabel = hasKnownCount
    ? t('session.lane.unreadCount', { count: unreadCount, defaultValue: 'непрочитанных: {{count}}' })
    : undefined
  const ariaLabel = unreadAriaLabel ? `${title} — ${statusLabel}, ${unreadAriaLabel}` : `${title} — ${statusLabel}`

  return (
    <div
      role="listitem"
      data-session-id={item.id}
      data-session-status={laneStatus}
      data-session-unread={unread || undefined}
      data-session-selected={selected ? 'true' : undefined}
      className={cn(
        'group/row relative flex min-h-[var(--control-lg)] items-stretch',
        !isFirst && 'border-t border-border-subtle/60',
        selected ? 'bg-[var(--state-selected)]' : 'hover:bg-[var(--state-hover)]',
      )}
    >
      <LaneRule status={laneStatus} active={laneStatus !== 'idle' && laneStatus !== 'done'} />
      <button
        ref={registerRef}
        type="button"
        tabIndex={tabIndex}
        onFocus={onFocus}
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={ariaLabel}
        data-testid={`lane-row-${item.id}`}
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-[var(--radius-xs)] py-1 pr-1.5 text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {item.isProcessing ? (
            <Spinner className="shrink-0 text-caption" />
          ) : (
            <StatusIcon className="icon-caption" aria-hidden="true" style={{ color: LANE_STATUS_COLOR[laneStatus] }} />
          )}
          <span className={cn('min-w-0 flex-1 truncate text-body text-text-primary', unread && 'font-medium')} title={title}>
            {title}
          </span>
          {item.isFlagged ? <Pin className="icon-status text-text-secondary" aria-hidden="true" /> : null}
          {unread ? (
            <span
              className="shrink-0 rounded-full bg-accent/15 px-1.5 text-caption font-semibold numeric text-accent-text"
              data-testid={`lane-unread-${item.id}`}
              data-unread-count={hasKnownCount ? unreadCount : undefined}
            >
              {unreadBadge}
            </span>
          ) : null}
          {time ? (
            <span className="shrink-0 text-caption numeric text-text-secondary group-hover/row:invisible" data-testid={`lane-time-${item.id}`}>
              {time}
            </span>
          ) : null}
        </span>
        {expanded ? (
          <span className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary" data-testid={`lane-preview-${item.id}`}>
            <span className="truncate" title={preview ?? undefined}>{preview}</span>
          </span>
        ) : null}
      </button>
      {/* Quick actions are siblings of the row button — never nested controls. */}
      <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-[var(--radius-xs)] bg-surface-canvas px-0.5 group-hover/row:flex group-focus-within/row:flex">
        <span className="pointer-events-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label={t(item.isFlagged ? 'session.action.unpin' : 'session.action.pin', { defaultValue: item.isFlagged ? 'Открепить' : 'Закрепить' })}
            aria-pressed={!!item.isFlagged}
            onClick={() => (item.isFlagged ? ctx.onUnflag?.(item.id) : ctx.onFlag?.(item.id))}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {item.isFlagged ? <PinOff className="icon-caption" /> : <Pin className="icon-caption" />}
          </button>
          <button
            type="button"
            aria-label={t('sessionMenu.markAsUnread')}
            onClick={() => ctx.onMarkUnread(item.id)}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Mail className="icon-caption" />
          </button>
          <button
            type="button"
            aria-label={t(item.isArchived ? 'sessionMenu.unarchive' : 'sessionMenu.archive')}
            onClick={() => (item.isArchived ? ctx.onUnarchive?.(item.id) : ctx.onArchive?.(item.id))}
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {item.isArchived ? <ArchiveRestore className="icon-caption" /> : <Archive className="icon-caption" />}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('session.action.more', { defaultValue: 'Ещё действия' })}
                className="grid h-7 w-7 place-items-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <MoreHorizontal className="icon-caption" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <SessionMenu
                item={item}
                sessionStatuses={ctx.sessionStatuses}
                labels={ctx.labels}
                onLabelsChange={ctx.onLabelsChange ? (next) => ctx.onLabelsChange!(item.id, next) : undefined}
                onRename={() => ctx.onRenameClick(item.id, title)}
                onFlag={() => ctx.onFlag?.(item.id)}
                onUnflag={() => ctx.onUnflag?.(item.id)}
                onArchive={() => ctx.onArchive?.(item.id)}
                onUnarchive={() => ctx.onUnarchive?.(item.id)}
                onMarkUnread={() => ctx.onMarkUnread(item.id)}
                onSessionStatusChange={(state) => ctx.onSessionStatusChange(item.id, state)}
                onOpenInNewWindow={() => ctx.onOpenInNewWindow(item)}
                onSendToWorkspace={ctx.onSendToWorkspace ? () => ctx.onSendToWorkspace!([item.id]) : undefined}
                hasTransferTargets={canSendToWorkspace}
                onDelete={() => ctx.onDelete(item.id)}
                projects={ctx.projects}
                onSetProjectId={ctx.onSetProjectId ? (projectId) => ctx.onSetProjectId!(item.id, projectId) : undefined}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </span>
      <span className="flex w-[52px] shrink-0 flex-col items-end justify-center pr-2 text-caption numeric">
        {workspaceName ? (
          <span className="truncate text-text-secondary" title={workspaceName}>{workspaceName}</span>
        ) : null}
      </span>
    </div>
  )
}