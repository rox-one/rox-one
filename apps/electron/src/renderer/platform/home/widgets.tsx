/**
 * Главная widgets. Every widget reads REAL data through stores/IPC that the
 * app already has and clicks through to its own screen. No fake data: when a
 * source is unavailable or empty the widget says so and why.
 */
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Cron } from 'croner'
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  Coins,
  Cpu,
  FileText,
  Gavel,
  Inbox as InboxIcon,
  LayoutGrid,
  ListTodo,
  MessageSquare,
  Mic,
  NotebookPen,
  Radar as RadarIcon,
  Rss,
  Search,
  SquarePen,
  Timer,
  Wallet,
  Workflow,
} from 'lucide-react'
import type { LocalMeeting } from '../../../shared/meetings-local'
import type { NoteSummary } from '@craft-agent/shared/protocol'
import { isInternalAgentSession } from '@craft-agent/shared/sessions/internal-prompts'
import { omniboxOpenAtom } from '@/atoms/omnibox'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { parseAutomationsConfig } from '@/components/automations/types'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useInboxItems } from '@/hooks/useInboxItems'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useWorkspaceTaskCount } from '@/hooks/useWorkspaceTaskCount'
import { subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import { useFeedItems, usePersonalTasks } from '@/lib/extra-screens/use-rox-sources'
import { focusMinutesOn, isFocusRunning, loadFocusState, localDay, subscribeFocusState, type FocusState } from '@/lib/focus-session'
import { startRecording, useRecorder } from '@/lib/meetings/recorder'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { buildAgentCenter } from '@/pages/extra-screens/agents/agent-center-model'
import { DECISIONS_NS, loadDecisions } from '@/pages/extra-screens/decisions/decisions-store'
import { RADAR_NS, loadRadar } from '@/pages/extra-screens/radar/radar-store'
import { isActive, sortInbox } from '@/pages/inbox/inbox-model'
import { getSessionTitle } from '@/utils/session'
import { isHomeSessionInWorkspace, pickRecentHomeSessions } from '../home-model'
import { buildMiniDashboard, formatDashboardCost, formatTokenCount, syncStatusLabelKey } from '../mini-dashboard'
import type { HomeWidgetId } from './dashboard-layout'
import {
  buildAutomationsOverview,
  buildMeetingsOverview,
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
import { Dot, SectionLabel, WidgetEmpty, WidgetFrame, WidgetList, WidgetRow, WidgetStat, type WidgetEditProps } from './widget-kit'

export interface WidgetProps {
  edit: WidgetEditProps | null
  /** Resolved column span (1..12) — lets a widget show more when it is wide. */
  span: number
}

// ---------------------------------------------------------------------------
// Shared hooks
// ---------------------------------------------------------------------------

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
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

/** Rows that fit: S/M widgets are short lists, L gets a few more. */
function rowsFor(span: number, base: number): number {
  return span >= 12 ? base + 1 : base
}

// ---------------------------------------------------------------------------
// Сводка
// ---------------------------------------------------------------------------

function SummaryWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const { active } = useHomeSessions()
  const connection = useTransportConnectionState()
  const tasks = useWorkspaceTaskCount(workspace?.id)
  const snap = useMemo(() => buildMiniDashboard({ sessions: active, tasks, connection }), [active, tasks, connection])
  const unknown = t('dashboard.unknown')
  return (
    <WidgetFrame testId="summary" title={t('workbench.home.w.summary')} edit={edit} meta={workspace?.name}>
      <div className={cn('grid gap-x-2 gap-y-1', span >= 12 ? 'grid-cols-6' : span >= 6 ? 'grid-cols-3' : 'grid-cols-2')}>
        <WidgetStat label={t('dashboard.sessions')} value={snap.sessions} onClick={() => navigate(routes.view.allSessions())} />
        <WidgetStat label={t('dashboard.activeAgents')} value={snap.activeAgents} tone={snap.activeAgents > 0 ? 'accent' : undefined} onClick={() => navigate(routes.view.screen('agents'))} />
        <WidgetStat label={t('workbench.home.summary.conductor')} value={snap.tasks == null ? unknown : snap.tasks} onClick={() => navigate(routes.view.tasks())} />
        <WidgetStat label={t('workbench.home.summary.tokens')} value={snap.tokens == null ? unknown : formatTokenCount(snap.tokens)} />
        <WidgetStat label={t('workbench.home.summary.cost')} value={snap.costUsd == null ? unknown : formatDashboardCost(snap.costUsd)} />
        <WidgetStat label={t('dashboard.syncCloud')} value={<span className="text-[15px]">{t(syncStatusLabelKey(snap.sync))}</span>} />
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Быстрые действия
// ---------------------------------------------------------------------------

function QuickActionsWidget({ edit, span }: WidgetProps) {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const setOmniboxOpen = useSetAtom(omniboxOpenAtom)
  const recorder = useRecorder()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const recording = recorder.status !== 'idle' && recorder.meetingId ? recorder.meetingId : null

  const record = async () => {
    if (recording) {
      navigate(routes.view.meetings(recording))
      return
    }
    setBusy('record')
    setError(null)
    const locale = i18n.resolvedLanguage || 'ru'
    const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(Date.now())
    try {
      const result = await startRecording({ title: t('meetings.local.defaultTitle', { date }), workspaceId: workspace?.id ?? null })
      if (result.ok) navigate(routes.view.meetings(result.meeting.id))
      else setError(t('workbench.home.quick.recordFailed', { code: result.code }))
    } finally {
      setBusy(null)
    }
  }

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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const actions: { key: string; label: string; icon: React.ReactNode; onClick: () => void; hint?: string }[] = [
    { key: 'session', label: t('workbench.home.quick.newSession'), icon: <SquarePen className="h-4 w-4" />, onClick: () => navigate(routes.action.newSession()) },
    {
      key: 'record',
      label: recording ? t('workbench.home.quick.recording') : t('workbench.home.quick.record'),
      icon: <Mic className={cn('h-4 w-4', recording && 'text-destructive')} />,
      onClick: () => void record(),
    },
    { key: 'note', label: t('workbench.home.quick.newNote'), icon: <NotebookPen className="h-4 w-4" />, onClick: () => void newNote() },
    { key: 'search', label: t('workbench.home.quick.search'), icon: <Search className="h-4 w-4" />, onClick: () => setOmniboxOpen(true), hint: '⌘K' },
  ]
  return (
    <WidgetFrame testId="quickActions" title={t('workbench.home.w.quickActions')} edit={edit}>
      <div className={cn('grid h-full gap-2 pb-5', span >= 12 ? 'grid-cols-4' : 'grid-cols-2')}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={busy === a.key}
            onClick={a.onClick}
            data-home-action={a.key}
            className="rox-home-tile flex min-w-0 flex-col items-start justify-between gap-1 rounded-[8px] px-3 py-2 text-left disabled:opacity-60"
          >
            <span className="text-foreground">{a.icon}</span>
            <span className="flex w-full min-w-0 items-baseline gap-1">
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-foreground">{a.label}</span>
              {a.hint ? <span className="shrink-0 text-[11px] text-muted-foreground">{a.hint}</span> : null}
            </span>
          </button>
        ))}
      </div>
      {error ? <p className="absolute inset-x-0 bottom-0 truncate text-[12px] text-destructive" role="alert">{error}</p> : null}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Недавние сессии
// ---------------------------------------------------------------------------

function RecentSessionsWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const { active } = useHomeSessions()
  const recent = useMemo(() => pickRecentHomeSessions(active, span >= 12 ? 14 : 7), [active, span])
  return (
    <WidgetFrame testId="recentSessions" title={t('workbench.home.recent')} onOpen={() => navigate(routes.view.allSessions())} edit={edit} meta={active.length ? String(active.length) : undefined}>
      {recent.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.emptySessions')} hint={t('workbench.home.recentEmptyHint')} action={{ label: t('workbench.home.quick.newSession'), onClick: () => navigate(routes.action.newSession()) }} />
      ) : (
        <WidgetList columns={span >= 12 ? 2 : 1}>
          {recent.map((s) => (
            <WidgetRow
              key={s.id}
              testId={s.id}
              onClick={() => navigate(routes.view.allSessions(s.id))}
              leading={s.isProcessing ? <Dot tone="accent" /> : s.lastMessageRole === 'error' ? <Dot tone="danger" /> : <MessageSquare className="h-3.5 w-3.5" />}
              title={getSessionTitle(s)}
              trailing={s.lastMessageAt || s.createdAt ? fmt.ago(s.lastMessageAt ?? s.createdAt ?? now, now) : undefined}
            />
          ))}
        </WidgetList>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Активные агенты
// ---------------------------------------------------------------------------

function AgentsWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(30_000)
  const { active } = useHomeSessions()
  const { pendingPermissions, pendingCredentials } = useAppShellContext()
  const center = useMemo(() => buildAgentCenter({
    sessions: active.map((s) => ({ id: s.id, name: getSessionTitle(s), isProcessing: s.isProcessing, lastMessageAt: s.lastMessageAt, createdAt: s.createdAt, costUsd: s.tokenUsage?.costUsd })),
    pendingPermissions: new Map([...pendingPermissions].map(([id, list]) => [id, list.length])),
    pendingCredentials: new Map([...pendingCredentials].map(([id, list]) => [id, list.length])),
    cloudRuns: [],
    automations: [],
    now,
    dailyBudgetUsd: null,
  }), [active, pendingPermissions, pendingCredentials, now])
  const rows = [
    ...center.waiting.map((w) => ({ id: w.session.id, name: w.session.name, tone: 'warning' as const, note: t('workbench.home.agents.waitingRow') })),
    ...center.stuck.map((s) => ({ id: s.id, name: s.name, tone: 'danger' as const, note: t('workbench.home.agents.stuckRow') })),
    ...center.running.map((s) => ({ id: s.id, name: s.name, tone: 'accent' as const, note: s.lastMessageAt ? fmt.ago(s.lastMessageAt, now) : '' })),
  ].slice(0, rowsFor(span, 3))
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
          <p className="mt-2 text-[12px] leading-4 text-muted-foreground">{t('workbench.home.agents.idle')}</p>
        ) : (
          <div className="mt-1 min-h-0">
            <WidgetList>
              {rows.map((r) => (
                <WidgetRow key={r.id} testId={r.id} onClick={() => navigate(routes.view.allSessions(r.id))} leading={<Dot tone={r.tone} />} title={r.name} trailing={r.note} />
              ))}
            </WidgetList>
          </div>
        )}
        <span className="flex-1" />
        <p className="truncate text-[12px] text-muted-foreground">{t('workbench.home.agents.costToday', { cost: formatUsd(center.costToday) })}</p>
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Входящие
// ---------------------------------------------------------------------------

function InboxWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const { items, state, counts, now } = useInboxItems({ withRemote: true })
  const pending = useMemo(() => sortInbox(items.filter((i) => isActive(state, i, now))).slice(0, rowsFor(span, 4)), [items, state, now, span])
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
        <WidgetList>
          {pending.map((item) => (
            <WidgetRow
              key={item.id}
              testId={item.id}
              onClick={() => navigate(routes.view.inbox(item.id))}
              leading={item.blocking ? <Dot tone="warning" /> : <InboxIcon className="h-3.5 w-3.5" />}
              title={item.title}
              sub={item.source}
              trailing={fmt.ago(item.at, now)}
            />
          ))}
        </WidgetList>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Расход и токены
// ---------------------------------------------------------------------------

function UsageWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const { all } = useHomeSessions()
  const usage = useMemo(() => buildUsageOverview(all, now, 7), [all, now])
  const models = useMemo(() => usageByModel(all, usage.days[0]!.start).filter((m) => m.tokens > 0).slice(0, 4), [all, usage])
  const max = Math.max(1, ...usage.days.map((d) => d.tokens))
  const wide = span >= 6
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
                    className={cn('w-full max-w-7 rounded-[4px]', d.start === usage.today.start ? 'bg-accent' : 'bg-foreground/30')}
                    style={{ height: d.tokens > 0 ? `${Math.max(6, Math.round((d.tokens / max) * 100))}%` : 2 }}
                  />
                  <span className="text-[11px] leading-3 text-muted-foreground">{fmt.weekday(d.start)}</span>
                </div>
              ))}
            </div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={t('workbench.home.usage.attribution')}>{t('workbench.home.usage.attribution')}</p>
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

function ModelsWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const now = useNow(5 * 60_000)
  const { all } = useHomeSessions()
  const { llmConnections, workspaceDefaultLlmConnection } = useAppShellContext()
  const since = startOfLocalDay(now) - 6 * 86_400_000
  const connections = useMemo(() => connectionUsage(llmConnections, all, since, workspaceDefaultLlmConnection), [llmConnections, all, since, workspaceDefaultLlmConnection])
  const models = useMemo(() => usageByModel(all, since).slice(0, 3), [all, since])
  const names = useMemo(() => new Map(llmConnections.map((c) => [c.slug, c.name])), [llmConnections])
  const defaultSlug = connections.find((c) => c.isDefault)?.slug
  const open = () => navigate(routes.view.settings('ai'))
  return (
    <WidgetFrame testId="models" title={t('workbench.home.w.models')} onOpen={open} edit={edit} meta={t('workbench.home.usage.window')}>
      {connections.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.models.empty')} hint={t('workbench.home.models.emptyHint')} action={{ label: t('workbench.home.models.connect'), onClick: open }} />
      ) : (
        <div className={cn('grid h-full min-h-0 gap-x-4', span >= 6 && models.length > 0 ? 'grid-cols-2' : 'grid-cols-1')}>
          <div className="min-w-0">
            <WidgetList>
              {connections.slice(0, span >= 6 ? 4 : 2).map((c) => (
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
              <WidgetList>
                {models.slice(0, span >= 6 ? 3 : 2).map((m) => (
                  <WidgetRow
                    key={m.model || `@${m.connection}`}
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

type BalanceState = { status: 'loading' } | { status: 'ok'; balance: number } | { status: 'disconnected' } | { status: 'error'; message: string } | { status: 'unavailable' }

function BalanceWidget({ edit }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const { all } = useHomeSessions()
  const usage = useMemo(() => buildUsageOverview(all, now, 7), [all, now])
  const [state, setState] = useState<BalanceState>({ status: 'loading' })
  const load = useCallback(async () => {
    const api = window.electronAPI
    if (typeof api?.getRoxBalance !== 'function') {
      setState({ status: 'unavailable' })
      return
    }
    try {
      setState(await api.getRoxBalance())
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // A server without the balance RPC is «unavailable», not an error.
      setState(/no handler/i.test(message) ? { status: 'unavailable' } : { status: 'error', message })
    }
  }, [])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 5 * 60_000)
    return () => window.clearInterval(timer)
  }, [load])
  const open = () => navigate(routes.view.settings('account'))
  return (
    <WidgetFrame testId="balance" title={t('workbench.home.w.balance')} onOpen={open} edit={edit}>
      <div className="flex h-full min-h-0 flex-col">
        {state.status === 'ok' ? (
          <WidgetStat label={t('workbench.home.balance.credits')} value={<span className="text-[28px] leading-9">{fmt.num(state.balance)}</span>} />
        ) : state.status === 'loading' ? (
          <WidgetStat label={t('workbench.home.balance.credits')} value="…" />
        ) : (
          <div className="min-h-0 flex-1">
            <WidgetEmpty
              text={state.status === 'disconnected' ? t('workbench.home.balance.disconnected') : state.status === 'unavailable' ? t('workbench.home.balance.unavailable') : t('workbench.home.balance.error')}
              hint={state.status === 'disconnected' ? t('workbench.home.balance.disconnectedHint') : state.status === 'error' ? state.message : undefined}
              action={state.status === 'disconnected' ? { label: t('workbench.home.balance.connect'), onClick: open } : undefined}
            />
          </div>
        )}
        <span className="flex-1" />
        {usage.hasData ? (
          <div className="grid grid-cols-2 gap-1">
            <WidgetStat label={t('workbench.home.usage.todayCost')} value={<span className="text-[15px]">{formatUsd(usage.today.costUsd)}</span>} />
            <WidgetStat label={t('workbench.home.usage.weekCost')} value={<span className="text-[15px]">{formatUsd(usage.totalCostUsd)}</span>} />
          </div>
        ) : null}
      </div>
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Задачи
// ---------------------------------------------------------------------------

function TasksWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const tasks = usePersonalTasks()
  const focus = useFocusState()
  const top = useMemo(() => topOpenTasks(tasks, focus.top3, now, span >= 12 ? 10 : 5), [tasks, focus.top3, now, span])
  const dayStart = startOfLocalDay(now)
  return (
    <WidgetFrame
      testId="tasks"
      title={t('workbench.home.w.tasks')}
      onOpen={() => navigate(routes.view.tasks())}
      edit={edit}
      meta={top.open ? t('workbench.home.tasks.open', { count: top.open }) : undefined}
    >
      {top.open === 0 ? (
        <WidgetEmpty text={t('workbench.home.tasks.empty')} hint={t('workbench.home.tasks.emptyHint')} action={{ label: t('workbench.home.tasks.add'), onClick: () => navigate(routes.view.tasks()) }} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {top.overdue > 0 ? <p className="mb-0.5 text-[12px] font-bold text-destructive">{t('workbench.home.tasks.overdue', { count: top.overdue })}</p> : null}
          <WidgetList columns={span >= 12 ? 2 : 1}>
            {top.top.map((task) => (
              <WidgetRow
                key={task.id}
                testId={task.id}
                onClick={() => navigate(routes.view.tasks(task.id))}
                leading={focus.top3.includes(task.id) ? <Dot tone="accent" /> : task.priority === 'high' ? <Dot tone="danger" /> : <ListTodo className="h-3.5 w-3.5" />}
                title={task.title || t('workbench.home.tasks.untitled')}
                trailing={task.dueAt != null ? <span className={cn(task.dueAt < dayStart && 'text-destructive')}>{fmt.when(task.dueAt, now)}</span> : undefined}
              />
            ))}
          </WidgetList>
        </div>
      )}
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

function MeetingsWidget({ edit }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const { available, loaded, meetings } = useLocalMeetings(workspace?.id ?? null)
  const overview = useMemo(() => buildMeetingsOverview(meetings, now), [meetings, now])
  const open = (id?: string) => navigate(routes.view.meetings(id))
  const transcriptTone = (status: string) => (status === 'done' ? 'success' : status === 'failed' ? 'danger' : status === 'running' || status === 'queued' ? 'accent' : 'muted') as 'success' | 'danger' | 'accent' | 'muted'
  const empty = loaded && !overview.live && overview.upcoming.length === 0 && !overview.last
  return (
    <WidgetFrame testId="meetings" title={t('workbench.home.w.meetings')} onOpen={() => open()} edit={edit}>
      {!available ? (
        <WidgetEmpty text={t('workbench.home.meetings.unavailable')} />
      ) : empty ? (
        <WidgetEmpty text={t('workbench.home.meetings.empty')} hint={t('workbench.home.meetings.emptyHint')} action={{ label: t('workbench.home.meetings.plan'), onClick: () => open() }} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {overview.live ? (
            <WidgetList>
              <WidgetRow onClick={() => open(overview.live!.id)} leading={<Mic className="h-3.5 w-3.5 text-destructive" />} title={overview.live.title} trailing={t('workbench.home.meetings.live')} />
            </WidgetList>
          ) : null}
          <SectionLabel>{t('workbench.home.meetings.upcoming')}</SectionLabel>
          {overview.upcoming.length === 0 ? (
            <p className="text-[12px] leading-4 text-muted-foreground">{t('workbench.home.meetings.noUpcoming')}</p>
          ) : (
            <WidgetList>
              {overview.upcoming.map((m) => (
                <WidgetRow key={m.id} testId={m.id} onClick={() => open(m.id)} leading={<CalendarClock className="h-3.5 w-3.5" />} title={m.title} trailing={m.scheduledAt ? fmt.when(m.scheduledAt, now) : undefined} />
              ))}
            </WidgetList>
          )}
          {overview.last ? (
            <>
              <SectionLabel>{t('workbench.home.meetings.last')}</SectionLabel>
              <WidgetList>
                <WidgetRow
                  testId={overview.last.id}
                  onClick={() => open(overview.last!.id)}
                  leading={<Dot tone={transcriptTone(overview.last.transcript.status)} />}
                  title={overview.last.title}
                  sub={t(`workbench.home.meetings.transcript.${overview.last.transcript.status}`)}
                  trailing={fmt.when(overview.last.endedAt ?? overview.last.startedAt ?? overview.last.createdAt, now)}
                />
              </WidgetList>
            </>
          ) : null}
        </div>
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
  const top3 = focus.top3.map((id) => tasks.find((task) => task.id === id)).filter((task): task is NonNullable<typeof task> => !!task)
  const left = running && focus.active ? Math.max(0, focus.active.endsAt - now) : 0
  const mm = String(Math.floor(left / 60_000)).padStart(2, '0')
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')
  const open = () => navigate(routes.view.screen('focus'))
  return (
    <WidgetFrame testId="focus" title={t('workbench.home.w.focus')} onOpen={open} edit={edit}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="grid grid-cols-2 gap-1">
          <WidgetStat label={running ? t('workbench.home.focus.left') : t('workbench.home.focus.timer')} value={running ? `${mm}:${ss}` : t('workbench.home.focus.off')} tone={running ? 'accent' : undefined} onClick={open} />
          <WidgetStat label={t('workbench.home.focus.today')} value={t('workbench.home.focus.minutes', { count: today.minutes })} />
        </div>
        <SectionLabel>{t('workbench.home.focus.top3')}</SectionLabel>
        {top3.length === 0 ? (
          <p className="text-[12px] leading-4 text-muted-foreground">{t('workbench.home.focus.top3Empty')}</p>
        ) : (
          <WidgetList>
            {top3.map((task, i) => (
              <WidgetRow key={task.id} testId={task.id} onClick={() => navigate(routes.view.tasks(task.id))} leading={<span className="text-[12px] font-bold">{i + 1}</span>} title={<span className={cn(task.completedAt && 'text-muted-foreground line-through')}>{task.title}</span>} />
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

type AutomationsState = { available: boolean; loaded: boolean; items: ReturnType<typeof parseAutomationsConfig>; last: Record<string, { ts: number; ok: boolean }> }

function AutomationsWidget({ edit }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [state, setState] = useState<AutomationsState>({ available: true, loaded: false, items: [], last: {} })
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
  }, [workspaceId])
  const overview = useMemo(() => buildAutomationsOverview(state.items, state.last, (a) => {
    if (!a.cron) return null
    try {
      return new Cron(a.cron, a.timezone ? { timezone: a.timezone } : {}).nextRun()?.getTime() ?? null
    } catch {
      return null
    }
  }, now), [state.items, state.last, now])
  const open = (automationId?: string) => navigate(routes.view.automations(automationId ? { automationId } : undefined))
  return (
    <WidgetFrame
      testId="automations"
      title={t('workbench.home.w.automations')}
      onOpen={() => open()}
      edit={edit}
      meta={state.items.length ? t('workbench.home.automations.counts', { enabled: overview.enabled, paused: overview.paused }) : undefined}
    >
      {!state.available ? (
        <WidgetEmpty text={t('workbench.home.automations.unavailable')} />
      ) : state.loaded && state.items.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.automations.empty')} hint={t('workbench.home.automations.emptyHint')} action={{ label: t('workbench.home.automations.create'), onClick: () => open() }} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {overview.failures.length > 0 ? (
            <>
              <SectionLabel>{t('workbench.home.automations.failures')}</SectionLabel>
              <WidgetList>
                {overview.failures.map((f) => (
                  <WidgetRow key={f.id} testId={`fail-${f.id}`} onClick={() => open(f.id)} leading={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />} title={f.name} trailing={fmt.ago(f.at, now)} />
                ))}
              </WidgetList>
            </>
          ) : null}
          <SectionLabel>{t('workbench.home.automations.next')}</SectionLabel>
          {overview.next.length === 0 ? (
            <p className="text-[12px] leading-4 text-muted-foreground">{t('workbench.home.automations.noSchedule')}</p>
          ) : (
            <WidgetList>
              {overview.next.map((n) => (
                <WidgetRow key={n.id} testId={n.id} onClick={() => open(n.id)} leading={<Workflow className="h-3.5 w-3.5" />} title={n.name} trailing={fmt.when(n.at, now)} />
              ))}
            </WidgetList>
          )}
        </div>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Лента
// ---------------------------------------------------------------------------

function FeedWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const feed = useFeedItems(workspace?.id ?? null)
  const latest = feed.items.slice(0, span >= 12 ? 10 : 5)
  return (
    <WidgetFrame testId="feed" title={t('workbench.home.w.feed')} onOpen={() => navigate(routes.view.feed())} edit={edit}>
      {!feed.available ? (
        <WidgetEmpty text={t('workbench.home.feed.unavailable')} />
      ) : feed.loaded && latest.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.feed.empty')} hint={t('workbench.home.feed.emptyHint')} />
      ) : (
        <WidgetList columns={span >= 12 ? 2 : 1}>
          {latest.map((item) => (
            <WidgetRow
              key={item.id}
              testId={item.id}
              onClick={() => navigate(routes.view.feed(item.id))}
              leading={item.status === 'error' ? <Dot tone="danger" /> : item.status === 'running' ? <Dot tone="accent" /> : item.tab === 'agents' ? <Bot className="h-3.5 w-3.5" /> : <Rss className="h-3.5 w-3.5" />}
              title={item.title || item.summary || item.id}
              trailing={fmt.ago(item.at, now)}
            />
          ))}
        </WidgetList>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Заметки
// ---------------------------------------------------------------------------

function NotesWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(60_000)
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [state, setState] = useState<{ available: boolean; loaded: boolean; notes: NoteSummary[] }>({ available: true, loaded: false, notes: [] })
  useEffect(() => {
    const api = window.electronAPI
    if (!workspaceId || typeof api?.listNotes !== 'function') {
      setState({ available: false, loaded: true, notes: [] })
      return
    }
    let cancelled = false
    const load = () => api.listNotes(workspaceId).then(
      (notes) => { if (!cancelled) setState({ available: true, loaded: true, notes: recentByUpdated(notes ?? [], 10) }) },
      () => { if (!cancelled) setState({ available: false, loaded: true, notes: [] }) },
    )
    void load()
    const off = typeof api.onNotesChanged === 'function' ? api.onNotesChanged(() => { void load() }) : undefined
    return () => { cancelled = true; off?.() }
  }, [workspaceId])
  const shown = state.notes.slice(0, span >= 12 ? 10 : 5)
  return (
    <WidgetFrame testId="notes" title={t('workbench.home.w.notes')} onOpen={() => navigate(routes.view.notes())} edit={edit}>
      {!state.available ? (
        <WidgetEmpty text={t('workbench.home.notes.unavailable')} />
      ) : state.loaded && shown.length === 0 ? (
        <WidgetEmpty text={t('workbench.home.notes.empty')} action={{ label: t('workbench.home.quick.newNote'), onClick: () => navigate(routes.view.notes()) }} />
      ) : (
        <WidgetList columns={span >= 12 ? 2 : 1}>
          {shown.map((note) => (
            <WidgetRow key={note.id} testId={note.id} onClick={() => navigate(routes.view.notes(note.id))} leading={<FileText className="h-3.5 w-3.5" />} title={note.title || t('notes.untitled')} trailing={fmt.ago(note.updatedAt, now)} />
          ))}
        </WidgetList>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Решения
// ---------------------------------------------------------------------------

function DecisionsWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const workspace = useActiveWorkspace()
  const data = useWorkspaceStore(DECISIONS_NS, workspace?.id ?? null, loadDecisions)
  const recent = useMemo(() => data.decisions.filter((d) => d.status === 'accepted').sort((a, b) => b.decidedAt - a.decidedAt).slice(0, rowsFor(span, 4)), [data.decisions, span])
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
            <WidgetRow key={d.id} testId={d.id} onClick={() => open(d.id)} leading={<Gavel className="h-3.5 w-3.5" />} title={d.title} sub={d.why || undefined} trailing={fmt.ago(d.decidedAt, now)} />
          ))}
        </WidgetList>
      )}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------
// Радар
// ---------------------------------------------------------------------------

function RadarWidget({ edit, span }: WidgetProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const now = useNow(5 * 60_000)
  const workspace = useActiveWorkspace()
  const data = useWorkspaceStore(RADAR_NS, workspace?.id ?? null, loadRadar)
  const signals = useMemo(() => radarSignals(data, rowsFor(span, 4)), [data, span])
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
}

