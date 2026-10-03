/**
 * Задачи — Things-style personal task manager (navigator → list → detail).
 *
 * Lists: Входящие · Сегодня (+ «Этот вечер») · Планы (calendar days) · В любое
 * время · Когда-нибудь · Журнал · Корзина; Области with projects (progress
 * pie, headings); tags. Keyboard-first: ↑/↓, Space completes (animated),
 * Enter edits, ⌘N Quick Entry (natural language: «завтра», «в пт», «через
 * неделю»), ⌘K move, ⌘T / ⌘E today / evening, ⌘S «Когда», ⇧⌘D deadline,
 * ⌘D duplicate, ⌘⌫ to Корзина, ⌥↑/⌥↓ reorder, type to search, #tag filter.
 * Drag & drop reorders and moves between lists, projects, headings and days;
 * the magic «+» can be dropped where the new task should go.
 *
 * Data: PersonalTask bundle (lib/personal-tasks) — canonical copy in
 * server-core PersonalTaskPersistStore via personalTasks:* RPC, localStorage
 * as cache + one-time migration source. «Агенты» are selectors over live
 * sessions. «Поручить агенту» creates a session (status «К выполнению», task
 * as prompt) and links it back (kind:"session").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import {
  PersonalTaskStore,
  allTaskTags,
  compareTaskOrder,
  filterAndSortTasks,
  isOpenTask,
  matchesProjection,
  parseTaskEntry,
  projectProgress,
  sortTasks,
  startOfLocalDay,
  upcomingByDay,
  type ParsedTaskEntry,
  type PersonalTask,
  type TaskFilterId,
  type TaskLink,
  type TaskListId,
  type TaskMoveTarget,
  type TaskSortId,
  type TaskWhen,
} from '@rox/core/tasks/personal'
import { CalendarStatusStrip } from '@/components/calendar/CalendarStatusStrip'
import { useActiveWorkspace, useOptionalAppShellContext } from '@/context/AppShellContext'
import { useProjects } from '@/hooks/useProjects'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useAction } from '@/actions'
import {
  loadPersonalTaskStore,
  persistPersonalTaskStore,
  capturePersonalTaskScope,
  importPersonalTasksConfirmed,
  personalTasksLoadStatus,
  personalTasksSyncState,
  personalTasksSyncConflicts,
  resolvePersonalTaskConflict,
  subscribePersonalTasks,
  subscribePersonalTaskCommits,
  personalTasksNativeAvailable,
  persistPersonalTaskSessionLink,
} from '@/lib/personal-tasks'
import { useTourSignals, useTourTarget, type TourObservation } from '@/features/product-tour/runtime/hooks'
import { derivePersonalTaskSignals, tasksProjectsCapabilities } from '@/features/product-tour/adapters/work/tasks-projects'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { formatHotkeyDisplay } from '@/lib/platform'
import {
  Badge,
  Button,
  EmptyState,
  ListHeader,
  ModeScreenLayout,
  type Tone,
} from '@/components/mode-screen/ModeScreen'
import { tasksViewAtom } from './tasks/atoms'
import {
  agentChipFor,
  agentCounts,
  agentSessions,
  buildDelegationPrompt,
  checklistProgress,
  countFilter,
  daysUntil,
  deriveTaskSource,
  matchesSearch,
  parseAgentMention,
  parseSearch,
  subtasksOf,
  visibleNotes,
  type AgentChip,
  type AgentSessionLike,
} from './tasks/task-model'
import { ConfirmDialog, Glyph, ProgressPie, TaskCheckbox, prefersReducedMotion } from './tasks/parts'
import { QuickEntry, type QuickEntryResult } from './tasks/QuickEntry'
import { MoveDialog, type MoveDestination } from './tasks/MoveDialog'
import { TaskDetail } from './tasks/TaskDetail'
import { TaskSidebar } from './tasks/TaskSidebar'
import { getSessionTitle } from '@/utils/session'
import { taskDelegationErrorKey, type TaskDelegationErrorKey } from './tasks/delegation-errors'

const SORTS: TaskSortId[] = ['order', 'due', 'priority', 'project', 'title']
const CHIP_TONE: Record<AgentChip, Tone> = { running: 'success', review: 'warning', todo: 'accent', done: 'muted', linked: 'muted' }
const COMPLETE_DELAY_MS = 650
const DAY = 24 * 60 * 60 * 1000
const DRAG_TASK = 'text/x-rox-task'
const DRAG_PLUS = 'text/x-rox-magic-plus'

function filterLabelKey(id: TaskFilterId): string {
  return id === 'all' ? 'tasks.filterAll' : `tasks.projection.${id}`
}

function parseEntry(text: string): ParsedTaskEntry {
  return parseTaskEntry(text, Date.now())
}

/** Drop / inline-create context of a list section. */
interface SectionContext {
  headingId?: string | null
  evening?: boolean
  date?: number
  projectId?: string | null
  areaId?: string | null
}

interface Section {
  key: string
  title?: React.ReactNode
  subtitle?: React.ReactNode
  tasks: PersonalTask[]
  context?: SectionContext
  /** Plans: a calendar day header (big day number). */
  day?: number
  /** Header click (e.g. open project from Anytime). */
  onOpen?: () => void
  pie?: { done: number; total: number }
  emptyHint?: boolean
  headingId?: string
}

interface InlineDraft {
  sectionKey: string
  afterId?: string
  context?: SectionContext
}

export interface TasksPageProps {
  /** Undefined keeps standalone/local selection; null/string is route-bound. */
  selectedId?: string | null
}

export default function TasksPage(props: TasksPageProps = {}) {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const shell = useOptionalAppShellContext()
  const tour = useTourSignals({ workspaceId: workspace?.id })
  const quickEntryTarget = useTourTarget('tasks.quick-entry', { workspaceId: workspace?.id })
  const pendingCreates = useRef(new Map<string, { observation: TourObservation; task: PersonalTask }>())
  const delegationInFlight = useRef(false)
  const delegationOwner = useRef<{ workspaceId: string | undefined; generation: number; mounted: boolean }>({ workspaceId: undefined, generation: 0, mounted: false })
  React.useLayoutEffect(() => {
    delegationOwner.current = { workspaceId: workspace?.id, generation: delegationOwner.current.generation + 1, mounted: true }
    setDelegating(false); setDelegateError(null)
    return () => { delegationOwner.current = { ...delegationOwner.current, generation: delegationOwner.current.generation + 1, mounted: false } }
  }, [workspace?.id])
  const { projects } = useProjects(workspace?.id)
  const sessionMap = useAtomValue(sessionMetaMapAtom) as ReadonlyMap<string, AgentSessionLike>
  const [store, setStore] = useState(loadPersonalTaskStore)
  const [view, setView] = useAtom(tasksViewAtom)
  const [sort, setSort] = useState<TaskSortId>('order')
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const [delegating, setDelegating] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef(false)
  const mountedRef = useRef(true)
  const importScopeRef = useRef({ id: workspace?.id, generation: 0 })
  if (importScopeRef.current.id !== workspace?.id) importScopeRef.current = { id: workspace?.id, generation: importScopeRef.current.generation + 1 }
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const [delegateError, setDelegateError] = useState<TaskDelegationErrorKey | null>(null)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [pendingDone, setPendingDone] = useState<ReadonlySet<string>>(new Set())
  const [quickEntry, setQuickEntry] = useState<{ initial: string } | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)
  const [popover, setPopover] = useState<'when' | 'deadline' | null>(null)
  const [confirm, setConfirm] = useState<null | { kind: 'emptyTrash' } | { kind: 'removeArea'; id: string } | { kind: 'removeHeading'; id: string }>(null)
  const [inline, setInline] = useState<InlineDraft | null>(null)
  const [inlineText, setInlineText] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [navCreate, setNavCreate] = useState<null | 'project' | 'area'>(null)
  const [navDraft, setNavDraft] = useState('')
  const [dropHint, setDropHint] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const quickRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const timers = useRef(new Map<string, number>())
  const routeBound = props.selectedId !== undefined
  const selectedId = routeBound ? props.selectedId ?? null : localSelectedId
  const selectTask = useCallback((id: string | null) => {
    setPopover(null)
    if (routeBound) navigate(routes.view.tasks(id ?? undefined))
    else setLocalSelectedId(id)
  }, [routeBound])
  const now = Date.now()
  const tourRef = useRef(tour)
  tourRef.current = tour

  useEffect(() => {
    const pending = pendingCreates.current
    const off = subscribePersonalTaskCommits(record => {
      const creation = pending.get(record.task.id)
      if (!creation) return
      const signals = derivePersonalTaskSignals(creation.observation, { kind: 'created', expected: creation.task, persisted: record })
      for (const signal of signals) tourRef.current.emit(creation.observation, signal.name, signal.level, signal.origin, signal.eventToken)
      if (signals.length) pending.delete(record.task.id)
    })
    return () => { off(); pending.clear() }
  }, [workspace?.id])

  useEffect(() => subscribePersonalTasks(() => setStore(loadPersonalTaskStore())), [])
  useEffect(() => {
    const pending = timers.current
    return () => { for (const timer of pending.values()) window.clearTimeout(timer) }
  }, [])

  const persist = useCallback((next: PersonalTaskStore) => {
    setStore(next)
    persistPersonalTaskStore(next)
  }, [])

  const storeRef = useRef(store)
  storeRef.current = store
  const mutate = useCallback((fn: (current: PersonalTaskStore) => void) => {
    const next = PersonalTaskStore.fromJson(storeRef.current.exportJson())
    fn(next)
    storeRef.current = next
    persist(next)
  }, [persist])

  const tasks = store.list()
  const topLevel = useMemo(() => tasks.filter((task) => !task.parentId), [tasks])
  const personalProjects = store.projects().filter((p) => p.trashedAt == null)
  const areas = store.areas().filter((a) => a.trashedAt == null)
  const filter: TaskFilterId = view.kind === 'list' ? view.id : 'all'
  const sessions = useMemo(() => [...sessionMap.values()], [sessionMap])
  const agents = useMemo(() => agentCounts(sessions), [sessions])
  const agentList = useMemo(() => (view.kind === 'agents' ? agentSessions(sessions, view.id) : []), [sessions, view])
  const tags = useMemo(() => allTaskTags(topLevel), [topLevel])

  const projectName = useCallback((projectId?: string) => {
    if (!projectId) return t('tasks.unassigned')
    return store.projects().find((p) => p.id === projectId)?.name
      ?? projects.find((project) => project.config.id === projectId)?.config.name
      ?? projectId
  }, [projects, store, t])
  const areaName = useCallback((areaId?: string) => store.areas().find((a) => a.id === areaId)?.name ?? '', [store])
  const placeLabel = useCallback((task: PersonalTask) => {
    if (task.projectId) {
      const heading = task.headingId ? store.headings(task.projectId).find((h) => h.id === task.headingId) : undefined
      return heading ? `${projectName(task.projectId)} › ${heading.title}` : projectName(task.projectId)
    }
    if (task.areaId) return areaName(task.areaId)
    return t(`tasks.projection.${task.list}`)
  }, [areaName, projectName, store, t])

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }), [i18n.language])
  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { weekday: 'long' }), [i18n.language])
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }), [i18n.language])
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }), [i18n.language])

  // ── Actions ──────────────────────────────────────────────────────────────
  const delegate = useCallback(async (task: PersonalTask) => {
    if (!workspace?.id || !shell || delegationInFlight.current || task.trashedAt != null || !personalTasksNativeAvailable()) return
    const scopeCurrent = capturePersonalTaskScope()
    const ownerGeneration = delegationOwner.current.generation
    const isCurrent = () => scopeCurrent() && delegationOwner.current.mounted && delegationOwner.current.workspaceId === workspace.id && delegationOwner.current.generation === ownerGeneration
    if (!isCurrent()) return
    const observation = tour.capture()
    delegationInFlight.current = true
    setDelegating(true)
    setDelegateError(null)
    try {
      const prompt = buildDelegationPrompt(task, subtasksOf(storeRef.current.list(), task.id), t('tasks.delegate.promptHeading'))
      const checklist = (task.checklist ?? []).filter((item) => !item.done).map((item) => `- [ ] ${item.title}`)
      const fullPrompt = checklist.length ? `${prompt}\n\n${checklist.join('\n')}` : prompt
      const session = await shell.onCreateSession(workspace.id, {
        sessionStatus: 'todo',
        ...(task.projectId && projects.some((p) => p.config.id === task.projectId) ? { projectId: task.projectId } : {}),
      })
      if (!isCurrent()) return
      await window.electronAPI.sessionCommand(session.id, { type: 'rename', name: task.title })
      if (!isCurrent()) return
      await window.electronAPI.sessionCommand(session.id, { type: 'setSessionStatus', state: 'todo' })
      if (!isCurrent()) return
      const committed = await persistPersonalTaskSessionLink(task.id, session.id)
      if (!isCurrent()) return
      await window.electronAPI.sendMessage(session.id, fullPrompt)
      const [nativeSession, nativeTasksSnapshot] = await Promise.all([
        window.electronAPI.getSessionMessages(session.id), window.electronAPI.personalTasksList(),
      ])
      if (!isCurrent()) return
      const savedTask = nativeTasksSnapshot.tasks.find(entry => entry.id === task.id)
      const persisted = savedTask ? { task: savedTask, revision: nativeTasksSnapshot.revisions[task.id] ?? 0 } : null
      const promptAccepted = Boolean(nativeSession?.messages.some(message => message.role === 'user' && message.content === fullPrompt))
      for (const signal of derivePersonalTaskSignals(observation, { kind: 'delegated', expected: committed.task, persisted, session: nativeSession, sessionId: session.id, promptAccepted })) {
        tour.emit(observation, signal.name, signal.level, signal.origin, signal.eventToken)
      }
    } catch (error) {
      if (isCurrent()) setDelegateError(taskDelegationErrorKey(error))
    } finally {
      delegationInFlight.current = false
      if (isCurrent()) setDelegating(false)
    }
  }, [workspace?.id, shell, t, projects, tour])

  const dropPending = (id: string) => setPendingDone((prev) => {
    const next = new Set(prev)
    next.delete(id)
    return next
  })

  const commitComplete = useCallback((id: string) => {
    timers.current.delete(id)
    dropPending(id)
    let spawnedId: string | null = null
    mutate((current) => {
      const task = current.get(id)
      if (task && !task.completedAt) spawnedId = current.completeTask(id).next?.id ?? null
    })
    const title = storeRef.current.get(id)?.title ?? ''
    const spawned = spawnedId as string | null
    toast(spawned ? t('tasks.toast.completedRepeat', { title }) : t('tasks.toast.completed', { title }), {
      action: {
        label: t('tasks.toast.undo'),
        onClick: () => mutate((current) => {
          current.reopen(id)
          if (spawned && current.get(spawned)) current.remove(spawned)
        }),
      },
    })
  }, [mutate, t])

  const toggleComplete = useCallback((task: PersonalTask) => {
    if (task.completedAt || task.cancelledAt) {
      mutate((current) => current.reopen(task.id))
      return
    }
    const pendingTimer = timers.current.get(task.id)
    if (pendingTimer != null) {
      // A second press during the animation cancels it.
      window.clearTimeout(pendingTimer)
      timers.current.delete(task.id)
      dropPending(task.id)
      return
    }
    if (prefersReducedMotion()) {
      commitComplete(task.id)
      return
    }
    setPendingDone((prev) => new Set(prev).add(task.id))
    timers.current.set(task.id, window.setTimeout(() => commitComplete(task.id), COMPLETE_DELAY_MS))
  }, [commitComplete, mutate])

  const trashTask = useCallback((task: PersonalTask) => {
    mutate((current) => { current.trash(task.id) })
    toast(t('tasks.toast.trashed', { title: task.title }), {
      action: { label: t('tasks.toast.undo'), onClick: () => mutate((current) => { current.restore(task.id) }) },
    })
  }, [mutate, t])

  const applyWhen = useCallback((id: string, when: TaskWhen) => mutate((current) => { current.setWhen(id, when) }), [mutate])

  /** Destination implied by the current view (Quick Entry, inline new row, magic plus). */
  const viewDefaults = useCallback((): { list: TaskListId; projectId?: string; areaId?: string; tag?: string; when?: TaskWhen } => {
    if (view.kind === 'project') return { list: 'anytime', projectId: view.id }
    if (view.kind === 'area') return { list: 'anytime', areaId: view.id }
    if (view.kind === 'tag') return { list: 'inbox', tag: view.id }
    if (view.kind === 'list') {
      switch (view.id) {
        case 'today': return { list: 'today' }
        case 'upcoming': return { list: 'upcoming', when: { kind: 'date', at: startOfLocalDay(Date.now()) + DAY } }
        case 'anytime': return { list: 'anytime' }
        case 'someday': return { list: 'someday' }
        default: return { list: 'inbox' }
      }
    }
    return { list: 'inbox' }
  }, [view])

  const destinationLabel = (() => {
    const d = viewDefaults()
    if (d.projectId) return projectName(d.projectId)
    if (d.areaId) return areaName(d.areaId)
    if (d.tag) return `${t('tasks.projection.inbox')} · #${d.tag}`
    return t(`tasks.projection.${d.list}`)
  })()

  const createFromEntry = useCallback((parsed: ParsedTaskEntry, opts: { notes?: string; context?: SectionContext; afterId?: string; open?: boolean; projectId?: string | null; areaId?: string | null; checklistItems?: string[] } = {}) => {
    const mention = parseAgentMention(parsed.title)
    if (!mention.title) return null
    const observation = tour.capture()
    const d = viewDefaults()
    let createdId: string | null = null
    mutate((current) => {
      const ctx = opts.context ?? {}
      const task = current.create({
        title: mention.title,
        notes: opts.notes ?? '',
        list: d.list,
        projectId: opts.projectId !== undefined ? opts.projectId ?? undefined : ctx.projectId ?? d.projectId,
        areaId: opts.areaId !== undefined ? opts.areaId ?? undefined : ctx.areaId ?? d.areaId,
        headingId: ctx.headingId ?? undefined,
        tags: [...new Set([...(d.tag ? [d.tag] : []), ...parsed.tags])],
        recurrence: parsed.recurrence ? { ...parsed.recurrence, timeZone: parsed.recurrence.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone } : undefined,
        reminderAt: parsed.reminderAt,
        reminderTimeZone: parsed.reminderAt != null ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
      })
      for (const title of opts.checklistItems ?? []) current.addChecklistItem(task.id, title)
      let when: TaskWhen | undefined = d.when
      if (ctx.date != null) when = { kind: 'date', at: ctx.date }
      if (ctx.evening) when = { kind: 'evening' }
      if (parsed.when === 'today') when = parsed.evening ? { kind: 'evening' } : { kind: 'today' }
      else if (parsed.when === 'evening') when = { kind: 'evening' }
      else if (parsed.when === 'anytime') when = { kind: 'anytime' }
      else if (parsed.when === 'someday') when = { kind: 'someday' }
      else if (parsed.when === 'date' && parsed.startAt != null) when = { kind: 'date', at: parsed.startAt, evening: parsed.evening }
      if (when) current.setWhen(task.id, when)
      if (opts.afterId) current.placeAfter(task.id, opts.afterId)
      if (parsed.deadlineAt != null) current.setDeadline(task.id, parsed.deadlineAt)
      createdId = task.id
      if (observation) {
        for (const [id, pending] of pendingCreates.current) if (pending.observation.binding.runToken !== observation.binding.runToken) pendingCreates.current.delete(id)
        pendingCreates.current.set(task.id, { observation, task: structuredClone(task) })
      }
    })
    const created = createdId ? storeRef.current.get(createdId) ?? null : null
    if (created && (opts.open ?? true)) selectTask(created.id)
    if (mention.delegate && created) void delegate(created)
    return created
  }, [delegate, mutate, selectTask, viewDefaults, tour])

  const onQuickEntry = (result: QuickEntryResult) => {
    const created = createFromEntry(result.parsed, { notes: result.notes, open: result.open, projectId: result.projectId, areaId: result.areaId, checklistItems: result.checklistItems })
    setQuickEntry(null)
    if (created && result.open) window.setTimeout(() => titleRef.current?.focus(), 30)
  }

  // Slim add bar on Входящие — same parser as Quick Entry; filter === 'all'
  // (and Журнал/Корзина) fall back to Входящие inside viewDefaults().
  const onCreateTask = (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    createFromEntry(parseEntry(draft), { open: filter === 'all' || filter === 'inbox' })
    setDraft('')
  }

  const commitInline = () => {
    if (!inline) return
    const text = inlineText.trim()
    const pending = inline
    setInline(null)
    setInlineText('')
    if (text) createFromEntry(parseEntry(text), { context: pending.context, afterId: pending.afterId, open: false })
  }

  // ── Sections for the current view ────────────────────────────────────────
  const searching = search.trim().length > 0
  const sections: Section[] = useMemo(() => {
    const out: Section[] = []
    if (view.kind === 'agents') return out
    const withTag = (list: PersonalTask[]) => (tagFilter ? list.filter((task) => task.tags.includes(tagFilter)) : list)
    const sorted = (list: PersonalTask[]) => (sort === 'order' ? [...list].sort(compareTaskOrder) : sortTasks(list, sort))
    const keepPending = (list: readonly PersonalTask[], keep: (task: PersonalTask) => boolean) => list.filter((task) => keep(task) || pendingDone.has(task.id))
    const inProjection = (id: TaskFilterId) => (task: PersonalTask) => (id === 'all' ? isOpenTask(task) : matchesProjection(task, now, id))
    if (searching) {
      const query = parseSearch(search)
      const hits = topLevel.filter((task) => task.trashedAt == null && matchesSearch(task, query))
      const open = hits.filter((task) => isOpenTask(task) || pendingDone.has(task.id))
      const done = hits.filter((task) => !isOpenTask(task) && !pendingDone.has(task.id))
      out.push({ key: 'search', title: t('tasks.search.results', { count: hits.length }), tasks: sorted(open) })
      if (done.length) out.push({ key: 'search-done', title: t('tasks.projection.logbook'), tasks: done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)) })
      return out
    }
    if (view.kind === 'list') {
      const id = view.id
      if (id === 'today') {
        const list = withTag(keepPending(topLevel, inProjection('today')))
        out.push({ key: 'today', tasks: sorted(list.filter((task) => !task.evening)), context: { evening: false } })
        out.push({ key: 'evening', title: <span className="inline-flex items-center gap-1.5">{Glyph.moon}{t('tasks.when.evening')}</span>, tasks: sorted(list.filter((task) => task.evening)), context: { evening: true }, emptyHint: true })
        return out
      }
      if (id === 'upcoming') {
        const plan = upcomingByDay(withTag(topLevel), now, 7)
        plan.days.forEach((day, index) => {
          out.push({ key: `day-${day.key}`, day: day.at, title: index === 0 ? t('tasks.due.tomorrow') : weekdayFmt.format(day.at), tasks: day.tasks, context: { date: day.at } })
        })
        for (const bucket of plan.later) {
          out.push({
            key: `later-${bucket.key}`,
            title: bucket.key === 'undated' ? t('tasks.upcoming.undated') : monthFmt.format(bucket.at),
            tasks: bucket.tasks,
            context: bucket.key === 'undated' ? undefined : { date: bucket.at },
          })
        }
        return out
      }
      if (id === 'anytime' || id === 'someday') {
        const list = withTag(keepPending(topLevel, inProjection(id)))
        const loose = list.filter((task) => !task.projectId && !task.areaId)
        if (loose.length) out.push({ key: 'loose', tasks: sorted(loose), context: { projectId: null, areaId: null } })
        for (const area of areas) {
          const inArea = list.filter((task) => task.areaId === area.id && !task.projectId)
          if (inArea.length) out.push({ key: `area-${area.id}`, title: area.name, tasks: sorted(inArea), onOpen: () => setView({ kind: 'area', id: area.id }), context: { areaId: area.id } })
        }
        const projectIds = [...personalProjects.map((p) => p.id), ...projects.map((p) => p.config.id)]
        for (const pid of projectIds) {
          const inProject = list.filter((task) => task.projectId === pid)
          if (inProject.length) out.push({ key: `proj-${pid}`, title: projectName(pid), tasks: sorted(inProject), onOpen: () => setView({ kind: 'project', id: pid }), pie: projectProgress(topLevel, pid), context: { projectId: pid } })
        }
        const known = new Set(projectIds)
        const orphans = list.filter((task) => task.projectId && !known.has(task.projectId))
        if (orphans.length) out.push({ key: 'orphans', title: t('tasks.unknownProject'), tasks: sorted(orphans) })
        return out
      }
      if (id === 'logbook') {
        const doneAt = (task: PersonalTask) => task.completedAt ?? task.cancelledAt ?? 0
        const done = withTag(topLevel.filter(inProjection('logbook'))).sort((a, b) => doneAt(b) - doneAt(a))
        const byDay = new Map<number, PersonalTask[]>()
        for (const task of done) {
          const key = startOfLocalDay(doneAt(task))
          byDay.set(key, [...(byDay.get(key) ?? []), task])
        }
        for (const [at, list] of byDay) {
          const label = at === startOfLocalDay(now) ? t('tasks.due.today') : at === startOfLocalDay(now - DAY) ? t('tasks.logbook.yesterday') : dateFmt.format(at)
          out.push({ key: `log-${at}`, title: label, tasks: list })
        }
        return out
      }
      if (id === 'trash') {
        out.push({ key: 'trash', tasks: withTag(topLevel.filter(inProjection('trash'))).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0)) })
        return out
      }
      out.push({
        key: id,
        tasks: id === 'all' ? withTag(filterAndSortTasks(topLevel, now, { filter: 'all', sort })) : sorted(withTag(keepPending(topLevel, inProjection(id)))),
      })
      return out
    }
    if (view.kind === 'project') {
      const pid = view.id
      const inProject = withTag(topLevel.filter((task) => task.projectId === pid && task.trashedAt == null))
      const open = inProject.filter((task) => isOpenTask(task) || pendingDone.has(task.id))
      const headings = store.headings(pid)
      out.push({ key: 'no-heading', tasks: sorted(open.filter((task) => !task.headingId || !headings.some((h) => h.id === task.headingId))), context: { projectId: pid, headingId: null } })
      for (const heading of headings) {
        out.push({ key: `heading-${heading.id}`, headingId: heading.id, title: heading.title, tasks: sorted(open.filter((task) => task.headingId === heading.id)), context: { projectId: pid, headingId: heading.id } })
      }
      const done = inProject.filter((task) => !isOpenTask(task) && !pendingDone.has(task.id))
      if (done.length && showDone) out.push({ key: 'done', title: t('tasks.project.completed'), tasks: done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)) })
      return out
    }
    if (view.kind === 'area') {
      const aid = view.id
      out.push({ key: 'area', tasks: sorted(withTag(keepPending(topLevel, (task) => task.areaId === aid && !task.projectId && isOpenTask(task)))), context: { areaId: aid } })
      for (const project of personalProjects.filter((p) => p.areaId === aid)) {
        const progress = projectProgress(topLevel, project.id)
        out.push({ key: `proj-${project.id}`, title: project.name, tasks: [], onOpen: () => setView({ kind: 'project', id: project.id }), pie: progress, subtitle: t('tasks.project.openCount', { count: progress.open }) })
      }
      return out
    }
    if (view.kind === 'tag') {
      out.push({ key: 'tag', tasks: sorted(keepPending(topLevel, (task) => task.tags.includes(view.id) && isOpenTask(task))) })
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, topLevel, search, tagFilter, sort, pendingDone, showDone, store, projects, i18n.language])

  const visible = useMemo(() => sections.flatMap((section) => section.tasks), [sections])
  const selected = selectedId ? store.get(selectedId) : undefined
  const nativeTasks = personalTasksNativeAvailable()
  const syncState = personalTasksSyncState()
  const delegationApi = Boolean(shell && typeof window.electronAPI?.sendMessage === 'function'
    && typeof window.electronAPI?.sessionCommand === 'function' && typeof window.electronAPI?.getSessionMessages === 'function')
  useEffect(() => {
    const capabilities = tasksProjectsCapabilities({ projectsApi: typeof window.electronAPI?.getProjects === 'function',
      personalTasksApi: nativeTasks, syncState, delegationApi, workspacePresent: Boolean(workspace?.id),
      taskPresent: Boolean(selected), taskTrashed: selected?.trashedAt != null })
    const cleanups = [tour.capability('personal-tasks.available', capabilities['personal-tasks.available']!),
      tour.capability('task.delegation-available', capabilities['task.delegation-available']!)]
    return () => { for (const cleanup of cleanups) cleanup() }
  }, [tour, nativeTasks, syncState, delegationApi, workspace?.id, selected?.id, selected?.trashedAt])
  const subtasks = selected ? subtasksOf(tasks, selected.id) : []
  const selectedChip = selected ? agentChipFor(selected, sessionMap) : null
  const viewTags = useMemo(() => allTaskTags(visible).map((x) => x.tag), [visible])

  useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector<HTMLElement>(`[data-task-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  useEffect(() => {
    setTagFilter(null)
    setInline(null)
    setShowDone(false)
  }, [view])

  // ── Move targets (⌘K + drag onto the navigator) ──────────────────────────
  const moveDestinations = useMemo((): MoveDestination[] => {
    const listGroup = t('tasks.move.lists')
    const placeGroup = t('tasks.move.places')
    const out: MoveDestination[] = [
      { id: 'list:inbox', label: t('tasks.projection.inbox'), group: listGroup },
      { id: 'when:today', label: t('tasks.when.today'), group: listGroup, hint: formatHotkeyDisplay('mod+t') },
      { id: 'when:evening', label: t('tasks.when.evening'), group: listGroup, hint: formatHotkeyDisplay('mod+e') },
      { id: 'when:tomorrow', label: t('tasks.due.tomorrow'), group: listGroup },
      { id: 'when:anytime', label: t('tasks.when.anytime'), group: listGroup },
      { id: 'when:someday', label: t('tasks.when.someday'), group: listGroup },
    ]
    const addProject = (id: string, name: string, indent: boolean, group = placeGroup) => {
      out.push({ id: `project:${id}`, label: name, group, indent })
      for (const heading of store.headings(id)) out.push({ id: `heading:${id}:${heading.id}`, label: `› ${heading.title}`, group, indent: true })
    }
    for (const project of personalProjects.filter((p) => !p.areaId)) addProject(project.id, project.name, false)
    for (const area of areas) {
      out.push({ id: `area:${area.id}`, label: area.name, group: placeGroup })
      for (const project of personalProjects.filter((p) => p.areaId === area.id)) addProject(project.id, project.name, true)
    }
    for (const project of projects) addProject(project.config.id, project.config.name, false, t('tasks.nav.workspaceProjects'))
    out.push({ id: 'noplace', label: t('tasks.move.noPlace'), group: t('tasks.move.other') })
    return out
  }, [areas, personalProjects, projects, store, t])

  const applyDestination = useCallback((taskId: string, dest: string) => {
    const tomorrow = startOfLocalDay(Date.now()) + DAY
    mutate((current) => {
      if (!current.get(taskId)) return
      if (dest === 'list:inbox') current.moveTo(taskId, { list: 'inbox', projectId: null, areaId: null })
      else if (dest === 'when:today') current.setWhen(taskId, { kind: 'today' })
      else if (dest === 'when:evening') current.setWhen(taskId, { kind: 'evening' })
      else if (dest === 'when:tomorrow' || dest === 'when:upcoming') current.setWhen(taskId, { kind: 'date', at: tomorrow })
      else if (dest === 'when:anytime') current.setWhen(taskId, { kind: 'anytime' })
      else if (dest === 'when:someday') current.setWhen(taskId, { kind: 'someday' })
      else if (dest === 'noplace') current.moveTo(taskId, { projectId: null, areaId: null })
      else if (dest.startsWith('project:')) current.moveTo(taskId, { projectId: dest.slice(8) })
      else if (dest.startsWith('area:')) current.moveTo(taskId, { areaId: dest.slice(5) })
      else if (dest.startsWith('heading:')) {
        const [, pid, hid] = dest.split(':')
        current.moveTo(taskId, { projectId: pid!, headingId: hid! })
      } else if (dest === 'trash') current.trash(taskId)
      else if (dest === 'logbook' && !current.get(taskId)!.completedAt) current.completeTask(taskId)
      if (current.get(taskId)!.trashedAt != null && dest !== 'trash') current.restore(taskId)
    })
  }, [mutate])

  // ── Keyboard ────────────────────────────────────────────────────────────
  const pageVisible = () => Boolean(rootRef.current && rootRef.current.isConnected && rootRef.current.offsetParent !== null)
  const pageFocused = () => {
    const active = document.activeElement
    return pageVisible() && (!active || active === document.body || Boolean(rootRef.current?.contains(active)))
  }
  const inField = () => Boolean((document.activeElement as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]'))
  // ⌘N on Задачи = Quick Entry (a new chat elsewhere); ⌘K / ⌘T apply to the selected task.
  useAction('app.newChat', () => setQuickEntry({ initial: '' }), { enabled: () => pageVisible(), priority: 10 })
  useAction('app.omnibox', () => { if (selected) setMoveFor(selected.id) }, { enabled: () => Boolean(selected) && pageFocused() && !inField(), priority: 10 }, [selected])
  useAction('app.newChatInPanel', () => { if (selected) applyWhen(selected.id, { kind: 'today' }) }, { enabled: () => Boolean(selected) && pageFocused() && !inField(), priority: 10 }, [selected])

  const reorderSelected = (delta: -1 | 1) => {
    if (!selected) return
    const section = sections.find((s) => s.tasks.some((task) => task.id === selected.id))
    if (!section) return
    const ids = section.tasks.map((task) => task.id)
    const from = ids.indexOf(selected.id)
    const to = from + delta
    if (to < 0 || to >= ids.length) return
    ids.splice(from, 1)
    ids.splice(to, 0, selected.id)
    mutate((current) => current.reorder(ids))
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (quickEntry || moveFor || confirm) return
    const target = event.target as HTMLElement
    // Portalled navigation still bubbles through this page's React tree.
    // Sidebar buttons and disclosures retain their native Space/Enter behavior.
    if (target.closest('[data-task-sidebar]')) return
    const typing = Boolean(target.closest('input, textarea, [contenteditable="true"]'))
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key === 'Enter' && selected) {
      event.preventDefault()
      void delegate(selected)
      return
    }
    if (typing) {
      if (event.key === 'Escape' && target === searchRef.current) {
        event.preventDefault()
        setSearch('')
        listRef.current?.focus()
      } else if (event.key === 'ArrowDown' && target === searchRef.current && visible[0]) {
        event.preventDefault()
        selectTask(visible[0].id)
        listRef.current?.focus()
      } else if (event.key === 'Escape' && target === titleRef.current) {
        event.preventDefault()
        listRef.current?.focus()
      }
      return
    }
    if (mod && !event.shiftKey && event.code === 'KeyE' && selected) { event.preventDefault(); applyWhen(selected.id, { kind: 'evening' }); return }
    if (mod && !event.shiftKey && event.code === 'KeyS' && selected) { event.preventDefault(); setPopover('when'); return }
    if (mod && event.shiftKey && event.code === 'KeyD' && selected) { event.preventDefault(); setPopover('deadline'); return }
    if (mod && !event.shiftKey && event.code === 'KeyD' && selected) {
      event.preventDefault()
      let copyId: string | null = null
      mutate((current) => { copyId = current.duplicate(selected.id).id })
      if (copyId) selectTask(copyId)
      return
    }
    if ((mod && event.key === 'Backspace') || (!mod && event.key === 'Delete')) {
      if (selected && selected.trashedAt == null) {
        event.preventDefault()
        const index = visible.findIndex((task) => task.id === selected.id)
        trashTask(selected)
        const next = visible[index + 1] ?? visible[index - 1]
        selectTask(next ? next.id : null)
      }
      return
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      reorderSelected(event.key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (mod || event.altKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const index = selected ? visible.findIndex((task) => task.id === selected.id) : -1
      const next = event.key === 'ArrowDown' ? visible[Math.min(visible.length - 1, index + 1)] : visible[Math.max(0, index - 1)]
      if (next) selectTask(next.id)
      return
    }
    if (event.key === ' ' && selected) {
      event.preventDefault()
      toggleComplete(selected)
      return
    }
    if (event.key === 'Enter' && selected) {
      event.preventDefault()
      titleRef.current?.focus()
      titleRef.current?.select()
      return
    }
    if (event.key === 'Escape') {
      if (search) { event.preventDefault(); setSearch(''); return }
      if (tagFilter) { event.preventDefault(); setTagFilter(null); return }
      if (selected) { event.preventDefault(); selectTask(null) }
      return
    }
    if (event.key === '/' || (event.key.length === 1 && /[\p{L}\p{N}#]/u.test(event.key))) {
      // Type-to-search (Things «Quick Find»).
      event.preventDefault()
      setSearch(event.key === '/' ? '' : event.key)
      window.setTimeout(() => searchRef.current?.focus(), 0)
    }
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────
  const isOurDrag = (event: React.DragEvent) => {
    const types = event.dataTransfer.types
    return types.includes(DRAG_TASK) || types.includes(DRAG_PLUS) || types.includes('text/task-id')
  }
  const draggedId = (event: React.DragEvent) => event.dataTransfer.getData(DRAG_TASK) || event.dataTransfer.getData('text/task-id')

  const applySectionContext = (current: PersonalTaskStore, id: string, ctx?: SectionContext) => {
    if (!ctx) return
    if (ctx.date != null) current.setWhen(id, { kind: 'date', at: ctx.date })
    if (ctx.evening !== undefined && view.kind === 'list' && view.id === 'today') current.setWhen(id, { kind: ctx.evening ? 'evening' : 'today' })
    const patch: TaskMoveTarget = {}
    if (ctx.projectId) patch.projectId = ctx.projectId
    if (ctx.areaId) patch.areaId = ctx.areaId
    if (ctx.headingId !== undefined) patch.headingId = ctx.headingId
    if (Object.keys(patch).length) current.moveTo(id, patch)
    if (current.get(id)?.trashedAt != null) current.restore(id)
  }

  const dropOnRow = (event: React.DragEvent, section: Section, target: PersonalTask) => {
    event.preventDefault()
    event.stopPropagation()
    setDropHint(null)
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2
    if (event.dataTransfer.types.includes(DRAG_PLUS)) {
      const index = section.tasks.findIndex((task) => task.id === target.id)
      const anchor = after ? target : section.tasks[index - 1]
      setInline({ sectionKey: section.key, afterId: anchor?.id, context: section.context })
      setInlineText('')
      return
    }
    const sourceId = draggedId(event)
    if (!sourceId || sourceId === target.id) return
    const ids = section.tasks.map((task) => task.id).filter((id) => id !== sourceId)
    ids.splice(ids.indexOf(target.id) + (after ? 1 : 0), 0, sourceId)
    const inSection = section.tasks.some((task) => task.id === sourceId)
    mutate((current) => {
      if (!current.get(sourceId)) return
      if (!inSection) applySectionContext(current, sourceId, section.context)
      current.reorder(ids)
    })
  }

  const dropOnSection = (event: React.DragEvent, section: Section) => {
    event.preventDefault()
    setDropHint(null)
    if (event.dataTransfer.types.includes(DRAG_PLUS)) {
      setInline({ sectionKey: section.key, afterId: section.tasks[section.tasks.length - 1]?.id, context: section.context })
      setInlineText('')
      return
    }
    const sourceId = draggedId(event)
    if (sourceId) mutate((current) => applySectionContext(current, sourceId, section.context))
  }

  const navDropProps = (dest: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TASK)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dropHint !== `nav:${dest}`) setDropHint(`nav:${dest}`)
    },
    onDragLeave: () => setDropHint((hint) => (hint === `nav:${dest}` ? null : hint)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      setDropHint(null)
      const sourceId = draggedId(event)
      if (sourceId) applyDestination(sourceId, dest)
    },
    className: cn('rounded-[6px]', dropHint === `nav:${dest}` && 'bg-accent/20 ring-[1.5px] ring-inset ring-accent'),
  })

  // ── Navigator ────────────────────────────────────────────────────────────
  const listCount = (id: TaskFilterId) => countFilter(tasks, now, id)
  const overdueCount = topLevel.filter((task) => isOpenTask(task) && task.dueAt != null && task.dueAt < startOfLocalDay(now)).length
  const trashCount = topLevel.filter((task) => task.trashedAt != null).length
  const createNav = (event: React.FormEvent) => {
    event.preventDefault()
    const name = navDraft.trim()
    if (!name) { setNavCreate(null); return }
    let id = ''
    const kind = navCreate
    mutate((current) => {
      id = kind === 'area' ? current.addArea(name).id : current.addProject(name, view.kind === 'area' ? view.id : undefined).id
    })
    setView(kind === 'area' ? { kind: 'area', id } : { kind: 'project', id })
    setNavCreate(null)
    setNavDraft('')
  }
  const navigator = (
    <TaskSidebar
      view={view}
      onSelect={setView}
      listCount={listCount}
      overdueCount={overdueCount}
      trashCount={trashCount}
      tasks={topLevel}
      areas={areas}
      personalProjects={personalProjects}
      workspaceProjects={projects.map(project => ({ id: project.config.id, name: project.config.name }))}
      tags={tags}
      agents={agents}
      dropProps={navDropProps}
      onToggleArea={area => mutate(current => current.updateArea(area.id, { collapsed: !area.collapsed }))}
      footer={(
        <div className="mt-auto pt-3">
          {navCreate ? (
            <form onSubmit={createNav} className="px-1">
              <input
                autoFocus
                value={navDraft}
                onChange={(event) => setNavDraft(event.target.value)}
                onBlur={() => { if (!navDraft.trim()) setNavCreate(null) }}
                onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setNavCreate(null) } }}
                placeholder={navCreate === 'area' ? t('tasks.nav.newAreaPlaceholder') : t('tasks.nav.newProjectPlaceholder')}
                aria-label={navCreate === 'area' ? t('tasks.nav.newArea') : t('tasks.nav.newProject')}
                data-testid="tasks-nav-create-input"
                className="h-7 w-full rounded-[6px] bg-foreground/[0.06] px-2 text-[12px] outline-none placeholder:text-text-muted"
              />
            </form>
          ) : (
            <div className="flex gap-1 px-1">
              <button type="button" data-testid="tasks-new-project" onClick={() => setNavCreate('project')} className="h-7 min-w-0 flex-1 truncate rounded-[6px] px-2 text-left text-[12px] text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground">+ {t('tasks.nav.newProject')}</button>
              <button type="button" data-testid="tasks-new-area" onClick={() => setNavCreate('area')} className="h-7 shrink-0 rounded-[6px] px-2 text-[12px] text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground">+ {t('tasks.nav.newArea')}</button>
            </div>
          )}
        </div>
      )}
    />
  )

  // ── List rows ────────────────────────────────────────────────────────────
  const currentProject = view.kind === 'project' ? store.projects().find((p) => p.id === view.id) : undefined
  const currentArea = view.kind === 'area' ? areas.find((a) => a.id === view.id) : undefined
  const listTitle = view.kind === 'list'
    ? t(filterLabelKey(view.id))
    : view.kind === 'project'
      ? projectName(view.id)
      : view.kind === 'area'
        ? (currentArea?.name ?? '')
        : view.kind === 'tag'
          ? `#${view.id}`
          : t(`tasks.agents.${view.id}`)

  const formatDeadline = (at: number) => {
    const days = daysUntil(at, now)
    if (days < 0) return t('tasks.deadline.overdue', { count: -days })
    if (days === 0) return t('tasks.deadline.today')
    return t('tasks.deadline.left', { count: days })
  }

  const renderInline = () => (
    <form
      key="inline"
      className="mx-1.5 flex items-center gap-2 rounded-[6px] bg-accent/10 px-2 py-[5px]"
      onSubmit={(event) => { event.preventDefault(); commitInline() }}
    >
      <TaskCheckbox checked={false} onToggle={() => {}} label={t('tasks.complete')} />
      <input
        autoFocus
        value={inlineText}
        onChange={(event) => setInlineText(event.target.value)}
        onBlur={() => commitInline()}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setInline(null); setInlineText('') } }}
        placeholder={t('tasks.quickEntry.placeholder')}
        aria-label={t('tasks.newTask')}
        data-testid="tasks-inline-input"
        className="h-5 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-muted"
      />
    </form>
  )

  const renderTaskRow = (task: PersonalTask, section: Section) => {
    const pending = pendingDone.has(task.id)
    const done = Boolean(task.completedAt || task.cancelledAt)
    const chip = agentChipFor(task, sessionMap)
    const progress = checklistProgress(task)
    const source = deriveTaskSource(task)
    const inProjectView = view.kind === 'project' && task.projectId === view.id
    const showToday = view.kind !== 'list' || (view.id !== 'today' && view.id !== 'upcoming')
    const isToday = isOpenTask(task) && matchesProjection(task, now, 'today')
    const place = !inProjectView && !section.onOpen && (task.projectId || task.areaId) ? (task.projectId ? projectName(task.projectId) : areaName(task.areaId)) : null
    const subs = subtasksOf(tasks, task.id)
    const selectedRow = selectedId === task.id
    const showStart = task.startAt != null && showToday && !isToday && !done
    const hasMeta = Boolean(place || progress.total || subs.length || source || showStart || (done && task.completedAt))
    return (
      <div
        key={task.id}
        data-task-id={task.id}
        draggable={!pending}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TASK, task.id)
          event.dataTransfer.setData('text/task-id', task.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => {
          if (!isOurDrag(event)) return
          event.preventDefault()
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          const hint = `${task.id}:${event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'}`
          if (dropHint !== hint) setDropHint(hint)
        }}
        onDragLeave={() => setDropHint((hint) => (hint?.startsWith(`${task.id}:`) ? null : hint))}
        onDrop={(event) => dropOnRow(event, section, task)}
        className={cn(
          'relative transition-opacity duration-300',
          pending && 'opacity-60',
          dropHint === `${task.id}:before` && 'before:absolute before:inset-x-3 before:top-0 before:h-[2px] before:rounded-full before:bg-accent',
          dropHint === `${task.id}:after` && 'after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-accent',
        )}
      >
        <div
          role="option"
          aria-selected={selectedRow}
          tabIndex={selectedRow ? 0 : -1}
          data-testid={`task-row-${task.id}`}
          onClick={() => selectTask(task.id)}
          onDoubleClick={() => { selectTask(task.id); window.setTimeout(() => titleRef.current?.focus(), 0) }}
          className={cn(
            'mx-1.5 flex cursor-default items-start gap-2 rounded-[6px] px-2 py-[5px] outline-none',
            selectedRow ? 'relative bg-accent/15 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:rounded-l-[6px] before:bg-accent' : 'hover:bg-foreground/[0.04]',
          )}
        >
          <TaskCheckbox checked={done} pending={pending} cancelled={Boolean(task.cancelledAt)} onToggle={() => toggleComplete(task)} label={t('tasks.complete')} testId={`task-check-${task.id}`} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {showToday && isToday && !done ? <span className="shrink-0 text-[var(--warning,#d9a13b)]" title={t('tasks.when.today')}>{task.evening ? Glyph.moon : Glyph.star}</span> : null}
              {task.priority === 'high' || task.priority === 'medium' ? (
                <span className={cn('shrink-0 font-bold', task.priority === 'high' ? 'text-destructive' : 'text-[var(--warning,#d9a13b)]')}>{task.priority === 'high' ? '!!' : '!'}</span>
              ) : null}
              <span className={cn('min-w-0 truncate transition-colors duration-300', (done || pending) && 'text-text-muted line-through')}>{task.title}</span>
              {visibleNotes(task.notes) ? <span className="shrink-0 text-text-muted" title={t('tasks.notes')}>{Glyph.notes}</span> : null}
              {task.recurrence ? <span className="shrink-0 text-text-muted" title={t('tasks.field.repeat')}>{Glyph.repeat}</span> : null}
              {task.reminderAt != null && task.reminderAt > now ? <span className="shrink-0 text-text-muted" title={t('tasks.field.reminder')}>{Glyph.bell}</span> : null}
              {chip ? <Badge tone={CHIP_TONE[chip.chip]}>{t(`tasks.chip.${chip.chip}`)}</Badge> : null}
            </div>
            {hasMeta ? (
              <div className="flex min-w-0 items-center gap-2 truncate text-[11px] text-text-muted">
                {done && task.completedAt ? <span>{t('tasks.row.doneAt', { time: timeFmt.format(task.completedAt) })}</span> : null}
                {place ? <span className="truncate">{place}</span> : null}
                {showStart ? <span>{dateFmt.format(task.startAt!)}</span> : null}
                {progress.total ? <span className="tabular-nums">☑ {progress.done}/{progress.total}</span> : null}
                {subs.length ? <span>{t('tasks.row.subtasks', { done: subs.filter((s) => s.completedAt).length, total: subs.length })}</span> : null}
                {source ? <span className="inline-flex items-center gap-0.5 truncate">{Glyph.link}{t(`tasks.linkKind.${source.kind}`)}</span> : null}
              </div>
            ) : null}
          </div>
          {task.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="mt-[1px] inline-flex h-[18px] max-w-[96px] shrink-0 items-center truncate rounded-[4px] bg-foreground/[0.07] px-1.5 text-[11px] text-text-secondary">{tag}</span>
          ))}
          {task.dueAt != null && !done ? (
            <span className={cn('mt-[1px] inline-flex h-[18px] shrink-0 items-center gap-1 text-[11px] tabular-nums', daysUntil(task.dueAt, now) <= 0 ? 'font-semibold text-destructive' : 'text-text-secondary')} title={`${t('tasks.field.deadline')}: ${dateFmt.format(task.dueAt)}`}>
              {Glyph.flag}{formatDeadline(task.dueAt)}
            </span>
          ) : null}
        </div>
        {inline && inline.sectionKey === section.key && inline.afterId === task.id ? renderInline() : null}
      </div>
    )
  }

  const renderSectionHeader = (section: Section) => {
    if (section.day != null) {
      const date = new Date(section.day)
      return (
        <div className="flex items-baseline gap-2 border-b border-foreground/10 px-3.5 pb-1 pt-3">
          <span className="text-[22px] font-bold leading-none tabular-nums">{date.getDate()}</span>
          <span className="text-[13px] font-semibold">{section.title}</span>
        </div>
      )
    }
    if (!section.title) return null
    const heading = section.headingId ? store.headings(view.kind === 'project' ? view.id : '').find((h) => h.id === section.headingId) : undefined
    return (
      <div className="group flex items-center gap-2 border-b border-foreground/10 px-3.5 pb-1 pt-3">
        {section.pie ? <ProgressPie done={section.pie.done} total={section.pie.total} size={13} label={t('tasks.project.progress', { done: section.pie.done, total: section.pie.total })} /> : null}
        {heading ? (
          <input
            defaultValue={heading.title}
            key={heading.id + heading.title}
            aria-label={t('tasks.heading.rename')}
            onBlur={(event) => { const title = event.target.value.trim(); if (title && title !== heading.title) mutate((current) => current.updateHeading(heading.id, { title })) }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); event.stopPropagation() }}
            className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-accent outline-none"
          />
        ) : section.onOpen ? (
          <button type="button" onClick={section.onOpen} className="min-w-0 truncate text-left text-[13px] font-semibold hover:underline">{section.title}</button>
        ) : (
          <span className="min-w-0 truncate text-[13px] font-semibold">{section.title}</span>
        )}
        {section.subtitle ? <span className="text-[11px] text-text-muted">{section.subtitle}</span> : null}
        <span className="flex-1" />
        {heading ? (
          <button type="button" onClick={() => setConfirm({ kind: 'removeHeading', id: heading.id })} className="rounded-[4px] px-1.5 text-[11px] text-text-muted opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100">{t('tasks.heading.remove')}</button>
        ) : null}
      </div>
    )
  }

  const renderSection = (section: Section) => {
    const inlineHere = inline && inline.sectionKey === section.key
    const inlineTop = inlineHere && !inline!.afterId
    const skipEmpty = !section.tasks.length && !section.title && !inlineTop && section.day == null
    if (skipEmpty) return null
    return (
      <div
        key={section.key}
        className="pb-1"
        onDragOver={(event) => { if (isOurDrag(event)) event.preventDefault() }}
        onDrop={(event) => dropOnSection(event, section)}
      >
        {renderSectionHeader(section)}
        <div className="pt-1">
          {inlineTop ? renderInline() : null}
          {section.tasks.map((task) => renderTaskRow(task, section))}
          {!section.tasks.length && !inlineTop && section.emptyHint ? (
            <div className="px-3.5 py-1 text-[12px] text-text-muted">{t('tasks.section.emptyDrop')}</div>
          ) : null}
        </div>
      </div>
    )
  }

  const emptyKey = view.kind === 'list' ? `tasks.empty.${view.id}` : view.kind === 'project' ? 'tasks.empty.project' : view.kind === 'area' ? 'tasks.empty.area' : 'tasks.empty.tag'
  const nothing = sections.every((section) => section.tasks.length === 0 && section.day == null && !section.onOpen) && !inline

  const sortControl = view.kind !== 'agents' ? (
    <Button
      variant="ghost"
      aria-label={t('tasks.sortBy')}
      onClick={() => setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]!)}
      data-testid="tasks-sort"
    >
      {t('tasks.sortLabel', { sort: t(`tasks.sort.${sort}`) })}
    </Button>
  ) : null

  const headerControls = (
    <>
      <span ref={quickEntry ? undefined : quickEntryTarget} className="inline-flex" data-tour="tasks.quick-entry">
        <Button onClick={() => setQuickEntry({ initial: '' })}>{t('tasks.quickEntry.title')}</Button>
      </span>
      {view.kind === 'list' && view.id === 'trash' && trashCount ? (
        <Button variant="danger" onClick={() => setConfirm({ kind: 'emptyTrash' })} data-testid="tasks-empty-trash">{t('tasks.trash.empty')}</Button>
      ) : null}
      {sortControl}
    </>
  )

  const projectToolbar = view.kind === 'project' && currentProject ? (
    <div className="flex flex-wrap items-center gap-1 px-3 pb-1.5">
      <Button variant="ghost" onClick={() => mutate((current) => { current.addHeading(t('tasks.heading.new'), currentProject.id) })} data-testid="tasks-add-heading">+ {t('tasks.heading.add')}</Button>
      <Button variant="ghost" onClick={() => setShowDone((v) => !v)} data-testid="tasks-toggle-done">{showDone ? t('tasks.project.hideDone') : t('tasks.project.showDone')}</Button>
      <Button variant="ghost" onClick={() => mutate((current) => { if (currentProject.completedAt) current.reopenProject(currentProject.id); else current.completeProject(currentProject.id) })} data-testid="tasks-complete-project">
        {currentProject.completedAt ? t('tasks.project.reopen') : t('tasks.project.complete')}
      </Button>
      <Button variant="ghost" className="text-destructive" onClick={() => { mutate((current) => current.trashProject(currentProject.id)); setView({ kind: 'list', id: 'anytime' }); toast(t('tasks.toast.projectTrashed'), { action: { label: t('tasks.toast.undo'), onClick: () => mutate((current) => current.restoreProject(currentProject.id)) } }) }} data-testid="tasks-trash-project">
        {t('tasks.project.trash')}
      </Button>
    </div>
  ) : view.kind === 'area' && currentArea ? (
    <div className="flex flex-wrap items-center gap-1 px-3 pb-1.5">
      <Button variant="ghost" onClick={() => { let id = ''; mutate((current) => { id = current.addProject(t('tasks.nav.newProject'), currentArea.id).id }); if (id) setView({ kind: 'project', id }) }}>+ {t('tasks.nav.newProject')}</Button>
      <Button variant="ghost" className="text-destructive" onClick={() => setConfirm({ kind: 'removeArea', id: currentArea.id })} data-testid="tasks-remove-area">{t('tasks.area.remove')}</Button>
    </div>
  ) : null

  const titleNode = view.kind === 'project' && currentProject ? (
    <span className="flex min-w-0 items-center gap-2">
      <ProgressPie done={projectProgress(topLevel, currentProject.id).done} total={projectProgress(topLevel, currentProject.id).total} size={16} label={t('tasks.project.progressLabel')} />
      <input
        key={currentProject.id + currentProject.name}
        defaultValue={currentProject.name}
        aria-label={t('tasks.rename')}
        data-testid="tasks-project-title"
        onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== currentProject.name) mutate((current) => current.updateProject(currentProject.id, { name })) }}
        onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); event.stopPropagation() }}
        className="min-w-0 flex-1 bg-transparent font-semibold outline-none"
      />
    </span>
  ) : view.kind === 'area' && currentArea ? (
    <input
      key={currentArea.id + currentArea.name}
      defaultValue={currentArea.name}
      aria-label={t('tasks.rename')}
      onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== currentArea.name) mutate((current) => current.updateArea(currentArea.id, { name })) }}
      onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); event.stopPropagation() }}
      className="min-w-0 bg-transparent font-semibold outline-none"
    />
  ) : listTitle

  const list = (
    <div className="relative flex h-full min-h-0 flex-col">
      <ListHeader title={titleNode} subtitle={t('tasks.status.open', { count: view.kind === 'agents' ? agentList.length : visible.filter(isOpenTask).length })} actions={headerControls} />
      {projectToolbar}
      {view.kind === 'project' && currentProject ? (
        <textarea
          key={currentProject.id}
          defaultValue={currentProject.notes ?? ''}
          placeholder={t('tasks.project.notesPlaceholder')}
          aria-label={t('tasks.notes')}
          rows={1}
          onBlur={(event) => { const notes = event.target.value; if (notes !== (currentProject.notes ?? '')) mutate((current) => current.updateProject(currentProject.id, { notes })) }}
          onKeyDown={(event) => event.stopPropagation()}
          className="mx-3.5 mb-1 resize-none bg-transparent text-[12px] text-text-secondary outline-none placeholder:text-text-muted"
        />
      ) : null}
      {view.kind !== 'agents' ? (
        <div className="flex items-center gap-2 px-3.5 pb-1.5">
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[6px] bg-foreground/[0.05] px-2">
            <span className="text-text-muted">{Glyph.search}</span>
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSearch(''); listRef.current?.focus() }
                if (event.key === 'ArrowDown') { event.preventDefault(); if (visible[0]) selectTask(visible[0].id); listRef.current?.focus() }
              }}
              placeholder={t('tasks.search.placeholder')}
              aria-label={t('tasks.search.label')}
              data-testid="tasks-search"
              className="h-6 min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-text-muted"
            />
          </div>
        </div>
      ) : null}
      {view.kind !== 'agents' && viewTags.length && !searching ? (
        <div className="flex flex-wrap gap-1 px-3.5 pb-1.5" role="group" aria-label={t('tasks.tagFilter')}>
          {viewTags.slice(0, 10).map((tag) => (
            <button key={tag} type="button" aria-pressed={tagFilter === tag} onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))} className={cn('h-[20px] rounded-[4px] px-1.5 text-[11px]', tagFilter === tag ? 'bg-accent text-accent-foreground' : 'bg-foreground/[0.06] text-text-secondary hover:text-foreground')}>
              {tag}
            </button>
          ))}
        </div>
      ) : null}
      {(filter === 'all' || filter === 'inbox') && view.kind === 'list' && !searching ? (
        <form onSubmit={onCreateTask} className="flex items-center gap-2 px-3.5 pb-1.5">
          <input
            ref={quickRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setDraft(''); listRef.current?.focus() } }}
            placeholder={t('tasks.quickEntryPlaceholder')}
            aria-label={t('tasks.newTask')}
            data-testid="tasks-quick-input"
            className="h-7 min-w-0 flex-1 rounded-[6px] bg-foreground/[0.05] px-2 text-[12px] outline-none placeholder:text-text-muted"
          />
          <Button type="submit" data-testid="new-task-button">{t('tasks.newTask')}</Button>
        </form>
      ) : null}
      {(filter === 'today' || filter === 'upcoming') && !searching ? <div className="px-3.5 pb-1"><CalendarStatusStrip tasks={tasks} now={now} /></div> : null}
      <div
        ref={listRef}
        role="listbox"
        aria-label={typeof listTitle === 'string' ? listTitle : undefined}
        tabIndex={0}
        data-testid="tasks-list"
        className="relative min-h-0 flex-1 overflow-y-auto pb-16 outline-none"
      >
        {view.kind === 'agents' ? (
          agentList.length === 0 ? (
            <EmptyState title={t(`tasks.agents.empty.${view.id}`)} />
          ) : agentList.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => navigate(routes.view.allSessions(session.id))}
              className="mx-1.5 flex w-[calc(100%-12px)] items-center gap-2 rounded-[6px] px-2 py-[5px] text-left hover:bg-foreground/[0.04]"
            >
              <span className="min-w-0 flex-1 truncate">{getSessionTitle(session as never)}</span>
              {session.sessionStatus ? <Badge tone="muted">{String(session.sessionStatus)}</Badge> : null}
            </button>
          ))
        ) : nothing ? (
          <EmptyState title={searching ? t('tasks.search.none') : t(emptyKey)} />
        ) : sections.map(renderSection)}
      </div>
      {view.kind !== 'agents' && view.kind !== 'tag' && !(view.kind === 'list' && (view.id === 'logbook' || view.id === 'trash')) ? (
        <button
          type="button"
          draggable
          onDragStart={(event) => { event.dataTransfer.setData(DRAG_PLUS, '1'); event.dataTransfer.effectAllowed = 'copy' }}
          onClick={() => {
            const section = sections.find((s) => s.context) ?? sections[0]
            if (section) { setInline({ sectionKey: section.key, afterId: selected && section.tasks.some((x) => x.id === selected.id) ? selected.id : section.tasks[section.tasks.length - 1]?.id, context: section.context }); setInlineText('') }
            else setQuickEntry({ initial: '' })
          }}
          title={t('tasks.magicPlusHint')}
          aria-label={t('tasks.magicPlus')}
          data-testid="tasks-magic-plus"
          className="absolute bottom-4 right-4 flex size-9 items-center justify-center rounded-full bg-accent text-[20px] leading-none text-accent-foreground shadow-middle transition-transform hover:scale-105 active:scale-95"
        >
          +
        </button>
      ) : null}
    </div>
  )

  // ── Detail ───────────────────────────────────────────────────────────────
  const openSession = (sessionId: string) => navigate(routes.view.allSessions(sessionId))
  const openSource = (link: TaskLink) => {
    if (link.kind === 'session') navigate(routes.view.allSessions(link.id))
    else if (link.kind === 'meeting') navigate(routes.view.meetings(link.id))
    else if (link.kind === 'feed') navigate(routes.view.feed(link.id))
    else if (link.kind === 'mail') navigate(routes.view.inbox(link.id))
    else if (link.kind === 'note') navigate(routes.view.notes(link.id))
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
    if (importRef.current) return
    const owner = importScopeRef.current
    const actorCurrent = capturePersonalTaskScope()
    const current = () => mountedRef.current && owner === importScopeRef.current && actorCurrent()
    importRef.current = true
    setImporting(true)
    try {
      const text = await file.text()
      if (!current()) return
      const incoming = PersonalTaskStore.tryFromJson(text)
      if (incoming.status !== 'ok') throw new Error('Invalid task import')
      await importPersonalTasksConfirmed(incoming.store.snapshot(), current)
      if (!current()) return
      // The shared store publishes the canonical receipt plus any edits made
      // during file reading/commit, rather than the captured render's store.
      const next = loadPersonalTaskStore()
      storeRef.current = next
      setStore(next)
      toast(t('tasks.toast.imported'))
    } catch {
      if (current()) toast.error(t('tasks.toast.importFailed'))
    } finally {
      importRef.current = false
      if (mountedRef.current) setImporting(false)
    }
  }

  const shortcuts: Array<[string, string]> = [
    [formatHotkeyDisplay('mod+n'), 'quick'],
    [formatHotkeyDisplay('space'), 'complete'],
    ['↑ ↓', 'navigate'],
    [formatHotkeyDisplay('enter'), 'edit'],
    [formatHotkeyDisplay('mod+k'), 'move'],
    [formatHotkeyDisplay('mod+t'), 'today'],
    [formatHotkeyDisplay('mod+e'), 'evening'],
    [formatHotkeyDisplay('mod+s'), 'when'],
    [formatHotkeyDisplay('shift+mod+d'), 'deadline'],
    [formatHotkeyDisplay('mod+d'), 'duplicate'],
    [`${formatHotkeyDisplay('alt+up')} / ${formatHotkeyDisplay('alt+down')}`, 'reorder'],
    [formatHotkeyDisplay('mod+backspace'), 'trash'],
    ['A–Я', 'search'],
  ]

  const detail = selected ? (
    <TaskDetail
      key={selected.id}
      task={selected}
      store={store}
      mutate={mutate}
      now={now}
      subtasks={subtasks}
      allTags={tags.map((x) => x.tag)}
      placeLabel={placeLabel(selected)}
      sessionMap={sessionMap}
      agentChip={selectedChip}
      delegating={delegating}
      delegateError={delegateError ? t(delegateError) : null}
      canDelegate={Boolean(workspace?.id && nativeTasks && delegationApi)}
      onDelegate={() => void delegate(selected)}
      onToggleComplete={() => toggleComplete(selected)}
      onOpenMove={() => setMoveFor(selected.id)}
      onOpenSource={openSource}
      onOpenSession={openSession}
      onOpenBoard={() => setView({ kind: 'agents', id: 'board' })}
      onTrash={() => trashTask(selected)}
      onClose={() => { selectTask(null); listRef.current?.focus() }}
      titleRef={titleRef}
      popover={popover}
      setPopover={setPopover}
    />
  ) : (
    <div className="flex flex-col gap-3 px-5 py-6">
      <p className="text-text-muted" role="status" data-testid={selectedId ? 'tasks-not-found' : 'tasks-select-hint'}>
        {t(selectedId ? 'tasks.notFound' : 'tasks.selectHint')}
      </p>
      {selectedId ? (
        <Button variant="ghost" className="self-start" onClick={() => selectTask(null)}>
          {t('common.backToList')}
        </Button>
      ) : (
        <div className="grid max-w-[360px] grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]" aria-label={t('tasks.status.keys')}>
          {shortcuts.map(([key, id]) => (
            <React.Fragment key={id}>
              <kbd className="font-sans font-semibold text-text-secondary">{key}</kbd>
              <span className="text-text-muted">{t(`tasks.keys.${id}`)}</span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )

  const todayCount = countFilter(tasks, now, 'today')
  const agentLinked = topLevel.filter((task) => isOpenTask(task) && agentChipFor(task, sessionMap)?.chip === 'running').length
  const sync = personalTasksSyncState()

  return (
    <div ref={rootRef} className="h-full min-h-0" onKeyDown={onKeyDown}>
      <style>{`
        @keyframes task-check-draw { from { stroke-dashoffset: 14 } to { stroke-dashoffset: 0 } }
        .task-check-draw { stroke-dasharray: 14; animation: task-check-draw 220ms ease-out both }
        @media (prefers-reduced-motion: reduce) { .task-check-draw { animation: none } }
      `}</style>
      {personalTasksLoadStatus() === 'quarantine' ? (
        <div className="bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive" role="alert" data-testid="tasks-quarantine">
          {t('tasks.quarantineBanner')}
        </div>
      ) : null}
      {personalTasksSyncConflicts().length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-2 text-[12px]" role="alert" data-testid="tasks-sync-conflicts">
          <span>{t('tasks.sync.conflict')}</span>
          {personalTasksSyncConflicts().map((conflict) => (
            <span key={conflict.id} className="inline-flex items-center gap-1">
              <span className="max-w-40 truncate">{conflict.current?.task.title ?? store.get(conflict.id)?.title ?? conflict.id}</span>
              <Button variant="secondary" onClick={() => resolvePersonalTaskConflict(conflict.id, 'local')}>{t('tasks.sync.keepLocal')}</Button>
              <Button variant="ghost" onClick={() => resolvePersonalTaskConflict(conflict.id, 'server')}>{t('tasks.sync.useServer')}</Button>
            </span>
          ))}
        </div>
      ) : null}
      <ModeScreenLayout
        testId="tasks-page"
        responsive={{ selectedId, onBack: () => selectTask(null), backLabel: t('common.backToList'), navigationLabel: t('tasks.navigation'), detailLabel: t('tasks.details') }}
        navigator={navigator}
        list={list}
        detail={detail}
        status={(
          <>
            <span className="truncate">{t('tasks.status.summary', { today: todayCount, agents: agentLinked })}</span>
            <span>·</span>
            <span data-testid="tasks-sync-state" className="truncate">{t(`tasks.status.sync.${sync}`)}</span>
            <span className="flex-1" />
            <button type="button" className="hover:text-foreground" onClick={onExport}>{t('tasks.export')}</button>
            <label className="cursor-pointer hover:text-foreground">
              {t('tasks.import')}
              <input
                type="file"
                disabled={importing}
                aria-label={t('tasks.import')}
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void onImport(file)
                  event.target.value = ''
                }}
              />
            </label>
            <span className="hidden xl:inline">· {t('tasks.status.hint', { new: formatHotkeyDisplay('mod+n'), move: formatHotkeyDisplay('mod+k') })}</span>
          </>
        )}
      />
      {quickEntry ? (
        <QuickEntry
          now={now}
          initialText={quickEntry.initial}
          destinationLabel={destinationLabel}
          projects={personalProjects}
          areas={areas}
          initialProjectId={viewDefaults().projectId}
          initialAreaId={viewDefaults().areaId}
          onClose={() => { setQuickEntry(null); listRef.current?.focus() }}
          onSubmit={onQuickEntry}
        />
      ) : null}
      {moveFor && store.get(moveFor) ? (
        <MoveDialog
          title={t('tasks.assignProject')}
          destinations={moveDestinations}
          onPick={(dest) => { applyDestination(moveFor, dest); setMoveFor(null); listRef.current?.focus() }}
          onClose={() => { setMoveFor(null); listRef.current?.focus() }}
        />
      ) : null}
      {confirm?.kind === 'emptyTrash' ? (
        <ConfirmDialog
          title={t('tasks.trash.emptyTitle')}
          body={t('tasks.trash.emptyBody', { count: trashCount })}
          confirmLabel={t('tasks.trash.empty')}
          onConfirm={() => { mutate((current) => { current.emptyTrash() }); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm?.kind === 'removeArea' ? (
        <ConfirmDialog
          title={t('tasks.area.removeTitle')}
          body={t('tasks.area.removeBody')}
          confirmLabel={t('tasks.area.remove')}
          onConfirm={() => { const id = confirm.id; mutate((current) => { current.removeArea(id) }); setConfirm(null); setView({ kind: 'list', id: 'anytime' }) }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm?.kind === 'removeHeading' ? (
        <ConfirmDialog
          title={t('tasks.heading.removeTitle')}
          body={t('tasks.heading.removeBody')}
          confirmLabel={t('tasks.heading.remove')}
          onConfirm={() => { const id = confirm.id; mutate((current) => { current.removeHeading(id) }); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  )
}
