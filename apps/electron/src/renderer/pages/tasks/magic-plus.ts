/**
 * Magic Plus (Things-style) helpers. Dropping the + on a project row's left
 * gutter inserts a heading there: rows from the drop point to the end of that
 * section move under the new heading. Pure over the store draft.
 */
import type { PersonalTaskStore, TaskHeading } from '@rox/core/tasks/personal'

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
  const at = afterHeadingId ? ordered.findIndex((h) => h.id === afterHeadingId) + 1 : 0
  const heading = store.addHeading(title, projectId)
  const next = [...ordered.slice(0, at), heading, ...ordered.slice(at)]
  next.forEach((h, order) => { if (h.order !== order) store.updateHeading(h.id, { order }) })
  for (const id of moveIds) if (store.get(id)) store.moveTo(id, { projectId, headingId: heading.id })
  return heading
}
