import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowLeft, ArrowUp, CheckCheck, Download, MoreHorizontal, Plus, Upload, X } from 'lucide-react'
import {
  PersonalTaskStore,
  buildTodayPlan,
  filterAndSortTasks,
  type PersonalTask,
  type TaskFilterId,
  type TaskLinkKind,
  type TaskPriority,
  type TaskSortId,
} from '@craft-agent/core/tasks/personal'
import { CalendarStatusStrip } from '@/components/calendar/CalendarStatusStrip'
import { ViewPurposeList } from '@/components/views/ViewPurposeList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { useProjects } from '@/hooks/useProjects'
import { loadPersonalTaskStore, persistPersonalTaskStore, subscribePersonalTasks } from '@/lib/personal-tasks'
import { cn } from '@/lib/utils'
import { CatalogDisclosure, CatalogSelect, useCatalogFocus } from './tasks/CatalogPanel'
import { parseTaskImport, taskDateFromInput, taskDateInputValue } from './tasks/presentation'
import { clearTaskDraftField, parseTaskTagDraft, type TaskDraft, type TaskDrafts } from './tasks/drafts'

const FILTERS: TaskFilterId[] = ['all', 'inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook']
const SORTS: TaskSortId[] = ['order', 'due', 'priority', 'project', 'title']
const LINK_KINDS: TaskLinkKind[] = ['note', 'session', 'message', 'workflowRun']
const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high']
const ALL_PROJECTS = '__all_projects__'
const NO_PROJECT = '__no_project__'

function filterLabelKey(id: TaskFilterId): string {
  return id === 'all' ? 'tasks.filterAll' : `tasks.projection.${id}`
}

function filterPurposeKey(id: TaskFilterId): string | null {
  if (id === 'all') return 'tasks.view.overviewPurpose'
  if (id === 'today') return 'tasks.view.planPurpose'
  if (id === 'logbook') return 'tasks.view.processPurpose'
  return null
}

export interface TasksPageProps {
  /** Undefined keeps standalone usage local; null is the catalog route. */
  selectedId?: string | null
  onSelect?: (id: string | null) => void
}

export default function TasksPage(props: TasksPageProps = {}) {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const { projects } = useProjects(workspace?.id)
  const [store, setStore] = useState(loadPersonalTaskStore)
  const storeRef = useRef(store)
  const [filter, setFilter] = useState<TaskFilterId>('all')
  const [sort, setSort] = useState<TaskSortId>('order')
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const selectedId = props.selectedId === undefined ? localSelectedId : props.selectedId
  const selectTask = props.onSelect ?? setLocalSelectedId
  const rootRef = useCatalogFocus(selectedId)
  const importRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [taskDrafts, setTaskDrafts] = useState<TaskDrafts>({})
  const taskDraft = selectedId ? taskDrafts[selectedId] : undefined
  const linkKind = taskDraft?.linkKind ?? 'note'
  const linkId = taskDraft?.linkId ?? ''
  const patchTaskDraft = (id: string, patch: TaskDraft) => setTaskDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  const [importing, setImporting] = useState(false)
  const [feedback, setFeedback] = useState<{ key: string; error: boolean } | null>(null)
  const now = Date.now()

  useEffect(() => subscribePersonalTasks(() => {
    const next = loadPersonalTaskStore()
    storeRef.current = next
    setStore(next)
  }), [])

  const persist = useCallback((next: PersonalTaskStore): boolean => {
    try {
      persistPersonalTaskStore(next)
      storeRef.current = next
      setStore(next)
      setFeedback(null)
      return true
    } catch {
      setFeedback({ key: 'tasks.saveFailed', error: true })
      return false
    }
  }, [])

  const mutate = useCallback((fn: (current: PersonalTaskStore) => void): boolean => {
    try {
      // A blur save and a click action can occur before React renders the first update.
      const next = PersonalTaskStore.fromJson(storeRef.current.exportJson())
      fn(next)
      return persist(next)
    } catch {
      setFeedback({ key: 'tasks.saveFailed', error: true })
      return false
    }
  }, [persist])

  const tasks = store.list()
  const visible = useMemo(
    () => filterAndSortTasks(tasks, now, { filter, projectId: projectFilter, sort }),
    [tasks, now, filter, projectFilter, sort],
  )
  const projectName = useCallback((projectId?: string) => {
    if (!projectId) return t('tasks.unassigned')
    return projects.find((project) => project.config.id === projectId)?.config.name ?? projectId
  }, [projects, t])
  const selected = selectedId ? store.get(selectedId) : undefined
  const selectedIndex = visible.findIndex((task) => task.id === selectedId)
  const todayPlan = useMemo(() => buildTodayPlan(tasks, now), [tasks, now])
  const purposeKey = filterPurposeKey(filter)
  const projectOptions = projects.map((project) => ({ value: project.config.id, label: project.config.name }))
  // A referenced project may have been removed or may be outside the loaded project catalog.
  const selectedProjectOptions = selected?.projectId && !projectOptions.some((option) => option.value === selected.projectId)
    ? [...projectOptions, { value: selected.projectId, label: projectName(selected.projectId) }]
    : projectOptions

  const onCreateTask = (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    let createdId: string | null = null
    const saved = mutate((current) => {
      const created = current.create({
        title: draft,
        list: filter === 'logbook' || filter === 'all' ? 'inbox' : filter,
        projectId: projectFilter ?? undefined,
        quickEntry: true,
      })
      createdId = created.id
    })
    if (saved && createdId) {
      selectTask(createdId)
      setDraft('')
    }
  }

  const toggleComplete = (task: PersonalTask) => {
    mutate((current) => {
      if (task.completedAt) current.reopen(task.id)
      else current.complete(task.id)
    })
  }

  const moveTask = (id: string, dir: -1 | 1) => {
    if (sort !== 'order') return
    const ids = visible.map((task) => task.id)
    const index = ids.indexOf(id)
    const next = index + dir
    if (index < 0 || next < 0 || next >= ids.length) return
    const reordered = [...ids]
    const [item] = reordered.splice(index, 1)
    reordered.splice(next, 0, item!)
    mutate((current) => current.reorder(reordered))
  }

  const dropOn = (targetId: string, sourceId: string) => {
    if (sort !== 'order' || !sourceId || sourceId === targetId) return
    const ids = visible.map((task) => task.id)
    const from = ids.indexOf(sourceId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const reordered = [...ids]
    const [item] = reordered.splice(from, 1)
    reordered.splice(to, 0, item!)
    mutate((current) => current.reorder(reordered))
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
    if (importing) return
    setImporting(true)
    try {
      const incoming = parseTaskImport(await file.text())
      if (!incoming) {
        setFeedback({ key: 'tasks.importFailed', error: true })
        return
      }
      // Read the latest store after the file read; edits made while importing must survive.
      const next = loadPersonalTaskStore()
      next.importBundle(incoming.snapshot(), 'merge')
      if (persist(next)) setFeedback({ key: 'tasks.imported', error: false })
    } catch {
      setFeedback({ key: 'tasks.importFailed', error: true })
    } finally {
      setImporting(false)
    }
  }

  const addLink = (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected || !linkId.trim()) return
    const id = linkId.trim()
    if (mutate((current) => current.link(selected.id, { kind: linkKind, id }))) {
      setTaskDrafts((current) => clearTaskDraftField(current, selected.id, 'linkId', linkId))
    }
  }

  const commitTags = (task: PersonalTask) => {
    const value = taskDrafts[task.id]?.tags
    if (value === undefined) return
    const tags = parseTaskTagDraft(value)
    if (mutate((current) => current.update(task.id, { tags }))) {
      setTaskDrafts((current) => clearTaskDraftField(current, task.id, 'tags', value))
    }
  }

  const commitNotes = (task: PersonalTask, value = taskDrafts[task.id]?.notes) => {
    if (value === undefined) return
    if (mutate((current) => current.update(task.id, { notes: value }))) {
      setTaskDrafts((current) => clearTaskDraftField(current, task.id, 'notes', value))
    }
  }

  return (
    <div ref={rootRef} className="catalog-panel" data-testid="tasks-page" data-has-selection={selectedId != null}>
      {feedback ? (
        <div className={cn('flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[13px]', feedback.error ? 'text-destructive' : 'text-muted-foreground')}>
          <p className="min-w-0 flex-1" role={feedback.error ? 'alert' : 'status'}>{t(feedback.key)}</p>
          <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={t('common.dismiss')} onClick={() => setFeedback(null)}><X /></Button>
        </div>
      ) : null}
      <div className="catalog-layout">
        <section className="catalog-master" aria-label={t('sidebar.tasks')}>
          <header className="shrink-0 border-b border-border p-3">
            <div className="mb-3 flex items-center gap-2">
              <h1 className="min-w-0 flex-1 text-[14px] font-semibold">{t('sidebar.tasks')}</h1>
              <span className="text-[11px] tabular-nums text-muted-foreground">{t('common.totalCount', { count: visible.length })}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label={t('common.more')}><MoreHorizontal /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onExport}><Download size={14} />{t('tasks.export')}</DropdownMenuItem>
                  <DropdownMenuItem disabled={importing} onSelect={() => importRef.current?.click()}><Upload size={14} />{t('tasks.import')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <input ref={importRef} type="file" accept="application/json,.json" className="hidden" aria-label={t('tasks.import')} onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void onImport(file)
              }} />
            </div>
            <form onSubmit={onCreateTask} className="flex items-center gap-2">
              <Input data-catalog-entry value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('tasks.quickEntryPlaceholder')} className="h-8 flex-1 text-[13px]" aria-label={t('tasks.quickEntryPlaceholder')} />
              <Button type="submit" size="sm" data-testid="new-task-button" disabled={!draft.trim()} className="shrink-0 px-2.5"><Plus size={14} />{t('tasks.newTask')}</Button>
            </form>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <CatalogSelect label={t('sidebar.views')} value={filter} options={FILTERS.map((id) => ({ value: id, label: t(filterLabelKey(id)) }))} onChange={setFilter} />
              <CatalogSelect label={t('tasks.sortBy')} value={sort} options={SORTS.map((id) => ({ value: id, label: t(`tasks.sort.${id}`) }))} onChange={setSort} />
              <CatalogSelect className="col-span-2 min-w-0" label={t('tasks.filterProject')} value={projectFilter ?? ALL_PROJECTS} options={[{ value: ALL_PROJECTS, label: t('tasks.filterAll') }, ...projectOptions]} onChange={(id) => setProjectFilter(id === ALL_PROJECTS ? null : id)} />
            </div>
            {purposeKey ? <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t(purposeKey)}</p> : null}
          </header>
          {filter === 'today' || filter === 'upcoming' ? <CalendarStatusStrip tasks={tasks} now={now} /> : null}
          {filter === 'today' && todayPlan.length > 0 ? (
            <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
              {todayPlan.map((group) => <span key={`${group.bucket}-${group.projectId ?? 'none'}`} className="shrink-0 rounded-full bg-foreground/5 px-2 py-0.5">{t(`tasks.bucket.${group.bucket}`)} · {group.tasks.length}</span>)}
            </div>
          ) : null}
          <ul className="min-h-24 flex-1 p-2" aria-label={t(filterLabelKey(filter))}>
            {visible.length === 0 ? (
              <li className="flex flex-col items-center gap-2 px-3 py-8 text-center text-[13px] text-muted-foreground" role="status">
                <CheckCheck size={24} className="opacity-50" aria-hidden="true" />
                {t(filter === 'today' ? 'tasks.emptyToday' : tasks.length === 0 ? 'tasks.emptyAll' : 'common.noResults')}
              </li>
            ) : visible.map((task) => (
              <li key={task.id} draggable={sort === 'order'} onDragStart={(event) => event.dataTransfer.setData('text/task-id', task.id)} onDragOver={(event) => { if (sort === 'order') event.preventDefault() }} onDrop={(event) => { event.preventDefault(); dropOn(task.id, event.dataTransfer.getData('text/task-id')) }} className={cn('mb-0.5 flex items-center rounded-md', selectedId === task.id ? 'bg-foreground/8' : 'hover:bg-foreground/4')}>
                <label className="catalog-completion-target flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm focus-within:ring-2 focus-within:ring-focus">
                  <input type="checkbox" checked={Boolean(task.completedAt)} onChange={() => toggleComplete(task)} aria-label={`${task.completedAt ? t('tasks.reopen') : t('tasks.complete')}: ${task.title}`} className="size-3.5 accent-accent" />
                </label>
                <button type="button" data-catalog-row={task.id} onClick={() => selectTask(task.id)} aria-current={selectedId === task.id ? 'true' : undefined} onKeyDown={(event) => {
                  if (event.altKey && sort === 'order' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                    event.preventDefault()
                    moveTask(task.id, event.key === 'ArrowUp' ? -1 : 1)
                  }
                }} className="min-w-0 flex-1 rounded-md py-2 pr-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  <span className={cn('block truncate', task.completedAt && 'line-through text-muted-foreground')}>{task.title}</span>
                  {task.projectId || task.dueAt ? <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{[task.projectId ? projectName(task.projectId) : null, task.dueAt ? new Date(task.dueAt).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' }) : null].filter(Boolean).join(' · ')}</span> : null}
                </button>
                {task.priority !== 'none' ? <span className={cn('mr-2 size-1.5 shrink-0 rounded-full', task.priority === 'high' ? 'bg-destructive' : 'bg-accent')} role="img" aria-label={`${t('tasks.priority')}: ${t(`tasks.priority.${task.priority}`)}`} /> : null}
              </li>
            ))}
          </ul>
          <div className="shrink-0 px-3"><CatalogDisclosure title={t('sidebar.views')}><ViewPurposeList /></CatalogDisclosure></div>
        </section>

        <section className="catalog-detail" aria-label={t('tasks.editTask')}>
          <Button variant="ghost" size="sm" className="catalog-back self-start px-1" onClick={() => selectTask(null)}><ArrowLeft size={14} />{t('common.backToList')}</Button>
          {selected ? (
            <div data-testid="task-detail" data-entity-id={selected.id} className="flex min-w-0 flex-col gap-4 text-[13px]">
              <h2 data-catalog-detail-heading tabIndex={-1} className="break-words text-[16px] font-semibold leading-snug outline-none">{selected.title}</h2>
              <div className="catalog-property-grid">
                <CatalogSelect label={t('tasks.assignProject')} value={selected.projectId ?? NO_PROJECT} options={[{ value: NO_PROJECT, label: t('tasks.unassigned') }, ...selectedProjectOptions]} onChange={(id) => mutate((current) => current.update(selected.id, { projectId: id === NO_PROJECT ? undefined : id }))} />
                <CatalogSelect label={t('tasks.priority')} value={selected.priority} options={PRIORITIES.map((priority) => ({ value: priority, label: t(`tasks.priority.${priority}`) }))} onChange={(priority) => mutate((current) => current.update(selected.id, { priority }))} />
                <label><span className="catalog-label">{t('tasks.startDate')}</span><Input type="date" className="h-8 text-[13px]" value={taskDateInputValue(selected.startAt)} onChange={(event) => mutate((current) => current.update(selected.id, { startAt: taskDateFromInput(event.target.value) }))} /></label>
                <label><span className="catalog-label">{t('collection.display.property.dueDate')}</span><Input type="date" className="h-8 text-[13px]" value={taskDateInputValue(selected.dueAt)} onChange={(event) => mutate((current) => current.update(selected.id, { dueAt: taskDateFromInput(event.target.value) }))} /></label>
              </div>
              <label className="flex min-h-7 items-center gap-2"><input type="checkbox" className="accent-accent" checked={selected.evening} onChange={(event) => mutate((current) => current.update(selected.id, { evening: event.target.checked }))} />{t('tasks.evening')}</label>
              <label><span className="catalog-label">{t('tasks.notes')}</span><Textarea className="min-h-28 resize-y text-[13px]" value={taskDraft?.notes ?? selected.notes} onChange={(event) => {
                const value = event.target.value
                patchTaskDraft(selected.id, { notes: value })
                commitNotes(selected, value)
              }} onBlur={() => commitNotes(selected)} /></label>
              <label><span className="catalog-label">{t('tasks.tags')}</span><Input className="h-8 text-[13px]" value={taskDraft?.tags ?? selected.tags.join(', ')} onChange={(event) => {
                const value = event.target.value
                patchTaskDraft(selected.id, { tags: value })
              }} onBlur={() => commitTags(selected)} onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  commitTags(selected)
                }
              }} placeholder={t('tasks.tags')} /></label>
              <CatalogDisclosure title={`${t('tasks.links')} · ${selected.links.length}`}>
                {selected.links.length > 0 ? <ul className="space-y-1">{selected.links.map((link) => (
                  <li key={`${link.kind}:${link.id}`} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate" title={link.id}>{t(`tasks.linkKind.${link.kind}`)} · {link.id}</span><Button type="button" variant="ghost" size="sm" onClick={() => mutate((current) => current.unlink(selected.id, link))}>{t('tasks.unlink')}</Button></li>
                ))}</ul> : null}
                <form onSubmit={addLink} className="grid gap-2">
                  <CatalogSelect label={t('common.type')} value={linkKind} options={LINK_KINDS.map((kind) => ({ value: kind, label: t(`tasks.linkKind.${kind}`) }))} onChange={(value) => patchTaskDraft(selected.id, { linkKind: value })} />
                  <Input className="h-8 text-[13px]" value={linkId} onChange={(event) => patchTaskDraft(selected.id, { linkId: event.target.value })} placeholder={t('tasks.linkIdPlaceholder')} aria-label={t('tasks.linkIdPlaceholder')} />
                  <Button type="submit" variant="secondary" size="sm" disabled={!linkId.trim()} className="justify-self-start"><Plus size={14} />{t('tasks.addLink')}</Button>
                </form>
              </CatalogDisclosure>
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Button size="sm" variant="secondary" onClick={() => toggleComplete(selected)}><CheckCheck size={14} />{selected.completedAt ? t('tasks.reopen') : t('tasks.complete')}</Button>
                {sort === 'order' && selectedIndex >= 0 ? <div className="ml-auto flex gap-1"><Button size="icon" variant="ghost" className="size-7" aria-label={t('tasks.moveUp')} aria-keyshortcuts="Alt+ArrowUp" disabled={selectedIndex === 0} onClick={() => moveTask(selected.id, -1)}><ArrowUp /></Button><Button size="icon" variant="ghost" className="size-7" aria-label={t('tasks.moveDown')} aria-keyshortcuts="Alt+ArrowDown" disabled={selectedIndex === visible.length - 1} onClick={() => moveTask(selected.id, 1)}><ArrowDown /></Button></div> : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-[13px] text-muted-foreground">
              <CheckCheck size={28} className="opacity-40" aria-hidden="true" />
              <p data-catalog-detail-heading tabIndex={-1} className="outline-none">{t(selectedId ? 'tasks.notFound' : 'tasks.selectHint')}</p>
              {selectedId ? <Button size="sm" variant="secondary" onClick={() => selectTask(null)}>{t('common.backToList')}</Button> : null}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
