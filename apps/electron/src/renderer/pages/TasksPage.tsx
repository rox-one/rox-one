/**
 * Задачи — three-panel mode screen (navigator → list → detail).
 *
 * Data: Things-style PersonalTask bundle (lib/personal-tasks) — canonical copy
 * in server-core PersonalTaskPersistStore via personalTasks:* RPC, localStorage
 * as cache + one-time migration source. «Агенты» are selectors over the live
 * session list (sessionStatus / isProcessing / taskSlug). «Поручить агенту»
 * creates a session (status «К выполнению», task as prompt) and links it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useAtomValue } from 'jotai'
import {
  PersonalTaskStore,
  filterAndSortTasks,
  isOpenTask,
  startOfLocalDay,
  type PersonalTask,
  type RecurrenceRule,
  type TaskFilterId,
  type TaskLinkKind,
  type TaskPriority,
  type TaskSortId,
} from '@craft-agent/core/tasks/personal'
import { CalendarStatusStrip } from '@/components/calendar/CalendarStatusStrip'
import { useActiveWorkspace, useOptionalAppShellContext } from '@/context/AppShellContext'
import { useProjects } from '@/hooks/useProjects'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import {
  loadPersonalTaskStore,
  persistPersonalTaskStore,
  personalTasksLoadStatus,
  personalTasksSyncState,
  subscribePersonalTasks,
} from '@/lib/personal-tasks'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  GroupLabel,
  ListHeader,
  ListRow,
  ModeScreenLayout,
  NavItem,
  NavSection,
  NavTitle,
  SectionLabel,
  Tabs,
  useListKeys,
  type Tone,
} from '@/components/mode-screen/ModeScreen'
import { tasksViewAtom } from './tasks/atoms'
import {
  agentChipFor,
  agentCounts,
  agentSessions,
  buildDelegationPrompt,
  countFilter,
  parseAgentMention,
  splitEvening,
  subtasksOf,
  type AgentChip,
  type AgentSessionLike,
  type AgentViewId,
} from './tasks/task-model'
import { getSessionTitle } from '@/utils/session'

const NAV_FILTERS: TaskFilterId[] = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook']
const AGENT_VIEWS: AgentViewId[] = ['board', 'running', 'review', 'conductor']
const SORTS: TaskSortId[] = ['order', 'due', 'priority', 'project', 'title']
const LINK_KINDS: TaskLinkKind[] = ['note', 'session', 'message', 'workflowRun']
const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high']
const RECURRENCES: Array<RecurrenceRule | 'none'> = ['none', 'daily', 'weekly', 'monthly', 'yearly']
const DAY = 24 * 60 * 60 * 1000
const PROJECT_DOTS: Tone[] = ['info', 'success', 'muted', 'accent', 'warning']
const AGENT_DOTS: Record<AgentViewId, Tone> = { board: 'accent', running: 'success', review: 'warning', conductor: 'muted' }
const CHIP_TONE: Record<AgentChip, Tone> = { running: 'success', review: 'warning', todo: 'accent', done: 'muted', linked: 'muted' }

function filterLabelKey(id: TaskFilterId): string {
  return id === 'all' ? 'tasks.filterAll' : `tasks.projection.${id}`
}

function priorityMark(priority: TaskPriority): string {
  return priority === 'high' ? '!!' : priority === 'medium' ? '!' : ''
}

export interface TasksPageProps {
  /** Undefined keeps standalone/local selection; null/string is route-bound. */
  selectedId?: string | null
}

type DetailTab = 'details' | 'links' | 'history'

export default function TasksPage(props: TasksPageProps = {}) {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const shell = useOptionalAppShellContext()
  const { projects } = useProjects(workspace?.id)
  const sessionMap = useAtomValue(sessionMetaMapAtom) as ReadonlyMap<string, AgentSessionLike>
  const [store, setStore] = useState(loadPersonalTaskStore)
  const [view, setView] = useAtom(tasksViewAtom)
  const [sort, setSort] = useState<TaskSortId>('order')
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('details')
  const [delegating, setDelegating] = useState(false)
  const [delegateError, setDelegateError] = useState<string | null>(null)
  const routeBound = props.selectedId !== undefined
  const selectedId = routeBound ? props.selectedId ?? null : localSelectedId
  const selectTask = useCallback((id: string | null) => {
    if (routeBound) navigate(routes.view.tasks(id ?? undefined))
    else setLocalSelectedId(id)
  }, [routeBound])
  const [draft, setDraft] = useState('')
  const [subDraft, setSubDraft] = useState('')
  const [linkKind, setLinkKind] = useState<TaskLinkKind>('note')
  const [linkId, setLinkId] = useState('')
  const quickRef = useRef<HTMLInputElement>(null)
  const now = Date.now()

  useEffect(() => subscribePersonalTasks(() => setStore(loadPersonalTaskStore())), [])

  const persist = useCallback((next: PersonalTaskStore) => {
    setStore(next)
    persistPersonalTaskStore(next)
  }, [])

  const mutate = useCallback((fn: (current: PersonalTaskStore) => void) => {
    const next = PersonalTaskStore.fromJson(store.exportJson())
    fn(next)
    persist(next)
  }, [persist, store])

  const tasks = store.list()
  const topLevel = useMemo(() => tasks.filter((task) => !task.parentId), [tasks])
  const filter: TaskFilterId = view.kind === 'list' ? view.id : 'all'
  const projectFilter = view.kind === 'project' ? view.id : null
  const visible = useMemo(
    () => (view.kind === 'agents' ? [] : filterAndSortTasks(topLevel, now, { filter, projectId: projectFilter, sort })),
    [topLevel, now, filter, projectFilter, sort, view.kind],
  )
  const sessions = useMemo(() => [...sessionMap.values()], [sessionMap])
  const agents = useMemo(() => agentCounts(sessions), [sessions])
  const agentList = useMemo(() => (view.kind === 'agents' ? agentSessions(sessions, view.id) : []), [sessions, view])
  const projectName = useCallback((projectId?: string) => {
    if (!projectId) return t('tasks.unassigned')
    return projects.find((project) => project.config.id === projectId)?.config.name ?? projectId
  }, [projects, t])
  const selected = selectedId ? store.get(selectedId) : undefined
  const subtasks = selected ? subtasksOf(tasks, selected.id) : []

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }), [i18n.language])
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }), [i18n.language])
  const formatDue = (at?: number) => {
    if (at == null) return null
    const day = startOfLocalDay(at)
    const today = startOfLocalDay(now)
    if (day === today) return t('tasks.due.today')
    if (day === today + DAY) return t('tasks.due.tomorrow')
    if (day < today) return t('tasks.due.overdue', { date: dateFmt.format(at) })
    return dateFmt.format(at)
  }

  const delegate = useCallback(async (task: PersonalTask) => {
    if (!workspace?.id || !shell) return
    setDelegating(true)
    setDelegateError(null)
    try {
      const prompt = buildDelegationPrompt(task, subtasksOf(store.list(), task.id), t('tasks.delegate.promptHeading'))
      const session = await shell.onCreateSession(workspace.id, {
        sessionStatus: 'todo',
        ...(task.projectId ? { projectId: task.projectId } : {}),
      })
      await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: task.title })
      await window.electronAPI.sessionCommand(session.id, { type: 'setSessionStatus', state: 'todo' })
      mutate((current) => current.link(task.id, { kind: 'session', id: session.id }))
      await window.electronAPI.sendMessage(session.id, prompt)
    } catch (error) {
      setDelegateError(error instanceof Error ? error.message : String(error))
    } finally {
      setDelegating(false)
    }
  }, [workspace?.id, shell, store, mutate, t])

  const onCreateTask = (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    const mention = parseAgentMention(draft)
    if (!mention.title) return
    let created: PersonalTask | null = null
    mutate((current) => {
      created = current.create({
        title: mention.title,
        list: filter === 'logbook' || filter === 'all' ? 'inbox' : filter,
        projectId: projectFilter ?? undefined,
        quickEntry: true,
      })
      selectTask(created.id)
    })
    setDraft('')
    if (mention.delegate && created) void delegate(created)
  }

  const toggleComplete = (task: PersonalTask) => {
    mutate((current) => {
      if (task.completedAt) current.reopen(task.id)
      else current.complete(task.id)
    })
  }

  const schedule = (task: PersonalTask, when: 'today' | 'tomorrow' | 'someday' | 'clear') => {
    mutate((current) => {
      if (when === 'today') {
        current.move(task.id, 'today')
        current.update(task.id, { dueAt: undefined })
      } else if (when === 'tomorrow') {
        current.move(task.id, 'upcoming')
        current.update(task.id, { dueAt: startOfLocalDay(now) + DAY + 18 * 60 * 60 * 1000 })
      } else if (when === 'someday') {
        current.move(task.id, 'someday')
        current.update(task.id, { dueAt: undefined })
      } else {
        current.update(task.id, { dueAt: undefined, startAt: undefined })
      }
    })
  }

  const dropOn = (targetId: string, sourceId: string) => {
    if (!sourceId || sourceId === targetId) return
    const ids = visible.map((task) => task.id)
    const from = ids.indexOf(sourceId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const reordered = [...ids]
    const [item] = reordered.splice(from, 1)
    reordered.splice(to, 0, item!)
    mutate((current) => current.reorder(reordered))
  }

  const removeTask = (task: PersonalTask) => {
    mutate((current) => { current.remove(task.id) })
    selectTask(null)
  }

  const onExport = () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'rox-tasks.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const onImport = async (file: File) => {
    const text = await file.text()
    const incoming = PersonalTaskStore.tryFromJson(text)
    if (incoming.status !== 'ok') return
    const next = PersonalTaskStore.fromJson(store.exportJson())
    next.importBundle(incoming.store.snapshot(), 'merge')
    persist(next)
  }

  const addLink = () => {
    if (!selected || !linkId.trim()) return
    const id = linkId.trim()
    mutate((current) => current.link(selected.id, { kind: linkKind, id }))
    setLinkId('')
  }

  const openSession = (sessionId: string) => navigate(routes.view.allSessions(sessionId))
  const selectedChip = selected ? agentChipFor(selected, sessionMap) : null

  const listKeys = useListKeys(visible, selected ?? null, (task) => selectTask(task.id))
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement
    const inField = Boolean(target.closest('input, textarea, [contenteditable="true"]'))
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key === 'Enter' && selected) {
      event.preventDefault()
      void delegate(selected)
      return
    }
    if (inField) return
    if (mod && event.key === 'Backspace' && selected) {
      event.preventDefault()
      removeTask(selected)
      return
    }
    if (mod || event.altKey) return
    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault()
      quickRef.current?.focus()
    } else if (event.key === ' ' && selected) {
      event.preventDefault()
      toggleComplete(selected)
    } else if ((event.key === 't' || event.key === 'T') && selected) {
      event.preventDefault()
      schedule(selected, event.shiftKey ? 'tomorrow' : 'today')
    } else if (['1', '2', '3'].includes(event.key) && selected) {
      event.preventDefault()
      const priority: TaskPriority = event.key === '1' ? 'high' : event.key === '2' ? 'medium' : 'low'
      mutate((current) => current.update(selected.id, { priority }))
    } else if ((event.key === 'o' || event.key === 'O') && selectedChip) {
      event.preventDefault()
      openSession(selectedChip.sessionId)
    } else if (event.key === 'Escape' && selected) {
      event.preventDefault()
      selectTask(null)
    } else {
      listKeys(event)
    }
  }

  // ── Navigator ────────────────────────────────────────────────────────────
  const navigator = (
    <>
      <NavTitle>{t('workbench.mode.tasks')}</NavTitle>
      {NAV_FILTERS.map((id) => (
        <NavItem
          key={id}
          label={t(filterLabelKey(id))}
          count={id === 'logbook' ? null : countFilter(tasks, now, id)}
          active={view.kind === 'list' && view.id === id}
          onClick={() => setView({ kind: 'list', id })}
          testId={`tasks-nav-${id}`}
        />
      ))}
      <NavSection title={t('tasks.nav.agents')}>
        {AGENT_VIEWS.map((id) => (
          <NavItem
            key={id}
            dot={AGENT_DOTS[id]}
            label={t(`tasks.agents.${id}`)}
            count={agents[id]}
            active={view.kind === 'agents' && view.id === id}
            onClick={() => setView({ kind: 'agents', id })}
            testId={`tasks-nav-agents-${id}`}
          />
        ))}
      </NavSection>
      <NavSection title={t('tasks.nav.projects')}>
        <span className="sr-only">{t('tasks.filterProject')}</span>
        {projects.length === 0 ? (
          <div className="px-2 text-[12px] text-text-muted">{t('tasks.nav.noProjects')}</div>
        ) : projects.map((project, index) => (
          <NavItem
            key={project.config.id}
            dot={PROJECT_DOTS[index % PROJECT_DOTS.length]}
            label={project.config.name}
            count={topLevel.filter((task) => task.projectId === project.config.id && isOpenTask(task)).length}
            active={view.kind === 'project' && view.id === project.config.id}
            onClick={() => setView({ kind: 'project', id: project.config.id })}
          />
        ))}
      </NavSection>
    </>
  )

  // ── List ─────────────────────────────────────────────────────────────────
  const listTitle = view.kind === 'list'
    ? t(filterLabelKey(view.id))
    : view.kind === 'project'
      ? projectName(view.id)
      : t(`tasks.agents.${view.id}`)

  const renderTaskRow = (task: PersonalTask) => {
    const chip = agentChipFor(task, sessionMap)
    const due = formatDue(task.dueAt)
    const subs = subtasksOf(tasks, task.id)
    const meta = [
      task.projectId ? projectName(task.projectId) : null,
      task.completedAt ? t('tasks.row.doneAt', { time: timeFmt.format(task.completedAt) }) : due,
      task.evening && !task.completedAt ? t('tasks.row.evening') : null,
      subs.length ? t('tasks.row.subtasks', { done: subs.filter((s) => s.completedAt).length, total: subs.length }) : null,
    ].filter(Boolean)
    return (
      <div
        key={task.id}
        draggable
        onDragStart={(event) => event.dataTransfer.setData('text/task-id', task.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          dropOn(task.id, event.dataTransfer.getData('text/task-id'))
        }}
      >
        <ListRow selected={selectedId === task.id} onClick={() => selectTask(task.id)} testId={`task-row-${task.id}`}>
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent)]"
            checked={Boolean(task.completedAt)}
            onChange={() => toggleComplete(task)}
            onClick={(event) => event.stopPropagation()}
            aria-label={t('tasks.complete')}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {priorityMark(task.priority) ? (
                <span className={cn('shrink-0 font-bold', task.priority === 'high' ? 'text-destructive' : 'text-[var(--warning,#d9a13b)]')}>
                  {priorityMark(task.priority)}
                </span>
              ) : null}
              <span className={cn('min-w-0 truncate', task.completedAt && 'text-text-muted line-through')}>{task.title}</span>
              {chip ? <Badge tone={CHIP_TONE[chip.chip]}>{t(`tasks.chip.${chip.chip}`)}</Badge> : null}
            </div>
            {meta.length ? <div className="truncate text-[11px] text-text-muted">{meta.join(' · ')}</div> : null}
          </div>
          {task.tags.slice(0, 2).map((tag) => <Badge key={tag}>{tag}</Badge>)}
        </ListRow>
      </div>
    )
  }

  const renderTaskGroups = () => {
    if (visible.length === 0) {
      if (view.kind === 'list' && view.id === 'today') {
        const anytime = filterAndSortTasks(topLevel, now, { filter: 'anytime', sort: 'priority' }).slice(0, 3)
        return (
          <>
            <EmptyState testId="tasks-empty-today" title={t('tasks.empty.todayTitle')} body={t('tasks.empty.todayBody')} />
            {anytime.length ? (
              <>
                <GroupLabel>{t('tasks.empty.fromAnytime')}</GroupLabel>
                {anytime.map(renderTaskRow)}
              </>
            ) : null}
          </>
        )
      }
      return <EmptyState testId="tasks-empty" title={t('tasks.emptyAll')} />
    }
    if (view.kind === 'list' && view.id === 'today') {
      const { day, evening } = splitEvening(visible)
      return (
        <>
          <GroupLabel>{t('tasks.group.tasks', { count: day.length })}</GroupLabel>
          {day.map(renderTaskRow)}
          {evening.length ? (
            <>
              <GroupLabel>{t('tasks.group.evening', { count: evening.length })}</GroupLabel>
              {evening.map(renderTaskRow)}
            </>
          ) : null}
        </>
      )
    }
    return visible.map(renderTaskRow)
  }

  const renderAgentList = () => {
    if (agentList.length === 0) {
      return (
        <EmptyState
          testId="tasks-agents-empty"
          title={t(view.kind === 'agents' && view.id === 'review' ? 'tasks.agents.emptyReview' : 'tasks.agents.empty')}
          body={t('tasks.agents.emptyBody')}
        />
      )
    }
    return agentList.map((session) => (
      <ListRow key={session.id} onClick={() => openSession(session.id)} testId={`tasks-agent-session-${session.id}`}>
        <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', session.isProcessing ? 'bg-success' : 'bg-text-muted')} />
        <div className="min-w-0 flex-1">
          <div className="truncate">{session.name || session.preview ? getSessionTitle(session) : t('tasks.agents.untitled')}</div>
          <div className="truncate text-[11px] text-text-muted">
            {[session.sessionStatus ? t(`tasks.sessionStatus.${session.sessionStatus}`, { defaultValue: session.sessionStatus }) : null,
              session.isProcessing ? t('tasks.chip.running') : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </ListRow>
    ))
  }

  const list = (
    <>
      <ListHeader
        title={listTitle}
        subtitle={view.kind === 'list' && view.id === 'today' ? dateFmt.format(now) : undefined}
        actions={view.kind === 'agents' ? (
          <Button variant="ghost" onClick={() => navigate(routes.view.board())}>{t('tasks.agents.openBoard')}</Button>
        ) : (
          <Button
            variant="ghost"
            aria-label={t('tasks.sortBy')}
            onClick={() => setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]!)}
          >
            {t('tasks.sortLabel', { sort: t(`tasks.sort.${sort}`) })}
          </Button>
        )}
      />
      {personalTasksLoadStatus() === 'quarantine' ? (
        <div className="mx-3 mb-1 rounded-[6px] bg-destructive/10 px-2 py-1.5 text-[12px] text-destructive" role="alert" data-testid="tasks-quarantine">
          {t('tasks.quarantineBanner')}
        </div>
      ) : null}
      {view.kind !== 'agents' ? (
        <form onSubmit={onCreateTask} className="mx-3 mb-1 flex items-center gap-2 rounded-[6px] bg-foreground/[0.05] px-2">
          <span aria-hidden className="text-text-muted">＋</span>
          <input
            ref={quickRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('tasks.quickEntryPlaceholder')}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-muted"
            aria-label={t('tasks.quickEntryPlaceholder')}
          />
          <button type="submit" data-testid="new-task-button" className="h-6 shrink-0 rounded-[4px] px-2 text-[12px] text-text-secondary hover:bg-foreground/[0.07]">
            {t('tasks.newTask')}
          </button>
        </form>
      ) : null}
      {filter === 'today' || filter === 'upcoming' ? (
        <div className="px-3"><CalendarStatusStrip tasks={tasks} now={now} /></div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-3" role="listbox" aria-label={listTitle} tabIndex={0}>
        {view.kind === 'agents' ? renderAgentList() : renderTaskGroups()}
      </div>
      <div className="flex items-center gap-2 px-3 pb-2 text-[11px] text-text-muted">
        <button type="button" className="hover:text-foreground" onClick={onExport}>{t('tasks.export')}</button>
        <label className="cursor-pointer hover:text-foreground">
          {t('tasks.import')}
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onImport(file)
            }}
          />
        </label>
      </div>
    </>
  )

  // ── Detail ───────────────────────────────────────────────────────────────
  const renderLink = (link: PersonalTask['links'][number]) => {
    const session = link.kind === 'session' ? sessionMap.get(link.id) : undefined
    const label = session ? (session.name || session.preview || link.id) : link.id
    return (
      <li key={`${link.kind}:${link.id}`} className="flex items-center gap-2 rounded-[6px] bg-foreground/[0.04] px-2 py-1.5">
        <span className="shrink-0 text-text-muted">{t(`tasks.linkKind.${link.kind}`)}</span>
        {link.kind === 'session' ? (
          <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => openSession(link.id)}>
            «{label}»
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate">{label}</span>
        )}
        {session ? (
          <Badge tone={session.isProcessing ? 'success' : session.sessionStatus === 'needs-review' ? 'warning' : 'muted'}>
            {session.isProcessing ? t('tasks.chip.running') : t(`tasks.sessionStatus.${session.sessionStatus ?? 'todo'}`, { defaultValue: session.sessionStatus ?? '' })}
          </Badge>
        ) : link.kind === 'session' ? <Badge>{t('tasks.links.sessionMissing')}</Badge> : null}
        <button
          type="button"
          className="shrink-0 text-[11px] text-text-muted hover:text-foreground"
          onClick={() => selected && mutate((current) => current.unlink(selected.id, link))}
        >
          {t('tasks.unlink')}
        </button>
      </li>
    )
  }

  const detail = selected ? (
    <div className="flex flex-col px-5 py-4" data-testid="task-detail">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1.5 size-4 shrink-0 accent-[var(--accent)]"
          checked={Boolean(selected.completedAt)}
          onChange={() => toggleComplete(selected)}
          aria-label={t('tasks.complete')}
        />
        <input
          className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold outline-none"
          value={selected.title}
          onChange={(event) => {
            const title = event.target.value
            if (title.trim()) mutate((current) => current.update(selected.id, { title }))
          }}
          aria-label={t('tasks.titleLabel')}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-text-muted">
        {selected.priority !== 'none' ? (
          <span className={cn('font-semibold', selected.priority === 'high' ? 'text-destructive' : 'text-text-secondary')}>
            {priorityMark(selected.priority)} {t(`tasks.priority.${selected.priority}`)}
          </span>
        ) : null}
        <span>{projectName(selected.projectId)}</span>
        {formatDue(selected.dueAt) ? <span>· {formatDue(selected.dueAt)}</span> : <span>· {t(`tasks.projection.${selected.list}`)}</span>}
        <span>· {t('tasks.recurrenceLabel', { rule: t(`tasks.recurrence.${selected.recurrence?.rule ?? 'none'}`) })}</span>
      </div>
      <div className="mt-3">
        <Tabs<DetailTab>
          label={t('tasks.detailTabs')}
          value={detailTab}
          onChange={setDetailTab}
          tabs={[
            { id: 'details', label: t('tasks.tab.details') },
            { id: 'links', label: t('tasks.links'), count: selected.links.length },
            { id: 'history', label: t('tasks.tab.history') },
          ]}
        />
      </div>

      {detailTab === 'details' ? (
        <>
          <SectionLabel>{t('tasks.notes')}</SectionLabel>
          <textarea
            className="min-h-[72px] rounded-[6px] bg-foreground/[0.04] p-2 text-[13px] outline-none focus:bg-foreground/[0.06]"
            value={selected.notes}
            placeholder={t('tasks.notesPlaceholder')}
            onChange={(event) => {
              const value = event.target.value
              mutate((current) => current.update(selected.id, { notes: value }))
            }}
            aria-label={t('tasks.notes')}
          />
          <SectionLabel>{t('tasks.subtasks', { done: subtasks.filter((s) => s.completedAt).length, total: subtasks.length })}</SectionLabel>
          <ul className="flex flex-col gap-0.5" data-testid="task-subtasks">
            {subtasks.map((sub) => (
              <li key={sub.id} className="group flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--accent)]"
                  checked={Boolean(sub.completedAt)}
                  onChange={() => toggleComplete(sub)}
                  aria-label={t('tasks.complete')}
                />
                <span className={cn('min-w-0 flex-1 truncate', sub.completedAt && 'text-text-muted line-through')}>{sub.title}</span>
                <button
                  type="button"
                  className="text-[11px] text-text-muted opacity-0 hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                  onClick={() => mutate((current) => { current.remove(sub.id) })}
                >
                  {t('tasks.removeSubtask')}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-1 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!subDraft.trim()) return
              mutate((current) => { current.addSubtask(selected.id, subDraft.trim()) })
              setSubDraft('')
            }}
          >
            <input
              value={subDraft}
              onChange={(event) => setSubDraft(event.target.value)}
              placeholder={t('tasks.addSubtaskPlaceholder')}
              className="h-7 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.04] px-2 text-[12px] outline-none"
              aria-label={t('tasks.addSubtaskPlaceholder')}
            />
          </form>

          {selected.links.length ? (
            <>
              <SectionLabel>{t('tasks.links')}</SectionLabel>
              <ul className="flex flex-col gap-1">{selected.links.map(renderLink)}</ul>
            </>
          ) : null}

          <Card className="mt-4">
            <div className="text-[13px] font-semibold">{t('tasks.delegate.title')}</div>
            <div className="mt-1 text-[12px] text-text-secondary">{t('tasks.delegate.body')}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button variant="primary" data-testid="task-delegate" disabled={delegating || !shell || !workspace} onClick={() => void delegate(selected)}>
                {delegating ? t('tasks.delegate.running') : t('tasks.delegate.action')} <span className="opacity-70">⌘↵</span>
              </Button>
              {selectedChip ? (
                <Button onClick={() => openSession(selectedChip.sessionId)}>{t('tasks.openSession')} <span className="opacity-60">O</span></Button>
              ) : null}
              <Button variant="ghost" onClick={() => navigate(routes.view.board())}>{t('tasks.delegate.toBoard')}</Button>
            </div>
            {delegateError ? <div className="mt-2 text-[12px] text-destructive" role="alert">{t('tasks.delegate.failed', { error: delegateError })}</div> : null}
          </Card>

          <SectionLabel>{t('tasks.scheduleLabel')}</SectionLabel>
          <div className="flex flex-wrap items-center gap-1">
            <Button onClick={() => schedule(selected, 'today')}>{t('tasks.due.today')} <span className="opacity-60">T</span></Button>
            <Button onClick={() => schedule(selected, 'tomorrow')}>{t('tasks.due.tomorrow')} <span className="opacity-60">⇧T</span></Button>
            <Button onClick={() => schedule(selected, 'someday')}>{t('tasks.projection.someday')}</Button>
            <input
              type="date"
              className="h-7 rounded-[6px] bg-foreground/[0.07] px-2 text-[12px] outline-none"
              aria-label={t('tasks.pickDate')}
              value={selected.dueAt ? new Date(selected.dueAt - new Date(selected.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : ''}
              onChange={(event) => {
                const value = event.target.value
                if (!value) return schedule(selected, 'clear')
                const [y, m, d] = value.split('-').map(Number)
                const at = new Date(y!, (m ?? 1) - 1, d ?? 1, 18).getTime()
                mutate((current) => current.update(selected.id, { dueAt: at, list: at >= startOfLocalDay(now) + DAY ? 'upcoming' : selected.list }))
              }}
            />
            {selected.dueAt ? <Button variant="ghost" onClick={() => schedule(selected, 'clear')}>{t('tasks.clearDate')}</Button> : null}
          </div>
          <SectionLabel>{t('tasks.priority')}</SectionLabel>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('tasks.priority')}>
            {PRIORITIES.map((priority) => (
              <Button
                key={priority}
                variant={selected.priority === priority ? 'primary' : 'secondary'}
                aria-pressed={selected.priority === priority}
                onClick={() => mutate((current) => current.update(selected.id, { priority }))}
              >
                {t(`tasks.priority.${priority}`)}
              </Button>
            ))}
          </div>
          <SectionLabel>{t('tasks.assignProject')}</SectionLabel>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('tasks.assignProject')}>
            <Button
              variant={!selected.projectId ? 'primary' : 'secondary'}
              aria-pressed={!selected.projectId}
              onClick={() => mutate((current) => current.update(selected.id, { projectId: undefined }))}
            >
              {t('tasks.unassigned')}
            </Button>
            {projects.map((project) => (
              <Button
                key={project.config.id}
                variant={selected.projectId === project.config.id ? 'primary' : 'secondary'}
                aria-pressed={selected.projectId === project.config.id}
                onClick={() => mutate((current) => current.update(selected.id, { projectId: project.config.id }))}
              >
                {project.config.name}
              </Button>
            ))}
          </div>
          <SectionLabel>{t('tasks.recurrenceTitle')}</SectionLabel>
          <div className="flex flex-wrap items-center gap-1">
            {RECURRENCES.map((rule) => (
              <Button
                key={rule}
                variant={(selected.recurrence?.rule ?? 'none') === rule ? 'primary' : 'secondary'}
                onClick={() => mutate((current) => current.update(selected.id, { recurrence: rule === 'none' ? undefined : { rule, interval: 1 } }))}
              >
                {t(`tasks.recurrence.${rule}`)}
              </Button>
            ))}
            <label className="ml-2 flex items-center gap-1.5 text-[12px]">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={selected.evening}
                onChange={(event) => mutate((current) => current.update(selected.id, { evening: event.target.checked }))}
              />
              {t('tasks.evening')}
            </label>
          </div>
          <SectionLabel>{t('tasks.tags')}</SectionLabel>
          <input
            className="h-7 rounded-[6px] bg-foreground/[0.04] px-2 text-[12px] outline-none"
            value={selected.tags.join(', ')}
            onChange={(event) => {
              const tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean)
              mutate((current) => current.update(selected.id, { tags }))
            }}
            placeholder={t('tasks.tags')}
            aria-label={t('tasks.tags')}
          />
          <div className="mt-6">
            <Button variant="danger" onClick={() => removeTask(selected)}>{t('tasks.delete')} <span className="opacity-60">⌘⌫</span></Button>
          </div>
        </>
      ) : null}

      {detailTab === 'links' ? (
        <>
          <SectionLabel>{t('tasks.links')}</SectionLabel>
          {selected.links.length === 0 ? (
            <div className="text-[12px] text-text-muted">{t('tasks.links.empty')}</div>
          ) : (
            <ul className="flex flex-col gap-1">{selected.links.map(renderLink)}</ul>
          )}
          <SectionLabel>{t('tasks.addLink')}</SectionLabel>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('tasks.addLink')}>
            {LINK_KINDS.map((kind) => (
              <Button key={kind} variant={linkKind === kind ? 'primary' : 'secondary'} onClick={() => setLinkKind(kind)}>
                {t(`tasks.linkKind.${kind}`)}
              </Button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1">
            <input
              className="h-7 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.04] px-2 text-[12px] outline-none"
              value={linkId}
              onChange={(event) => setLinkId(event.target.value)}
              placeholder={t('tasks.linkIdPlaceholder')}
              aria-label={t('tasks.linkIdPlaceholder')}
            />
            <Button onClick={addLink}>{t('tasks.addLink')}</Button>
          </div>
        </>
      ) : null}

      {detailTab === 'history' ? (
        <>
          <SectionLabel>{t('tasks.tab.history')}</SectionLabel>
          <ul className="flex flex-col gap-1 text-[12px]" data-testid="task-history">
            {store.auditLog().filter((event) => event.taskId === selected.id).slice(-50).reverse().map((event, index) => (
              <li key={`${event.at}-${index}`} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-text-muted">{dateFmt.format(event.at)} {timeFmt.format(event.at)}</span>
                <span>{t(`tasks.audit.${event.action}`, { defaultValue: event.action })}{event.detail ? ` · ${event.detail}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  ) : (
    <div className="flex flex-col gap-2 px-5 py-6">
      <p className="text-text-muted" role="status" data-testid={selectedId ? 'tasks-not-found' : 'tasks-select-hint'}>
        {t(selectedId ? 'tasks.notFound' : 'tasks.selectHint')}
      </p>
      {selectedId ? (
        <Button variant="ghost" className="self-start" onClick={() => selectTask(null)}>
          {t('common.backToList')}
        </Button>
      ) : null}
    </div>
  )

  const todayCount = countFilter(tasks, now, 'today')
  const agentLinked = topLevel.filter((task) => isOpenTask(task) && agentChipFor(task, sessionMap)?.chip === 'running').length
  const sync = personalTasksSyncState()

  return (
    <div className="h-full min-h-0" onKeyDown={onKeyDown}>
      <ModeScreenLayout
        testId="tasks-page"
        navigator={navigator}
        list={list}
        detail={detail}
        status={(
          <>
            <span>{t('tasks.status.summary', { today: todayCount, agents: agentLinked })}</span>
            <span>·</span>
            <span data-testid="tasks-sync-state">{t(`tasks.status.sync.${sync}`)}</span>
          </>
        )}
      />
    </div>
  )
}
