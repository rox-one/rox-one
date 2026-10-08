/**
 * «Фокус» — the day on one screen: calendar + meetings, top-3 tasks, pending
 * Входящие and a deep-work timer. While the timer runs, agent notifications
 * are queued (lib/focus-session) instead of shown. «Итоги дня» are upserted
 * into today's daily note (button, or automatically after the chosen hour).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { useInboxItems } from '@/hooks/useInboxItems'
import { navigate, routes } from '@/lib/navigate'
import { usePersonalTasks, useMeetings } from '@/lib/extra-screens/use-rox-sources'
import {
  focusMinutesOn,
  isFocusRunning,
  loadFocusState,
  localDay,
  saveFocusState,
  settleFocus,
  startFocus,
  stopFocus,
  subscribeFocusState,
  type FocusState,
} from '@/lib/focus-session'
import { isActive, sortInbox } from '@/pages/inbox/inbox-model'
import { cn } from '@/lib/utils'
import { Card, CardTitle, Chip, ScreenButton, ScreenColumn, ScreenDetail, ScreenHeader, ScreenRoot, SectionLabel } from '../ui'
import { calendarEventsToday, mergeDay, rankTopTasks, startOfDay, type DayEvent } from './focus-model'
import { collectDaySummary, writeDaySummary } from './focus-summary'
import { toErrorMessage } from '@/lib/errors'

const PRESETS = [25, 50, 90]
const CALENDAR_KEY = 'rox.calendar.v1'

function readCalendarBundle(): unknown {
  try {
    const raw = window.localStorage.getItem(CALENDAR_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function FocusPage(_props: { itemId: string | null }) {
  const { t, i18n } = useTranslation()
  const language: 'ru' | 'en' = i18n.language.startsWith('ru') ? 'ru' : 'en'
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const [focus, setFocus] = useState<FocusState>(() => loadFocusState())
  const [now, setNow] = useState(() => Date.now())
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryState, setSummaryState] = useState<'idle' | 'writing' | 'written' | 'error'>('idle')
  const [summaryNoteId, setSummaryNoteId] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)

  useEffect(() => subscribeFocusState(() => setFocus(loadFocusState())), [])
  const running = isFocusRunning(focus, now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), running ? 1000 : 30000)
    return () => window.clearInterval(timer)
  }, [running])
  useEffect(() => {
    const settled = settleFocus(focus, now)
    if (settled !== focus) { saveFocusState(settled); setFocus(settled) }
  }, [focus, now])

  const update = useCallback((next: FocusState) => { saveFocusState(next); setFocus(next) }, [])

  // Day: calendar store + today's meetings.
  const tasks = usePersonalTasks()
  const { meetings, available: meetingsAvailable } = useMeetings(workspaceId)
  const calendar = useMemo(() => calendarEventsToday(readCalendarBundle(), now), [now])
  const dayStart = startOfDay(now)
  const meetingEvents = useMemo<DayEvent[]>(() => meetings
    .filter((m) => m.at != null && m.at >= dayStart && m.at < dayStart + 86400000)
    .map((m) => ({ id: m.id, title: m.title, startAt: m.at!, kind: 'meeting' })), [meetings, dayStart])
  const day = useMemo(() => mergeDay(calendar.events, meetingEvents), [calendar.events, meetingEvents])

  const top = useMemo(() => rankTopTasks(tasks, focus.top3, now), [tasks, focus.top3, now])
  const openTasks = useMemo(() => tasks.filter((task) => !task.completedAt && !task.cancelledAt), [tasks])
  const togglePin = (id: string) => {
    const pinned = focus.top3.includes(id) ? focus.top3.filter((x) => x !== id) : [...focus.top3, id].slice(-3)
    update({ ...focus, top3: pinned })
  }

  const inbox = useInboxItems({ withRemote: false })
  const pendingInbox = useMemo(() => sortInbox(inbox.items.filter((item) => isActive(inbox.state, item, inbox.now))), [inbox.items, inbox.state, inbox.now])

  const today = localDay(now)
  const stats = focusMinutesOn(focus, today, now)
  const queueToday = workspaceId ? focus.queue.filter((q) => q.workspaceId === workspaceId) : []
  const time = (ts: number) => new Date(ts).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })

  const preview = async () => {
    if (!workspaceId) return
    const result = await collectDaySummary(workspaceId, Date.now(), language, pendingInbox.length)
    setSummary(result.text)
  }
  // Refresh the preview when its inputs change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void preview() }, [workspaceId, tasks, focus.history.length, pendingInbox.length, language])

  const write = async () => {
    if (!workspaceId) return
    setSummaryState('writing')
    setSummaryError(null)
    try {
      const result = await collectDaySummary(workspaceId, Date.now(), language, pendingInbox.length)
      setSummary(result.text)
      const { noteId } = await writeDaySummary(workspaceId, result.text, Date.now())
      setSummaryNoteId(noteId)
      setSummaryState('written')
    } catch (e) {
      setSummaryError(toErrorMessage(e))
      setSummaryState('error')
    }
  }

  return (
    <ScreenRoot>
      <ScreenColumn width="clamp(220px, 32%, 340px)">
        <ScreenHeader
          title={t('extraScreens.focus.title')}
          subtitle={new Date(now).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'long' })}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <SectionLabel>{t('extraScreens.focus.calendar')}</SectionLabel>
          {!calendar.connected && (
            <div className="pb-2 text-[12px] text-muted-foreground">{t('extraScreens.focus.calendarOff')}</div>
          )}
          {day.length === 0 ? (
            <div className="text-muted-foreground">{t('extraScreens.focus.dayEmpty')}</div>
          ) : (
            day.map((event) => (
              <button
                key={`${event.kind}:${event.id}`}
                type="button"
                onClick={() => { if (event.kind === 'meeting') navigate(routes.view.meetings(event.id)) }}
                className={cn('flex w-full items-baseline gap-3 rounded-[var(--radius-control)] px-2 py-1.5 text-left', event.kind === 'meeting' ? 'hover:bg-foreground/5' : 'cursor-default', event.endAt && event.endAt < now && 'text-muted-foreground')}
              >
                <span className="w-[44px] shrink-0 tabular-nums text-[12px] text-muted-foreground">{event.allDay ? t('extraScreens.focus.allDay') : time(event.startAt)}</span>
                <span className="min-w-0 flex-1 truncate">{event.title}</span>
                {event.kind === 'meeting' && <Chip>{t('extraScreens.radar.local.meeting')}</Chip>}
              </button>
            ))
          )}
          {!meetingsAvailable && <div className="pt-1 text-[12px] text-muted-foreground">{t('extraScreens.decisions.meetingsUnavailable')}</div>}

          <div className="mt-5"><SectionLabel>{t('extraScreens.focus.inbox')} · {pendingInbox.length}</SectionLabel></div>
          {pendingInbox.length === 0 && <div className="text-muted-foreground">{t('extraScreens.focus.inboxEmpty')}</div>}
          {pendingInbox.slice(0, 6).map((item) => (
            <button key={item.id} type="button" onClick={() => navigate(routes.view.inbox(item.id))} className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-foreground/5">
              {item.blocking && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <span className="shrink-0 truncate text-[12px] text-muted-foreground">{item.source}</span>
            </button>
          ))}
          {pendingInbox.length > 6 && (
            <button type="button" className="px-2 pt-1 text-[12px] text-accent" onClick={() => navigate(routes.view.inbox())}>{t('extraScreens.focus.allInbox', { n: pendingInbox.length })}</button>
          )}
        </div>
      </ScreenColumn>

      <ScreenDetail className="overflow-x-hidden">
        <div className="min-w-0 max-w-[860px]">
          <Card accent={running} className="mt-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="min-w-0">
                <CardTitle>{t('extraScreens.focus.deepWork')}</CardTitle>
                <div className="mt-1 text-[44px] font-bold tabular-nums leading-none" role="timer" aria-live="off">
                  {running && focus.active ? mmss(focus.active.endsAt - now) : mmss(25 * 60000)}
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {running ? t('extraScreens.focus.runningHint') : t('extraScreens.focus.idleHint')}
                </div>
              </div>
              <span className="flex-1" />
              <div className="flex min-w-0 flex-col items-end gap-1.5">
                {running ? (
                  <ScreenButton variant="danger" onClick={() => update(stopFocus(focus, Date.now()))}>{t('extraScreens.focus.stop')}</ScreenButton>
                ) : (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {PRESETS.map((minutes) => (
                      <ScreenButton key={minutes} variant={minutes === 25 ? 'primary' : 'default'} onClick={() => update(startFocus(focus, minutes, Date.now()))}>
                        {t('extraScreens.focus.startMinutes', { n: minutes })}
                      </ScreenButton>
                    ))}
                  </div>
                )}
                <div className="text-right text-[12px] text-muted-foreground">{t('extraScreens.focus.todayStats', { n: stats.sessions, minutes: stats.minutes })}</div>
              </div>
            </div>
            {queueToday.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center gap-2">
                  <SectionLabel>{t('extraScreens.focus.deferred', { n: queueToday.reduce((sum, q) => sum + q.count, 0) })}</SectionLabel>
                  <span className="flex-1" />
                  <ScreenButton variant="ghost" onClick={() => update({ ...focus, queue: focus.queue.filter((q) => q.workspaceId !== workspaceId) })}>{t('extraScreens.focus.clearQueue')}</ScreenButton>
                </div>
                {queueToday.map((q) => (
                  <button key={JSON.stringify([q.workspaceId, q.sessionId])} type="button" onClick={() => { update({ ...focus, queue: focus.queue.filter((x) => x.workspaceId !== q.workspaceId || x.sessionId !== q.sessionId) }); navigate(routes.view.allSessions(q.sessionId)) }} className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-left hover:bg-foreground/5">
                    <span className="min-w-0 flex-1 truncate">{q.title}{q.count > 1 ? ` ×${q.count}` : ''}</span>
                    <span className="max-w-[40%] truncate text-[12px] text-muted-foreground">{q.body}</span>
                    <span className="text-[12px] text-muted-foreground">{time(q.at)}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <CardTitle>{t('extraScreens.focus.top3')}</CardTitle>
              <span className="flex-1" />
              <ScreenButton variant="ghost" onClick={() => setChoosing((v) => !v)}>{choosing ? t('extraScreens.focus.done') : t('extraScreens.focus.choose')}</ScreenButton>
            </div>
            {top.length === 0 && (
              <div className="mt-1 text-muted-foreground">
                {t('extraScreens.focus.noTasks')}{' '}
                <button type="button" className="text-accent" onClick={() => navigate(routes.view.tasks())}>{t('extraScreens.focus.openTasks')}</button>
              </div>
            )}
            {!choosing && top.map((task, index) => (
              <button key={task.id} type="button" onClick={() => navigate(routes.view.tasks(task.id))} className="mt-1 flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-foreground/5">
                <span className="w-4 text-[15px] font-bold text-accent">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{task.title}</span>
                {focus.top3.includes(task.id) && <Chip>{t('extraScreens.focus.pinned')}</Chip>}
                {task.priority === 'high' && <Chip tone="warn">{t('extraScreens.focus.high')}</Chip>}
              </button>
            ))}
            {choosing && (
              <div className="mt-1 max-h-[260px] overflow-y-auto">
                {openTasks.map((task) => (
                  <label key={task.id} className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 hover:bg-foreground/5">
                    <input type="checkbox" checked={focus.top3.includes(task.id)} onChange={() => togglePin(task.id)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  </label>
                ))}
                <div className="px-2 pt-1 text-[12px] text-muted-foreground">{t('extraScreens.focus.chooseHint')}</div>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{t('extraScreens.focus.summary')}</CardTitle>
              <span className="flex-1" />
              <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={focus.summaryHour != null}
                  onChange={() => update({ ...focus, summaryHour: focus.summaryHour == null ? 19 : null })}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                {t('extraScreens.focus.autoSummary', { hour: String(focus.summaryHour ?? 19).padStart(2, '0') })}
              </label>
              <ScreenButton variant="primary" disabled={!workspaceId || summaryState === 'writing'} onClick={() => { void write() }}>
                {summaryState === 'writing' ? t('extraScreens.decisions.saving') : t('extraScreens.focus.writeSummary')}
              </ScreenButton>
            </div>
            {summary && <pre className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] font-[inherit] text-[12px] leading-[1.5] text-foreground/85">{summary}</pre>}
            <div className="mt-1 text-[12px] text-muted-foreground">
              {summaryState === 'written'
                ? <button type="button" className="text-accent" onClick={() => summaryNoteId && navigate(routes.view.notes(summaryNoteId))}>{t('extraScreens.focus.summaryWritten')}</button>
                : summaryState === 'error'
                  ? <span className="text-destructive">{summaryError}</span>
                  : focus.summaryWrittenFor === today
                    ? t('extraScreens.focus.summaryAlready')
                    : t('extraScreens.focus.summaryHint')}
            </div>
          </Card>
        </div>
      </ScreenDetail>
    </ScreenRoot>
  )
}
