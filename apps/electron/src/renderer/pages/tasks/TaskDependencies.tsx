/**
 * «Зависит от» block in the task detail: link/unlink finish-to-start
 * dependencies. Candidates exclude links that would create a cycle.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { PersonalTask, PersonalTaskStore } from '@rox/core/tasks/personal'
import { cn } from '@/lib/utils'
import { SectionLabel } from '@/components/mode-screen/ModeScreen'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function dependencyCandidates(store: PersonalTaskStore, task: PersonalTask): PersonalTask[] {
  const all = store.list()
  // One reverse walk: everything that (transitively) depends on `task` would form a cycle.
  const dependents = new Map<string, string[]>()
  for (const other of all) for (const blocker of other.blockedBy ?? []) dependents.set(blocker, [...(dependents.get(blocker) ?? []), other.id])
  const excluded = new Set<string>([task.id, ...(task.blockedBy ?? [])])
  const stack = [task.id]
  while (stack.length) {
    for (const next of dependents.get(stack.pop()!) ?? []) if (!excluded.has(next)) { excluded.add(next); stack.push(next) }
  }
  return all
    .filter((other) => !excluded.has(other.id) && other.trashedAt == null && other.completedAt == null && other.cancelledAt == null && !other.parentId)
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function TaskDependencies({ task, store, mutate }: {
  task: PersonalTask
  store: PersonalTaskStore
  mutate: (fn: (store: PersonalTaskStore) => void) => void
}) {
  const { t } = useTranslation()
  const blockers = (task.blockedBy ?? []).map((id) => store.get(id)).filter((x): x is PersonalTask => Boolean(x))
  const candidates = dependencyCandidates(store, task)
  return (
    <>
      <SectionLabel>{t('tasks.deps.title')}</SectionLabel>
      <ul className="flex flex-col gap-0.5" data-testid="task-deps">
        {blockers.map((blocker) => (
          <li key={blocker.id} className="flex items-center gap-2 text-sm">
            <span className={cn('min-w-0 flex-1 truncate', (blocker.completedAt || blocker.trashedAt != null) && 'text-text-muted', blocker.completedAt && 'line-through')}>{blocker.title}</span>
            {blocker.trashedAt != null ? <span className="shrink-0 text-xs text-text-muted" data-testid={`task-dep-trashed-${blocker.id}`}>{t('tasks.projection.trash')}</span> : null}
            <button type="button" aria-label={t('tasks.deps.remove', { title: blocker.title })} data-testid={`task-dep-remove-${blocker.id}`}
              onClick={() => mutate((current) => { current.removeDependency(task.id, blocker.id) })}
              className="rounded-[var(--radius-control)] px-1.5 text-text-muted hover:bg-surface-hover hover:text-foreground">×</button>
          </li>
        ))}
      </ul>
      {candidates.length ? (
        // Remount after each pick so the trigger shows the placeholder again.
        <Select key={(task.blockedBy ?? []).join(',')} onValueChange={(id) => mutate((current) => { current.addDependency(task.id, id) })}>
          <SelectTrigger className="h-7 text-sm" aria-label={t('tasks.deps.add')} data-testid="task-dep-add">
            <SelectValue placeholder={t('tasks.deps.add')} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((other) => <SelectItem key={other.id} value={other.id}>{other.title}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
    </>
  )
}
