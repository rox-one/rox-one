/**
 * Detail pane of a personal task (Things-style): title, Markdown notes,
 * checklist, «Когда» vs deadline, reminder, repeat rule, tags, place
 * (area/project/heading), source link, «Поручить агенту», links, history.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@rox/ui'
import {
  parseDateExpression,
  startOfLocalDay,
  type PersonalTask,
  type PersonalTaskStore,
  type RecurrenceRule,
  type TaskLink,
  type TaskLinkKind,
  type TaskPriority,
  type TaskWhen,
} from '@rox/core/tasks/personal'
import { cn } from '@/lib/utils'
import { useTourTarget } from '@/features/product-tour/runtime/hooks'
import { Badge, Button, Card, SectionLabel, Tabs } from '@/components/mode-screen/ModeScreen'
import { ConfirmDialog, Glyph, MiniCalendar, TaskCheckbox } from './parts'
import { checklistProgress, daysUntil, deriveTaskSource, mergeNotesMarkers, visibleNotes, type AgentChip, type AgentSessionLike } from './task-model'

const LINK_KINDS: TaskLinkKind[] = ['note', 'session', 'message', 'meeting', 'feed', 'mail', 'workflowRun']
const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high']
const RECURRENCES: Array<RecurrenceRule | 'none'> = ['none', 'daily', 'weekly', 'monthly', 'yearly']
const CHIP_TONE: Record<AgentChip, 'success' | 'warning' | 'accent' | 'muted'> = { running: 'success', review: 'warning', todo: 'accent', done: 'muted', linked: 'muted' }

type DetailTab = 'details' | 'links' | 'history'
type Popover = 'when' | 'deadline' | null

export interface TaskDetailProps {
  task: PersonalTask
  store: PersonalTaskStore
  mutate: (fn: (store: PersonalTaskStore) => void) => void
  now: number
  subtasks: PersonalTask[]
  allTags: string[]
  placeLabel: string
  sessionMap: ReadonlyMap<string, AgentSessionLike>
  agentChip: { sessionId: string; chip: AgentChip } | null
  delegating: boolean
  delegateError: string | null
  canDelegate: boolean
  onDelegate: () => void
  onToggleComplete: () => void
  onOpenMove: () => void
  onOpenSource: (link: TaskLink) => void
  onOpenSession: (id: string) => void
  onOpenBoard: () => void
  onTrash: () => void
  onClose: () => void
  titleRef: React.RefObject<HTMLInputElement>
  popover: Popover
  setPopover: (p: Popover) => void
}

export function TaskDetail(props: TaskDetailProps) {
  const { task, mutate, now } = props
  const delegateTarget = useTourTarget('tasks.delegate', { entityId: task.id })
  const { t, i18n } = useTranslation()
  const [tab, setTab] = React.useState<DetailTab>('details')
  const [editingNotes, setEditingNotes] = React.useState(false)
  const [checkDraft, setCheckDraft] = React.useState('')
  const [tagDraft, setTagDraft] = React.useState('')
  const [nlDate, setNlDate] = React.useState('')
  const [subDraft, setSubDraft] = React.useState('')
  const [linkKind, setLinkKind] = React.useState<TaskLinkKind>('note')
  const [linkId, setLinkId] = React.useState('')
  const [confirmPurge, setConfirmPurge] = React.useState(false)
  const notesRef = React.useRef<HTMLTextAreaElement>(null)
  const dateFmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }), [i18n.language])
  const timeFmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }), [i18n.language])

  React.useEffect(() => {
    setEditingNotes(false)
    setTab('details')
    setNlDate('')
  }, [task.id])
  React.useEffect(() => { if (editingNotes) notesRef.current?.focus() }, [editingNotes])

  const update = (patch: Partial<PersonalTask>) => mutate((current) => { current.update(task.id, patch) })
  const setWhen = (when: TaskWhen) => {
    mutate((current) => { current.setWhen(task.id, when) })
    props.setPopover(null)
  }
  const notes = visibleNotes(task.notes)
  const source = deriveTaskSource(task)
  const progress = checklistProgress(task)
  const trashed = task.trashedAt != null
  const reminderStatus = task.reminderDeliveredFor === task.reminderAt
    ? t('tasks.reminder.shown')
    : task.reminderError === 'permission-denied'
      ? t('tasks.reminder.permissionDenied')
      : task.reminderError === 'permission-required'
        ? t('tasks.reminder.permissionRequired')
        : task.reminderError
          ? t('tasks.reminder.deliveryFailed')
          : task.reminderAt != null && task.reminderAt < now
            ? t('tasks.reminder.past')
            : t('tasks.reminder.scheduled')

  const whenLabel = (() => {
    if (task.startAt != null && task.startAt >= startOfLocalDay(now) + 86400000) return dateFmt.format(task.startAt) + (task.evening ? ` · ${t('tasks.when.evening')}` : '')
    if (task.list === 'today' || (task.startAt != null && task.startAt < startOfLocalDay(now) + 86400000)) return task.evening ? t('tasks.when.evening') : t('tasks.when.today')
    if (task.list === 'anytime') return t('tasks.when.anytime')
    if (task.list === 'someday') return t('tasks.when.someday')
    if (task.list === 'upcoming') return t('tasks.projection.upcoming')
    return t('tasks.when.none')
  })()

  const deadlineDays = task.dueAt != null ? daysUntil(task.dueAt, now) : null
  const deadlineLabel = task.dueAt != null
    ? `${dateFmt.format(task.dueAt)} · ${deadlineDays! < 0 ? t('tasks.deadline.overdue', { count: -deadlineDays! }) : deadlineDays === 0 ? t('tasks.deadline.today') : t('tasks.deadline.left', { count: deadlineDays! })}`
    : null

  const toLocalInput = (at: number) => {
    const d = new Date(at)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const addTag = (raw: string) => {
    const tags = raw.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)
    if (!tags.length) return
    update({ tags: [...new Set([...task.tags, ...tags])] })
    setTagDraft('')
  }
  const tagSuggestions = tagDraft.trim()
    ? props.allTags.filter((tag) => tag.toLowerCase().startsWith(tagDraft.trim().replace(/^#/, '').toLowerCase()) && !task.tags.includes(tag)).slice(0, 6)
    : []

  const fieldRow = (label: string, children: React.ReactNode, testId?: string) => (
    <div className="flex min-h-8 items-center gap-2" data-testid={testId}>
      <span className="w-[112px] shrink-0 text-[12px] text-text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</div>
    </div>
  )

  const renderLink = (link: TaskLink) => {
    const session = link.kind === 'session' ? props.sessionMap.get(link.id) : undefined
    const label = session ? (session.name || session.preview || link.id) : (link.label || link.id)
    return (
      <li key={`${link.kind}:${link.id}`} className="flex items-center gap-2 rounded-[6px] bg-foreground/[0.04] px-2 py-1.5">
        <span className="shrink-0 text-text-muted">{t(`tasks.linkKind.${link.kind}`)}</span>
        <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => props.onOpenSource(link)}>
          «{label}»
        </button>
        {session ? (
          <Badge tone={session.isProcessing ? 'success' : session.sessionStatus === 'needs-review' ? 'warning' : 'muted'}>
            {session.isProcessing ? t('tasks.chip.running') : t(`tasks.sessionStatus.${session.sessionStatus ?? 'todo'}`, { defaultValue: session.sessionStatus ?? '' })}
          </Badge>
        ) : link.kind === 'session' ? <Badge>{t('tasks.links.sessionMissing')}</Badge> : null}
        <button type="button" className="shrink-0 text-[11px] text-text-muted hover:text-foreground" onClick={() => mutate((current) => { current.unlink(task.id, link) })}>
          {t('tasks.unlink')}
        </button>
      </li>
    )
  }

  return (
    <div className="flex flex-col px-5 py-4" data-testid="task-detail">
      {trashed ? (
        <div className="mb-3 flex items-center gap-2 rounded-[8px] bg-destructive/10 px-3 py-2 text-[12px]" role="status" data-testid="task-trashed">
          <span className="min-w-0 flex-1">{t('tasks.trash.inTrash')}</span>
          <Button onClick={() => mutate((current) => { current.restore(task.id) })}>{t('tasks.trash.restore')}</Button>
          <Button variant="danger" onClick={() => setConfirmPurge(true)}>{t('tasks.trash.deleteForever')}</Button>
        </div>
      ) : null}
      <div className="flex items-start gap-2">
        <span className="pt-1.5">
          <TaskCheckbox checked={Boolean(task.completedAt)} cancelled={Boolean(task.cancelledAt)} onToggle={props.onToggleComplete} label={t('tasks.complete')} size={16} />
        </span>
        <input
          ref={props.titleRef}
          className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold outline-none"
          value={task.title}
          onChange={(event) => {
            const title = event.target.value
            if (title.trim()) update({ title })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              setEditingNotes(true)
            }
          }}
          aria-label={t('tasks.titleLabel')}
        />
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-6 text-[12px] text-text-muted">
        <span>{props.placeLabel}</span>
        {task.completedAt ? <span>· {t('tasks.row.doneAt', { time: `${dateFmt.format(task.completedAt)} ${timeFmt.format(task.completedAt)}` })}</span> : null}
        {progress.total ? <span>· {t('tasks.checklist.progress', { done: progress.done, total: progress.total })}</span> : null}
      </div>

      <div className="mt-3">
        <Tabs<DetailTab>
          label={t('tasks.detailTabs')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'details', label: t('tasks.tab.details') },
            { id: 'links', label: t('tasks.links'), count: task.links.length },
            { id: 'history', label: t('tasks.tab.history') },
          ]}
        />
      </div>

      {tab === 'details' ? (
        <>
          <SectionLabel>{t('tasks.notes')}</SectionLabel>
          {editingNotes ? (
            <textarea
              ref={notesRef}
              className="min-h-[96px] rounded-[6px] bg-foreground/[0.04] p-2 text-[13px] leading-5 outline-none focus:bg-foreground/[0.06]"
              value={notes}
              placeholder={t('tasks.notesPlaceholder')}
              onChange={(event) => update({ notes: mergeNotesMarkers(task.notes, event.target.value) })}
              onBlur={() => setEditingNotes(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setEditingNotes(false)
                }
              }}
              aria-label={t('tasks.notes')}
              data-testid="task-notes-editor"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingNotes(true)}
              className="min-h-[40px] rounded-[6px] px-2 py-1.5 text-left text-[13px] hover:bg-foreground/[0.04]"
              aria-label={t('tasks.notesEdit')}
              data-testid="task-notes"
            >
              {notes ? <Markdown mode="minimal">{notes}</Markdown> : <span className="text-text-muted">{t('tasks.notesPlaceholder')}</span>}
            </button>
          )}

          <SectionLabel>{progress.total ? t('tasks.checklist.titleCount', { done: progress.done, total: progress.total }) : t('tasks.checklist.title')}</SectionLabel>
          <ul className="flex flex-col" data-testid="task-checklist">
            {(task.checklist ?? []).map((item, index) => (
              <li key={item.id} className="group flex items-center gap-2 py-0.5">
                <TaskCheckbox
                  checked={item.done}
                  onToggle={() => mutate((current) => { current.updateChecklistItem(task.id, item.id, { done: !item.done }) })}
                  label={t('tasks.checklist.toggle')}
                  size={13}
                />
                <input
                  value={item.title}
                  onChange={(event) => mutate((current) => { current.updateChecklistItem(task.id, item.id, { title: event.target.value }) })}
                  onKeyDown={(event) => {
                    if (event.key === 'Backspace' && !item.title) {
                      event.preventDefault()
                      mutate((current) => { current.removeChecklistItem(task.id, item.id) })
                    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                      event.preventDefault()
                      const ids = (task.checklist ?? []).map((c) => c.id)
                      const to = event.key === 'ArrowUp' ? index - 1 : index + 1
                      if (to < 0 || to >= ids.length) return
                      ids.splice(index, 1)
                      ids.splice(to, 0, item.id)
                      mutate((current) => { current.reorderChecklist(task.id, ids) })
                    }
                  }}
                  aria-label={t('tasks.checklist.item')}
                  className={cn('h-6 min-w-0 flex-1 bg-transparent text-[13px] outline-none', item.done && 'text-text-muted line-through')}
                />
                <button
                  type="button"
                  className="text-[11px] text-text-muted opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  onClick={() => mutate((current) => { current.removeChecklistItem(task.id, item.id) })}
                  aria-label={t('tasks.checklist.remove')}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!checkDraft.trim()) return
              mutate((current) => { current.addChecklistItem(task.id, checkDraft) })
              setCheckDraft('')
            }}
          >
            <span className="w-[13px] shrink-0 text-center text-text-muted">+</span>
            <input
              value={checkDraft}
              onChange={(event) => setCheckDraft(event.target.value)}
              placeholder={t('tasks.checklist.add')}
              aria-label={t('tasks.checklist.add')}
              data-testid="task-checklist-add"
              className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-muted"
            />
          </form>

          {props.subtasks.length ? (
            <>
              <SectionLabel>{t('tasks.subtasks', { done: props.subtasks.filter((s) => s.completedAt).length, total: props.subtasks.length })}</SectionLabel>
              <ul className="flex flex-col gap-0.5" data-testid="task-subtasks">
                {props.subtasks.map((sub) => (
                  <li key={sub.id} className="group flex items-center gap-2 py-0.5">
                    <TaskCheckbox checked={Boolean(sub.completedAt)} onToggle={() => mutate((current) => { if (sub.completedAt) current.reopen(sub.id); else current.complete(sub.id) })} label={t('tasks.complete')} size={13} />
                    <span className={cn('min-w-0 flex-1 truncate', sub.completedAt && 'text-text-muted line-through')}>{sub.title}</span>
                    <button type="button" className="text-[11px] text-text-muted opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100" onClick={() => mutate((current) => { current.remove(sub.id) })}>
                      {t('tasks.removeSubtask')}
                    </button>
                  </li>
                ))}
              </ul>
              <form className="mt-1 flex" onSubmit={(event) => { event.preventDefault(); if (!subDraft.trim()) return; mutate((current) => { current.addSubtask(task.id, subDraft.trim()) }); setSubDraft('') }}>
                <input value={subDraft} onChange={(event) => setSubDraft(event.target.value)} placeholder={t('tasks.addSubtaskPlaceholder')} aria-label={t('tasks.addSubtaskPlaceholder')} className="h-7 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.04] px-2 text-[12px] outline-none" />
              </form>
            </>
          ) : null}

          <SectionLabel>{t('tasks.section.schedule')}</SectionLabel>
          <div className="flex flex-col gap-0.5">
            {fieldRow(t('tasks.field.when'), (
              <>
                <Button className="min-w-0 max-w-full shrink" onClick={() => props.setPopover(props.popover === 'when' ? null : 'when')} data-testid="task-when" aria-expanded={props.popover === 'when'}>
                  {task.evening ? Glyph.moon : task.list === 'today' ? Glyph.star : null}
                  <span className="min-w-0 truncate">{whenLabel}</span> <span className="shrink-0 opacity-60">⌘S</span>
                </Button>
              </>
            ), 'task-field-when')}
            {props.popover === 'when' ? (
              <div className="mt-1 w-[260px] max-w-full rounded-[8px] sm:ml-[120px] bg-foreground/[0.04] p-2" data-testid="task-when-popover">
                <div className="flex flex-col gap-0.5">
                  <button type="button" className="flex h-7 items-center gap-2 rounded-[6px] px-2 text-left hover:bg-foreground/[0.07]" onClick={() => setWhen({ kind: 'today' })}>{Glyph.star}{t('tasks.when.today')}<span className="ml-auto text-[11px] text-text-muted">⌘T</span></button>
                  <button type="button" className="flex h-7 items-center gap-2 rounded-[6px] px-2 text-left hover:bg-foreground/[0.07]" onClick={() => setWhen({ kind: 'evening' })}>{Glyph.moon}{t('tasks.when.evening')}<span className="ml-auto text-[11px] text-text-muted">⌘E</span></button>
                </div>
                <div className="mt-1.5"><MiniCalendar value={task.startAt} now={now} locale={i18n.language} onPick={(at) => setWhen({ kind: 'date', at })} /></div>
                <form className="mt-1.5" onSubmit={(event) => {
                  event.preventDefault()
                  const at = parseDateExpression(nlDate, now)
                  if (at != null) setWhen({ kind: 'date', at })
                }}>
                  <input value={nlDate} onChange={(event) => setNlDate(event.target.value)} placeholder={t('tasks.when.nlPlaceholder')} aria-label={t('tasks.when.nlPlaceholder')} className="h-7 w-full rounded-[6px] bg-background px-2 text-[12px] outline-none placeholder:text-text-muted" />
                </form>
                <div className="mt-1.5 flex flex-col gap-0.5">
                  <button type="button" className="flex h-7 items-center rounded-[6px] px-2 text-left hover:bg-foreground/[0.07]" onClick={() => setWhen({ kind: 'anytime' })}>{t('tasks.when.anytime')}</button>
                  <button type="button" className="flex h-7 items-center rounded-[6px] px-2 text-left hover:bg-foreground/[0.07]" onClick={() => setWhen({ kind: 'someday' })}>{t('tasks.when.someday')}</button>
                  <button type="button" className="flex h-7 items-center rounded-[6px] px-2 text-left text-text-muted hover:bg-foreground/[0.07]" onClick={() => setWhen(task.projectId || task.areaId ? { kind: 'anytime' } : { kind: 'inbox' })}>{t('tasks.when.clear')}</button>
                </div>
              </div>
            ) : null}
            {fieldRow(t('tasks.field.deadline'), (
              <>
                <Button onClick={() => props.setPopover(props.popover === 'deadline' ? null : 'deadline')} data-testid="task-deadline" className={cn('min-w-0 max-w-full shrink', deadlineDays != null && deadlineDays <= 0 && 'text-destructive')}>
                  {Glyph.flag}<span className="min-w-0 truncate">{deadlineLabel ?? t('tasks.deadline.add')}</span> <span className="shrink-0 opacity-60">⇧⌘D</span>
                </Button>
                {task.dueAt != null ? <Button variant="ghost" onClick={() => mutate((current) => { current.setDeadline(task.id, undefined) })}>{t('tasks.clearDate')}</Button> : null}
              </>
            ), 'task-field-deadline')}
            {props.popover === 'deadline' ? (
              <div className="mt-1 w-[260px] max-w-full rounded-[8px] sm:ml-[120px] bg-foreground/[0.04] p-2">
                <MiniCalendar value={task.dueAt} now={now} locale={i18n.language} onPick={(at) => { mutate((current) => { current.setDeadline(task.id, at) }); props.setPopover(null) }} />
              </div>
            ) : null}
            {fieldRow(t('tasks.field.reminder'), (
              <>
                <input
                  type="datetime-local"
                  className="h-7 rounded-[6px] bg-foreground/[0.07] px-2 text-[12px] outline-none"
                  aria-label={t('tasks.field.reminder')}
                  data-testid="task-reminder"
                  value={task.reminderAt != null ? toLocalInput(task.reminderAt) : ''}
                  onChange={(event) => {
                    const value = event.target.value
                    update(value ? { reminderAt: new Date(value).getTime(), reminderTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, reminderDeliveredFor: undefined, reminderRetryAt: undefined, reminderError: undefined } : { reminderAt: undefined, reminderTimeZone: undefined, reminderDeliveredFor: undefined, reminderRetryAt: undefined, reminderError: undefined })
                  }}
                />
                {task.reminderAt != null ? (
                  <>
                    <span className={cn('text-[11px]', task.reminderError ? 'text-destructive' : task.reminderAt < now ? 'text-text-muted' : 'text-text-secondary')}>{reminderStatus}</span>
                    <Button variant="ghost" onClick={() => update({ reminderAt: undefined, reminderTimeZone: undefined, reminderDeliveredFor: undefined, reminderRetryAt: undefined, reminderError: undefined })}>{t('tasks.clearDate')}</Button>
                  </>
                ) : null}
              </>
            ), 'task-field-reminder')}
            {fieldRow(t('tasks.field.repeat'), (
              <>
                {RECURRENCES.map((rule) => (
                  <button
                    key={rule}
                    type="button"
                    aria-pressed={(task.recurrence?.rule ?? 'none') === rule}
                    onClick={() => update({ recurrence: rule === 'none' ? undefined : { rule, interval: task.recurrence?.interval ?? 1, mode: task.recurrence?.mode, weekdays: rule === 'weekly' ? task.recurrence?.weekdays : undefined, timeZone: task.recurrence?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone } })}
                    className={cn('h-6 rounded-[6px] px-2 text-[12px]', (task.recurrence?.rule ?? 'none') === rule ? 'bg-accent/15 font-semibold' : 'bg-foreground/[0.05] text-text-secondary hover:bg-foreground/[0.09]')}
                  >
                    {t(`tasks.recurrence.${rule}`)}
                  </button>
                ))}
              </>
            ), 'task-field-repeat')}
            {task.recurrence ? (
              <div className="ml-[120px] flex flex-wrap items-center gap-1.5 pb-1 text-[12px]">
                <span className="text-text-muted">{t('tasks.repeat.every')}</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={task.recurrence.interval}
                  onChange={(event) => update({ recurrence: { ...task.recurrence!, interval: Math.max(1, Number(event.target.value) || 1) } })}
                  aria-label={t('tasks.repeat.interval')}
                  className="h-6 w-12 rounded-[6px] bg-foreground/[0.07] px-1.5 text-center outline-none"
                />
                <span>{t(`tasks.repeat.unit.${task.recurrence.rule}`, { count: task.recurrence.interval })}</span>
                {task.recurrence.rule === 'weekly' ? (
                  <span className="flex gap-0.5" role="group" aria-label={t('tasks.repeat.weekdays')}>
                    {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
                      const on = (task.recurrence!.weekdays ?? []).includes(wd)
                      return (
                        <button
                          key={wd}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const set = new Set(task.recurrence!.weekdays ?? [])
                            if (on) set.delete(wd); else set.add(wd)
                            update({ recurrence: { ...task.recurrence!, weekdays: [...set].sort() } })
                          }}
                          className={cn('size-6 rounded-[4px] text-[11px]', on ? 'bg-accent text-[var(--accent-foreground,white)]' : 'bg-foreground/[0.05] text-text-secondary')}
                        >
                          {new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' }).format(new Date(2024, 0, wd === 0 ? 7 : wd))}
                        </button>
                      )
                    })}
                  </span>
                ) : null}
                <span className="flex gap-0.5" role="group" aria-label={t('tasks.repeat.mode')}>
                  {(['fixed', 'after'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={(task.recurrence!.mode ?? 'fixed') === mode}
                      onClick={() => update({ recurrence: { ...task.recurrence!, mode } })}
                      className={cn('h-6 rounded-[6px] px-2', (task.recurrence!.mode ?? 'fixed') === mode ? 'bg-accent/15 font-semibold' : 'bg-foreground/[0.05] text-text-secondary')}
                    >
                      {t(`tasks.repeat.${mode}`)}
                    </button>
                  ))}
                </span>
              </div>
            ) : null}
          </div>

          <SectionLabel>{t('tasks.section.organize')}</SectionLabel>
          <div className="flex flex-col gap-0.5">
            {fieldRow(t('tasks.field.place'), (
              <Button onClick={props.onOpenMove} data-testid="task-move">{props.placeLabel} <span className="opacity-60">⌘K</span></Button>
            ))}
            {fieldRow(t('tasks.tags'), (
              <>
                {task.tags.map((tag) => (
                  <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-foreground/[0.07] pl-2 pr-1 text-[12px]">
                    #{tag}
                    <button type="button" aria-label={t('tasks.tagRemove', { tag })} className="px-0.5 text-text-muted hover:text-foreground" onClick={() => update({ tags: task.tags.filter((x) => x !== tag) })}>×</button>
                  </span>
                ))}
                <span className="relative">
                  <input
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ',') {
                        event.preventDefault()
                        addTag(tagDraft)
                      } else if (event.key === 'Backspace' && !tagDraft && task.tags.length) {
                        update({ tags: task.tags.slice(0, -1) })
                      }
                    }}
                    placeholder={t('tasks.tagAdd')}
                    aria-label={t('tasks.tagAdd')}
                    data-testid="task-tag-input"
                    className="h-6 w-[120px] rounded-[6px] bg-foreground/[0.04] px-2 text-[12px] outline-none placeholder:text-text-muted"
                  />
                  {tagSuggestions.length ? (
                    <span className="absolute left-0 top-7 z-10 flex min-w-[140px] flex-col rounded-[6px] bg-background p-1 shadow-modal-small">
                      {tagSuggestions.map((tag) => (
                        <button key={tag} type="button" onMouseDown={(event) => { event.preventDefault(); addTag(tag) }} className="h-6 rounded-[4px] px-2 text-left text-[12px] hover:bg-foreground/[0.07]">#{tag}</button>
                      ))}
                    </span>
                  ) : null}
                </span>
              </>
            ), 'task-field-tags')}
            {fieldRow(t('tasks.priority'), (
              <span className="flex flex-wrap gap-1" role="group" aria-label={t('tasks.priority')}>
                {PRIORITIES.map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    aria-pressed={task.priority === priority}
                    onClick={() => update({ priority })}
                    className={cn('h-6 rounded-[6px] px-2 text-[12px]', task.priority === priority ? 'bg-accent/15 font-semibold' : 'bg-foreground/[0.05] text-text-secondary hover:bg-foreground/[0.09]')}
                  >
                    {t(`tasks.priority.${priority}`)}
                  </button>
                ))}
              </span>
            ))}
            {source ? fieldRow(t('tasks.field.source'), (
              <button type="button" onClick={() => props.onOpenSource(source)} className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] px-2 text-[12px] hover:bg-foreground/[0.06]" data-testid="task-source">
                {Glyph.link}
                <span className="text-text-muted">{t(`tasks.linkKind.${source.kind}`)}</span>
                <span className="min-w-0 truncate underline-offset-2 hover:underline">{source.label || source.id}</span>
              </button>
            ), 'task-field-source') : null}
          </div>

          <Card className="mt-4">
            <div className="text-[13px] font-semibold">{t('tasks.delegate.title')}</div>
            <div className="mt-1 text-[12px] text-text-secondary">{t('tasks.delegate.body')}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span ref={delegateTarget} className="inline-flex" data-tour="tasks.delegate">
                <Button variant="primary" data-testid="task-delegate" disabled={props.delegating || !props.canDelegate || trashed} onClick={props.onDelegate}>
                  {props.delegating ? t('tasks.delegate.running') : t('tasks.delegate.action')} <span className="opacity-70">⌘↵</span>
                </Button>
              </span>
              {props.agentChip ? (
                <>
                  <Badge tone={CHIP_TONE[props.agentChip.chip]}>{t(`tasks.chip.${props.agentChip.chip}`)}</Badge>
                  <Button onClick={() => props.onOpenSession(props.agentChip!.sessionId)}>{t('tasks.openSession')}</Button>
                </>
              ) : null}
              <Button variant="ghost" onClick={props.onOpenBoard}>{t('tasks.delegate.toBoard')}</Button>
            </div>
            {props.delegateError ? <div className="mt-2 text-[12px] text-destructive" role="alert">{t('tasks.delegate.failed', { error: props.delegateError })}</div> : null}
          </Card>

          {!trashed ? (
            <div className="mt-6 flex gap-1.5">
              <Button variant="danger" onClick={props.onTrash} data-testid="task-trash">{t('tasks.trash.move')} <span className="opacity-60">⌘⌫</span></Button>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'links' ? (
        <>
          <SectionLabel>{t('tasks.links')}</SectionLabel>
          {task.links.length === 0 ? <div className="text-[12px] text-text-muted">{t('tasks.links.empty')}</div> : <ul className="flex flex-col gap-1">{task.links.map(renderLink)}</ul>}
          <SectionLabel>{t('tasks.addLink')}</SectionLabel>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('tasks.addLink')}>
            {LINK_KINDS.map((kind) => (
              <button key={kind} type="button" aria-pressed={linkKind === kind} onClick={() => setLinkKind(kind)} className={cn('h-6 rounded-[6px] px-2 text-[12px]', linkKind === kind ? 'bg-accent/15 font-semibold' : 'bg-foreground/[0.05] text-text-secondary')}>
                {t(`tasks.linkKind.${kind}`)}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1">
            <input className="h-7 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.04] px-2 text-[12px] outline-none" value={linkId} onChange={(event) => setLinkId(event.target.value)} placeholder={t('tasks.linkIdPlaceholder')} aria-label={t('tasks.linkIdPlaceholder')} />
            <Button onClick={() => { if (!linkId.trim()) return; const id = linkId.trim(); mutate((current) => { current.link(task.id, { kind: linkKind, id }) }); setLinkId('') }}>{t('tasks.addLink')}</Button>
          </div>
        </>
      ) : null}

      {tab === 'history' ? (
        <>
          <SectionLabel>{t('tasks.tab.history')}</SectionLabel>
          <ul className="flex flex-col gap-1 text-[12px]" data-testid="task-history">
            {props.store.auditLog().filter((event) => event.taskId === task.id).slice(-50).reverse().map((event, index) => (
              <li key={`${event.at}-${index}`} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-text-muted">{dateFmt.format(event.at)} {timeFmt.format(event.at)}</span>
                <span>{t(`tasks.audit.${event.action.replace('.', '_')}`, { defaultValue: event.action })}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {confirmPurge ? (
        <ConfirmDialog
          title={t('tasks.trash.deleteForeverTitle')}
          body={t('tasks.trash.deleteForeverBody', { title: task.title })}
          confirmLabel={t('tasks.trash.deleteForever')}
          onCancel={() => setConfirmPurge(false)}
          onConfirm={() => {
            setConfirmPurge(false)
            mutate((current) => { current.remove(task.id) })
            props.onClose()
          }}
        />
      ) : null}
    </div>
  )
}
