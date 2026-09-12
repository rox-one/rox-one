import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildTodayPlan,
  PersonalTaskStore,
  projectTasks,
  type PersonalTask,
  type TaskLinkKind,
  type TaskPriority,
  type TaskProjectionId,
} from '@craft-agent/core/tasks/personal'
import { CalendarStatusStrip } from '@/components/calendar/CalendarStatusStrip'
import { cn } from '@/lib/utils'

const PROJECTIONS: TaskProjectionId[] = ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook']
const LINK_KINDS: TaskLinkKind[] = ['note', 'session', 'message', 'workflowRun']
const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high']
const STORAGE_KEY = 'rox.personal-tasks.v1'

function loadStore(): PersonalTaskStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return PersonalTaskStore.fromJson(raw)
  } catch {
    // Corrupt local cache — start empty; import remains available.
  }
  return new PersonalTaskStore()
}

export default function TasksPage() {
  const { t } = useTranslation()
  const [store, setStore] = useState(loadStore)
  const [projection, setProjection] = useState<TaskProjectionId>('today')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [linkKind, setLinkKind] = useState<TaskLinkKind>('note')
  const [linkId, setLinkId] = useState('')
  const now = Date.now()

  const persist = useCallback((next: PersonalTaskStore) => {
    setStore(next)
    localStorage.setItem(STORAGE_KEY, next.exportJson())
  }, [])

  const mutate = useCallback((fn: (current: PersonalTaskStore) => void) => {
    const next = PersonalTaskStore.fromJson(store.exportJson())
    fn(next)
    persist(next)
  }, [persist, store])

  const tasks = store.list()
  const visible = useMemo(() => projectTasks(tasks, now, projection), [tasks, now, projection])
  const selected = selectedId ? store.get(selectedId) : undefined
  const todayPlan = useMemo(() => buildTodayPlan(tasks, now), [tasks, now])

  const onQuickEntry = (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    mutate((current) => {
      const created = current.create({
        title: draft,
        list: projection === 'logbook' ? 'inbox' : projection === 'today' ? 'today' : projection,
        quickEntry: true,
      })
      setSelectedId(created.id)
    })
    setDraft('')
  }

  const toggleComplete = (task: PersonalTask) => {
    mutate((current) => {
      if (task.completedAt) current.reopen(task.id)
      else current.complete(task.id)
    })
  }

  const moveSelected = (dir: -1 | 1) => {
    const ids = visible.map((task) => task.id)
    const index = selectedId ? ids.indexOf(selectedId) : -1
    if (index < 0) return
    const next = index + dir
    if (next < 0 || next >= ids.length) return
    const reordered = [...ids]
    const [item] = reordered.splice(index, 1)
    reordered.splice(next, 0, item!)
    mutate((current) => current.reorder(reordered))
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
    const incoming = PersonalTaskStore.fromJson(text)
    const next = PersonalTaskStore.fromJson(store.exportJson())
    next.importBundle(incoming.snapshot(), 'merge')
    persist(next)
  }

  const addLink = () => {
    if (!selected || !linkId.trim()) return
    const id = linkId.trim()
    mutate((current) => current.link(selected.id, { kind: linkKind, id }))
    setLinkId('')
  }

  return (
    <div className="flex h-full min-h-0 bg-background" data-testid="tasks-page">
      <aside className="w-[200px] shrink-0 border-r border-border p-3 flex flex-col gap-1">
        {PROJECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setProjection(id)}
            className={cn(
              'text-left rounded-[6px] px-2 py-1.5 text-[13px]',
              projection === id ? 'bg-foreground/10 font-medium' : 'hover:bg-foreground/5',
            )}
          >
            {t(`tasks.projection.${id}`)}
          </button>
        ))}
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        <form onSubmit={onQuickEntry} className="border-b border-border px-3 py-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                moveSelected(-1)
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                moveSelected(1)
              }
            }}
            placeholder={t('tasks.quickEntryPlaceholder')}
            className="w-full h-9 rounded-[8px] border border-foreground/10 bg-transparent px-3 text-[13px] outline-none"
            aria-label={t('tasks.quickEntryPlaceholder')}
          />
        </form>
        {projection === 'today' || projection === 'upcoming' ? (
          <CalendarStatusStrip tasks={tasks} now={now} />
        ) : null}
        {projection === 'today' ? (
          <div className="flex gap-2 overflow-x-auto border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
            {todayPlan.length === 0 ? t('tasks.emptyToday') : todayPlan.map((group) => (
              <span key={`${group.bucket}-${group.projectId ?? 'none'}`} className="rounded-full border border-foreground/10 px-2 py-0.5">
                {t(`tasks.bucket.${group.bucket}`)} · {group.tasks.length}
              </span>
            ))}
          </div>
        ) : null}
        <ul className="flex-1 overflow-auto p-2">
          {visible.map((task) => (
            <li
              key={task.id}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/task-id', task.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                dropOn(task.id, event.dataTransfer.getData('text/task-id'))
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedId(task.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px]',
                  selectedId === task.id ? 'bg-foreground/10' : 'hover:bg-foreground/5',
                )}
              >
                <input
                  type="checkbox"
                  checked={Boolean(task.completedAt)}
                  onChange={() => toggleComplete(task)}
                  aria-label={t('tasks.complete')}
                />
                <span className={cn('truncate', task.completedAt && 'line-through text-muted-foreground')}>{task.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <aside className="w-[280px] shrink-0 border-l border-border p-3 text-[13px]">
        {selected ? (
          <div className="flex flex-col gap-2">
            <h2 className="font-medium">{selected.title}</h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('tasks.priority')}>
              {PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  type="button"
                  className={cn(
                    'rounded-[6px] border px-2 py-0.5 text-[12px]',
                    selected.priority === priority ? 'border-foreground/40 bg-foreground/10' : 'border-foreground/10',
                  )}
                  onClick={() => mutate((current) => current.update(selected.id, { priority }))}
                >
                  {t(`tasks.priority.${priority}`)}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.evening}
                onChange={(event) => mutate((current) => current.update(selected.id, { evening: event.target.checked }))}
              />
              {t('tasks.evening')}
            </label>
            <input
              className="rounded-[8px] border border-foreground/10 bg-transparent px-2 py-1"
              value={selected.tags.join(', ')}
              onChange={(event) => {
                const tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean)
                mutate((current) => current.update(selected.id, { tags }))
              }}
              placeholder={t('tasks.tags')}
              aria-label={t('tasks.tags')}
            />
            <textarea
              className="min-h-[80px] rounded-[8px] border border-foreground/10 bg-transparent p-2"
              value={selected.notes}
              onChange={(event) => {
                const value = event.target.value
                mutate((current) => current.update(selected.id, { notes: value }))
              }}
              aria-label={t('tasks.notes')}
            />
            <p className="text-muted-foreground">{t('tasks.links')}: {selected.links.length}</p>
            <ul className="flex flex-col gap-1">
              {selected.links.map((link) => (
                <li key={`${link.kind}:${link.id}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">{t(`tasks.linkKind.${link.kind}`)} · {link.id}</span>
                  <button
                    type="button"
                    className="text-[12px] underline"
                    onClick={() => mutate((current) => current.unlink(selected.id, link))}
                  >
                    {t('tasks.unlink')}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('tasks.addLink')}>
              {LINK_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={cn(
                    'rounded-[6px] border px-2 py-0.5 text-[12px]',
                    linkKind === kind ? 'border-foreground/40 bg-foreground/10' : 'border-foreground/10',
                  )}
                  onClick={() => setLinkKind(kind)}
                >
                  {t(`tasks.linkKind.${kind}`)}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                className="min-w-0 flex-1 rounded-[6px] border border-foreground/10 bg-transparent px-2 py-0.5"
                value={linkId}
                onChange={(event) => setLinkId(event.target.value)}
                placeholder={t('tasks.linkIdPlaceholder')}
                aria-label={t('tasks.linkIdPlaceholder')}
              />
              <button type="button" className="text-[12px] underline" onClick={addLink}>{t('tasks.addLink')}</button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">{t('tasks.selectHint')}</p>
        )}
        <div className="mt-4 flex gap-2">
          <button type="button" className="text-[12px] underline" onClick={onExport}>{t('tasks.export')}</button>
          <label className="text-[12px] underline cursor-pointer">
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
      </aside>
    </div>
  )
}
