import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronLeft, ChevronRight, Phone, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { WorkBlock } from '@rox/shared/workspace-work'
import type { LocalMeeting } from '../../../shared/meetings-local'
import { useWorkspaceWork } from '@/lib/useWorkspaceWork'
import { localDateTimeInput, parseLocalDateTime } from '@/lib/workspace-work-client'
import { navigate, routes } from '@/lib/navigate'

const fieldClass = 'w-full rounded-lg border border-border/70 bg-background px-2.5 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const compactFieldClass = fieldClass.replace('w-full', 'w-auto')
const buttonClass = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[13px] transition-colors motion-reduce:transition-none hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none'
type BlockDraft = { id: string | null; taskId: string; start: string; end: string; expectedRevision: number }
type PlanItem = { key: string; kind: 'block' | 'deadline' | 'meeting'; id: string; title: string; at: number; endAt?: number; conflict?: boolean }

function dayInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function WorkspacePlanView({ workspaceId, projectId, onOpenTask }: { workspaceId: string; projectId?: string; onOpenTask?: (taskId: string) => void }) {
  const { t, i18n } = useTranslation()
  const work = useWorkspaceWork(workspaceId)
  const { snapshot } = work
  const [date, setDate] = useState(() => dayInput(new Date()))
  const [view, setView] = useState<'day' | 'week'>('week')
  const [draft, setDraft] = useState<BlockDraft | null>(null)
  const [meetings, setMeetings] = useState<LocalMeeting[]>([])
  const [meetingState, setMeetingState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [meetingReload, setMeetingReload] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [validationError, setValidationError] = useState(false)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const time = (at: number) => new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const when = (at: number) => new Date(at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  useEffect(() => { setDraft(null); setDeleteTarget(null); setValidationError(false) }, [workspaceId, projectId])
  useEffect(() => {
    let active = true
    let generation = 0
    setMeetings([]); setMeetingState('loading')
    const api = window.electronAPI?.meetingsLocal
    if (!api) { setMeetingState('error'); return }
    const load = async () => {
      const request = ++generation
      try {
        const list = await api.list(workspaceId)
        if (active && generation === request) { setMeetings(list.filter(meeting => !meeting.workspaceId || meeting.workspaceId === workspaceId)); setMeetingState('ready') }
      } catch { if (active && generation === request) setMeetingState('error') }
    }
    void load()
    const off = api.onChanged(() => { void load() })
    return () => { active = false; generation++; off() }
  }, [workspaceId, meetingReload])

  const tasks = snapshot?.tasks.filter(task => !projectId || task.project?.id === projectId) ?? []
  const taskById = new Map<string, (typeof tasks)[number]>(tasks.map(task => [task.id, task]))
  const blocks = snapshot?.workBlocks.filter(block => taskById.has(block.taskId)) ?? []
  const conflictBlockIds = new Set(snapshot?.conflicts.flatMap(conflict => [conflict.firstBlockId, conflict.secondBlockId]))
  const days = useMemo(() => {
    const start = new Date(`${date}T00:00:00`)
    if (view === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    return Array.from({ length: view === 'week' ? 7 : 1 }, (_, index) => { const day = new Date(start); day.setDate(day.getDate() + index); return day })
  }, [date, view])
  const rangeStart = days[0].getTime()
  const rangeEndDate = new Date(days[days.length - 1]); rangeEndDate.setDate(rangeEndDate.getDate() + 1)
  const rangeEnd = rangeEndDate.getTime()
  const allItems: PlanItem[] = [
    ...blocks.map(block => ({ key: `block:${block.id}`, kind: 'block' as const, id: block.id, title: taskById.get(block.taskId)!.title, at: block.startAt, endAt: block.endAt, conflict: conflictBlockIds.has(block.id) })),
    ...tasks.filter(task => task.dueAt !== null && task.status !== 'done' && task.status !== 'canceled').map(task => ({ key: `deadline:${task.id}`, kind: 'deadline' as const, id: task.id, title: task.title, at: task.dueAt! })),
    ...(!projectId ? meetings.filter(meeting => meeting.scheduledAt !== undefined).map(meeting => ({ key: `meeting:${meeting.id}`, kind: 'meeting' as const, id: meeting.id, title: meeting.title, at: meeting.scheduledAt!, ...(meeting.durationMs > 0 ? { endAt: meeting.scheduledAt! + meeting.durationMs } : {}) })) : []),
  ]
  const items = allItems.filter(item => item.at < rangeEnd && (item.endAt ? item.endAt > rangeStart : item.at >= rangeStart)).sort((a, b) => a.at - b.at)

  const begin = (block?: WorkBlock) => {
    if (!snapshot) return
    setDeleteTarget(null); setValidationError(false)
    setDraft(block ? { id: block.id, taskId: block.taskId, start: localDateTimeInput(block.startAt), end: localDateTimeInput(block.endAt), expectedRevision: snapshot.revision }
      : { id: null, taskId: '', start: `${date}T09:00`, end: `${date}T10:00`, expectedRevision: snapshot.revision })
  }
  const save = async () => {
    if (!draft) return
    const startAt = parseLocalDateTime(draft.start), endAt = parseLocalDateTime(draft.end)
    if (!draft.taskId || startAt === null || endAt === null || endAt <= startAt) { setValidationError(true); return }
    setValidationError(false)
    const input = { taskId: draft.taskId, startAt, endAt }
    const ok = await work.write(draft.id ? { kind: 'updateWorkBlock', id: draft.id, patch: input } : { kind: 'createWorkBlock', input }, draft.expectedRevision)
    if (ok) setDraft(null)
  }
  const activate = (item: PlanItem) => {
    if (item.kind === 'block') begin(blocks.find(block => block.id === item.id))
    else if (item.kind === 'meeting') navigate(routes.view.meetings(item.id))
    else onOpenTask?.(item.id)
  }
  const shift = (direction: -1 | 1) => { const next = new Date(`${date}T00:00:00`); next.setDate(next.getDate() + direction * (view === 'week' ? 7 : 1)); setDate(dayInput(next)) }
  const canWrite = snapshot?.access.canWrite === true
  const busy = work.pending || !snapshot
  const draftExists = !draft?.id || snapshot?.workBlocks.some(block => block.id === draft.id)

  return <section className="flex h-full min-h-0 flex-col bg-background font-sans text-[13px]" data-testid="workspace-plan-view">
    <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3"><CalendarDays className="size-4 text-accent" aria-hidden /><h2 className="mr-auto text-[15px] font-semibold">{t('navigation.work.plan.title')}</h2><button type="button" className={buttonClass} disabled={work.loading} onClick={() => { void work.refresh(); setMeetingReload(value => value + 1) }} aria-label={t('navigation.work.refresh')}><RefreshCw className="size-3.5" aria-hidden /></button><button type="button" className={buttonClass} disabled={!canWrite || busy || !tasks.length} onClick={() => begin()}><Plus className="size-3.5" aria-hidden />{t('navigation.work.plan.newBlock')}</button></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <p className="text-muted-foreground">{t('navigation.work.plan.explanation')}</p>
      {work.loading && !snapshot && <p role="status">{t('navigation.work.loading')}</p>}
      {work.error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">{t(`navigation.work.errors.${work.error.code}`)}</div>}
      {snapshot && !canWrite && <p role="status" className="text-muted-foreground">{t('navigation.work.readOnly')}</p>}
      <div className="flex flex-wrap items-center gap-2"><button type="button" className={buttonClass} onClick={() => shift(-1)} aria-label={t('navigation.work.plan.previous')}><ChevronLeft className="size-3.5" aria-hidden /></button><input type="date" className={compactFieldClass} value={date} required onChange={event => { if (event.target.value) setDate(event.target.value) }} aria-label={t('navigation.work.plan.date')} /><button type="button" className={buttonClass} onClick={() => shift(1)} aria-label={t('navigation.work.plan.next')}><ChevronRight className="size-3.5" aria-hidden /></button><button type="button" className={buttonClass} onClick={() => setDate(dayInput(new Date()))}>{t('navigation.work.plan.today')}</button><select className={compactFieldClass} value={view} onChange={event => setView(event.target.value as 'day' | 'week')} aria-label={t('navigation.work.plan.view')}><option value="day">{t('navigation.work.plan.day')}</option><option value="week">{t('navigation.work.plan.week')}</option></select><button type="button" disabled className={`${buttonClass} ml-auto`}><Phone className="size-3.5" aria-hidden />{t('navigation.work.plan.callsSoon')}</button></div>
      <div className="grid gap-2" style={{ gridTemplateColumns: view === 'week' ? 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))' : 'minmax(0, 1fr)' }} aria-label={t('navigation.work.plan.calendar')}>
        {days.map(day => {
          const dayEnd = new Date(day); dayEnd.setDate(dayEnd.getDate() + 1)
          const daily = items.filter(item => item.at < dayEnd.getTime() && (item.endAt ? item.endAt > day.getTime() : item.at >= day.getTime()))
          return <section key={dayInput(day)} className="min-w-0 rounded-lg border border-border/70 p-2"><h3 className="mb-2 font-medium">{day.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</h3><div className="space-y-1.5">{daily.map(item => <button type="button" key={item.key} disabled={item.kind === 'deadline' && !onOpenTask} onClick={() => activate(item)} className={`w-full rounded-md border p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.conflict ? 'border-amber-500/60 bg-amber-500/10' : item.kind === 'deadline' ? 'border-border/50 bg-foreground/[0.025]' : 'border-accent/20 bg-accent/5 hover:bg-accent/10'}`}><span className="block text-[11px] text-muted-foreground">{t(`navigation.work.plan.kinds.${item.kind}`)} · {time(item.at)}{item.endAt ? `–${time(item.endAt)}` : ''}</span><span className="block break-words">{item.title}</span>{item.conflict && <span className="block text-xs text-amber-700 dark:text-amber-300">{t('navigation.work.plan.conflict')}</span>}</button>)}{!daily.length && <p className="text-xs text-muted-foreground">{t('navigation.work.plan.free')}</p>}</div></section>
        })}
      </div>
      {snapshot && !items.length && <p className="text-muted-foreground">{t('navigation.work.plan.empty')}</p>}
      {!projectId && meetingState === 'loading' && <p role="status">{t('navigation.work.plan.meetingsLoading')}</p>}
      {!projectId && meetingState === 'error' && <p role="status" className="text-muted-foreground">{t('navigation.work.plan.meetingsError')}</p>}
      {snapshot && snapshot.conflicts.filter(conflict => blocks.some(block => block.id === conflict.firstBlockId || block.id === conflict.secondBlockId)).length > 0 && <section className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" aria-label={t('navigation.work.plan.conflicts')}><h3 className="font-medium">{t('navigation.work.plan.conflicts')}</h3>{snapshot.conflicts.filter(conflict => blocks.some(block => block.id === conflict.firstBlockId || block.id === conflict.secondBlockId)).map(conflict => {
        const first = blocks.find(block => block.id === conflict.firstBlockId), second = blocks.find(block => block.id === conflict.secondBlockId)
        const person = snapshot.members.find(member => member.id === conflict.assigneeId)?.name ?? conflict.assigneeId
        return <div key={`${conflict.firstBlockId}:${conflict.secondBlockId}`} className="flex flex-wrap items-center gap-2"><span>{person} · {when(conflict.startAt)}–{time(conflict.endAt)}</span>{[first, second].filter((block): block is WorkBlock => Boolean(block)).map(block => <button type="button" key={block.id} className={buttonClass} onClick={() => begin(block)}>{taskById.get(block.taskId)?.title}</button>)}</div>
      })}<p className="text-muted-foreground">{t('navigation.work.plan.conflictHelp')}</p></section>}
      {draft && <form className="max-w-2xl space-y-3 rounded-lg border border-border/70 p-4" onSubmit={event => { event.preventDefault(); void save() }}><h3 className="font-semibold">{t(draft.id ? 'navigation.work.plan.editBlock' : 'navigation.work.plan.newBlock')}</h3>{!draftExists && <p role="alert" className="text-destructive">{t('navigation.work.plan.deleted')}</p>}<label className="block space-y-1"><span>{t('navigation.work.plan.task')}</span><select required className={fieldClass} disabled={!canWrite || busy || !draftExists} value={draft.taskId} onChange={event => setDraft({ ...draft, taskId: event.target.value })}><option value="">{t('navigation.work.plan.chooseTask')}</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1"><span>{t('navigation.work.plan.start')}</span><input type="datetime-local" required className={fieldClass} disabled={!canWrite || busy || !draftExists} value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label><label className="block space-y-1"><span>{t('navigation.work.plan.end')}</span><input type="datetime-local" required className={fieldClass} disabled={!canWrite || busy || !draftExists} value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label></div>{validationError && <p role="alert" className="text-destructive">{t('navigation.work.plan.invalidRange')}</p>}{snapshot && draft.expectedRevision !== snapshot.revision && <div className="space-y-2 rounded-lg bg-amber-500/10 p-3" role="status"><p>{t('navigation.work.draftChanged')}</p><button type="button" className={buttonClass} onClick={() => setDraft({ ...draft, expectedRevision: snapshot.revision })}>{t('navigation.work.keepDraftRetry')}</button></div>}<div className="flex flex-wrap gap-2"><button type="submit" className={`${buttonClass} bg-accent/10 text-accent`} disabled={!canWrite || busy || !draftExists || !draft.taskId}>{t(work.pending ? 'navigation.work.saving' : 'navigation.work.save')}</button><button type="button" className={buttonClass} disabled={work.pending} onClick={() => setDraft(null)}>{t('navigation.work.cancel')}</button>{draft.id && <button type="button" className={`${buttonClass} ml-auto text-destructive`} disabled={!snapshot?.access.canDelete || busy || !draftExists} onClick={() => setDeleteTarget(draft.id)}>{t('navigation.work.delete')}</button>}</div>{draft.id && deleteTarget === draft.id && <div className="flex flex-wrap items-center gap-2" role="alert"><span>{t('navigation.work.plan.deleteConfirm')}</span><button type="button" className={buttonClass} disabled={busy} onClick={() => void work.remove({ kind: 'workBlock', id: draft.id! }, draft.expectedRevision).then(ok => { if (ok) { setDraft(null); setDeleteTarget(null) } })}>{t('navigation.work.delete')}</button><button type="button" className={buttonClass} onClick={() => setDeleteTarget(null)}>{t('navigation.work.cancel')}</button></div>}</form>}
      <p className="text-xs text-muted-foreground">{t('navigation.work.plan.localCalendar')}</p>
    </div>
  </section>
}

export default WorkspacePlanView
