/**
 * W1-01/W1-02 — Shared app-route → ref parser.
 *
 * Single grammar for kind-first entity routes (`docs/file/{id}`,
 * `goals/goal/{id}`, `base/{id}/{table}` …) plus the frozen legacy shapes
 * (`notes/note/{id}`, `tasks/task/{id}`, `allSessions/session/{id}`,
 * `inbox/item/{id}`, …) that the legacy compound parser already owns.
 *
 * The Electron renderer (`entity-routes.ts`) uses the kind-first entry point
 * for navigation (legacy routes keep parsing byte-identically there); the
 * server-side link extractor uses the union entry point so every explicit
 * `rox://` deep link creates a link. All segments, query values and fragments
 * are percent-decoded, so `rox://docs/wiki/w1/%D0%9F%D0%BB%D0%B0%D0%BD`
 * resolves to `wiki-space:w1#План`.
 *
 * Non-throwing: malformed shapes return `null` and create no link.
 */

import { entityRoute, isEntityRoutePrefix } from './routes.ts'
import type { EntityKind } from './kinds.ts'
import type { EntityRef } from './refs.ts'

export interface ParsedEntityRoute {
  kind: EntityKind
  ref: EntityRef
  /** Canonical `entityRoute(ref)`; equals the input for well-formed routes. */
  canonicalRoute: string
}

/** Split a path into non-empty, percent-decoded segments; null when malformed. */
function decodeSegments(path: string): string[] | null {
  const raw = path.split('/')
  if (raw.some(segment => !segment)) return null
  const decoded: string[] = []
  for (const segment of raw) decoded.push(decodeURIComponent(segment))
  return decoded
}

/** Query parameters as a strict map (duplicate keys are malformed); null on malformed. */
function queryEntries(queryPart: string | undefined): Map<string, string> | null {
  if (queryPart === undefined || queryPart === '') return new Map()
  const params = new URLSearchParams(queryPart)
  const map = new Map<string, string>()
  for (const [key, value] of params) {
    if (map.has(key)) return null
    map.set(key, value)
  }
  return map
}

/** Read exactly one non-empty query value; null when keys/values do not match. */
function singleQuery(query: Map<string, string>, key: string): string | null {
  if (query.size !== 1) return null
  return query.get(key) || null
}

function refOf(kind: EntityKind, ref: EntityRef): ParsedEntityRoute {
  return { kind, ref, canonicalRoute: entityRoute(ref) }
}

const DOCS_KINDS: Record<string, EntityKind> = {
  file: 'file',
  folder: 'folder',
  link: 'drive-link',
  wiki: 'wiki-space',
}

const CALENDAR_KINDS: Record<string, EntityKind> = {
  event: 'calendar-event',
  reminder: 'reminder',
  cal: 'calendar',
  room: 'room',
}

const CONTACT_KINDS: Record<string, EntityKind> = {
  company: 'crm-company',
  person: 'person',
  department: 'department',
  invitations: 'invitation',
}

type EntityMatcher = (
  segments: string[],
  fragment: string | undefined,
  query: Map<string, string>,
) => ParsedEntityRoute | null

// docs/file/{id}, docs/folder/{id}, docs/link/{id}, docs/wiki/{id}[/{frag}]
function matchDocs(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (query.size !== 0 || segments.length < 3) return null
  const kind = DOCS_KINDS[segments[1]!]
  if (!kind) return null
  const id = segments[2]!
  if (kind === 'wiki-space') {
    if (fragment !== undefined) return null
    const frag = segments.length > 3 ? segments.slice(3).join('/') : undefined
    return refOf(kind, frag ? { kind, id, fragment: frag } : { kind, id })
  }
  if (segments.length !== 3 || fragment !== undefined) return null
  return refOf(kind, { kind, id })
}

// messenger/{id} (channel) and messenger/{id}?seq={n} (channel-message)
function matchMessenger(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (segments.length !== 2 || fragment !== undefined) return null
  const id = segments[1]!
  const seq = singleQuery(query, 'seq')
  if (seq) return refOf('channel-message', { kind: 'channel-message', id, fragment: seq })
  if (query.size !== 0) return null
  return refOf('channel', { kind: 'channel', id })
}

function matchCalendar(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (query.size !== 0 || fragment !== undefined || segments.length !== 3) return null
  const kind = CALENDAR_KINDS[segments[1]!]
  return kind ? refOf(kind, { kind, id: segments[2]! }) : null
}

function matchGoals(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  const head = segments[1]
  if (head === 'goal') {
    if (segments.length !== 3 || query.size !== 0) return null
    const id = segments[2]!
    if (fragment === undefined) return refOf('goal', { kind: 'goal', id })
    if (fragment.startsWith('t-') && fragment.length > 2) {
      return refOf('goal-target', { kind: 'goal-target', id, fragment: fragment.slice(2) })
    }
    if (fragment.startsWith('k-') && fragment.length > 2) {
      return refOf('goal-check', { kind: 'goal-check', id, fragment: fragment.slice(2) })
    }
    return null
  }
  if (head === 'space') {
    if (query.size !== 0 || fragment !== undefined) return null
    const id = segments[2]!
    if (segments.length === 3) return refOf('space', { kind: 'space', id })
    if (segments.length >= 4 && segments[3] === 'kpis') {
      const frag = segments.length > 4 ? segments.slice(4).join('/') : undefined
      return refOf('kpi', frag ? { kind: 'kpi', id, fragment: frag } : { kind: 'kpi', id })
    }
    return null
  }
  if (head === 'okrs') {
    if (segments.length !== 2 || fragment !== undefined) return null
    const cycle = singleQuery(query, 'cycle')
    return cycle ? refOf('okr-cycle', { kind: 'okr-cycle', id: cycle }) : null
  }
  if (query.size !== 0 || fragment !== undefined || segments.length !== 3) return null
  if (head === 'check-in') return refOf('check-in', { kind: 'check-in', id: segments[2]! })
  if (head === 'review') return refOf('review', { kind: 'review', id: segments[2]! })
  if (head === 'kpis') return refOf('kpi-entry', { kind: 'kpi-entry', id: segments[2]! })
  if (head === 'templates') return refOf('project-template', { kind: 'project-template', id: segments[2]! })
  return null
}

function matchContacts(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (query.size !== 0 || fragment !== undefined || segments.length !== 3) return null
  const kind = CONTACT_KINDS[segments[1]!]
  return kind ? refOf(kind, { kind, id: segments[2]! }) : null
}

// workflows/{id} and workflows/run/{id}
function matchWorkflows(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (query.size !== 0 || fragment !== undefined) return null
  if (segments.length === 2) {
    if (segments[1] === 'run') return null
    return refOf('workflow', { kind: 'workflow', id: segments[1]! })
  }
  if (segments.length === 3 && segments[1] === 'run') return refOf('workflow-run', { kind: 'workflow-run', id: segments[2]! })
  return null
}

// base/{id}, base/{id}/{table}, base/{id}/{table}/{view}[?record={r}]
function matchBase(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (fragment !== undefined) return null
  if (segments.length === 2) {
    if (query.size !== 0) return null
    return refOf('base', { kind: 'base', id: segments[1]! })
  }
  if (segments.length === 3) {
    if (query.size !== 0) return null
    return refOf('base-table', { kind: 'base-table', id: segments[1]!, fragment: segments[2]! })
  }
  if (segments.length === 4) {
    const record = query.size === 0 ? null : singleQuery(query, 'record')
    const fragmentPath = `${segments[2]}/${segments[3]}`
    if (record) return refOf('base-record', { kind: 'base-record', id: segments[1]!, fragment: `${fragmentPath}/${record}` })
    if (query.size !== 0) return null
    return refOf('base-view', { kind: 'base-view', id: segments[1]!, fragment: fragmentPath })
  }
  return null
}

// tasks/list/{id}[?section={frag}] and tasks/group/{id}
function matchTasks(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (fragment !== undefined || segments.length !== 3) return null
  const id = segments[2]!
  if (segments[1] === 'group') {
    if (query.size !== 0) return null
    return refOf('task-list-group', { kind: 'task-list-group', id })
  }
  if (segments[1] !== 'list') return null
  const section = singleQuery(query, 'section')
  if (section) return refOf('task-section', { kind: 'task-section', id, fragment: section })
  if (query.size !== 0) return null
  return refOf('task-list', { kind: 'task-list', id })
}

function matchProjects(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (query.size !== 0 || fragment !== undefined) return null
  return segments.length === 3 && segments[1] === 'milestone'
    ? refOf('milestone', { kind: 'milestone', id: segments[2]! })
    : null
}

function matchSettings(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (query.size !== 0 || fragment !== undefined) return null
  return segments.length === 3 && segments[1] === 'licences'
    ? refOf('license-component', { kind: 'license-component', id: segments[2]! })
    : null
}

function matchHome(segments: string[], fragment: string | undefined, query: Map<string, string>) {
  if (query.size !== 0 || fragment !== undefined) return null
  return segments.length === 3 && segments[1] === 'apps'
    ? refOf('app', { kind: 'app', id: segments[2]! })
    : null
}

const PREFIX_MATCHERS: Record<string, EntityMatcher> = {
  docs: matchDocs,
  messenger: matchMessenger,
  calendar: matchCalendar,
  goals: matchGoals,
  contacts: matchContacts,
  workflows: matchWorkflows,
  base: matchBase,
  tasks: matchTasks,
  projects: matchProjects,
  settings: matchSettings,
  home: matchHome,
  forms: (segments, fragment, query) => query.size === 0 && fragment === undefined && segments.length === 2
    ? refOf('form', { kind: 'form', id: segments[1]! })
    : null,
  comments: (segments, fragment, query) => query.size === 0 && fragment === undefined && segments.length === 2
    ? refOf('comment', { kind: 'comment', id: segments[1]! })
    : null,
}

/** Frozen legacy shapes the legacy compound parser already owns. */
const LEGACY_TWO: Record<string, EntityKind> = {
  'notes/note': 'note',
  'tasks/task': 'task',
  'projects/project': 'project',
  'pages/page': 'page',
  'skills/skill': 'skill',
  'sources/source': 'source',
  'automations/automation': 'automation',
  'meetings/meeting': 'call',
}

function matchLegacy(
  segments: string[],
  fragment: string | undefined,
  query: Map<string, string>,
): ParsedEntityRoute | null {
  if (fragment !== undefined || query.size !== 0) return null
  if (segments.length !== 3) return null
  const first = segments[0]!
  // allSessions/session/{id} — the session surface.
  if (first === 'allSessions' && segments[1] === 'session') {
    const id = segments[2]!
    if (!id) return null
    return refOf('session', { kind: 'session', id })
  }
  if ((first === 'inbox' || first === 'feed') && segments[1] === 'item') {
    const id = segments[2]!
    if (!id) return null
    return first === 'inbox'
      ? refOf('mail-thread', { kind: 'mail-thread', id })
      : refOf('feed-item', { kind: 'feed-item', id })
  }
  const kind = LEGACY_TWO[`${first}/${segments[1]}`]
  if (!kind) return null
  const id = segments[2]!
  if (!id) return null
  return refOf(kind, { kind, id } as EntityRef)
}

function splitRoute(route: string): {
  segments: string[]
  fragment: string | undefined
  query: Map<string, string>
} | null {
  // Reject corrupt percent escapes anywhere in the route up front.
  decodeURIComponent(route)

  const hashIndex = route.indexOf('#')
  const fragmentRaw = hashIndex === -1 ? undefined : route.slice(hashIndex + 1)
  const withoutFragment = hashIndex === -1 ? route : route.slice(0, hashIndex)
  if (fragmentRaw !== undefined && fragmentRaw.length === 0) return null
  const fragment = fragmentRaw === undefined ? undefined : decodeURIComponent(fragmentRaw)

  const queryIndex = withoutFragment.indexOf('?')
  const pathPart = queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex)
  const queryPart = queryIndex === -1 ? undefined : withoutFragment.slice(queryIndex + 1)

  const query = queryEntries(queryPart)
  if (!query) return null

  const segments = decodeSegments(pathPart)
  if (!segments) return null
  return { segments, fragment, query }
}

/**
 * Match a route against the kind-first entity routes.
 *
 * Returns `null` for legacy routes, malformed shapes and unknown prefixes so
 * the legacy parser keeps owning everything it already handled.
 */
export function parseEntityRoute(route: string): ParsedEntityRoute | null {
  if (route.length === 0) return null
  try {
    const split = splitRoute(route)
    if (!split) return null
    const first = split.segments[0]
    if (!isEntityRoutePrefix(first!)) return null
    return PREFIX_MATCHERS[first!]?.(split.segments, split.fragment, split.query) ?? null
  } catch {
    return null
  }
}

/**
 * Match a route against the kind-first entity routes OR the frozen legacy
 * shapes. For the server-side extractor, where every explicit `rox://` deep
 * link creates a link regardless of which parser owns the route.
 */
export function parseEntityRouteOrLegacy(route: string): ParsedEntityRoute | null {
  if (route.length === 0) return null
  try {
    const split = splitRoute(route)
    if (!split) return null
    const first = split.segments[0]
    if (!isEntityRoutePrefix(first!)) return null
    const kindFirst = PREFIX_MATCHERS[first!]?.(split.segments, split.fragment, split.query) ?? null
    return kindFirst ?? matchLegacy(split.segments, split.fragment, split.query)
  } catch {
    return null
  }
}

/** True iff the route is a well-formed kind-first entity route. */
export function isEntityCompoundRoute(route: string): boolean {
  return isEntityRoutePrefix(route) && parseEntityRoute(route) !== null
}
