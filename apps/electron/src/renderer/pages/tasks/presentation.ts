import { PersonalTaskStore, type PersonalTask } from '@craft-agent/core/tasks/personal'

/** Date controls edit local calendar days; UTC conversion would shift them in some timezones. */
export function taskDateInputValue(timestamp?: number): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function taskDateFromInput(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return undefined
  return date.getTime()
}

function isRenderableTask(task: PersonalTask): boolean {
  return task != null && typeof task === 'object'
    && typeof task.id === 'string' && !!task.id
    && typeof task.title === 'string' && !!task.title.trim()
    && typeof task.notes === 'string'
    && Array.isArray(task.tags) && task.tags.every((tag) => typeof tag === 'string')
    && Array.isArray(task.links) && task.links.every((link) => link != null
      && typeof link.id === 'string' && ['note', 'session', 'message', 'workflowRun'].includes(link.kind))
    && ['inbox', 'today', 'upcoming', 'anytime', 'someday'].includes(task.list)
    && ['none', 'low', 'medium', 'high'].includes(task.priority)
    && typeof task.evening === 'boolean'
    && Number.isFinite(task.order) && Number.isFinite(task.createdAt)
    && [task.dueAt, task.startAt, task.completedAt, task.cancelledAt].every((date) => date == null || Number.isFinite(date))
    && (task.projectId == null || typeof task.projectId === 'string')
}

/** Reject malformed task rows before they can break the retained list/detail render. */
export function parseTaskImport(text: string): PersonalTaskStore | null {
  const incoming = PersonalTaskStore.tryFromJson(text)
  if (incoming.status !== 'ok') return null
  const tasks = incoming.store.list()
  return tasks.every(isRenderableTask) && new Set(tasks.map((task) => task.id)).size === tasks.length
    ? incoming.store : null
}
