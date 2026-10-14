/**
 * «Зависит от» block in the task detail: link/unlink finish-to-start
 * dependencies. Candidates exclude links that would create a cycle.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { PersonalTask, PersonalTaskStore } from '@rox/core/tasks/personal'
import { SectionLabel } from '@/components/mode-screen/ModeScreen'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function dependencyCandidates(store: PersonalTaskStore, task: PersonalTask): PersonalTask[] {
  return store.list()
    .filter((other) => other.trashedAt == null && other.completedAt == null && other.cancelledAt == null && !other.parentId)
    .filter((other) => store.canAddDependency(task.id, other.id))
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
            <span className={blocker.completedAt ? 'min-w-0 flex-1 truncate text-text-muted line-through' : 'min-w-0 flex-1 truncate'}>{blocker.title}</span>
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
