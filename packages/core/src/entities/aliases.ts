/**
 * W1-01 — Kind alias normalisation (DATA-MODEL §3.2).
 *
 * Legacy and friendlier spellings resolve onto canonical kinds so old refs
 * keep working. The table is applied by `parseEntityRef` before kind
 * validation; unknown spellings pass through unchanged.
 */

import type { EntityKind } from './kinds.ts'

/**
 * Alias → canonical kind. 18 entries, frozen. Keys are matched verbatim
 * (case-sensitive) before falling back to literal kind lookup.
 */
export const KIND_ALIASES: Readonly<Record<string, EntityKind>> = {
  doc: 'note',
  post: 'note',
  discussion: 'note',
  chat: 'channel',
  message: 'channel-message',
  meeting: 'call',
  event: 'calendar-event',
  user: 'person',
  contact: 'person',
  company: 'crm-company',
  objective: 'goal',
  'key-result': 'goal-target',
  kr: 'goal-target',
  mail: 'mail-thread',
  workflowRun: 'workflow-run',
  list: 'task-list',
  heading: 'task-section',
  area: 'task-list-group',
}

/** Resolve an alias to its canonical kind, or return the input unchanged. */
export function normalizeKindAlias(kind: string): string {
  return KIND_ALIASES[kind] ?? kind
}