import type { TaskLinkKind } from '@craft-agent/core/tasks/personal'

export type TaskDraft = { notes?: string; tags?: string; linkId?: string; linkKind?: TaskLinkKind }
export type TaskDrafts = Record<string, TaskDraft>

/** Clear only the submitted value, leaving other task drafts and later edits intact. */
export function clearTaskDraftField<K extends keyof TaskDraft>(
  drafts: TaskDrafts,
  id: string,
  field: K,
  submitted: TaskDraft[K],
): TaskDrafts {
  if (drafts[id]?.[field] !== submitted) return drafts
  const draft = { ...drafts[id] }
  delete draft[field]
  const next = { ...drafts }
  if (Object.keys(draft).length) next[id] = draft
  else delete next[id]
  return next
}

export function parseTaskTagDraft(value: string): string[] {
  return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))]
}
