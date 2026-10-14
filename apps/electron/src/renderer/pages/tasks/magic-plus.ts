/**
 * Magic Plus (Things-style) helpers. Dropping the + on a project row's left
 * gutter inserts a heading there: rows from the drop point to the end of that
 * section move under the new heading. Pure over the store draft.
 */
import type { PersonalTaskStore, TaskHeading, TaskListId, TaskWhen } from '@rox/core/tasks/personal'

/** Left gutter (px) of a row where a Magic Plus drop means "new heading". */
export const HEADING_GUTTER_PX = 28

export function isHeadingDrop(clientX: number, rowLeft: number): boolean {
  return clientX - rowLeft < HEADING_GUTTER_PX
}

/**
 * Inserts a heading right after `afterHeadingId` (null = before every heading)
 * and moves `moveIds` (in order) under it. Returns the new heading.
 */
export function insertHeading(
  store: PersonalTaskStore,
  projectId: string,
  title: string,
  afterHeadingId: string | null,
  moveIds: readonly string[],
): TaskHeading {
  const ordered = store.headings(projectId)
  // A stale afterHeadingId (heading removed meanwhile) appends instead of jumping first.
  const found = afterHeadingId ? ordered.findIndex((h) => h.id === afterHeadingId) : -1
  const at = afterHeadingId == null ? 0 : found < 0 ? ordered.length : found + 1
  const heading = store.addHeading(title, projectId)
  const next = [...ordered.slice(0, at), heading, ...ordered.slice(at)]
  next.forEach((h, order) => { if (h.order !== order) store.updateHeading(h.id, { order }) })
  for (const id of moveIds) if (store.get(id)) store.moveTo(id, { projectId, headingId: heading.id }, { keepOrder: true })
  return heading
}

/** Sidebar destinations that accept a Magic Plus drop (not Корзина / Журнал). */
export function acceptsPlusDrop(dest: string): boolean {
  return dest !== 'trash' && dest !== 'logbook'
}

export interface DestDefaults {
  list: TaskListId
  projectId?: string
  areaId?: string
  headingId?: string
  when?: TaskWhen
}

/** Creation defaults implied by a sidebar destination id (see applyDestination). */
export function destDefaults(dest: string, tomorrow: number): DestDefaults | null {
  if (!acceptsPlusDrop(dest)) return null
  if (dest === 'list:inbox') return { list: 'inbox' }
  if (dest === 'when:today') return { list: 'today', when: { kind: 'today' } }
  if (dest === 'when:evening') return { list: 'today', when: { kind: 'evening' } }
  if (dest === 'when:tomorrow' || dest === 'when:upcoming') return { list: 'upcoming', when: { kind: 'date', at: tomorrow } }
  if (dest === 'when:anytime') return { list: 'anytime', when: { kind: 'anytime' } }
  if (dest === 'when:someday') return { list: 'someday', when: { kind: 'someday' } }
  if (dest.startsWith('project:')) return { list: 'anytime', projectId: dest.slice(8) }
  if (dest.startsWith('area:')) return { list: 'anytime', areaId: dest.slice(5) }
  if (dest.startsWith('heading:')) {
    const [, projectId, headingId] = dest.split(':')
    return { list: 'anytime', projectId, headingId }
  }
  return { list: 'inbox' }
}

/** Which nav drop a drag means: a + creates, a task moves, anything else is ignored. */
export function navDropKind(types: readonly string[], dest: string, plusType: string, taskType: string): 'plus' | 'task' | null {
  if (types.includes(plusType)) return acceptsPlusDrop(dest) ? 'plus' : null
  return types.includes(taskType) ? 'task' : null
}
