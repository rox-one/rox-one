/**
 * W1-01 — `rox://` route map.
 *
 * One route builder per kind, matching the frozen legacy renderer routes for
 * the 21 Rox2 kinds and the new kind-first routes for the added kinds
 * (DATA-MODEL §3.3). `entityRoute` returns the bare app route (what the
 * compound-route parser consumes); `entityDeepLink` wraps it as `rox://…`.
 *
 * This module intentionally has no runtime dependency on `./kinds.ts` — the
 * kind list is a compile-time contract here — so `kinds.ts` may import it
 * without creating an ESM cycle.
 */

import type { EntityKind } from './kinds.ts'
import type { EntityRef } from './refs.ts'

const enc = encodeURIComponent

/** First path segments that can start an entity route. */
export const ENTITY_ROUTE_PREFIXES: readonly string[] = [
  'allSessions',
  'notes',
  'tasks',
  'projects',
  'pages',
  'memory',
  'skills',
  'sources',
  'automations',
  'connections',
  'docs',
  'inbox',
  'calendar',
  'contacts',
  'messenger',
  'meetings',
  'workflows',
  'goals',
  'base',
  'forms',
  'comments',
  'settings',
  'home',
  'decisions',
  'feed',
  'radar',
  'agents',
]

/** Encode a `{a}/{b}/{c}`-style fragment, dropping trailing empties. */
function fragmentPath(fragment: string | undefined): string {
  if (!fragment) return ''
  return `/${fragment.split('/').map(enc).join('/')}`
}

/**
 * Per-kind route builders. Container-relative kinds read the container from
 * `ref.id` and the child from `ref.fragment` (see `./refs.ts` grammar).
 */
export const KIND_ROUTE_BUILDERS: Record<EntityKind, (ref: EntityRef) => string> = {
  // --- frozen Rox2 kinds (legacy routes preserved verbatim) --------------------
  session: ref => `allSessions/session/${enc(ref.id)}`,
  note: ref => `notes/note/${enc(ref.id)}`,
  task: ref => `tasks/task/${enc(ref.id)}`,
  project: ref => `projects/project/${enc(ref.id)}`,
  page: ref => `pages/page/${enc(ref.id)}`,
  memory: () => 'memory',
  skill: ref => `skills/skill/${enc(ref.id)}`,
  source: ref => `sources/source/${enc(ref.id)}`,
  automation: ref => `automations/automation/${enc(ref.id)}`,
  connection: () => 'connections',
  file: ref => `docs/file/${enc(ref.id)}`,
  'mail-thread': ref => `inbox/item/${enc(ref.id)}`,
  'calendar-event': ref => `calendar/event/${enc(ref.id)}`,
  'crm-company': ref => `contacts/company/${enc(ref.id)}`,
  channel: ref => `messenger/${enc(ref.id)}`,
  'channel-message': ref => `messenger/${enc(ref.id)}${ref.fragment ? `?seq=${enc(ref.fragment)}` : ''}`,
  call: ref => `meetings/meeting/${enc(ref.id)}`,
  reminder: ref => `calendar/reminder/${enc(ref.id)}`,
  workflow: ref => `workflows/${enc(ref.id)}`,
  person: ref => `contacts/person/${enc(ref.id)}`,
  'license-component': ref => `settings/licences/${enc(ref.id)}`,

  // --- new kinds ---------------------------------------------------------------
  goal: ref => `goals/goal/${enc(ref.id)}`,
  'goal-target': ref => `goals/goal/${enc(ref.id)}${ref.fragment ? `#t-${enc(ref.fragment)}` : ''}`,
  'goal-check': ref => `goals/goal/${enc(ref.id)}${ref.fragment ? `#k-${enc(ref.fragment)}` : ''}`,
  'check-in': ref => `goals/check-in/${enc(ref.id)}`,
  review: ref => `goals/review/${enc(ref.id)}`,
  'okr-cycle': ref => `goals/okrs?cycle=${enc(ref.id)}`,
  milestone: ref => `projects/milestone/${enc(ref.id)}`,
  space: ref => `goals/space/${enc(ref.id)}`,
  kpi: ref => `goals/space/${enc(ref.id)}/kpis${fragmentPath(ref.fragment)}`,
  'kpi-entry': ref => `goals/kpis/${enc(ref.id)}`,
  'task-list': ref => `tasks/list/${enc(ref.id)}`,
  'task-section': ref => `tasks/list/${enc(ref.id)}${ref.fragment ? `?section=${enc(ref.fragment)}` : ''}`,
  'task-list-group': ref => `tasks/group/${enc(ref.id)}`,
  folder: ref => `docs/folder/${enc(ref.id)}`,
  'drive-link': ref => `docs/link/${enc(ref.id)}`,
  'wiki-space': ref => `docs/wiki/${enc(ref.id)}${fragmentPath(ref.fragment)}`,
  comment: ref => `comments/${enc(ref.id)}`,
  base: ref => `base/${enc(ref.id)}`,
  'base-table': ref => `base/${enc(ref.id)}${fragmentPath(ref.fragment)}`,
  'base-view': ref => `base/${enc(ref.id)}${fragmentPath(ref.fragment)}`,
  'base-record': ref => {
    if (!ref.fragment) return `base/${enc(ref.id)}`
    const parts = ref.fragment.split('/')
    const [table, view, record] = parts
    if (!table || !view) return `base/${enc(ref.id)}${fragmentPath(ref.fragment)}`
    const tail = record ? `?record=${enc(record)}` : ''
    return `base/${enc(ref.id)}/${enc(table)}/${enc(view)}${tail}`
  },
  form: ref => `forms/${enc(ref.id)}`,
  calendar: ref => `calendar/cal/${enc(ref.id)}`,
  room: ref => `calendar/room/${enc(ref.id)}`,
  department: ref => `contacts/department/${enc(ref.id)}`,
  app: ref => `home/apps/${enc(ref.id)}`,
  'project-template': ref => `goals/templates/${enc(ref.id)}`,
  decision: ref => `decisions/item/${enc(ref.id)}`,
  'feed-item': ref => `feed/item/${enc(ref.id)}`,
  'workflow-run': ref => `workflows/run/${enc(ref.id)}`,
  'radar-topic': ref => `radar/item/${enc(ref.id)}`,
  'agent-team': ref => `agents/item/${enc(ref.id)}`,
  invitation: ref => `contacts/invitations/${enc(ref.id)}`,
}

/** Build the app route for a ref. Throws on an unregistered kind. */
export function entityRoute(ref: EntityRef): string {
  const builder = KIND_ROUTE_BUILDERS[ref.kind]
  if (!builder) throw new Error(`No route builder registered for kind "${ref.kind}"`)
  return builder(ref)
}

/** Build the `rox://` deep link for a ref. */
export function entityDeepLink(ref: EntityRef): string {
  return `rox://${entityRoute(ref)}`
}

/** True when `route`'s first segment can start an entity route. */
export function isEntityRoutePrefix(route: string): boolean {
  const first = route.split('?')[0]!.split('/')[0] ?? ''
  return ENTITY_ROUTE_PREFIXES.includes(first)
}