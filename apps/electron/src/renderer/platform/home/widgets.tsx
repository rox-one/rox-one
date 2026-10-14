/**
 * Главная widgets. Every widget reads REAL data through stores/IPC that the
 * app already has and clicks through to its own screen. No fake data: when a
 * source is unavailable or empty the widget says so and why.
 */
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useNotesTitleKey } from '../useNotesTitleKey'
import { useTranslation } from 'react-i18next'
import { Cron } from 'croner'
import {
  AlertTriangle,
  Activity as ActivityIcon,
  ArrowUp,
  Bot,
  CalendarClock,
  BellDot,
  Check,
  ChevronLeft,
  Clock,
  CornerUpLeft,
  Play,
  Square,
  CalendarDays,
  Coins,
  Cpu,
  FileText,
  GripVertical,
  Gavel,
  Inbox as InboxIcon,
  LayoutGrid,
  ListChecks,
  ListTodo,
  MessageSquare,
  Mic,
  NotebookPen,
  Phone,
  Plus,
  Radar as RadarIcon,
  Rss,
  RotateCcw,
  Search,
  Sparkles,
  SquarePen,
  Timer,
  Wallet,
  Workflow,
} from 'lucide-react'
import type { LocalMeeting } from '../../../shared/meetings-local'
import type { NoteSummary } from '@rox/shared/protocol'
import { isInternalAgentSession } from '@rox/shared/sessions/internal-prompts'
import { ROX_VISIBLE_TERMS } from '@rox/shared/identity'
import { omniboxOpenAtom } from '@/atoms/omnibox'
import { useEffectiveVisible } from '@/lib/surface-keepalive'
import type { AgentBudgetSnapshot } from '@rox/shared/agent'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { parseAutomationsConfig, type AutomationListItem } from '@/components/automations/types'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useInboxItems } from '@/hooks/useInboxItems'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useWorkspaceTaskCount } from '@/hooks/useWorkspaceTaskCount'
import { subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import { createPersonalTaskConfirmed } from '@/lib/extra-screens/personal-task-bridge'
import { useFeedItems, usePersonalTasks } from '@/lib/extra-screens/use-rox-sources'
import { focusMinutesOn, isFocusRunning, loadFocusState, localDay, subscribeFocusState, type FocusState } from '@/lib/focus-session'
import { startRecording, useRecorder } from '@/lib/meetings/recorder'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { formatHotkeyDisplay } from '@/lib/platform'
import { buildAgentCenter } from '@/pages/extra-screens/agents/agent-center-model'
import { DECISIONS_NS, loadDecisions } from '@/pages/extra-screens/decisions/decisions-store'
import { RADAR_NS, loadRadar } from '@/pages/extra-screens/radar/radar-store'
import { ALL_KINDS, isActive, markDone, snooze, snoozeTargets, sortInbox } from '@/pages/inbox/inbox-model'
import { getSessionTitle } from '@/utils/session'
import { isHomeSessionInWorkspace, pickRecentHomeSessions } from '../home-model'
import { buildMiniDashboard, formatDashboardCost, formatTokenCount, syncStatusLabelKey } from '../mini-dashboard'
import { widgetContentLayout, widgetItemLimit, widgetRowSpan, type HomeWidgetId, type HomeWidgetSize } from './dashboard-layout'
import {
  TASK_LISTS,
  buildAutomationsOverview,
  buildWeekCalendar,
  formatDuration,
  recentCalls,
  taskTrackerStats,
  type CalendarEventKind,
  buildMeetingsOverview,
  buildActivityHeatmap,
  agentPhase,
  dayTimeline,
  reorderedSlots,
  todayTasks,
  averageSessionCost,
  greetingPart,
  heatLevel,
  buildUsageOverview,
  connectionUsage,
  formatTokens,
  formatUsd,
  radarSignals,
  recentByUpdated,
  startOfLocalDay,
  topOpenTasks,
  usageByModel,
} from './home-data'
import { Dot, Ring, SectionLabel, Sparkline, Toggle, WidgetButton, WidgetEmpty, WidgetFrame, WidgetList, WidgetRow, WidgetStat, type WidgetEditProps } from './widget-kit'
import { QuickTaskInput } from './QuickTaskInput'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { setPersonalTaskDone, setPersonalTaskOrders } from './home-actions'
import { toErrorMessage } from '@/lib/errors'
import { cachedNotesList, fetchNotesList, subscribeCachedNotesList } from '@/lib/query/notes-cache'

export interface WidgetProps {
  edit: WidgetEditProps | null
  /** Persisted size controls height independently of the responsive width. */
  size?: HomeWidgetSize
  /** Actual card width; a full grid span can still be a narrow card. */
  width: number
}

// ---------------------------------------------------------------------------
// Shared hooks
// ---------------------------------------------------------------------------

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  // PERF-10 (#1577): a retired Home surface keeps its widgets mounted but stops
  // their clock; the value is recomputed as soon as the surface is active again.
  const visible = useEffectiveVisible()
  useEffect(() => {
    if (!visible) {
      setNow(Date.now())
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs, visible])
  return now
}

function useFormat() {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage || i18n.language || 'ru'
  return useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    const dayTime = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
    const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
    return {
      ago(ts: number, now: number): string {
        const min = Math.round((now - ts) / 60_000)
        if (Math.abs(min) < 60) return rtf.format(-min, 'minute')
        const h = Math.round(min / 60)
        if (Math.abs(h) < 24) return rtf.format(-h, 'hour')
        return rtf.format(-Math.round(h / 24), 'day')
      },
      /** Today → HH:MM, otherwise «12 окт., 14:00». */
      when(ts: number, now: number): string {
        return startOfLocalDay(ts) === startOfLocalDay(now) ? time.format(ts) : dayTime.format(ts)
      },
      weekday: (ts: number) => weekday.format(ts),
      dayMonth: (ts: number) => dayMonth.format(ts),
      time: (ts: number) => time.format(ts),
      num: (n: number) => num.format(n),
    }
  }, [locale])
}

/** Workspace sessions (not hidden, not Rox-internal); archived kept for spend. */
function useHomeSessions(): { all: SessionMeta[]; active: SessionMeta[] } {
  const workspace = useActiveWorkspace()
  const map = useAtomValue(sessionMetaMapAtom)
  return useMemo(() => {
    const all: SessionMeta[] = []
    for (const meta of map.values()) {
      if (meta.hidden || isInternalAgentSession(meta)) continue
      if (!isHomeSessionInWorkspace(meta, workspace?.id, workspace?.remoteServer?.remoteWorkspaceId)) continue
      all.push(meta)
    }
    return { all, active: all.filter((s) => !s.isArchived) }
  }, [map, workspace])
}

function useWorkspaceStore<T>(ns: string, workspaceId: string | null, load: (ws: string | null) => T): T {
  const [value, setValue] = useState<T>(() => load(workspaceId))
  useEffect(() => {
    setValue(load(workspaceId))
    return subscribeWorkspaceJson(ns, workspaceId, () => setValue(load(workspaceId)))
  }, [ns, workspaceId, load])
  return value
}

function useFocusState(): FocusState {
  const [state, setState] = useState<FocusState>(() => loadFocusState())
  useEffect(() => subscribeFocusState(() => setState(loadFocusState())), [])
  return state
}

/** Visible rows grow with the card height, independently of screen width. */
function rowsFor(size: HomeWidgetSize, base: number): number {
  return widgetItemLimit(size, base)
}

// ---------------------------------------------------------------------------
// Сводка
// ---------------------------------------------------------------------------

function SummaryWidget({ edit, width }: WidgetProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const { active } = useHomeSessions()
  const connection = useTransportConnectionState()
  const tasks = useWorkspaceTaskCount(workspace?.id)
  const snap = useMemo(() => buildMiniDashboard({ sessions: active, tasks, connection }), [active, tasks, connection])
  const unknown = t('dashboard.unknown')
  return (
    <WidgetFrame testId="summary" title={t('workbench.home.w.summary')} edit={edit} meta={workspace?.name}>
      <div className={cn('grid gap-x-2 gap-y-1', widgetContentLayout(width).summaryColumns === 6 ? 'grid-cols-6' : widgetContentLayout(width).summaryColumns === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        <WidgetStat label={t('dashboard.sessions')} value={snap.sessions} onClick={() => navigate(routes.view.allSessions())} />
        <WidgetStat label={t('dashboard.activeAgents')} value={snap.activeAgents} tone={snap.activeAgents > 0 ? 'accent' : undefined} onClick={() => navigate(routes.view.screen('agents'))} />
        <WidgetStat label={t('workbench.home.summary.conductor')} value={snap.tasks == null ? unknown : snap.tasks} onClick={() => navigate(routes.view.tasks())} />
        <WidgetStat label={t('workbench.home.summary.tokens')} value={snap.tokens == null ? unknown : formatTokenCount(snap.tokens)} />
        <WidgetStat label={t('workbench.home.summary.cost')} value={snap.costUsd == null ? unknown : formatDashboardCost(snap.costUsd)} />
        <WidgetStat label={t('dashboard.syncCloud')} value={<span className="text-lg">{t(syncStatusLabelKey(snap.sync))}</span>} />
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Быстрые действия
// ---------------------------------------------------------------------------

/** «Запись»: start a local meeting recording, or jump to the live one. */
function useRecordAction(): { recording: string | null; busy: boolean; error: string | null; record: () => Promise<void> } {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const recorder = useRecorder()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recording = recorder.status !== 'idle' && recorder.meetingId ? recorder.meetingId : null
  const record = async () => {
    if (recording) {
      navigate(routes.view.meetings(recording))
      return
    }
    setBusy(true)
    setError(null)
    const locale = i18n.resolvedLanguage || 'ru'
    const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(Date.now())
    try {
      const result = await startRecording({ title: t('meetings.local.defaultTitle', { date }), workspaceId: workspace?.id ?? null })
      if (result.ok) navigate(routes.view.meetings(result.meeting.id))
      else setError(t('workbench.home.quick.recordFailed', { code: result.code }))
    } catch {
      setError(t('workbench.home.quick.recordFailed', { code: 'error' }))
    } finally {
      setBusy(false)
    }
  }
  return { recording, busy, error, record }
}

function RecordButton({ rec }: { rec: ReturnType<typeof useRecordAction> }) {
  const { t } = useTranslation()
  return (
    <WidgetButton tone={rec.recording ? 'danger' : undefined} disabled={rec.busy} onClick={() => void rec.record()} title={rec.error ?? undefined}>
      <Mic className="icon-status" />
      {rec.recording ? t('workbench.home.quick.recording') : t('workbench.home.meetings.record')}
    </WidgetButton>
  )
}

function QuickActionsWidget({ edit, width }: WidgetProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const setOmniboxOpen = useSetAtom(omniboxOpenAtom)
  const rec = useRecordAction()
  const [noteError, setError] = useState<string | null>(null)
  const [noteBusy, setBusy] = useState<string | null>(null)
  const recording = rec.recording
  const record = rec.record
  const busy = rec.busy ? 'record' : noteBusy
  const error = rec.error ?? noteError

  const newNote = async () => {
    if (!workspace?.id || typeof window.electronAPI?.createNote !== 'function') {
      navigate(routes.view.notes())
      return
    }
    setBusy('note')
    setError(null)
    try {
      const note = await window.electronAPI.createNote(workspace.id, t('notes.untitled'))
      navigate(routes.view.notes(note.id))
    } catch (e) {
      console.warn('[home] create note failed', e)
      setError(t('workbench.home.quick.noteFailed'))
    } finally {
      setBusy(null)
    }
  }

  const actions: { key: string; label: string; icon: React.ReactNode; onClick: () => void; hint?: string }[] = [
    { key: 'session', label: t('workbench.home.quick.newSession'), icon: <SquarePen className="icon-toolbar" />, onClick: () => navigate(routes.action.newSession()) },
    {
      key: 'record',
      label: recording ? t('workbench.home.quick.recording') : t('workbench.home.quick.record'),
      icon: <Mic className={cn('icon-toolbar', recording && 'text-destructive')} />,
      onClick: () => void record(),
    },
    { key: 'note', label: t('workbench.home.quick.newNote'), icon: <NotebookPen className="icon-toolbar" />, onClick: () => void newNote() },
    { key: 'search', label: t('workbench.home.quick.search'), icon: <Search className="icon-toolbar" />, onClick: () => setOmniboxOpen(true), hint: formatHotkeyDisplay('mod+k') },
  ]
  return (
    <WidgetFrame testId="quickActions" title={t('workbench.home.w.quickActions')} edit={edit}>
      <div className={cn('grid content-start gap-2 pb-5', widgetContentLayout(width).quickActionColumns === 4 ? 'grid-cols-4' : 'grid-cols-2')}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={busy === a.key}
            onClick={a.onClick}
            data-home-action={a.key}
            className="rox-home-tile flex min-h-10 min-w-0 items-center gap-2 rounded-[var(--radius-card)] px-3 py-2 text-left disabled:opacity-60"
          >
            <span className="text-foreground">{a.icon}</span>
            <span className="flex w-full min-w-0 items-baseline gap-1">
              <span className="min-w-0 flex-1 truncate text-base font-bold text-foreground" title={a.label}>{a.label}</span>
              {a.hint ? <span className="shrink-0 text-xs text-muted-foreground">{a.hint}</span> : null}
            </span>
          </button>
        ))}
      </div>
      {error ? <p className="absolute inset-x-0 bottom-0 truncate text-sm text-destructive" role="alert">{error}</p> : null}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Недавние сессии
// ---------------------------------------------------------------------------

function RecentSessionsWidget({ edit, width, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const { active } = useHomeSessions()
  const recent = useMemo(() => pickRecentHomeSessions(active, Math.max(4, widgetItemLimit(size, 5, widgetContentLayout(width).listColumns))), [active, width, size])
  const track = useRef<HTMLUListElement>(null)
  const scroll = (dir: -1 | 1) => track.current?.scrollBy({ left: dir * Math.max(160, track.current.clientWidth * 0.8), behavior: 'smooth' })
  const pager = recent.length > 1 && !edit ? (
    <span className="flex items-center gap-0.5">
      <button type="button" onClick={() => scroll(-1)} aria-label={t('workbench.home.recentPrev')} className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground"><ChevronLeft className="icon-status" /></button>
      <button type="button" onClick={() => scroll(1)} aria-label={t('workbench.home.recentNext')} className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground"><ChevronLeft className="icon-status rotate-180" /></button>
    </span>
  ) : undefined
  return (
    <WidgetFrame testId="recentSessions" title={t('workbench.home.recent')} onOpen={() => navigate(routes.view.allSessions())} edit={edit} meta={active.length ? String(active.length) : undefined} action={pager}>
      {recent.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.emptySessions')} hint={t('workbench.home.recentEmptyHint')} action={{ label: t('workbench.home.quick.newSession'), onClick: () => navigate(routes.action.newSession()) }} />
      ) : (
        <ul ref={track} className="flex h-full min-h-0 snap-x snap-mandatory gap-2 overflow-x-auto overflow-y-hidden pb-1" data-home-carousel="" aria-label={t('workbench.home.recent')}>
          {recent.map((s) => (
            <li key={s.id} className="flex h-full w-44 shrink-0 snap-start flex-col gap-1 rounded-[var(--radius-card)] bg-surface-hover p-2" data-home-row={s.id}>
              <span className="flex min-w-0 items-center gap-1.5">
                {s.isProcessing ? <Dot tone="accent" /> : s.lastMessageRole === 'error' ? <Dot tone="danger" /> : <MessageSquare className="icon-caption shrink-0" />}
                <span className="min-w-0 truncate text-base font-bold text-foreground" title={getSessionTitle(s)}>{getSessionTitle(s)}</span>
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {s.lastMessageAt || s.createdAt ? fmt.ago(s.lastMessageAt ?? s.createdAt ?? now, now) : ''}
                {s.model ? ` · ${s.model}` : ''}
              </span>
              {s.preview ? <p className="line-clamp-3 min-h-0 flex-1 text-sm text-muted-foreground">{s.preview}</p> : <span className="flex-1" />}
              <WidgetButton onClick={() => navigate(routes.view.allSessions(s.id))}>{t('workbench.home.continue')}</WidgetButton>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Активные агенты
// ---------------------------------------------------------------------------

function AgentsWidget({ edit, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(30_000)
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const { active } = useHomeSessions()
  const { pendingPermissions, pendingCredentials } = useAppShellContext()
  const [budget, setBudget] = useState<AgentBudgetSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    setBudget(null)
    if (!workspaceId || typeof api?.getSessionBudget !== 'function') return
    api.getSessionBudget(workspaceId).then((snapshot) => {
      if (!cancelled) setBudget(snapshot)
    }).catch(() => {
      if (!cancelled) setBudget(null)
    })
    return () => { cancelled = true }
  }, [workspaceId])

  const center = useMemo(() => buildAgentCenter({
    sessions: active.map((s) => ({ id: s.id, name: getSessionTitle(s), isProcessing: s.isProcessing, lastMessageAt: s.lastMessageAt, createdAt: s.createdAt })),
    pendingPermissions: new Map([...pendingPermissions].map(([id, list]) => [id, list.length])),
    pendingCredentials: new Map([...pendingCredentials].map(([id, list]) => [id, list.length])),
    cloudRuns: [],
    automations: [],
    now,
    budget,
  }), [active, pendingPermissions, pendingCredentials, now, budget])
  const byId = useMemo(() => new Map(active.map((s) => [s.id, s])), [active])
  const [stopping, setStopping] = useState<Set<string>>(() => new Set())
  const [stopError, setStopError] = useState(false)
  const stop = (id: string) => {
    if (typeof window.electronAPI?.cancelProcessing !== 'function') return
    setStopError(false)
    setStopping((cur) => new Set(cur).add(id))
    window.electronAPI.cancelProcessing(id).catch(() => setStopError(true)).finally(() => setStopping((cur) => { const next = new Set(cur); next.delete(id); return next }))
  }
  const rows = [
    ...center.waiting.map((w) => ({ id: w.session.id, name: w.session.name, tone: 'warning' as const, note: t('workbench.home.agents.waitingRow'), running: false })),
    ...center.stuck.map((s) => ({ id: s.id, name: s.name, tone: 'danger' as const, note: t('workbench.home.agents.stuckRow'), running: false })),
    ...center.running.map((s) => ({ id: s.id, name: s.name, tone: 'accent' as const, note: t(`workbench.home.agents.phase.${agentPhase(byId.get(s.id)?.lastMessageRole)}`), running: true })),
  ].slice(0, rowsFor(size, 3))
  const open = () => navigate(routes.view.screen('agents'))
  return (
    <WidgetFrame testId="agents" title={t('workbench.home.w.agents')} onOpen={open} edit={edit}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid grid-cols-3 gap-1">
          <WidgetStat label={t('workbench.home.agents.running')} value={center.running.length} tone={center.running.length ? 'accent' : undefined} onClick={open} />
          <WidgetStat label={t('workbench.home.agents.waiting')} value={center.waiting.length} tone={center.waiting.length ? 'warning' : undefined} onClick={open} />
          <WidgetStat label={t('workbench.home.agents.stuck')} value={center.stuck.length} tone={center.stuck.length ? 'danger' : undefined} onClick={open} />
        </div>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('workbench.home.agents.idle')}</p>
        ) : (
          <div className="mt-1 min-h-0">
            <WidgetList>
              {rows.map((r) => (
                <WidgetRow
                  key={r.id}
                  testId={r.id}
                  onClick={() => navigate(routes.view.allSessions(r.id))}
                  leading={<span className={cn('inline-flex', r.running && 'animate-pulse motion-reduce:animate-none')}><Dot tone={r.tone} /></span>}
                  title={r.name}
                  trailing={<span data-home-agent-phase={r.running ? agentPhase(byId.get(r.id)?.lastMessageRole) : undefined}>{r.note}</span>}
                  aside={r.running ? (
                    <button type="button" onClick={() => stop(r.id)} disabled={stopping.has(r.id)} aria-label={t('workbench.home.agents.stop', { name: r.name })} data-home-agent-stop={r.id} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-50">
                      <Square className="icon-status" />
                    </button>
                  ) : undefined}
                />
              ))}
            </WidgetList>
          </div>
        )}
        {stopError ? <p className="mt-1 text-sm text-destructive" role="alert">{t('workbench.home.agents.stopFailed')}</p> : null}
        <span className="flex-1" />
        <p className="truncate text-sm text-muted-foreground">{t('workbench.home.agents.costToday', { cost: center.budget ? formatUsd(center.budget.spentUsd) : t('common.unavailable') })}</p>
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Входящие
// ---------------------------------------------------------------------------

const TRIAGE_BTN = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground'

function InboxWidget({ edit, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const { items, state, setState, counts, now } = useInboxItems({ withRemote: true })
  const pending = useMemo(() => sortInbox(items.filter((i) => isActive(state, i, now))).slice(0, rowsFor(size, 4)), [items, state, now, size])
  return (
    <WidgetFrame
      testId="inbox"
      title={t('workbench.home.w.inbox')}
      onOpen={() => navigate(routes.view.inbox())}
      edit={edit}
      meta={counts.decisions ? t('workbench.home.inbox.decisions', { count: counts.decisions }) : undefined}
    >
      {pending.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.inbox.empty')} hint={t('workbench.home.inbox.emptyHint')} />
      ) : (
        <ul className="flex flex-col gap-1">
          {pending.map((item) => (
            <li key={item.id} data-home-row={item.id} className="group flex min-w-0 items-center gap-1 rounded-[var(--radius-control)] bg-surface-hover/50 py-0.5 pl-0.5 pr-1 transition-transform duration-150 focus-within:translate-x-0.5 hover:translate-x-0.5 motion-reduce:transition-none">
              <button type="button" onClick={() => navigate(routes.view.inbox(item.id))} className="rox-home-row flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-1 text-left">
                {item.blocking ? <Dot tone="warning" /> : <InboxIcon className="icon-caption shrink-0" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base text-foreground" title={item.title}>{item.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.source} · {fmt.ago(item.at, now)}</span>
                </span>
              </button>
              <span className="flex shrink-0 items-center opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" className={TRIAGE_BTN} onClick={() => navigate(routes.view.inbox(item.id))} aria-label={t('workbench.home.inbox.reply', { name: item.title })} data-home-triage="reply"><CornerUpLeft className="icon-status" /></button>
                <button type="button" className={TRIAGE_BTN} onClick={() => setState(snooze(state, item.id, snoozeTargets(now).laterToday))} aria-label={t('workbench.home.inbox.snooze', { name: item.title })} data-home-triage="snooze"><Clock className="icon-status" /></button>
                <button type="button" className={TRIAGE_BTN} onClick={() => setState(markDone(state, item.id, now))} aria-label={t('workbench.home.inbox.done', { name: item.title })} data-home-triage="done"><Check className="icon-status" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Расход и токены
// ---------------------------------------------------------------------------

function UsageWidget({ edit, width, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const { all } = useHomeSessions()
  const usage = useMemo(() => buildUsageOverview(all, now, 7), [all, now])
  const models = useMemo(() => usageByModel(all, usage.days[0]!.start).filter((m) => m.tokens > 0).slice(0, rowsFor(size, 4)), [all, usage, size])
  const max = Math.max(1, ...usage.days.map((d) => d.tokens))
  const wide = widgetContentLayout(width).splitPanels
  const open = () => navigate(routes.view.screen('agents'))
  return (
    <WidgetFrame testId="usage" title={t('workbench.home.w.usage')} onOpen={open} edit={edit} meta={t('workbench.home.usage.window')}>
      {!usage.hasData ? (
        <WidgetEmpty text={t('workbench.home.usage.empty')} hint={t('workbench.home.usage.emptyHint')} />
      ) : (
        <div className="flex h-full min-h-0 gap-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="grid grid-cols-2 gap-1">
              <WidgetStat label={t('workbench.home.usage.today')} value={formatTokens(usage.today.tokens)} sub={formatUsd(usage.today.costUsd)} />
              <WidgetStat label={t('workbench.home.usage.week')} value={formatTokens(usage.totalTokens)} sub={formatUsd(usage.totalCostUsd)} />
            </div>
            <div className="mt-2 flex min-h-0 flex-1 items-end gap-1 px-1.5" role="img" aria-label={t('workbench.home.usage.chart')}>
              {usage.days.map((d) => (
                <div key={d.start} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${fmt.weekday(d.start)} · ${formatTokens(d.tokens)} · ${formatUsd(d.costUsd)}`}>
                  <div
                    className={cn('w-full max-w-7 rounded-[var(--radius-control)]', d.start === usage.today.start ? 'bg-accent' : 'bg-foreground/30')}
                    style={{ height: d.tokens > 0 ? `${Math.max(6, Math.round((d.tokens / max) * 100))}%` : 2 }}
                  />
                  <span className="text-xs text-muted-foreground">{fmt.weekday(d.start)}</span>
                </div>
              ))}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={t('workbench.home.usage.attribution')}>{t('workbench.home.usage.attribution')}</p>
          </div>
          {wide && models.length > 0 ? (
            <div className="flex w-[38%] min-w-0 shrink-0 flex-col">
              <SectionLabel>{t('workbench.home.usage.byModel')}</SectionLabel>
              <WidgetList>
                {models.map((m) => (
                  <WidgetRow key={m.model || `@${m.connection}`} title={m.model || t('workbench.home.models.defaultModel')} sub={formatUsd(m.costUsd)} trailing={formatTokens(m.tokens)} />
                ))}
              </WidgetList>
            </div>
          ) : null}
        </div>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Модели
// ---------------------------------------------------------------------------

const SHARE_TONES = ['bg-accent', 'bg-success', 'bg-accent/50', 'bg-success/50', 'bg-muted-foreground'] as const

/** Token share per model as one segmented bar (sessions when no tokens). */
function ModelShareBar({ models }: { models: readonly { model?: string; connection?: string; tokens: number; sessions: number }[] }) {
  const { t } = useTranslation()
  const weight = (m: { tokens: number; sessions: number }) => (models.some((x) => x.tokens > 0) ? m.tokens : m.sessions)
  const total = models.reduce((sum, m) => sum + weight(m), 0)
  if (total <= 0) return null
  return (
    <span className="my-1 flex h-2 overflow-hidden rounded-full bg-surface-hover" role="img" aria-label={t('workbench.home.models.share')} data-home-model-share="">
      {models.map((m, i) => (
        <span key={m.model || `@${m.connection}`} className={cn('h-full transition-[width] duration-500 motion-reduce:transition-none', SHARE_TONES[i % SHARE_TONES.length])} style={{ width: `${(weight(m) / total) * 100}%` }} />
      ))}
    </span>
  )
}

function ModelsWidget({ edit, width, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const now = useNow(5 * 60_000)
  const { all } = useHomeSessions()
  const { llmConnections, workspaceDefaultLlmConnection, runtimeSummary } = useAppShellContext()
  const since = startOfLocalDay(now) - 6 * 86_400_000
  const connections = useMemo(() => connectionUsage(llmConnections, all, since, workspaceDefaultLlmConnection), [llmConnections, all, since, workspaceDefaultLlmConnection])
  const models = useMemo(() => usageByModel(all, since).slice(0, rowsFor(size, 3)), [all, since, size])
  const names = useMemo(() => new Map(llmConnections.map((c) => [c.slug, c.name])), [llmConnections])
  const defaultSlug = connections.find((c) => c.isDefault)?.slug
  const open = () => navigate(routes.view.settings('ai'))
  return (
    <WidgetFrame testId="models" title={t('workbench.home.w.models')} onOpen={open} edit={edit} meta={t('workbench.home.usage.window')}>
      {runtimeSummary ? (
        <div data-home-runtime-configuration="native">
          <WidgetList>
            <WidgetRow
              onClick={open}
              leading={<Cpu className="icon-caption" />}
              title={runtimeSummary.providerType === 'omp' ? ROX_VISIBLE_TERMS.product : runtimeSummary.providerType}
              sub={runtimeSummary.defaultModel
                ? t('workbench.home.models.default', { model: runtimeSummary.models?.find(model => model.id === runtimeSummary.defaultModel)?.name ?? runtimeSummary.defaultModel })
                : t('common.unavailable')}
            />
          </WidgetList>
        </div>
      ) : connections.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.models.empty')} hint={t('workbench.home.models.emptyHint')} action={{ label: t('workbench.home.models.connect'), onClick: open }} />
      ) : (
        <div className={cn('grid h-full min-h-0 gap-x-4', widgetContentLayout(width).splitPanels && models.length > 0 ? 'grid-cols-2' : 'grid-cols-1')}>
          <div className="min-w-0">
            <WidgetList>
              {connections.slice(0, rowsFor(size, 4)).map((c) => (
                <WidgetRow
                  key={c.slug}
                  testId={c.slug}
                  onClick={open}
                  leading={<Dot tone={c.authenticated ? 'success' : 'danger'} />}
                  title={c.name}
                  sub={c.isDefault ? t('workbench.home.models.default', { model: c.defaultModel ?? '—' }) : c.authenticated ? c.defaultModel : t('workbench.home.models.noAuth')}
                  trailing={t('workbench.home.models.sessions', { count: c.sessions })}
                />
              ))}
            </WidgetList>
          </div>
          {models.length > 0 ? (
            <div className="min-w-0">
              <SectionLabel>{t('workbench.home.models.used')}</SectionLabel>
              <ModelShareBar models={models} />
              <WidgetList>
                {models.map((m, i) => (
                  <WidgetRow
                    key={m.model || `@${m.connection}`}
                    leading={<span className={cn('inline-block h-2 w-2 rounded-full', SHARE_TONES[i % SHARE_TONES.length])} aria-hidden="true" />}
                    title={m.model || t('workbench.home.models.defaultOf', { name: names.get(m.connection ?? defaultSlug ?? '') || m.connection || defaultSlug || '—' })}
                    trailing={m.tokens > 0 ? formatTokens(m.tokens) : t('workbench.home.models.sessions', { count: m.sessions })}
                  />
                ))}
              </WidgetList>
            </div>
          ) : null}
        </div>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Баланс
// ---------------------------------------------------------------------------

type BalanceState =
  | { status: 'loading' }
  | { status: 'ok'; balance: number; updating?: boolean; syncedAt?: number | null }
  | { status: 'disconnected' }
  | { status: 'error'; message: string }
  | { status: 'unavailable' }

function BalanceWidget({ edit }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const { all } = useHomeSessions()
  const usage = useMemo(() => buildUsageOverview(all, now, 7), [all, now])
  const [state, setState] = useState<BalanceState>({ status: 'loading' })
  // A transient outage keeps the last confirmed snapshot on screen.
  const lastBalance = useRef<number | null>(null)
  const load = useCallback(async () => {
    const api = window.electronAPI
    if (typeof api?.getRoxBalance !== 'function') {
      setState({ status: 'unavailable' })
      return
    }
    try {
      const next = await api.getRoxBalance()
      if (next.status === 'ok') lastBalance.current = next.balance
      setState(next)
    } catch (e) {
      const message = toErrorMessage(e)
      // Never surfaced: logged for diagnostics, the widget keeps the snapshot.
      console.warn('[home] balance unavailable:', message)
      setState(lastBalance.current !== null
        ? { status: 'ok', balance: lastBalance.current, updating: true }
        : /no handler/i.test(message) ? { status: 'unavailable' } : { status: 'error', message })
    }
  }, [])
  const visible = useEffectiveVisible()
  useEffect(() => {
    if (!visible) return
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [load, visible])
  const open = () => navigate(routes.view.settings('account'))
  return (
    <WidgetFrame testId="balance" title={t('workbench.home.w.balance')} onOpen={open} edit={edit}>
      <div className="flex h-full min-h-0 flex-col">
        <WidgetStat
          label={t('workbench.home.balance.credits')}
          value={<span className="text-display numeric">{state.status === 'ok' ? fmt.num(state.balance) : state.status === 'loading' ? '…' : '—'}</span>}
        />
        {state.status === 'ok' ? (
          <span className="px-1.5 text-small text-muted-foreground" data-home-balance-note="">
            {state.updating
              ? t('workbench.home.balance.updating')
              : state.syncedAt ? t('workbench.home.balance.updated', { time: fmt.when(state.syncedAt, Date.now()) }) : ''}
          </span>
        ) : state.status === 'disconnected' ? (
          <div className="flex min-w-0 flex-col items-start gap-1 px-1.5">
            <WidgetButton onClick={open}>{t('workbench.home.balance.connect')}</WidgetButton>
            <span className="line-clamp-2 text-sm text-muted-foreground">{t('workbench.home.balance.disconnectedHint')}</span>
          </div>
        ) : state.status === 'error' || state.status === 'unavailable' ? (
          <p className="px-1.5 text-sm text-muted-foreground" data-home-balance-note="">{t('workbench.home.balance.error')}</p>
        ) : null}
        <span className="flex-1" />
        {usage.hasData ? (
          <div className="flex min-w-0 items-center gap-2" data-home-balance-spend="">
            <div className="h-10 shrink-0">
              <Ring value={usage.totalCostUsd > 0 ? usage.today.costUsd / usage.totalCostUsd : 0} label={t('workbench.home.balance.todayShare')} />
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
              <WidgetStat label={t('workbench.home.usage.todayCost')} value={<span className="text-lg">{formatUsd(usage.today.costUsd)}</span>} />
              <WidgetStat label={t('workbench.home.usage.weekCost')} value={<span className="text-lg">{formatUsd(usage.totalCostUsd)}</span>} />
            </div>
          </div>
        ) : null}
        {usage.hasData ? <Sparkline values={usage.days.map((d) => d.costUsd)} label={t('workbench.home.balance.trend')} /> : null}
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Задачи
// ---------------------------------------------------------------------------

function TodayTaskRow({ task, overdue, due, disabled }: { task: { id: string; title: string; completedAt?: number }; overdue: boolean; due?: string; disabled: boolean }) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: disabled || Boolean(task.completedAt) })
  const done = Boolean(task.completedAt)
  const title = task.title || t('workbench.home.tasks.untitled')
  return (
    <li ref={setNodeRef} data-home-row={task.id} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('group flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1 py-0.5', isDragging && 'relative bg-surface-pressed')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t(done ? 'workbench.home.tasks.reopen' : 'workbench.home.tasks.complete', { name: title })}
        onClick={() => setPersonalTaskDone(task.id, !done)}
        data-home-task-check={task.id}
        className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors', done ? 'bg-success text-background' : 'bg-surface-hover hover:bg-surface-pressed')}
      >
        {done ? <Check className="icon-caption" /> : null}
      </button>
      <button type="button" onClick={() => navigate(routes.view.tasks(task.id))} className="min-w-0 flex-1 truncate text-left text-base" title={title}>
        <span className={cn(done ? 'text-muted-foreground line-through' : 'text-foreground')}>{title}</span>
      </button>
      {due ? <span className={cn('shrink-0 text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>{due}</span> : null}
      {!done ? (
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={t('workbench.home.tasks.drag', { name: title })} className="flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing">
          <GripVertical className="icon-caption" />
        </button>
      ) : null}
    </li>
  )
}

function TasksWidget({ edit, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const tasks = usePersonalTasks()
  const today = useMemo(() => todayTasks(tasks, now), [tasks, now])
  const shown = today.slice(0, widgetItemLimit(size, 5))
  const doneCount = today.filter((task) => task.completedAt).length
  const dayStart = startOfLocalDay(now)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const open = today.filter((task) => !task.completedAt)
  const onDragEnd = (event: DragEndEvent) => {
    const over = event.over ? String(event.over.id) : null
    if (!over) return
    setPersonalTaskOrders(reorderedSlots(open, String(event.active.id), over))
  }
  return (
    <WidgetFrame
      testId="tasks"
      title={t('workbench.home.w.tasks')}
      onOpen={() => navigate(routes.view.tasks())}
      edit={edit}
      meta={today.length ? t('workbench.home.tasks.progress', { done: doneCount, total: today.length }) : undefined}
    >
      <div className="flex h-full min-h-0 flex-col gap-1">
        {today.length > 0 ? (
          <span className="flex h-1 shrink-0 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuemin={0} aria-valuemax={today.length} aria-valuenow={doneCount} aria-label={t('workbench.home.tasks.progress', { done: doneCount, total: today.length })}>
            <span className="rounded-full bg-success transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(doneCount / today.length) * 100}%` }} />
          </span>
        ) : null}
        {today.length === 0 ? (
          <p className="px-1.5 py-2 text-sm text-muted-foreground">{t('workbench.home.tasks.todayEmpty')}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={shown.filter((task) => !task.completedAt).map((task) => task.id)} strategy={verticalListSortingStrategy}>
              <ul className="min-h-0 flex-1 overflow-y-auto" aria-label={t('workbench.home.w.tasks')}>
                {shown.map((task) => (
                  <TodayTaskRow key={task.id} task={task} disabled={Boolean(edit)} overdue={task.dueAt != null && task.dueAt < dayStart && !task.completedAt} due={task.dueAt != null ? fmt.when(task.dueAt, now) : undefined} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
        <QuickTaskInput disabled={Boolean(edit)} onCreate={(title, previousAttempt) => createPersonalTaskConfirmed({ title, list: 'today' }, previousAttempt)} />
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Встречи
// ---------------------------------------------------------------------------

function useLocalMeetings(workspaceId: string | null): { available: boolean; loaded: boolean; meetings: LocalMeeting[] } {
  const [state, setState] = useState<{ available: boolean; loaded: boolean; meetings: LocalMeeting[] }>({ available: true, loaded: false, meetings: [] })
  useEffect(() => {
    const api = window.electronAPI?.meetingsLocal
    if (!api) {
      setState({ available: false, loaded: true, meetings: [] })
      return
    }
    let cancelled = false
    const load = () => api.list(workspaceId).then(
      (meetings) => { if (!cancelled) setState({ available: true, loaded: true, meetings: Array.isArray(meetings) ? meetings : [] }) },
      () => { if (!cancelled) setState({ available: false, loaded: true, meetings: [] }) },
    )
    void load()
    const off = api.onChanged(() => { void load() })
    return () => { cancelled = true; off() }
  }, [workspaceId])
  return state
}

function transcriptTone(status: string): 'success' | 'danger' | 'accent' | 'muted' {
  return status === 'done' ? 'success' : status === 'failed' ? 'danger' : status === 'running' || status === 'queued' ? 'accent' : 'muted'
}

function MeetingsWidget({ edit, width, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const rec = useRecordAction()
  const { available, loaded, meetings } = useLocalMeetings(workspace?.id ?? null)
  const overview = useMemo(() => buildMeetingsOverview(meetings, now, widgetItemLimit(size, 2)), [meetings, now, size])
  const open = (id?: string) => navigate(routes.view.meetings(id))
  const empty = loaded && !overview.live && overview.upcoming.length === 0 && overview.recent.length === 0
  const recent = overview.recent.slice(0, widgetItemLimit(size, overview.upcoming.length > 0 ? 2 : 3))
  const timeline = useMemo(() => dayTimeline(meetings, now), [meetings, now])
  return (
    <WidgetFrame testId="meetings" title={t('workbench.home.w.meetings')} onOpen={() => open()} edit={edit} action={available ? <RecordButton rec={rec} /> : undefined}>
      {!available ? (
        <WidgetEmpty text={t('workbench.home.meetings.unavailable')} />
      ) : empty ? (
        <WidgetEmpty text={t('workbench.home.meetings.empty')} hint={t('workbench.home.meetings.emptyHint')} action={{ label: t('workbench.home.meetings.plan'), onClick: () => open() }} />
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-1">
        {timeline.items.length > 0 ? (
          <div className="relative h-9 shrink-0 rounded-[var(--radius-control)] bg-surface-hover" data-home-timeline="" role="list" aria-label={t('workbench.home.meetings.timeline')}>
            <span className="absolute inset-y-0 w-0.5 bg-destructive" style={{ left: `${timeline.now * 100}%` }} aria-hidden="true" />
            {timeline.items.map(({ item, left, width: w }) => (
              <button
                key={item.id}
                type="button"
                role="listitem"
                onClick={() => open(item.id)}
                title={`${item.title} · ${fmt.time(item.startedAt ?? item.scheduledAt ?? now)}`}
                aria-label={`${item.title} · ${fmt.time(item.startedAt ?? item.scheduledAt ?? now)}`}
                className={cn('absolute inset-y-1 min-w-2 truncate rounded-[var(--radius-control)] px-1 text-left text-xs font-bold text-foreground transition-transform hover:-translate-y-px motion-reduce:transition-none', item.status === 'recording' || item.id === overview.live?.id ? 'bg-destructive/40' : item.endedAt ? 'bg-surface-pressed' : 'bg-accent/40')}
                style={{ left: `${left * 100}%`, width: `${w * 100}%` }}
              >
                {item.title}
              </button>
            ))}
          </div>
        ) : null}
        <div className={cn('grid min-h-0 flex-1 gap-x-4', widgetContentLayout(width).listColumns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
          <div className="min-w-0">
            {overview.live ? (
              <WidgetList>
                <WidgetRow onClick={() => open(overview.live!.id)} leading={<Mic className="icon-caption text-destructive" />} title={overview.live.title} trailing={t('workbench.home.meetings.live')} />
              </WidgetList>
            ) : null}
            <SectionLabel>{t('workbench.home.meetings.upcoming')}</SectionLabel>
            {overview.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('workbench.home.meetings.noUpcoming')}</p>
            ) : (
              <WidgetList>
                {overview.upcoming.map((m) => (
                  <WidgetRow
                    key={m.id}
                    testId={m.id}
                    onClick={() => open(m.id)}
                    leading={<CalendarClock className="icon-caption" />}
                    title={m.title}
                    trailing={m.scheduledAt ? fmt.when(m.scheduledAt, now) : undefined}
                    aside={m.scheduledAt != null && m.scheduledAt - now < 15 * 60_000 ? <WidgetButton onClick={() => void rec.record()} disabled={rec.busy || Boolean(rec.recording)}>{t('workbench.home.meetings.record')}</WidgetButton> : undefined}
                  />
                ))}
              </WidgetList>
            )}
          </div>
          {recent.length > 0 ? (
            <div className="min-w-0">
              <SectionLabel>{t('workbench.home.meetings.recent')}</SectionLabel>
              <WidgetList>
                {recent.map((m) => (
                  <WidgetRow
                    key={m.id}
                    testId={m.id}
                    onClick={() => open(m.id)}
                    leading={<Dot tone={transcriptTone(m.transcript.status)} />}
                    title={m.title}
                    sub={t(`workbench.home.meetings.transcript.${m.transcript.status}`)}
                    trailing={fmt.when(m.endedAt ?? m.startedAt ?? m.createdAt, now)}
                  />
                ))}
              </WidgetList>
            </div>
          ) : null}
        </div>
        </div>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Звонки
// ---------------------------------------------------------------------------

function CallsWidget({ edit, width, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const rec = useRecordAction()
  const { available, loaded, meetings } = useLocalMeetings(workspace?.id ?? null)
  const calls = useMemo(() => recentCalls(meetings, widgetItemLimit(size, 4, widgetContentLayout(width).listColumns)), [meetings, width, size])
  const totalMs = useMemo(() => recentCalls(meetings, Number.MAX_SAFE_INTEGER).filter((m) => (m.startedAt ?? m.createdAt) >= startOfLocalDay(now) - 6 * 86_400_000).reduce((sum, m) => sum + (m.durationMs || 0), 0), [meetings, now])
  const open = (id?: string) => navigate(routes.view.meetings(id))
  return (
    <WidgetFrame
      testId="calls"
      title={t('workbench.home.w.calls')}
      onOpen={() => open()}
      edit={edit}
      meta={calls.length && totalMs > 0 ? t('workbench.home.calls.week', { duration: formatDuration(totalMs) }) : undefined}
      action={available && calls.length > 0 ? <RecordButton rec={rec} /> : undefined}
    >
      {!available ? (
        <WidgetEmpty text={t('workbench.home.meetings.unavailable')} />
      ) : loaded && calls.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.calls.empty')} hint={t('workbench.home.calls.emptyHint')} action={{ label: rec.recording ? t('workbench.home.quick.recording') : t('workbench.home.meetings.record'), onClick: () => void rec.record() }} />
      ) : (
        <WidgetList columns={widgetContentLayout(width).listColumns}>
          {calls.map((m) => {
            const live = m.status === 'recording' || m.status === 'paused'
            return (
              <WidgetRow
                key={m.id}
                testId={m.id}
                onClick={() => open(m.id)}
                leading={live ? <Mic className="icon-caption text-destructive" /> : <Phone className="icon-caption" />}
                title={m.title}
                sub={live
                  ? t('workbench.home.meetings.live')
                  : `${m.durationMs > 0 ? `${formatDuration(m.durationMs)} · ` : ''}${t(`workbench.home.meetings.transcript.${m.transcript.status}`)}`}
                trailing={fmt.when(m.startedAt ?? m.createdAt, now)}
              />
            )
          })}
        </WidgetList>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Фокус
// ---------------------------------------------------------------------------

function FocusWidget({ edit }: WidgetProps) {
  const { t } = useTranslation()
  const focus = useFocusState()
  const running = isFocusRunning(focus, Date.now())
  const now = useNow(running ? 1000 : 60_000)
  const tasks = usePersonalTasks()
  const today = focusMinutesOn(focus, localDay(now), now)
  const top3 = focus.top3.map((id) => tasks.find((task) => task.id === id)).filter((task): task is NonNullable<typeof task> => !!task && !task.trashedAt)
  const left = running && focus.active ? Math.max(0, focus.active.endsAt - now) : 0
  const mm = String(Math.floor(left / 60_000)).padStart(2, '0')
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')
  const open = () => navigate(routes.view.screen('focus'))
  return (
    <WidgetFrame testId="focus" title={t('workbench.home.w.focus')} onOpen={open} edit={edit}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid grid-cols-2 gap-1">
          <button type="button" onClick={open} className="flex h-16 min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1.5 text-left" aria-label={running ? `${t('workbench.home.focus.left')} ${mm}:${ss}` : t('workbench.home.focus.off')}>
            <Ring value={running && focus.active ? left / Math.max(1, focus.active.endsAt - focus.active.startedAt) : 0} label={t('workbench.home.focus.timer')} className="text-success">
              <span className="text-xs font-bold numeric text-foreground" data-home-focus-left="">{running ? `${mm}:${ss}` : '—'}</span>
            </Ring>
            <span className="min-w-0 truncate text-xs uppercase caps-label text-muted-foreground">{running ? t('workbench.home.focus.left') : t('workbench.home.focus.off')}</span>
          </button>
          <WidgetStat label={t('workbench.home.focus.today')} value={t('workbench.home.focus.minutes', { count: today.minutes })} />
        </div>
        <SectionLabel>{t('workbench.home.focus.top3')}</SectionLabel>
        {top3.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('workbench.home.focus.top3Empty')}</p>
        ) : (
          <WidgetList>
            {top3.map((task, i) => (
              <WidgetRow key={task.id} testId={task.id} onClick={() => navigate(routes.view.tasks(task.id))} leading={<span className="text-sm font-bold">{i + 1}</span>} title={<span className={cn(task.completedAt && 'text-muted-foreground line-through')}>{task.title}</span>} />
            ))}
          </WidgetList>
        )}
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Автоматизации
// ---------------------------------------------------------------------------

type AutomationsState = { available: boolean; loaded: boolean; items: AutomationListItem[]; last: Record<string, { ts: number; ok: boolean }> }

function useAutomationsData(workspaceId: string | null): AutomationsState & { setItems: (fn: (items: AutomationListItem[]) => AutomationListItem[]) => void; reload: () => void } {
  const [state, setState] = useState<AutomationsState>({ available: true, loaded: false, items: [], last: {} })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const api = window.electronAPI
    if (!workspaceId || typeof api?.getAutomations !== 'function') {
      setState({ available: false, loaded: true, items: [], last: {} })
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const json = await api.getAutomations(workspaceId)
        const items = json ? parseAutomationsConfig(json) : []
        let last: Record<string, { ts: number; ok: boolean }> = {}
        try { last = await api.getAutomationLastExecuted(workspaceId, true) } catch { /* no history yet */ }
        if (!cancelled) setState({ available: true, loaded: true, items, last })
      } catch {
        if (!cancelled) setState({ available: false, loaded: true, items: [], last: {} })
      }
    }
    void load()
    const off = typeof api.onAutomationsChanged === 'function' ? api.onAutomationsChanged(() => { void load() }) : undefined
    return () => { cancelled = true; off?.() }
  }, [workspaceId, tick])
  const setItems = useCallback((fn: (items: AutomationListItem[]) => AutomationListItem[]) => setState((prev) => ({ ...prev, items: fn(prev.items) })), [])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, setItems, reload }
}

function nextCronRun(a: { cron?: string; timezone?: string }): number | null {
  if (!a.cron) return null
  try {
    return new Cron(a.cron, a.timezone ? { timezone: a.timezone } : {}).nextRun()?.getTime() ?? null
  } catch {
    return null
  }
}

/** Fire times of enabled cron automations before `until` (capped per automation). */
function cronRunsUntil(items: readonly AutomationListItem[], until: number, cap = 24): { id: string; title: string; at: number }[] {
  const out: { id: string; title: string; at: number }[] = []
  for (const a of items) {
    if (!a.enabled || !a.cron) continue
    try {
      const runs = new Cron(a.cron, a.timezone ? { timezone: a.timezone } : {}).nextRuns(cap)
      for (const r of runs) {
        const at = r.getTime()
        if (at >= until) break
        out.push({ id: a.id, title: a.name, at })
      }
    } catch { /* invalid cron: the Автоматизации screen flags it */ }
  }
  return out
}

function AutomationsWidget({ edit, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const data = useAutomationsData(workspaceId)
  const [toggleError, setToggleError] = useState(false)
  const overview = useMemo(() => buildAutomationsOverview(data.items, data.last, nextCronRun, now), [data.items, data.last, now])
  const open = (automationId?: string) => navigate(routes.view.automations(automationId ? { automationId } : undefined))
  const toggle = (item: AutomationListItem, enabled: boolean) => {
    if (!workspaceId || typeof window.electronAPI?.setAutomationEnabled !== 'function') return
    setToggleError(false)
    data.setItems((items) => items.map((a) => (a.id === item.id ? { ...a, enabled } : a)))
    window.electronAPI.setAutomationEnabled(workspaceId, item.event, item.matcherIndex, enabled).then(
      () => data.reload(),
      () => {
        data.setItems((items) => items.map((a) => (a.id === item.id ? { ...a, enabled: item.enabled } : a)))
        setToggleError(true)
      },
    )
  }
  const [runState, setRunState] = useState<Record<string, 'running' | 'ok' | 'error'>>({})
  const runNow = (item: AutomationListItem) => {
    if (!workspaceId || typeof window.electronAPI?.testAutomation !== 'function') return
    setRunState((cur) => ({ ...cur, [item.id]: 'running' }))
    window.electronAPI.testAutomation({ workspaceId, automationId: item.id, automationName: item.name, actions: item.actions, permissionMode: item.permissionMode, labels: item.labels, telegramTopic: item.telegramTopic }).then(
      (result) => { setRunState((cur) => ({ ...cur, [item.id]: result.actions?.length && result.actions.every((a) => a.success) ? 'ok' : 'error' })); data.reload() },
      () => setRunState((cur) => ({ ...cur, [item.id]: 'error' })),
    )
  }
  // Rows: scheduled ones by next run, then the rest (event/paused) so every
  // automation can be switched from here.
  const nextAt = new Map(overview.next.map((n) => [n.id, n.at]))
  const rows = [...data.items]
    .sort((a, b) => (nextAt.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (nextAt.get(b.id) ?? Number.MAX_SAFE_INTEGER) || Number(b.enabled) - Number(a.enabled))
    .slice(0, Math.max(1, widgetItemLimit(size, 4) - Math.min(overview.failures.length, 2)))
  return (
    <WidgetFrame
      testId="automations"
      title={t('workbench.home.w.automations')}
      onOpen={() => open()}
      edit={edit}
      meta={data.items.length ? t('workbench.home.automations.counts', { enabled: overview.enabled, paused: overview.paused }) : undefined}
    >
      {!data.available ? (
        <WidgetEmpty text={t('workbench.home.automations.unavailable')} />
      ) : data.loaded && data.items.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.automations.empty')} hint={t('workbench.home.automations.emptyHint')} action={{ label: t('workbench.home.automations.create'), onClick: () => open() }} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {overview.failures.length > 0 ? (
            <>
              <SectionLabel>{t('workbench.home.automations.failures')}</SectionLabel>
              <WidgetList>
                {overview.failures.slice(0, 2).map((f) => (
                  <WidgetRow key={f.id} testId={`fail-${f.id}`} onClick={() => open(f.id)} leading={<AlertTriangle className="icon-caption text-destructive" />} title={f.name} trailing={fmt.ago(f.at, now)} />
                ))}
              </WidgetList>
            </>
          ) : null}
          <SectionLabel>{t('workbench.home.automations.next')}</SectionLabel>
          <WidgetList>
            {rows.map((a) => {
              const at = nextAt.get(a.id)
              return (
                <WidgetRow
                  key={a.id}
                  testId={a.id}
                  onClick={() => open(a.id)}
                  leading={<Workflow className={cn('icon-caption', !a.enabled && 'opacity-50')} />}
                  title={<span className={cn(!a.enabled && 'text-muted-foreground')}>{a.name}</span>}
                  trailing={!a.enabled ? t('workbench.home.automations.paused') : at != null ? fmt.when(at, now) : a.cron ? '—' : t('workbench.home.automations.onEvent')}
                  aside={
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => runNow(a)}
                        disabled={runState[a.id] === 'running'}
                        aria-label={t('workbench.home.automations.runNow', { name: a.name })}
                        data-home-run={runState[a.id] ?? 'idle'}
                        className={cn('flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] hover:bg-surface-hover disabled:opacity-50', runState[a.id] === 'ok' ? 'text-success' : runState[a.id] === 'error' ? 'text-destructive' : 'text-muted-foreground hover:text-foreground')}
                      >
                        {runState[a.id] === 'ok' ? <Check className="icon-status" /> : runState[a.id] === 'error' ? <AlertTriangle className="icon-status" /> : <Play className={cn('icon-status', runState[a.id] === 'running' && 'animate-pulse motion-reduce:animate-none')} />}
                      </button>
                      <Toggle checked={a.enabled} onChange={(next) => toggle(a, next)} label={t(a.enabled ? 'workbench.home.automations.pause' : 'workbench.home.automations.resume', { name: a.name })} />
                    </span>
                  }
                />
              )
            })}
          </WidgetList>
          {toggleError ? <p className="mt-1 text-sm text-destructive" role="alert">{t('toast.failedToToggleAutomation')}</p> : null}
        </div>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Лента
// ---------------------------------------------------------------------------

function FeedWidget({ edit, width, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const feed = useFeedItems(workspace?.id ?? null, { retainStale: true })
  const latest = feed.items.slice(0, widgetItemLimit(size, 5, widgetContentLayout(width).listColumns))
  return (
    <WidgetFrame testId="feed" title={t('workbench.home.w.feed')} onOpen={() => navigate(routes.view.feed())} edit={edit}>
      {feed.refreshing && !feed.loaded ? (
        <WidgetEmpty text={t('workbench.home.feed.loading')} />
      ) : !feed.available && latest.length === 0 ? (
        <WidgetEmpty
          text={t('workbench.home.feed.unavailable')}
          hint={feed.error ? t('workbench.home.feed.refreshFailed') : undefined}
          action={feed.error ? { label: t('workbench.home.feed.retry'), onClick: feed.retry } : undefined}
        />
      ) : feed.loaded && latest.length === 0 ? (
        <WidgetEmpty
          text={t('workbench.home.feed.empty')}
          hint={feed.error ? t('workbench.home.feed.refreshFailed') : t('workbench.home.feed.emptyHint')}
          action={feed.error ? { label: t('workbench.home.feed.retry'), onClick: feed.retry } : undefined}
        />
      ) : (
        <>
          {feed.error ? (
            <div className="flex items-center justify-between gap-2 px-1.5 py-1 text-xs text-destructive" role="status">
              <span className="min-w-0">{t('workbench.home.feed.refreshFailed')}</span>
              <WidgetButton onClick={feed.retry} title={t('workbench.home.feed.retry')} disabled={feed.refreshing}>
                <RotateCcw className="icon-status" />
                {t('workbench.home.feed.retry')}
              </WidgetButton>
            </div>
          ) : null}
          {latest[0] ? (
            <button type="button" onClick={() => navigate(routes.view.feed(latest[0]!.id))} data-home-feed-highlight={latest[0].id} className="rox-home-tile mb-1 flex w-full min-w-0 flex-col gap-0.5 rounded-[var(--radius-card)] px-2.5 py-2 text-left">
              <span className="flex min-w-0 items-center gap-1.5 text-xs uppercase caps-label text-muted-foreground">
                {latest[0].tab === 'agents' ? <Bot className="icon-caption" /> : <Rss className="icon-caption" />}
                <span className="truncate">{t('workbench.home.feed.highlight')} · {fmt.ago(latest[0].at, now)}</span>
              </span>
              <span className="line-clamp-2 text-base font-bold text-foreground">{latest[0].title || latest[0].summary || latest[0].id}</span>
              {latest[0].title && latest[0].summary ? <span className="line-clamp-2 text-sm text-muted-foreground">{latest[0].summary}</span> : null}
            </button>
          ) : null}
          <WidgetList columns={widgetContentLayout(width).listColumns}>
            {latest.slice(1).map((item) => (
              <WidgetRow
                key={item.id}
                testId={item.id}
                onClick={() => navigate(routes.view.feed(item.id))}
                leading={item.status === 'error' ? <Dot tone="danger" /> : item.status === 'running' ? <Dot tone="accent" /> : item.tab === 'agents' ? <Bot className="icon-caption" /> : <Rss className="icon-caption" />}
                title={item.title || item.summary || item.id}
                trailing={fmt.ago(item.at, now)}
              />
            ))}
          </WidgetList>
        </>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Заметки
// ---------------------------------------------------------------------------

function useNotes(workspaceId: string | null): { available: boolean; loaded: boolean; notes: NoteSummary[] } {
  // PERF-09: shares the Notes page's cached list (paint at once, then revalidate).
  const [state, setState] = useState<{ available: boolean; loaded: boolean; notes: NoteSummary[] }>(() => {
    const cached = cachedNotesList(workspaceId)
    return cached ? { available: true, loaded: true, notes: cached } : { available: true, loaded: false, notes: [] }
  })
  useEffect(() => {
    const api = window.electronAPI
    if (!workspaceId || typeof api?.listNotes !== 'function') {
      setState({ available: false, loaded: true, notes: [] })
      return
    }
    let cancelled = false
    let fresh = false
    // The disk restore is async: paint the hydrated list until the first fresh read.
    const offHydration = subscribeCachedNotesList(workspaceId, (notes) => {
      if (!cancelled && !fresh) setState({ available: true, loaded: true, notes })
    })
    // Mount: joinable and skipped inside the SWR window; change events read fresh.
    const load = (mount = false) => fetchNotesList(workspaceId, () => api.listNotes(workspaceId), { mount }).then(
      (notes) => { fresh = true; if (!cancelled) setState({ available: true, loaded: true, notes: Array.isArray(notes) ? notes : [] }) },
      () => { if (!cancelled) setState({ available: false, loaded: true, notes: [] }) },
    )
    void load(true)
    const off = typeof api.onNotesChanged === 'function' ? api.onNotesChanged(() => { void load() }) : undefined
    return () => { cancelled = true; offHydration(); off?.() }
  }, [workspaceId])
  return state
}

function NotePreview({ workspaceId, noteId }: { workspaceId: string; noteId: string }) {
  const { t } = useTranslation()
  const [doc, setDoc] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ok'; content: string; revision?: string }>({ status: 'loading' })
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const load = useCallback(() => {
    const api = window.electronAPI
    if (typeof api?.readNote !== 'function') { setDoc({ status: 'error' }); return }
    api.readNote(workspaceId, noteId).then((note) => setDoc({ status: 'ok', content: note.content, revision: note.revision }), () => setDoc({ status: 'error' }))
  }, [workspaceId, noteId])
  useEffect(() => { load() }, [load])
  const append = async () => {
    const line = draft.trim()
    const api = window.electronAPI
    if (!line || doc.status !== 'ok' || typeof api?.saveNote !== 'function') return
    setSaving(true)
    setSaveError(false)
    try {
      // Expected revision: a concurrent edit fails instead of being overwritten.
      const next = `${doc.content.replace(/\s*$/, '')}\n\n${line}\n`
      const saved = await api.saveNote(workspaceId, noteId, next, doc.revision)
      setDoc({ status: 'ok', content: saved.content, revision: saved.revision })
      setDraft('')
    } catch {
      setSaveError(true)
      load()
    } finally {
      setSaving(false)
    }
  }
  if (doc.status === 'loading') return <p className="px-1.5 py-1 text-sm text-muted-foreground">…</p>
  if (doc.status === 'error') return <p className="px-1.5 py-1 text-sm text-muted-foreground">{t('workbench.home.notes.previewFailed')}</p>
  const text = doc.content.replace(/^---[\s\S]*?---\s*/, '').trim()
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-control)] bg-surface-hover/60 p-1.5" data-home-note-preview={noteId}>
      <p className="line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{text || t('workbench.home.notes.emptyNote')}</p>
      <form className="flex min-w-0 items-center gap-1" onSubmit={(event) => { event.preventDefault(); void append() }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} disabled={saving} placeholder={t('workbench.home.notes.appendPlaceholder')} aria-label={t('workbench.home.notes.append')} className="min-w-0 flex-1 rounded-[var(--radius-control)] bg-background px-1.5 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent" />
        <WidgetButton onClick={() => void append()} disabled={saving || !draft.trim()}>{t('workbench.home.notes.append')}</WidgetButton>
      </form>
      {saveError ? <p className="text-xs text-destructive" role="alert">{t('workbench.home.notes.appendFailed')}</p> : null}
    </div>
  )
}

function NotesWidget({ edit, width, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const titleKey = useNotesTitleKey('workbench.home.w.notes')
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const state = useNotes(workspace?.id ?? null)
  const shown = useMemo(() => recentByUpdated(state.notes, widgetItemLimit(size, 5, widgetContentLayout(width).listColumns)), [state.notes, width, size])
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <WidgetFrame testId="notes" title={t(titleKey)} onOpen={() => navigate(routes.view.notes())} edit={edit}>
      {!state.available ? (
        <WidgetEmpty text={t('workbench.home.notes.unavailable')} />
      ) : state.loaded && shown.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.notes.empty')} action={{ label: t('workbench.home.quick.newNote'), onClick: () => navigate(routes.view.notes()) }} />
      ) : (
        <ul className="flex min-w-0 flex-col">
          {shown.map((note) => (
            <li key={note.id} className="min-w-0" data-home-row={note.id}>
              <div className="flex min-w-0 items-center gap-1">
                <button type="button" onClick={() => navigate(routes.view.notes(note.id))} className="rox-home-row flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-1 text-left">
                  <FileText className="icon-caption shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-base text-foreground">{note.title || t('notes.untitled')}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">{fmt.ago(note.updatedAt, now)}</span>
                </button>
                {workspace?.id ? (
                  <button type="button" onClick={() => setExpanded((cur) => (cur === note.id ? null : note.id))} aria-expanded={expanded === note.id} aria-label={t('workbench.home.notes.preview', { name: note.title || t('notes.untitled') })} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover hover:text-foreground">
                    <ChevronLeft className={cn('icon-status transition-transform motion-reduce:transition-none', expanded === note.id ? '-rotate-90' : 'rotate-180')} />
                  </button>
                ) : null}
              </div>
              {expanded === note.id && workspace?.id ? <NotePreview workspaceId={workspace.id} noteId={note.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Решения
// ---------------------------------------------------------------------------

function DecisionsWidget({ edit, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const workspace = useActiveWorkspace()
  const data = useWorkspaceStore(DECISIONS_NS, workspace?.id ?? null, loadDecisions)
  const recent = useMemo(() => data.decisions.filter((d) => d.status === 'accepted').sort((a, b) => b.decidedAt - a.decidedAt).slice(0, rowsFor(size, 4)), [data.decisions, size])
  const open = (id?: string) => navigate(routes.view.screen('decisions', id))
  return (
    <WidgetFrame
      testId="decisions"
      title={t('workbench.home.w.decisions')}
      onOpen={() => open()}
      edit={edit}
      meta={data.candidates.length ? t('workbench.home.decisions.candidates', { count: data.candidates.length }) : undefined}
    >
      {recent.length === 0 ? (
        <WidgetEmpty
          text={t('workbench.home.decisions.empty')}
          hint={data.candidates.length ? t('workbench.home.decisions.reviewHint') : t('workbench.home.decisions.emptyHint')}
          action={{ label: t('workbench.home.decisions.open'), onClick: () => open() }}
        />
      ) : (
        <WidgetList>
          {recent.map((d) => (
            <WidgetRow key={d.id} testId={d.id} onClick={() => open(d.id)} leading={<Gavel className="icon-caption" />} title={d.title} sub={d.why || undefined} trailing={fmt.ago(d.decidedAt, now)} />
          ))}
        </WidgetList>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Радар
// ---------------------------------------------------------------------------

function RadarWidget({ edit, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const workspace = useActiveWorkspace()
  const data = useWorkspaceStore(RADAR_NS, workspace?.id ?? null, loadRadar)
  const signals = useMemo(() => radarSignals(data, rowsFor(size, 4)), [data, size])
  const open = () => navigate(routes.view.screen('radar'))
  const bucketTone = (bucket: string) => (bucket === 'reaction' ? 'warning' : bucket === 'important' ? 'accent' : 'muted') as 'warning' | 'accent' | 'muted'
  return (
    <WidgetFrame
      testId="radar"
      title={t('workbench.home.w.radar')}
      onOpen={open}
      edit={edit}
      meta={signals.sweptAt ? fmt.ago(signals.sweptAt, now) : undefined}
    >
      {signals.topics === 0 ? (
        <WidgetEmpty text={t('workbench.home.radar.noTopics')} hint={t('workbench.home.radar.noTopicsHint')} action={{ label: t('workbench.home.radar.setup'), onClick: open }} />
      ) : signals.items.length === 0 ? (
        <WidgetEmpty text={signals.running ? t('workbench.home.radar.running') : t('workbench.home.radar.empty')} hint={t('workbench.home.radar.topics', { count: signals.topics })} />
      ) : (
        <WidgetList>
          {signals.items.map((item) => (
            <WidgetRow key={item.id} testId={item.id} onClick={open} leading={<Dot tone={bucketTone(item.bucket)} />} title={item.title} sub={item.source} />
          ))}
        </WidgetList>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Трекер задач
// ---------------------------------------------------------------------------

function TaskTrackerWidget({ edit, width }: WidgetProps) {
  const { t } = useTranslation()
  const now = useNow(60_000)
  const tasks = usePersonalTasks()
  const stats = useMemo(() => taskTrackerStats(tasks, now), [tasks, now])
  const open = () => navigate(routes.view.tasks())
  const listTone: Record<string, string> = { inbox: 'bg-foreground/45', today: 'bg-accent', upcoming: 'bg-foreground/70', anytime: 'bg-foreground/30', someday: 'bg-foreground/15' }
  const total = Math.max(1, stats.open)
  return (
    <WidgetFrame testId="taskTracker" title={t('workbench.home.w.taskTracker')} onOpen={open} edit={edit} meta={stats.doneToday ? t('workbench.home.taskTracker.doneToday', { count: stats.doneToday }) : undefined}>
      <div className="flex h-full min-h-0 flex-col">
        <div className={cn('grid gap-1', widgetContentLayout(width).trackerColumns === 4 ? 'grid-cols-4' : 'grid-cols-2')}>
          <WidgetStat label={t('workbench.home.taskTracker.open')} value={stats.open} onClick={open} />
          <WidgetStat label={t('workbench.home.taskTracker.overdue')} value={stats.overdue} tone={stats.overdue ? 'danger' : undefined} onClick={open} />
          <WidgetStat label={t('workbench.home.taskTracker.today')} value={stats.today} tone={stats.today ? 'accent' : undefined} onClick={open} />
          <WidgetStat label={t('workbench.home.taskTracker.doneWeek')} value={stats.doneWeek} />
        </div>
        {stats.open > 0 ? (
          <div className="mt-1 px-1.5">
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]" role="img" aria-label={t('workbench.home.taskTracker.byStatus')}>
              {TASK_LISTS.filter((l) => stats.byList[l] > 0).map((l) => (
                <span key={l} className={listTone[l]} style={{ width: `${(stats.byList[l] / total) * 100}%` }} />
              ))}
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
              {TASK_LISTS.filter((l) => stats.byList[l] > 0).map((l) => (
                <li key={l} className="flex items-center gap-1">
                  <span className={cn('inline-block h-2 w-2 rounded-full', listTone[l])} aria-hidden="true" />
                  <span>{t(`tasks.projection.${l}`)}</span>
                  <span className="font-bold numeric text-foreground">{stats.byList[l]}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-1 px-1.5 text-sm text-muted-foreground">{t('workbench.home.tasks.emptyHint')}</p>
        )}
        <span className="flex-1" />
        <QuickTaskInput disabled={Boolean(edit)} onCreate={(title, previousAttempt) => createPersonalTaskConfirmed({ title, list: 'inbox' }, previousAttempt)} />
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Трекер входящих
// ---------------------------------------------------------------------------

function InboxTrackerWidget({ edit, width, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const { counts, loaded } = useInboxItems({ withRemote: true })
  const kinds = ALL_KINDS.filter((k) => counts.byKind[k] > 0)
  const open = () => navigate(routes.view.inbox())
  const max = Math.max(1, ...kinds.map((k) => counts.byKind[k]))
  return (
    <WidgetFrame testId="inboxTracker" title={t('workbench.home.w.inboxTracker')} onOpen={open} edit={edit} meta={counts.snoozed ? t('workbench.home.inboxTracker.snoozed', { count: counts.snoozed }) : undefined}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid grid-cols-3 gap-1">
          <WidgetStat label={t('workbench.home.inboxTracker.decisions')} value={counts.decisions} tone={counts.decisions ? 'warning' : undefined} onClick={open} />
          <WidgetStat label={t('workbench.home.inboxTracker.blocking')} value={counts.blocking} tone={counts.blocking ? 'danger' : undefined} onClick={open} />
          <WidgetStat label={t('workbench.home.inboxTracker.messages')} value={counts.messages} onClick={open} />
        </div>
        <SectionLabel>{t('workbench.home.inboxTracker.byType')}</SectionLabel>
        {kinds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{loaded ? t('workbench.home.inbox.empty') : '…'}</p>
        ) : (
          <ul className={cn('min-w-0', widgetContentLayout(width).listColumns === 2 ? 'grid grid-cols-2 gap-x-4' : 'flex flex-col')}>
            {kinds.slice(0, widgetItemLimit(size, 4, widgetContentLayout(width).listColumns)).map((k) => (
              <li key={k} className="min-w-0" data-home-row={`kind-${k}`}>
                <button type="button" onClick={open} className="rox-home-row flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-1 text-left">
                  <span className="w-[42%] min-w-0 shrink-0 truncate text-base text-foreground">{t(`inbox.kind.${k}`)}</span>
                  <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                    <span className={cn('rounded-full', k === 'error' ? 'bg-destructive' : (['permission', 'credential', 'plan', 'memory', 'skill', 'sender'] as string[]).includes(k) ? 'bg-[var(--warning,#d9a13b)]' : 'bg-foreground/50')} style={{ width: `${(counts.byKind[k] / max) * 100}%` }} />
                  </span>
                  <span className="w-6 shrink-0 text-right text-sm font-bold numeric text-foreground">{counts.byKind[k]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Календарь на неделю
// ---------------------------------------------------------------------------

const CALENDAR_ICON: Record<CalendarEventKind, React.ComponentType<{ className?: string }>> = {
  meeting: CalendarClock,
  task: ListTodo,
  automation: Workflow,
  note: FileText,
}

function CalendarWidget({ edit, width, size = 'S' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const { meetings } = useLocalMeetings(workspaceId)
  const tasks = usePersonalTasks()
  const automations = useAutomationsData(workspaceId)
  const notes = useNotes(workspaceId)
  const days = useMemo(() => {
    const first = startOfLocalDay(now)
    const until = new Date(first)
    until.setDate(until.getDate() + 7)
    return buildWeekCalendar({
      meetings,
      tasks,
      automationRuns: cronRunsUntil(automations.items, until.getTime()),
      notes: notes.notes.map((n) => ({ id: n.id, title: n.title || t('notes.untitled'), createdAt: n.createdAt })),
    }, now)
  }, [meetings, tasks, automations.items, notes.notes, now, t])
  const openEvent = (kind: CalendarEventKind, id: string) => {
    if (kind === 'meeting') navigate(routes.view.meetings(id))
    else if (kind === 'task') navigate(routes.view.tasks(id))
    else if (kind === 'automation') navigate(routes.view.automations({ automationId: id.split('@')[0] }))
    else navigate(routes.view.notes(id))
  }
  const total = days.reduce((sum, d) => sum + d.events.length, 0)
  const wide = widgetContentLayout(width).calendarView === 'week'
  const perDay = widgetItemLimit(size, 3)
  const today = startOfLocalDay(now)
  return (
    <WidgetFrame testId="calendar" title={t('workbench.home.w.calendar')} onOpen={() => navigate(routes.view.meetings())} edit={edit} meta={t('workbench.home.calendar.events', { count: total })}>
      <div className="flex h-full min-h-0 flex-col">
        {wide ? (
          <div className="grid min-h-0 flex-1 gap-1" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }} data-home-calendar="week">
            {days.map((day) => {
              const isToday = day.start === today
              const shown = day.events.slice(0, perDay)
              return (
                <div key={day.start} className={cn('flex min-h-0 min-w-0 flex-col rounded-[var(--radius-card)] px-1 py-1', isToday ? 'bg-foreground/[0.08]' : 'bg-surface-hover')} data-home-day={isToday ? 'today' : ''}>
                  <div className="flex items-baseline gap-1 px-0.5">
                    <span className={cn('text-xs uppercase caps-label', isToday ? 'font-bold text-foreground' : 'text-muted-foreground')}>{fmt.weekday(day.start)}</span>
                    <span className={cn('truncate text-sm numeric', isToday ? 'font-bold text-accent' : 'text-muted-foreground')}>{fmt.dayMonth(day.start)}</span>
                  </div>
                  <ul className="mt-0.5 flex min-h-0 flex-col gap-px">
                    {shown.map((e) => {
                      const Icon = CALENDAR_ICON[e.kind]
                      return (
                        <li key={`${e.kind}-${e.id}`} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => openEvent(e.kind, e.id)}
                            title={`${t(`workbench.home.calendar.kind.${e.kind}`)} · ${e.title}`}
                            className="rox-home-row flex w-full min-w-0 items-center gap-1 rounded-[var(--radius-control)] px-0.5 text-left text-sm"
                          >
                            <Icon className={cn('h-3 w-3 shrink-0', e.overdue ? 'text-destructive' : 'text-muted-foreground')} />
                            {e.kind !== 'task' && e.kind !== 'note' ? <span className="shrink-0 numeric text-muted-foreground">{fmt.time(e.at)}</span> : null}
                            <span className={cn('min-w-0 flex-1 truncate', e.overdue ? 'text-destructive' : 'text-foreground')} title={e.title}>{e.title}</span>
                          </button>
                        </li>
                      )
                    })}
                    {day.events.length > shown.length ? <li className="px-0.5 text-xs text-muted-foreground">{t('workbench.home.calendar.more', { count: day.events.length - shown.length })}</li> : null}
                  </ul>
                </div>
              )
            })}
          </div>
        ) : (
          <ul className="flex flex-col" data-home-calendar="list">
            {days.map((day) => {
              const isToday = day.start === today
              const shown = day.events.slice(0, widgetRowSpan(size) - 1)
              return (
                <li key={day.start} className="min-w-0 shrink-0">
                  {shown.length === 0 ? (
                    <div className="flex items-center gap-2 px-1.5 py-0.5 text-sm text-muted-foreground">
                      <span className={cn('w-12 shrink-0 uppercase', isToday && 'font-bold text-accent')}>{fmt.weekday(day.start)} {new Date(day.start).getDate()}</span>
                      <span>—</span>
                    </div>
                  ) : shown.map((event, index) => {
                    const Icon = CALENDAR_ICON[event.kind]
                    return (
                      <button
                        key={`${event.kind}-${event.id}`}
                        type="button"
                        onClick={() => openEvent(event.kind, event.id)}
                        title={`${t(`workbench.home.calendar.kind.${event.kind}`)} · ${event.title}`}
                        data-home-row={`calendar-${event.kind}-${event.id}`}
                        className="rox-home-row flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-0.5 text-left"
                      >
                        <span className={cn('w-12 shrink-0 text-sm uppercase', isToday ? 'font-bold text-accent' : 'text-muted-foreground')}>
                          {index === 0 ? `${fmt.weekday(day.start)} ${new Date(day.start).getDate()}` : null}
                        </span>
                        <Icon className={cn('h-3 w-3 shrink-0', event.overdue ? 'text-destructive' : 'text-muted-foreground')} />
                        <span className={cn('min-w-0 flex-1 truncate text-sm', event.overdue ? 'text-destructive' : 'text-foreground')} title={event.title}>{event.title}</span>
                        {index === 0 && day.events.length > shown.length ? <span className="shrink-0 text-xs numeric text-muted-foreground">+{day.events.length - shown.length}</span> : null}
                      </button>
                    )
                  })}
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-auto shrink-0 truncate pt-1 text-xs text-muted-foreground" title={t('workbench.home.calendar.external')} data-home-calendar-note="">
          {t('workbench.home.calendar.external')}
        </p>
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Сегодня (hero)
// ---------------------------------------------------------------------------

const HERO_CHIP = 'rox-home-chip flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-foreground disabled:opacity-60'

function HeroWidget({ edit }: WidgetProps) {
  const { t, i18n } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const { active } = useHomeSessions()
  const connection = useTransportConnectionState()
  const taskCount = useWorkspaceTaskCount(workspace?.id)
  const { counts } = useInboxItems({ withRemote: false })
  const setOmniboxOpen = useSetAtom(omniboxOpenAtom)
  const rec = useRecordAction()
  const snap = useMemo(() => buildMiniDashboard({ sessions: active, tasks: taskCount, connection }), [active, taskCount, connection])
  const [prompt, setPrompt] = useState('')
  const { all } = useHomeSessions()
  const { llmConnections, workspaceDefaultLlmConnection, runtimeSummary } = useAppShellContext()
  // Sending is immediate (intended): say which model answers and what a session usually costs.
  const modelName = runtimeSummary?.defaultModel
    ? runtimeSummary.models?.find((model) => model.id === runtimeSummary.defaultModel)?.name ?? runtimeSummary.defaultModel
    : llmConnections.find((c) => c.slug === workspaceDefaultLlmConnection)?.defaultModel ?? null
  const typicalCost = useMemo(() => averageSessionCost(all, startOfLocalDay(now) - 6 * 86_400_000), [all, now])
  const locale = i18n.resolvedLanguage || i18n.language || 'ru'
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(now), [locale, now])
  const waiting = counts.decisions + counts.blocking
  const ask = () => {
    const input = prompt.trim()
    if (!input) return
    navigate(routes.action.newSession({ input, send: true }))
    setPrompt('')
  }
  const stats: { key: string; label: string; onClick: () => void; tone?: 'accent' | 'warning' }[] = [
    { key: 'agents', label: t('workbench.home.hero.agents', { count: snap.activeAgents }), onClick: () => navigate(routes.view.screen('agents')), tone: snap.activeAgents > 0 ? 'accent' : undefined },
    ...(snap.tasks == null ? [] : [{ key: 'tasks', label: t('workbench.home.hero.tasks', { count: snap.tasks }), onClick: () => navigate(routes.view.tasks()) }]),
    { key: 'inbox', label: t('workbench.home.hero.inbox', { count: waiting }), onClick: () => navigate(routes.view.inbox()), tone: waiting > 0 ? 'warning' as const : undefined },
  ]
  return (
    <WidgetFrame testId="hero" title={t('workbench.home.w.hero')} edit={edit} meta={`${date} · ${fmt.time(now)}`}>
      <div className="relative flex h-full min-h-0 flex-col gap-3">
        <div className="min-w-0">
          <p className="truncate text-display font-bold text-foreground" data-home-greeting={greetingPart(now)}>{t(`workbench.home.hero.greeting.${greetingPart(now)}`)}</p>
          <ul className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1">
            {stats.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={s.onClick} data-home-hero-stat={s.key} className="flex items-center gap-1.5 rounded-[var(--radius-control)] text-base text-muted-foreground hover:text-foreground">
                  <Dot tone={s.tone ?? 'muted'} />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <form
          className="rox-home-ask flex min-w-0 items-center gap-2 rounded-[var(--radius-card)] py-1.5 pl-3 pr-1.5"
          onSubmit={(event) => { event.preventDefault(); ask() }}
        >
          <Sparkles className="icon-toolbar shrink-0 text-accent" aria-hidden="true" />
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t('workbench.home.hero.placeholder')}
            aria-label={t('workbench.home.hero.ask')}
            data-home-hero-input=""
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!prompt.trim()}
            aria-label={t('workbench.home.hero.send')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-40"
          >
            <ArrowUp className="icon-status" />
          </button>
        </form>
        <p className="-mt-2 truncate px-1 text-xs text-muted-foreground" data-home-hero-estimate="">
          {t('workbench.home.hero.model', { model: modelName ?? t('workbench.home.models.defaultModel') })}
          {' · '}
          {typicalCost != null ? t('workbench.home.hero.estimate', { cost: formatUsd(typicalCost) }) : t('workbench.home.hero.noEstimate')}
        </p>
        <span className="flex-1" />
        <div className="flex min-w-0 flex-wrap gap-2">
          <button type="button" className={HERO_CHIP} onClick={() => navigate(routes.action.newSession())}><SquarePen className="icon-status" />{t('workbench.home.quick.newSession')}</button>
          <button type="button" className={HERO_CHIP} disabled={rec.busy} onClick={() => void rec.record()}>
            <Mic className={cn('icon-status', rec.recording && 'text-destructive')} />
            {rec.recording ? t('workbench.home.quick.recording') : t('workbench.home.quick.record')}
          </button>
          <button type="button" className={HERO_CHIP} onClick={() => setOmniboxOpen(true)}><Search className="icon-status" />{t('workbench.home.quick.search')}<span className="text-xs text-muted-foreground">{formatHotkeyDisplay('mod+k')}</span></button>
        </div>
        {rec.error ? <p className="truncate text-sm text-destructive" role="alert">{rec.error}</p> : null}
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Активность (heatmap)
// ---------------------------------------------------------------------------

const HEAT_CLASS = ['bg-surface-hover', 'bg-accent/25', 'bg-accent/50', 'bg-accent/75', 'bg-accent'] as const

function ActivityWidget({ edit, width, size = 'M' }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const { all } = useHomeSessions()
  // ~14 px per week column, capped so tall/wide cards show more history.
  const weeks = Math.max(6, Math.min(size === 'S' ? 8 : 26, Math.floor((width - 24) / 18)))
  const heat = useMemo(() => buildActivityHeatmap(all, now, weeks), [all, now, weeks])
  const open = () => navigate(routes.view.allSessions())
  const weekdayName = (index: number) => fmt.weekday(heat.weeks[heat.weeks.length - 1]![0]!.start + index * 86_400_000 + 3_600_000)
  return (
    <WidgetFrame testId="activity" title={t('workbench.home.w.activity')} onOpen={open} edit={edit} meta={t('workbench.home.activity.window', { count: weeks })}>
      {heat.total === 0 ? (
        <WidgetEmpty text={t('workbench.home.activity.empty')} hint={t('workbench.home.activity.emptyHint')} />
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className="grid min-h-0 flex-1 grid-flow-col grid-rows-7 gap-0.5" role="group" aria-label={t('workbench.home.activity.chart')} data-home-heatmap={weeks}>
            {heat.weeks.flatMap((column, w) =>
              column.map((day, d) =>
                day ? (
                  <span
                    key={day.start}
                    role="img"
                    title={t('workbench.home.activity.cell', { date: fmt.dayMonth(day.start), count: day.sessions, tokens: formatTokens(day.tokens) })}
                    aria-label={t('workbench.home.activity.cell', { date: fmt.dayMonth(day.start), count: day.sessions, tokens: formatTokens(day.tokens) })}
                    data-home-heat={heatLevel(day.sessions, heat.max)}
                    className={cn('min-h-1 rounded-[var(--radius-control)] transition-transform hover:scale-125 motion-reduce:transition-none', HEAT_CLASS[heatLevel(day.sessions, heat.max)])}
                  />
                ) : (
                  <span key={`f-${w}-${d}`} aria-hidden="true" />
                ),
              ),
            )}
          </div>
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
            <span><b className="numeric text-foreground">{heat.total}</b> {t('workbench.home.activity.total')}</span>
            <span data-home-streak={heat.streak}><b className="numeric text-foreground">{heat.streak}</b> {t('workbench.home.activity.streak')}</span>
            {heat.bestWeekday !== null ? <span>{t('workbench.home.activity.best', { day: weekdayName(heat.bestWeekday) })}</span> : null}
          </div>
        </div>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface HomeWidgetDef {
  id: HomeWidgetId
  titleKey: string
  descriptionKey: string
  icon: React.ComponentType<{ className?: string }>
  Component: React.ComponentType<WidgetProps>
}

export const HOME_WIDGETS: Record<HomeWidgetId, HomeWidgetDef> = {
  summary: { id: 'summary', titleKey: 'workbench.home.w.summary', descriptionKey: 'workbench.home.d.summary', icon: LayoutGrid, Component: SummaryWidget },
  quickActions: { id: 'quickActions', titleKey: 'workbench.home.w.quickActions', descriptionKey: 'workbench.home.d.quickActions', icon: SquarePen, Component: QuickActionsWidget },
  recentSessions: { id: 'recentSessions', titleKey: 'workbench.home.recent', descriptionKey: 'workbench.home.d.recentSessions', icon: MessageSquare, Component: RecentSessionsWidget },
  agents: { id: 'agents', titleKey: 'workbench.home.w.agents', descriptionKey: 'workbench.home.d.agents', icon: Bot, Component: AgentsWidget },
  inbox: { id: 'inbox', titleKey: 'workbench.home.w.inbox', descriptionKey: 'workbench.home.d.inbox', icon: InboxIcon, Component: InboxWidget },
  usage: { id: 'usage', titleKey: 'workbench.home.w.usage', descriptionKey: 'workbench.home.d.usage', icon: Coins, Component: UsageWidget },
  models: { id: 'models', titleKey: 'workbench.home.w.models', descriptionKey: 'workbench.home.d.models', icon: Cpu, Component: ModelsWidget },
  balance: { id: 'balance', titleKey: 'workbench.home.w.balance', descriptionKey: 'workbench.home.d.balance', icon: Wallet, Component: BalanceWidget },
  tasks: { id: 'tasks', titleKey: 'workbench.home.w.tasks', descriptionKey: 'workbench.home.d.tasks', icon: ListTodo, Component: TasksWidget },
  meetings: { id: 'meetings', titleKey: 'workbench.home.w.meetings', descriptionKey: 'workbench.home.d.meetings', icon: CalendarClock, Component: MeetingsWidget },
  focus: { id: 'focus', titleKey: 'workbench.home.w.focus', descriptionKey: 'workbench.home.d.focus', icon: Timer, Component: FocusWidget },
  automations: { id: 'automations', titleKey: 'workbench.home.w.automations', descriptionKey: 'workbench.home.d.automations', icon: Workflow, Component: AutomationsWidget },
  feed: { id: 'feed', titleKey: 'workbench.home.w.feed', descriptionKey: 'workbench.home.d.feed', icon: Rss, Component: FeedWidget },
  notes: { id: 'notes', titleKey: 'workbench.home.w.notes', descriptionKey: 'workbench.home.d.notes', icon: NotebookPen, Component: NotesWidget },
  decisions: { id: 'decisions', titleKey: 'workbench.home.w.decisions', descriptionKey: 'workbench.home.d.decisions', icon: Gavel, Component: DecisionsWidget },
  radar: { id: 'radar', titleKey: 'workbench.home.w.radar', descriptionKey: 'workbench.home.d.radar', icon: RadarIcon, Component: RadarWidget },
  taskTracker: { id: 'taskTracker', titleKey: 'workbench.home.w.taskTracker', descriptionKey: 'workbench.home.d.taskTracker', icon: ListChecks, Component: TaskTrackerWidget },
  inboxTracker: { id: 'inboxTracker', titleKey: 'workbench.home.w.inboxTracker', descriptionKey: 'workbench.home.d.inboxTracker', icon: BellDot, Component: InboxTrackerWidget },
  calls: { id: 'calls', titleKey: 'workbench.home.w.calls', descriptionKey: 'workbench.home.d.calls', icon: Phone, Component: CallsWidget },
  hero: { id: 'hero', titleKey: 'workbench.home.w.hero', descriptionKey: 'workbench.home.d.hero', icon: Sparkles, Component: HeroWidget },
  activity: { id: 'activity', titleKey: 'workbench.home.w.activity', descriptionKey: 'workbench.home.d.activity', icon: ActivityIcon, Component: ActivityWidget },
  calendar: { id: 'calendar', titleKey: 'workbench.home.w.calendar', descriptionKey: 'workbench.home.d.calendar', icon: CalendarDays, Component: CalendarWidget },
}
