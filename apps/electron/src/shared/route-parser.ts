/**
 * Route Parser
 *
 * Parses route strings back into structured navigation objects.
 * Used by both the navigate() function and deep link handler.
 *
 * Supports route formats:
 * - Action: action/{name}[/{id}] - Trigger side effects
 * - Compound: {filter}[/session/{sessionId}] - View routes for full navigation state
 *
 * Surface routes retain their own navigator and entity identity. Malformed
 * encodings return null from the parser; resolveRouteNavigationState keeps the
 * exact unavailable view address for rendering/history without action effects.
 * degradeSurfaceNavigationState remains an explicit compatibility adapter for
 * consumers that deliberately do not host these surfaces.
 */

import type {
  NavigationState,
  SessionFilter,
  SourceFilter,
  AutomationFilter,
  RightSidebarPanel,
  KnowledgeRefKind,
  UnavailableNavigationState,
} from './types'
import { isValidSettingsSubpage, type SettingsSubpage } from './settings-registry'
import { EXTRA_SCREEN_IDS, buildExtraScreenRoute, isExtraScreenId, parseExtraScreenSegments, type ExtraScreenId } from './extra-screens'

// =============================================================================
// Route Types
// =============================================================================

export type RouteType = 'action' | 'view'

export interface ParsedRoute {
  type: RouteType
  name: string
  id?: string
  params: Record<string, string>
}

// =============================================================================
// Compound Route Types (new format)
// =============================================================================

export type NavigatorType = 'sessions' | 'sources' | 'skills' | 'notes' | 'search' | 'automations' | 'projects' | 'pages' | 'settings' | 'browser' | 'memory' | 'learning' | 'tasks' | 'meetings' | 'feed' | 'inbox' | 'connections' | 'home'
  // Extra workbench screens («Ещё»): one navigator, screen id in `screen`
  | 'screen'
  // Unified-shell surface navigators (W1 scaffolding; hosts land in W2/W5)
  | 'knowledge' | 'cloud-run' | 'extension' | 'diff' | 'terminal'

export interface ParsedCompoundRoute {
  /** The navigator type */
  navigator: NavigatorType
  /** Search page query (only for search navigator). */
  query?: string
  /** Session filter (only for sessions navigator) */
  sessionFilter?: SessionFilter
  /** Source filter (only for sources navigator) */
  sourceFilter?: SourceFilter
  /** Automation filter (only for automations navigator) */
  automationFilter?: AutomationFilter
  /** Extra workbench screen id (only for the `screen` navigator). */
  screen?: ExtraScreenId
  /** Sessions presentation mode (only for sessions navigator). 'board' = Kanban; 'table' = dense collection. */
  viewMode?: 'list' | 'board' | 'table' | 'heatmap'
  /**
   * Details page info (null for empty state).
   * W1 surface navigators reuse this shape: `id` is the entity id (runId /
   * proposalId / extensionId), `kind` carries the SiYuan ref kind for
   * 'knowledge' details, `viewId` the sandbox view for 'extension' details.
   */
  details: {
    type: string
    id: string
    kind?: KnowledgeRefKind
    viewId?: string
  } | null
}

/**
 * Known prefixes that indicate a compound route. Shared with the deep-link
 * handler so `rox://search?q=...` is accepted like renderer navigation.
 */
export const COMPOUND_ROUTE_PREFIXES: readonly string[] = [
  'allSessions', 'flagged', 'archived', 'state', 'label', 'view', 'board', 'table', 'heatmap', 'sources', 'skills', 'notes', 'search', 'automations', 'projects', 'pages', 'settings', 'browser', 'memory', 'learning', 'tasks', 'meetings', 'feed', 'inbox', 'connections', 'home',
  'knowledge', 'cloud-run', 'extension', 'diff', 'terminal',
  ...EXTRA_SCREEN_IDS,
]

export function isCompoundRoute(route: string): boolean {
  const firstSegment = route.split('?')[0].split('/')[0]
  return COMPOUND_ROUTE_PREFIXES.includes(firstSegment)
}

function splitRouteQuery(route: string): [string, string | undefined] {
  const queryIndex = route.indexOf('?')
  return queryIndex < 0 ? [route, undefined] : [route.slice(0, queryIndex), route.slice(queryIndex + 1)]
}

function strictPathSegments(path: string): string[] | null {
  const segments = path.split('/')
  if (segments.some(segment => !segment)) return null
  // Validate every segment, including raw slug fields and extra-screen IDs.
  // Keep their established decoding semantics; this only rejects corrupt URLs.
  for (const segment of segments) decodeURIComponent(segment)
  return segments
}

export function parseCompoundRoute(route: string): ParsedCompoundRoute | null {
  try {
    // Validate the query as well; URLSearchParams otherwise repairs corrupt escapes.
    decodeURIComponent(route)
    return parseCompoundRouteSegments(route)
  } catch {
    // Retain malformed addresses on the unavailable surface without throwing.
    return null
  }
}

function parseCompoundRouteSegments(route: string): ParsedCompoundRoute | null {
  // Keep the query separate from slash-delimited route segments.
  const [pathPart, queryPart] = splitRouteQuery(route)
  const segments = strictPathSegments(pathPart)
  if (!segments) return null

  const first = segments[0]
  if (first === 'search') {
    if (segments.length !== 1) return null
    return {
      navigator: 'search',
      query: queryPart ? new URLSearchParams(queryPart).get('q') ?? '' : '',
      details: null,
    }
  }
  // Kanban board — standalone route. A view of all sessions in board mode.
  // Encoded as its own prefix (not `allSessions/board`) so it never collides
  // with the positional `{filter}/session/{id}` detail parsing below.
  if (first === 'board') {
    if (segments.length !== 1 && (segments.length !== 3 || segments[1] !== 'session')) return null
    const sessionId = segments[1] === 'session' && segments[2] ? decodeURIComponent(segments[2]) : undefined
    return {
      navigator: 'sessions',
      sessionFilter: { kind: 'allSessions' },
      viewMode: 'board',
      details: sessionId ? { type: 'session', id: sessionId } : null,
    }
  }

  // Dense table — standalone route. A view of all sessions in table mode.
  // Encoded as its own prefix (not `allSessions/table`) so it never collides
  // with the positional `{filter}/session/{id}` detail parsing below.
  if (first === 'table') {
    if (segments.length !== 1) return null
    return {
      navigator: 'sessions',
      sessionFilter: { kind: 'allSessions' },
      viewMode: 'table',
      details: null,
    }
  }

  if (first === 'heatmap') {
    if (segments.length !== 1) return null
    return {
      navigator: 'sessions',
      sessionFilter: { kind: 'allSessions' },
      viewMode: 'heatmap',
      details: null,
    }
  }

  // Settings navigator
  if (first === 'settings') {
    if (segments.length > 2) return null
    const subpage = segments[1]
    if (subpage === undefined) {
      // Bare `settings` route — Overview in the detail panel.
      return { navigator: 'settings', details: null }
    }
    // Legacy subpages.
    // toolchain → runtime (PRD runtime-context-marketplace §5.1)
    // preferences → context (P2.1 Context ↔ Preferences merge)
    const LEGACY_SETTINGS_REDIRECT: Record<string, SettingsSubpage> = {
      toolchain: 'runtime',
      preferences: 'context',
    }
    const redirected = LEGACY_SETTINGS_REDIRECT[subpage] ?? subpage
    if (!isValidSettingsSubpage(redirected)) return null
    return {
      navigator: 'settings',
      details: { type: redirected, id: redirected },
    }
  }

  // Sources navigator - supports type filters (api, mcp, local)
  if (first === 'sources') {
    if (segments.length === 1) {
      return { navigator: 'sources', details: null }
    }

    // Check for type filter: sources/api, sources/mcp, sources/local
    const validSourceTypes = ['api', 'mcp', 'local']
    if (validSourceTypes.includes(segments[1])) {
      const sourceType = segments[1] as 'api' | 'mcp' | 'local'
      const sourceFilter: SourceFilter = { kind: 'type', sourceType }

      // Check for source selection within filtered view: sources/api/source/{sourceSlug}
      if (segments.length === 4 && segments[2] === 'source' && segments[3]) {
        return {
          navigator: 'sources',
          sourceFilter,
          details: { type: 'source', id: segments[3] },
        }
      }

      // Just the filter, no selection
      return segments.length === 2 ? { navigator: 'sources', sourceFilter, details: null } : null
    }

    // Unfiltered source selection: sources/source/{sourceSlug}
    if (segments.length === 3 && segments[1] === 'source' && segments[2]) {
      return {
        navigator: 'sources',
        details: { type: 'source', id: segments[2] },
      }
    }

    return null
  }

  // Skills navigator
  if (first === 'skills') {
    if (segments.length === 1) {
      return { navigator: 'skills', details: null }
    }

    // skills/skill/{skillSlug}
    if (segments.length === 3 && segments[1] === 'skill' && segments[2]) {
      return {
        navigator: 'skills',
        details: { type: 'skill', id: segments[2] },
      }
    }

    return null
  }

  // Memory navigator (self-learning lessons / context / history)
  if (first === 'memory') {
    if (segments.length !== 1) return null
    return { navigator: 'memory', details: null }
  }

  // Learning navigator (self-learning dashboard — PRD §25-30)
  if (first === 'learning') {
    if (segments.length !== 1) return null
    return { navigator: 'learning', details: null }
  }

  // Personal tasks (Things-style; Issue 17)
  if (first === 'tasks') {
    if (segments.length === 3 && segments[1] === 'task' && segments[2]) {
      return {
        navigator: 'tasks',
        details: { type: 'task', id: decodeURIComponent(segments[2]) },
      }
    }
    return segments.length === 1 ? { navigator: 'tasks', details: null } : null
  }

  if (first === 'inbox') {
    if (segments.length === 3 && segments[1] === 'item' && segments[2]) {
      return { navigator: 'inbox', details: { type: 'item', id: decodeURIComponent(segments[2]) } }
    }
    return segments.length === 1 ? { navigator: 'inbox', details: null } : null
  }

  if (first === 'feed') {
    if (segments.length === 3 && segments[1] === 'item' && segments[2]) {
      return { navigator: 'feed', details: { type: 'item', id: decodeURIComponent(segments[2]) } }
    }
    return segments.length === 1 ? { navigator: 'feed', details: null } : null
  }

  if (first === 'meetings') {
    if (segments.length === 3 && segments[1] === 'meeting' && segments[2]) {
      return {
        navigator: 'meetings',
        details: { type: 'meeting', id: decodeURIComponent(segments[2]) },
      }
    }
    return segments.length === 1 ? { navigator: 'meetings', details: null } : null
  }

  if (first === 'connections') {
    if (segments.length !== 1) return null
    return { navigator: 'connections', details: null }
  }

  if (first === 'home') {
    if (segments.length !== 1) return null
    return { navigator: 'home', details: null }
  }

  // Extra workbench screens: <screenId>[/item/<itemId>]
  if (isExtraScreenId(first) && segments.length !== 1 && (segments.length !== 3 || segments[1] !== 'item')) return null
  const extraScreen = parseExtraScreenSegments(segments)
  if (extraScreen) {
    return {
      navigator: 'screen',
      screen: extraScreen.screen,
      details: extraScreen.itemId ? { type: 'item', id: extraScreen.itemId } : null,
    }
  }

  // Browser navigator — embedded browser instance panel: browser/instance/{instanceId}
  if (first === 'browser') {
    if (segments.length === 3 && segments[1] === 'instance' && segments[2]) {
      return {
        navigator: 'browser',
        details: { type: 'browser', id: decodeURIComponent(segments[2]) },
      }
    }
    return null
  }

  // Projects navigator
  if (first === 'projects') {
    if (segments.length === 1) {
      return { navigator: 'projects', details: null }
    }
    if (segments.length === 3 && segments[1] === 'project' && segments[2]) {
      return {
        navigator: 'projects',
        details: { type: 'project', id: segments[2] },
      }
    }

    return null
  }

  // Pages navigator
  if (first === 'pages') {
    if (segments.length === 1) {
      return { navigator: 'pages', details: null }
    }
    if (segments.length === 3 && segments[1] === 'page' && segments[2]) {
      return {
        navigator: 'pages',
        details: { type: 'page', id: segments[2] },
      }
    }
    return null
  }

  // Notes navigator.
  if (first === 'notes') {
    if (segments.length === 1) {
      return { navigator: 'notes' as NavigatorType, details: null }
    }

    if (segments[1] === 'note' && segments[2]) {
      // Retain nested Notes path IDs as one complete native address.
      return {
        navigator: 'notes' as NavigatorType,
        details: { type: 'note', id: decodeURIComponent(segments.slice(2).join('/')) },
      }
    }

    return null
  }


  // Automations navigator - supports type filters (scheduled, event, agentic)
  if (first === 'automations') {
    if (segments.length === 1) {
      return { navigator: 'automations', details: null }
    }

    // Check for type filter: automations/scheduled, automations/event, automations/agentic
    const validAutomationTypes = ['scheduled', 'event', 'agentic']
    if (validAutomationTypes.includes(segments[1])) {
      const automationType = segments[1] as 'scheduled' | 'event' | 'agentic'
      const automationFilter: AutomationFilter = { kind: 'type', automationType }

      // Check for automation selection within filtered view: automations/scheduled/automation/{automationId}
      if (segments.length === 4 && segments[2] === 'automation' && segments[3]) {
        return {
          navigator: 'automations',
          automationFilter,
          details: { type: 'automation', id: segments[3] },
        }
      }

      // Just the filter, no selection
      return segments.length === 2 ? { navigator: 'automations', automationFilter, details: null } : null
    }

    // Unfiltered automation selection: automations/automation/{automationId}
    if (segments.length === 3 && segments[1] === 'automation' && segments[2]) {
      return {
        navigator: 'automations',
        details: { type: 'automation', id: segments[2] },
      }
    }

    return null
  }

  // ------------------------------------------------------------------
  // Unified-shell surface navigators (W1 scaffolding, spec S-02 §3.6).
  // Well-formed routes round-trip exactly; malformed shapes remain unavailable.
  // ------------------------------------------------------------------

  // Knowledge surface — knowledge/{kind}/{id}; kind 'database' doubles as the
  // database SurfaceTab (descriptor-lowering happens in the registry, S-02 §3.2).
  // P5 saved views: knowledge/view/{viewId} — stays on knowledge navigator with
  // details.type 'knowledge-view' so KnowledgeHome can deep-link.
  if (first === 'knowledge') {
    if (segments.length === 1) {
      return { navigator: 'knowledge', details: null }
    }
    if (segments[1] === 'view') {
      if (segments.length !== 3) return null
      const viewId = decodeURIComponent(segments[2])
      if (viewId) {
        return {
          navigator: 'knowledge',
          details: { type: 'knowledge-view', id: viewId },
        }
      }
      return null
    }
    if (segments.length !== 3) return null
    const kind = segments[1]
    const id = decodeURIComponent(segments[2])
    if (id && (['notebook', 'document', 'block', 'database', 'asset'] as const).includes(kind as KnowledgeRefKind)) {
      return {
        navigator: 'knowledge',
        details: { type: 'knowledge', id, kind: kind as KnowledgeRefKind },
      }
    }
    return null
  }

  // Cloud run surface — cloud-run/{runId}
  if (first === 'cloud-run') {
    if (segments.length === 1) {
      return { navigator: 'cloud-run', details: null }
    }
    if (segments.length !== 2) return null
    const runId = decodeURIComponent(segments[1])
    if (!runId) return null
    return { navigator: 'cloud-run', details: { type: 'cloud-run', id: runId } }
  }

  // Extension sandbox view — extension/{extensionId}[/{viewId}]
  if (first === 'extension') {
    if (segments.length === 1) {
      return { navigator: 'extension', details: null }
    }
    if (segments.length > 3) return null
    const extensionId = decodeURIComponent(segments[1])
    const viewId = segments[2] ? decodeURIComponent(segments[2]) : undefined
    return {
      navigator: 'extension',
      details: { type: 'extension', id: extensionId, ...(viewId ? { viewId } : {}) },
    }
  }

  // Write-proposal diff surface — diff/{proposalId}
  if (first === 'diff') {
    if (segments.length === 1) {
      return { navigator: 'diff', details: null }
    }
    if (segments.length !== 2) return null
    const proposalId = decodeURIComponent(segments[1])
    if (!proposalId) return null
    return { navigator: 'diff', details: { type: 'diff', id: proposalId } }
  }

  // Local terminal surface — terminal/{terminalId}
  if (first === 'terminal') {
    if (segments.length === 1) {
      return { navigator: 'terminal', details: null }
    }
    if (segments.length !== 2) return null
    const terminalId = decodeURIComponent(segments[1])
    if (!terminalId) return null
    return { navigator: 'terminal', details: { type: 'terminal', id: terminalId } }
  }

  // Sessions navigator (allSessions, flagged, state)
  let sessionFilter: SessionFilter
  let detailsStartIndex: number

  switch (first) {
    case 'allSessions':
      sessionFilter = { kind: 'allSessions' }
      detailsStartIndex = 1
      break
    case 'flagged':
      sessionFilter = { kind: 'flagged' }
      detailsStartIndex = 1
      break
    case 'archived':
      sessionFilter = { kind: 'archived' }
      detailsStartIndex = 1
      break
    case 'state':
      if (!segments[1]) return null
      // Cast is safe because we're constructing from URL
      sessionFilter = { kind: 'state', stateId: segments[1] as SessionFilter & { kind: 'state' } extends { stateId: infer T } ? T : never }
      detailsStartIndex = 2
      break
    case 'label':
      if (!segments[1]) return null
      // Label IDs are URL-decoded (simple slugs, no special characters expected)
      sessionFilter = { kind: 'label', labelId: decodeURIComponent(segments[1]) }
      detailsStartIndex = 2
      break
    case 'view':
      if (!segments[1]) return null
      sessionFilter = { kind: 'view', viewId: decodeURIComponent(segments[1]) }
      detailsStartIndex = 2
      break
    default:
      return null
  }

  // Check for details
  if (segments.length > detailsStartIndex) {
    const detailsType = segments[detailsStartIndex]
    const detailsId = segments[detailsStartIndex + 1]
    if (detailsType === 'session' && detailsId && segments.length === detailsStartIndex + 2) {
      return {
        navigator: 'sessions',
        sessionFilter,
        details: { type: 'session', id: decodeURIComponent(detailsId) },
      }
    }
    return null
  }

  return {
    navigator: 'sessions',
    sessionFilter,
    details: null,
  }
}

/**
 * Build a compound route string from parsed state
 */
export function buildCompoundRoute(parsed: ParsedCompoundRoute): string {
  if (parsed.navigator === 'search') {
    const query = parsed.query
    return query ? `search?${new URLSearchParams({ q: query }).toString()}` : 'search'
  }

  if (parsed.navigator === 'settings') {
    if (!parsed.details) return 'settings'
    return `settings/${parsed.details.type}`
  }

  if (parsed.navigator === 'sources') {
    // Build base from filter (sources, sources/api, sources/mcp, sources/local)
    let base = 'sources'
    if (parsed.sourceFilter?.kind === 'type') {
      base = `sources/${parsed.sourceFilter.sourceType}`
    }
    if (!parsed.details) return base
    return `${base}/source/${parsed.details.id}`
  }

  if (parsed.navigator === 'skills') {
    if (!parsed.details) return 'skills'
    return `skills/skill/${parsed.details.id}`
  }

  if (parsed.navigator === 'notes') {
    if (!parsed.details) return 'notes'
    return `notes/note/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'automations') {
    // Build base from filter (automations, automations/scheduled, automations/event, automations/agentic)
    let base = 'automations'
    if (parsed.automationFilter?.kind === 'type') {
      base = `automations/${parsed.automationFilter.automationType}`
    }
    if (!parsed.details) return base
    return `${base}/automation/${parsed.details.id}`
  }

  if (parsed.navigator === 'memory') {
    return 'memory'
  }

  if (parsed.navigator === 'learning') {
    return 'learning'
  }

  if (parsed.navigator === 'tasks') {
    if (!parsed.details) return 'tasks'
    return `tasks/task/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'inbox') {
    if (!parsed.details) return 'inbox'
    return `inbox/item/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'feed') {
    if (!parsed.details) return 'feed'
    return `feed/item/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'meetings') {
    if (!parsed.details) return 'meetings'
    return `meetings/meeting/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'connections') {
    return 'connections'
  }

  if (parsed.navigator === 'home') {
    return 'home'
  }

  if (parsed.navigator === 'screen' && parsed.screen) {
    return buildExtraScreenRoute(parsed.screen, parsed.details?.id)
  }

  if (parsed.navigator === 'browser') {
    if (!parsed.details) return 'browser'
    return `browser/instance/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'projects') {
    if (!parsed.details) return 'projects'
    return `projects/project/${parsed.details.id}`
  }

  if (parsed.navigator === 'pages') {
    if (!parsed.details) return 'pages'
    return `pages/page/${parsed.details.id}`
  }

  // Unified-shell surfaces (W1)
  if (parsed.navigator === 'knowledge') {
    if (!parsed.details) return 'knowledge'
    if (parsed.details.type === 'knowledge-view') {
      return `knowledge/view/${encodeURIComponent(parsed.details.id)}`
    }
    if (parsed.details.type !== 'knowledge' || !parsed.details.kind) return 'knowledge'
    return `knowledge/${parsed.details.kind}/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'cloud-run') {
    if (!parsed.details) return 'cloud-run'
    return `cloud-run/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'extension') {
    if (!parsed.details) return 'extension'
    const base = `extension/${encodeURIComponent(parsed.details.id)}`
    return parsed.details.viewId ? `${base}/${encodeURIComponent(parsed.details.viewId)}` : base
  }

  if (parsed.navigator === 'diff') {
    if (!parsed.details) return 'diff'
    return `diff/${encodeURIComponent(parsed.details.id)}`
  }

  if (parsed.navigator === 'terminal') {
    if (!parsed.details) return 'terminal'
    return `terminal/${encodeURIComponent(parsed.details.id)}`
  }

  // Sessions navigator
  // Board/table are standalone views of all sessions; emit their own prefixes.
  if (parsed.viewMode === 'board') {
    if (parsed.details?.type === 'session' && parsed.details.id) {
      return `board/session/${parsed.details.id}`
    }
    return 'board'
  }
  if (parsed.viewMode === 'table') return 'table'
  if (parsed.viewMode === 'heatmap') return 'heatmap'

  let base: string
  const filter = parsed.sessionFilter
  if (!filter) return 'allSessions'

  switch (filter.kind) {
    case 'allSessions':
      base = 'allSessions'
      break
    case 'flagged':
      base = 'flagged'
      break
    case 'archived':
      base = 'archived'
      break
    case 'state':
      base = `state/${filter.stateId}`
      break
    case 'label':
      base = `label/${encodeURIComponent(filter.labelId)}`
      break
    case 'view':
      base = `view/${encodeURIComponent(filter.viewId)}`
      break
    default:
      base = 'allSessions'
  }

  if (!parsed.details) return base
  return `${base}/session/${parsed.details.id}`
}

// =============================================================================
// Route Parsing
// =============================================================================

/**
 * Parse a route string into structured navigation
 *
 * Examples:
 *   'allSessions' -> { type: 'view', name: 'allSessions', params: {} }
 *   'allSessions/session/abc123' -> { type: 'view', name: 'session', id: 'abc123', params: { filter: 'allSessions' } }
 *   'settings/shortcuts' -> { type: 'view', name: 'shortcuts', params: {} }
 *   'action/new-session' -> { type: 'action', name: 'new-session', params: {} }
 */
export function parseRoute(route: string): ParsedRoute | null {
  try {
    decodeURIComponent(route)
    // Check if this is a compound route (preferred format)
    if (isCompoundRoute(route)) {
      const compound = parseCompoundRoute(route)
      if (compound) {
        return convertCompoundToViewRoute(compound)
      }
    }

    // Parse action routes: action/{name}[/{id}]
    const [pathPart, queryPart] = splitRouteQuery(route)
    const segments = strictPathSegments(pathPart)
    if (!segments || segments.length < 2 || segments.length > 3) {
      return null
    }

    const type = segments[0]
    if (type !== 'action') {
      return null
    }

    const name = segments[1]
    const id = segments[2]

    // Parse query params
    const params: Record<string, string> = {}
    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart)
      searchParams.forEach((value, key) => {
        params[key] = value
      })
    }

    return { type: 'action', name, id, params }
  } catch {
    return null
  }
}

/**
 * Convert a parsed compound route to ParsedRoute format (type: 'view')
 */
function convertCompoundToViewRoute(compound: ParsedCompoundRoute): ParsedRoute {
  if (['knowledge', 'cloud-run', 'extension', 'diff', 'terminal'].includes(compound.navigator)) {
    return {
      type: 'view',
      name: compound.navigator,
      id: compound.details?.id,
      params: {
        ...(compound.details?.kind ? { kind: compound.details.kind } : {}),
        ...(compound.details?.viewId ? { viewId: compound.details.viewId } : {}),
        ...(compound.details ? { detailType: compound.details.type } : {}),
      },
    }
  }
  if (compound.navigator === 'search') {
    return { type: 'view', name: 'search', params: compound.query ? { q: compound.query } : {} }
  }

  // Settings
  if (compound.navigator === 'settings') {
    if (!compound.details) {
      return { type: 'view', name: 'settings', params: {} }
    }
    const subpage = compound.details.type
    if (subpage === 'app') {
      return { type: 'view', name: 'settings', params: {} }
    }
    return { type: 'view', name: subpage, params: {} }
  }

  // Sources
  if (compound.navigator === 'sources') {
    if (!compound.details) {
      return { type: 'view', name: 'sources', params: {} }
    }
    return { type: 'view', name: 'source-info', id: compound.details.id, params: {} }
  }

  // Skills
  if (compound.navigator === 'skills') {
    if (!compound.details) {
      return { type: 'view', name: 'skills', params: {} }
    }
    return { type: 'view', name: 'skill-info', id: compound.details.id, params: {} }
  }

  // Memory
  if (compound.navigator === 'memory') {
    return { type: 'view', name: 'memory', params: {} }
  }

  // Learning
  if (compound.navigator === 'learning') {
    return { type: 'view', name: 'learning', params: {} }
  }

  if (compound.navigator === 'tasks') {
    if (!compound.details) {
      return { type: 'view', name: 'tasks', params: {} }
    }
    return { type: 'view', name: 'task-info', id: compound.details.id, params: {} }
  }

  if (compound.navigator === 'inbox') {
    if (!compound.details) {
      return { type: 'view', name: 'inbox', params: {} }
    }
    return { type: 'view', name: 'inbox-item', id: compound.details.id, params: {} }
  }

  if (compound.navigator === 'feed') {
    if (!compound.details) {
      return { type: 'view', name: 'feed', params: {} }
    }
    return { type: 'view', name: 'feed-item', id: compound.details.id, params: {} }
  }

  if (compound.navigator === 'meetings') {
    if (!compound.details) {
      return { type: 'view', name: 'meetings', params: {} }
    }
    return { type: 'view', name: 'meeting-info', id: compound.details.id, params: {} }
  }

  if (compound.navigator === 'connections') {
    return { type: 'view', name: 'connections', params: {} }
  }

  if (compound.navigator === 'home') {
    return { type: 'view', name: 'home', params: {} }
  }

  if (compound.navigator === 'screen' && compound.screen) {
    return { type: 'view', name: 'screen', id: compound.details?.id, params: { screen: compound.screen } }
  }

  // Notes
  if (compound.navigator === 'notes') {
    if (!compound.details) {
      return { type: 'view', name: 'notes', params: {} }
    }
    return { type: 'view', name: 'note-info', id: compound.details.id, params: {} }
  }

  // Automations
  if (compound.navigator === 'automations') {
    if (!compound.details) {
      return { type: 'view', name: 'automations', params: {} }
    }
    return { type: 'view', name: 'automation-info', id: compound.details.id, params: {} }
  }

  // Projects
  if (compound.navigator === 'projects') {
    if (!compound.details) {
      return { type: 'view', name: 'projects', params: {} }
    }
    return { type: 'view', name: 'project-info', id: compound.details.id, params: {} }
  }

  // Pages
  if (compound.navigator === 'pages') {
    if (!compound.details) {
      return { type: 'view', name: 'pages', params: {} }
    }
    return { type: 'view', name: 'page-info', id: compound.details.id, params: {} }
  }

  // Browser (embedded browser instance panel)
  if (compound.navigator === 'browser') {
    if (!compound.details) {
      return { type: 'view', name: 'browser', params: {} }
    }
    return { type: 'view', name: 'browser', id: compound.details.id, params: {} }
  }

  // Sessions
  if (compound.sessionFilter) {
    const filter = compound.sessionFilter
    if (compound.details) {
      return {
        type: 'view',
        name: 'session',
        id: compound.details.id,
        params: {
          filter: filter.kind,
          ...(filter.kind === 'state' ? { stateId: filter.stateId } : {}),
          ...(filter.kind === 'label' ? { labelId: filter.labelId } : {}),
          ...(filter.kind === 'view' ? { viewId: filter.viewId } : {}),
        },
      }
    }
    return {
      type: 'view',
      name: filter.kind,
      id: filter.kind === 'state' ? filter.stateId : (filter.kind === 'label' ? filter.labelId : (filter.kind === 'view' ? filter.viewId : undefined)),
      params: {},
    }
  }

  return { type: 'view', name: 'allSessions', params: {} }
}

// =============================================================================
// NavigationState Parsing (new unified system)
// =============================================================================

/** Shared runtime boundary; retain the current public name for all callers. */
export function parseRouteToNavigationStateOrUnavailable(route: string, sidebarParam?: string): NavigationState {
  return resolveViewRoute(route, sidebarParam)
}

/**
 * Parse a route string directly to NavigationState (the unified state)
 *
 * This is the preferred way to parse routes - returns the unified state that
 * determines all 3 panels (sidebar, navigator, main content).
 *
 * Supports:
 * - Compound routes: allSessions, allSessions/session/abc, sources, sources/source/github, settings/shortcuts
 * - Right sidebar param: ?sidebar=files or ?sidebar=history
 *
 * Returns null for action routes (they don't map to a navigation state) and invalid routes.
 */
export function parseRouteToNavigationState(
  route: string,
  sidebarParam?: string
): NavigationState | null {
  // Parse compound routes
  if (isCompoundRoute(route)) {
    const compound = parseCompoundRoute(route)
    if (compound) {
      const state = convertCompoundToNavigationState(compound)
      // Add rightSidebar if param provided
      const rightSidebar = parseRightSidebarParam(sidebarParam)
      if (rightSidebar) {
        return { ...state, rightSidebar }
      }
      return state
    }
  }

  // Parse as route (may be action or view)
  const parsed = parseRoute(route)
  if (!parsed) return null

  // Actions don't map to navigation state
  if (parsed.type === 'action') return null

  // Convert view routes to NavigationState
  const state = convertParsedRouteToNavigationState(parsed)
  if (state) {
    // Add rightSidebar if param provided
    const rightSidebar = parseRightSidebarParam(sidebarParam)
    if (rightSidebar) {
      return { ...state, rightSidebar }
    }
  }
  return state
}

/** Resolve a view address without substituting an unrelated default view.
 * Action addresses in restored URLs are unavailable, never executed.
 */
export function resolveRouteNavigationState(route: string, sidebarParam?: string): NavigationState {
  return parseRouteToNavigationStateOrUnavailable(route, sidebarParam)
}

/**
 * Resolve a panel/deep-link view without discarding its original address.
 * Stored action routes are views here and must never execute during restore.
 * The nullable parser retains its legacy degradation contract; mounted runtime
 * consumers use this boundary to reject lossy parsing across all navigators.
 */
export function resolveViewRoute(route: string, sidebarParam?: string): NavigationState {
  const unavailable: UnavailableNavigationState = { navigator: 'unavailable', route, details: null }
  const rightSidebar = parseRightSidebarParam(sidebarParam)
  if (rightSidebar) unavailable.rightSidebar = rightSidebar
  try {
    if (route.includes('#') || /[\u0000-\u001f\u007f]/.test(route)) return unavailable
    // Some legacy routes retain encoded slugs, but malformed encoding is never
    // a valid entity address, even when that parser branch does not decode it.
    const path = route.split('?')[0]
    // Empty namespace separators are legacy aliases. Opaque rest-of-path IDs
    // retain every separator after their first byte; folding them could select
    // a different document/run/terminal. Notes keeps its filesystem alias.
    const rawSegments = path.split('/')
    const namespaceSegments = rawSegments.filter(Boolean)
    const opaquePrefixLength = ['knowledge', 'extension'].includes(namespaceSegments[0] ?? '')
      && namespaceSegments.length >= 3 ? 2
      : ['cloud-run', 'terminal', 'diff'].includes(namespaceSegments[0] ?? '')
        && namespaceSegments.length >= 2 ? 1 : null
    let normalizedPath = namespaceSegments.join('/')
    if (opaquePrefixLength !== null) {
      let namespaceCount = 0
      let idStart = 0
      for (; idStart < rawSegments.length; idStart++) {
        if (rawSegments[idStart] && ++namespaceCount === opaquePrefixLength) { idStart++; break }
      }
      while (idStart < rawSegments.length && rawSegments[idStart] === '') idStart++
      normalizedPath = namespaceSegments.slice(0, opaquePrefixLength).join('/')
        + '/' + rawSegments.slice(idStart).join('/')
    }
    const decodedPath = decodeURIComponent(normalizedPath)
    const query = route.slice(path.length)
    // Keep published rest-of-path entity addresses through the strict raw
    // grammar. Encode the complete legacy ID as one segment before parsing;
    // never select only its prefix. Existing escapes are decoded exactly once.
    const segments = normalizedPath.split('/')
    const restStart = segments[0] === 'knowledge' && segments.length > 3 ? 2
      : segments[0] === 'extension' && segments.length > 3 ? 2
      : ['cloud-run', 'terminal', 'diff'].includes(segments[0]) && segments.length > 2 ? 1 : null
    const parsePath = restStart === null ? normalizedPath
      : segments.slice(0, restStart).join('/') + '/' + encodeURIComponent(decodeURIComponent(segments.slice(restStart).join('/')))
    const state = parseRouteToNavigationState(parsePath + query, sidebarParam)
    if (!state) return unavailable
    // Compare the full address, allowing equivalent entity encoding and the
    // established settings aliases. A parser fallback must not drop a suffix.
    const canonicalPath = decodeURIComponent(buildRouteFromNavigationState(state).split('?')[0])
    const aliasedPath = decodedPath === 'settings/toolchain' ? 'settings/runtime'
      : decodedPath === 'settings/preferences' ? 'settings/context' : decodedPath
    if (canonicalPath !== aliasedPath) return unavailable
    return state
  } catch {
    return unavailable
  }
}

/**
 * Convert a ParsedCompoundRoute to NavigationState
 */
function convertCompoundToNavigationState(compound: ParsedCompoundRoute): NavigationState {
  if (compound.navigator === 'search') {
    return { navigator: 'search', query: compound.query ?? '' }
  }

  // Settings
  if (compound.navigator === 'settings') {
    if (!compound.details) {
      return { navigator: 'settings', subpage: null }
    }
    return { navigator: 'settings', subpage: compound.details.type as SettingsSubpage }
  }

  // Sources - include filter if present
  if (compound.navigator === 'sources') {
    if (!compound.details) {
      return {
        navigator: 'sources',
        filter: compound.sourceFilter,
        details: null,
      }
    }
    return {
      navigator: 'sources',
      filter: compound.sourceFilter,
      details: { type: 'source', sourceSlug: compound.details.id },
    }
  }

  // Skills
  if (compound.navigator === 'skills') {
    if (!compound.details) {
      return { navigator: 'skills', details: null }
    }
    return {
      navigator: 'skills',
      details: { type: 'skill', skillSlug: compound.details.id },
    }
  }

  // Memory
  if (compound.navigator === 'memory') {
    return { navigator: 'memory', details: null }
  }

  // Learning
  if (compound.navigator === 'learning') {
    return { navigator: 'learning', details: null }
  }

  if (compound.navigator === 'tasks') {
    if (!compound.details) {
      return { navigator: 'tasks', details: null }
    }
    return {
      navigator: 'tasks',
      details: { type: 'task', taskId: compound.details.id },
    }
  }

  if (compound.navigator === 'inbox') {
    if (!compound.details) {
      return { navigator: 'inbox', details: null }
    }
    return { navigator: 'inbox', details: { type: 'item', itemId: compound.details.id } }
  }

  if (compound.navigator === 'feed') {
    if (!compound.details) {
      return { navigator: 'feed', details: null }
    }
    return { navigator: 'feed', details: { type: 'item', itemId: compound.details.id } }
  }

  if (compound.navigator === 'meetings') {
    if (!compound.details) {
      return { navigator: 'meetings', details: null }
    }
    return {
      navigator: 'meetings',
      details: { type: 'meeting', meetingId: compound.details.id },
    }
  }

  if (compound.navigator === 'connections') {
    return { navigator: 'connections', details: null }
  }

  if (compound.navigator === 'home') {
    return { navigator: 'home', details: null }
  }

  if (compound.navigator === 'screen' && compound.screen) {
    return {
      navigator: 'screen',
      screen: compound.screen,
      details: compound.details ? { type: 'item', itemId: compound.details.id } : null,
    }
  }

  // Notes
  if (compound.navigator === 'notes') {
    if (!compound.details) {
      return { navigator: 'notes', details: null }
    }
    return {
      navigator: 'notes',
      details: { type: 'note', noteId: compound.details.id },
    }
  }

  // Automations - include filter if present
  if (compound.navigator === 'automations') {
    if (!compound.details) {
      return {
        navigator: 'automations',
        filter: compound.automationFilter,
        details: null,
      }
    }
    return {
      navigator: 'automations',
      filter: compound.automationFilter,
      details: { type: 'automation', automationId: compound.details.id },
    }
  }

  // Projects
  if (compound.navigator === 'projects') {
    if (!compound.details) {
      return { navigator: 'projects', details: null }
    }
    return {
      navigator: 'projects',
      details: { type: 'project', projectSlug: compound.details.id },
    }
  }

  // Pages
  if (compound.navigator === 'pages') {
    if (!compound.details) {
      return { navigator: 'pages', details: null }
    }
    return {
      navigator: 'pages',
      details: { type: 'page', pageSlug: compound.details.id },
    }
  }

  // Browser
  if (compound.navigator === 'browser') {
    if (!compound.details) {
      return { navigator: 'browser', details: null }
    }
    return {
      navigator: 'browser',
      details: { type: 'browser', id: compound.details.id },
    }
  }

  // Unified-shell surfaces (W1)
  if (compound.navigator === 'knowledge') {
    if (!compound.details) {
      return { navigator: 'knowledge', details: null }
    }
    if (compound.details.type === 'knowledge-view') {
      return {
        navigator: 'knowledge',
        details: { type: 'knowledge-view', viewId: compound.details.id },
      }
    }
    if (compound.details.type !== 'knowledge' || !compound.details.kind) {
      return { navigator: 'knowledge', details: null }
    }
    return {
      navigator: 'knowledge',
      details: { type: 'knowledge', kind: compound.details.kind, id: compound.details.id },
    }
  }

  if (compound.navigator === 'cloud-run') {
    if (!compound.details) {
      return { navigator: 'cloud-run', details: null }
    }
    return {
      navigator: 'cloud-run',
      details: { type: 'cloud-run', runId: compound.details.id },
    }
  }

  if (compound.navigator === 'extension') {
    if (!compound.details) {
      return { navigator: 'extension', details: null }
    }
    return {
      navigator: 'extension',
      details: {
        type: 'extension',
        extensionId: compound.details.id,
        ...(compound.details.viewId ? { viewId: compound.details.viewId } : {}),
      },
    }
  }

  if (compound.navigator === 'diff') {
    if (!compound.details) {
      return { navigator: 'diff', details: null }
    }
    return {
      navigator: 'diff',
      details: { type: 'diff', proposalId: compound.details.id },
    }
  }

  if (compound.navigator === 'terminal') {
    if (!compound.details) {
      return { navigator: 'terminal', details: null }
    }
    return {
      navigator: 'terminal',
      details: { type: 'terminal', id: compound.details.id },
    }
  }

  // Sessions
  const filter = compound.sessionFilter || { kind: 'allSessions' as const }
  if (compound.details) {
    return {
      navigator: 'sessions',
      filter,
      viewMode: compound.viewMode,
      details: { type: 'session', sessionId: compound.details.id },
    }
  }
  return {
    navigator: 'sessions',
    filter,
    viewMode: compound.viewMode,
    details: null,
  }
}

/**
 * Convert a ParsedRoute (view type) to NavigationState
 */
function convertParsedRouteToNavigationState(parsed: ParsedRoute): NavigationState | null {
  // Only handle view routes (compound routes converted to view type)
  if (parsed.type !== 'view') {
    return null
  }

  switch (parsed.name) {
    case 'settings':
      return { navigator: 'settings', subpage: null }
    case 'workspace':
      return { navigator: 'settings', subpage: 'workspace' }
    case 'permissions':
      return { navigator: 'settings', subpage: 'permissions' }
    case 'labels':
      return { navigator: 'settings', subpage: 'labels' }
    case 'shortcuts':
      return { navigator: 'settings', subpage: 'shortcuts' }
    case 'preferences':
      return { navigator: 'settings', subpage: 'context' }
    case 'sources':
      return { navigator: 'sources', details: null }
    case 'source-info':
      if (parsed.id) {
        return {
          navigator: 'sources',
          details: {
            type: 'source',
            sourceSlug: parsed.id,
          },
        }
      }
      return { navigator: 'sources', details: null }
    case 'skills':
      return { navigator: 'skills', details: null }
    case 'memory':
      return { navigator: 'memory', details: null }
    case 'learning':
      return { navigator: 'learning', details: null }
    case 'tasks':
      return { navigator: 'tasks', details: null }
    case 'inbox':
      return { navigator: 'inbox', details: null }
    case 'inbox-item':
      return parsed.id
        ? { navigator: 'inbox', details: { type: 'item', itemId: parsed.id } }
        : { navigator: 'inbox', details: null }
    case 'feed':
      return { navigator: 'feed', details: null }
    case 'feed-item':
      return parsed.id
        ? { navigator: 'feed', details: { type: 'item', itemId: parsed.id } }
        : { navigator: 'feed', details: null }
    case 'meetings':
      return { navigator: 'meetings', details: null }
    case 'meeting-info':
      if (parsed.id) {
        return {
          navigator: 'meetings',
          details: { type: 'meeting', meetingId: parsed.id },
        }
      }
      return { navigator: 'meetings', details: null }
    case 'task-info':
      if (parsed.id) {
        return {
          navigator: 'tasks',
          details: { type: 'task', taskId: parsed.id },
        }
      }
      return { navigator: 'tasks', details: null }
    case 'connections':
      return { navigator: 'connections', details: null }
    case 'home':
      return { navigator: 'home', details: null }
    case 'screen': {
      const screen = parsed.params.screen
      if (!isExtraScreenId(screen)) return null
      return { navigator: 'screen', screen, details: parsed.id ? { type: 'item', itemId: parsed.id } : null }
    }
    case 'skill-info':
      if (parsed.id) {
        return {
          navigator: 'skills',
          details: {
            type: 'skill',
            skillSlug: parsed.id,
          },
        }
      }
      return { navigator: 'skills', details: null }
    case 'notes':
      return { navigator: 'notes', details: null }
    case 'note-info':
      if (parsed.id) {
        return {
          navigator: 'notes',
          details: {
            type: 'note',
            noteId: parsed.id,
          },
        }
      }
      return { navigator: 'notes', details: null }
    case 'automations':
      return { navigator: 'automations', details: null }
    case 'automation-info':
      if (parsed.id) {
        return {
          navigator: 'automations',
          details: {
            type: 'automation',
            automationId: parsed.id,
          },
        }
      }
      return { navigator: 'automations', details: null }
    case 'projects':
      return { navigator: 'projects', details: null }
    case 'pages':
      return { navigator: 'pages', details: null }
    case 'page-info':
      if (parsed.id) {
        return {
          navigator: 'pages',
          details: { type: 'page', pageSlug: parsed.id },
        }
      }
      return { navigator: 'pages', details: null }
    case 'browser':
      if (parsed.id) {
        return {
          navigator: 'browser',
          details: { type: 'browser', id: parsed.id },
        }
      }
      return { navigator: 'browser', details: null }
    case 'project-info':
      if (parsed.id) {
        return {
          navigator: 'projects',
          details: { type: 'project', projectSlug: parsed.id },
        }
      }
      return { navigator: 'projects', details: null }
    case 'session':
      if (parsed.id) {
        // Reconstruct filter from params
        const filterKind = (parsed.params.filter || 'allSessions') as SessionFilter['kind']
        let filter: SessionFilter
        if (filterKind === 'state' && parsed.params.stateId) {
          filter = { kind: 'state', stateId: parsed.params.stateId }
        } else if (filterKind === 'label' && parsed.params.labelId) {
          filter = { kind: 'label', labelId: parsed.params.labelId }
        } else if (filterKind === 'view' && parsed.params.viewId) {
          filter = { kind: 'view', viewId: parsed.params.viewId }
        } else {
          filter = { kind: filterKind as 'allSessions' | 'flagged' | 'archived' }
        }
        return {
          navigator: 'sessions',
          filter,
          details: { type: 'session', sessionId: parsed.id },
        }
      }
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    case 'allSessions':
      return {
        navigator: 'sessions',
        filter: { kind: 'allSessions' },
        details: null,
      }
    case 'flagged':
      return {
        navigator: 'sessions',
        filter: { kind: 'flagged' },
        details: null,
      }
    case 'archived':
      return {
        navigator: 'sessions',
        filter: { kind: 'archived' },
        details: null,
      }
    case 'state':
      if (parsed.id) {
        return {
          navigator: 'sessions',
          filter: { kind: 'state', stateId: parsed.id },
          details: null,
        }
      }
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    case 'label':
      if (parsed.id) {
        return {
          navigator: 'sessions',
          filter: { kind: 'label', labelId: parsed.id },
          details: null,
        }
      }
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    case 'view':
      if (parsed.id) {
        return {
          navigator: 'sessions',
          filter: { kind: 'view', viewId: parsed.id },
          details: null,
        }
      }
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    default:
      return null
  }
}

/**
 * Convert NavigationState to ParsedCompoundRoute
 */
function navigationStateToCompoundRoute(state: Exclude<NavigationState, UnavailableNavigationState>): ParsedCompoundRoute {
  if (state.navigator === 'search') {
    return { navigator: 'search', query: state.query, details: null }
  }

  if (state.navigator === 'settings') {
    if (state.subpage === null) {
      return { navigator: 'settings', details: null }
    }
    return {
      navigator: 'settings',
      details: { type: state.subpage, id: state.subpage },
    }
  }

  if (state.navigator === 'sources') {
    return {
      navigator: 'sources',
      sourceFilter: state.filter ?? undefined,
      details: state.details ? { type: 'source', id: state.details.sourceSlug } : null,
    }
  }

  if (state.navigator === 'skills') {
    return {
      navigator: 'skills',
      details: state.details?.type === 'skill' ? { type: 'skill', id: state.details.skillSlug } : null,
    }
  }

  if (state.navigator === 'notes') {
    return {
      navigator: 'notes' as NavigatorType,
      details: state.details?.type === 'note' ? { type: 'note', id: state.details.noteId } : null,
    }
  }

  if (state.navigator === 'automations') {
    return {
      navigator: 'automations',
      automationFilter: state.filter ?? undefined,
      details: state.details ? { type: 'automation', id: state.details.automationId } : null,
    }
  }

  if (state.navigator === 'projects') {
    return {
      navigator: 'projects',
      details: state.details ? { type: 'project', id: state.details.projectSlug } : null,
    }
  }

  if (state.navigator === 'pages') {
    return {
      navigator: 'pages',
      details: state.details ? { type: 'page', id: state.details.pageSlug } : null,
    }
  }

  if (state.navigator === 'memory') {
    return {
      navigator: 'memory',
      details: null,
    }
  }

  if (state.navigator === 'learning') {
    return {
      navigator: 'learning',
      details: null,
    }
  }

  if (state.navigator === 'tasks') {
    return {
      navigator: 'tasks',
      details: state.details ? { type: 'task', id: state.details.taskId } : null,
    }
  }

  if (state.navigator === 'inbox') {
    return {
      navigator: 'inbox',
      details: state.details ? { type: 'item', id: state.details.itemId } : null,
    }
  }

  if (state.navigator === 'feed') {
    return {
      navigator: 'feed',
      details: state.details ? { type: 'item', id: state.details.itemId } : null,
    }
  }

  if (state.navigator === 'meetings') {
    return {
      navigator: 'meetings',
      details: state.details ? { type: 'meeting', id: state.details.meetingId } : null,
    }
  }

  if (state.navigator === 'connections') {
    return {
      navigator: 'connections',
      details: null,
    }
  }

  if (state.navigator === 'home') {
    return {
      navigator: 'home',
      details: null,
    }
  }

  if (state.navigator === 'screen') {
    return {
      navigator: 'screen',
      screen: state.screen,
      details: state.details ? { type: 'item', id: state.details.itemId } : null,
    }
  }

  if (state.navigator === 'browser') {
    return {
      navigator: 'browser',
      details: state.details ? { type: 'browser', id: state.details.id } : null,
    }
  }

  // Unified-shell surfaces (W1)
  if (state.navigator === 'knowledge') {
    if (state.details?.type === 'knowledge-view') {
      return {
        navigator: 'knowledge',
        details: { type: 'knowledge-view', id: state.details.viewId },
      }
    }
    return {
      navigator: 'knowledge',
      details: state.details?.type === 'knowledge'
        ? { type: 'knowledge', id: state.details.id, kind: state.details.kind }
        : null,
    }
  }

  if (state.navigator === 'cloud-run') {
    return {
      navigator: 'cloud-run',
      details: state.details?.type === 'cloud-run'
        ? { type: 'cloud-run', id: state.details.runId }
        : null,
    }
  }

  if (state.navigator === 'extension') {
    return {
      navigator: 'extension',
      details: state.details?.type === 'extension'
        ? { type: 'extension', id: state.details.extensionId, ...(state.details.viewId ? { viewId: state.details.viewId } : {}) }
        : null,
    }
  }

  if (state.navigator === 'diff') {
    return {
      navigator: 'diff',
      details: state.details?.type === 'diff'
        ? { type: 'diff', id: state.details.proposalId }
        : null,
    }
  }

  if (state.navigator === 'terminal') {
    return {
      navigator: 'terminal',
      details: state.details?.type === 'terminal'
        ? { type: 'terminal', id: state.details.id }
        : null,
    }
  }

  // Sessions
  return {
    navigator: 'sessions',
    sessionFilter: state.filter,
    viewMode: state.viewMode,
    details: state.details ? { type: 'session', id: state.details.sessionId } : null,
  }
}

/**
 * Build a route string from NavigationState
 */
export function buildRouteFromNavigationState(state: NavigationState): string {
  if (state.navigator === 'unavailable') return state.route
  return buildCompoundRoute(navigationStateToCompoundRoute(state))
}

/**
 * Degrade a unified-shell surface state to the nearest pre-W1 navigation view.
 *
 * Until the dedicated hosts land (knowledge/run/diff in W2+K-05, extension in
 * W5), consumers that cannot render a surface navigator should map it through
 * this helper instead of branching on the new navigators themselves. Identity
 * for every pre-W1 state. See the degradation table at the top of this file.
 */
export function degradeSurfaceNavigationState(state: NavigationState): NavigationState {
  switch (state.navigator) {
    case 'knowledge':
    case 'cloud-run':
    case 'diff':
      return { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null }
    case 'extension':
      return { navigator: 'settings', subpage: null }
    default:
      return state
  }
}

// =============================================================================
// Right Sidebar Param Parsing
// =============================================================================

/**
 * Parse right sidebar param from URL query string
 *
 * Examples:
 *   'history' -> { type: 'history' }
 *   'files' -> { type: 'files' }
 *   'files/src/main.ts' -> { type: 'files', path: 'src/main.ts' }
 *   'git' | 'browser' | 'context' -> { type }
 *   'none' -> { type: 'none' }
 */
export function parseRightSidebarParam(sidebarStr?: string): RightSidebarPanel | undefined {
  if (!sidebarStr) return undefined

  if (sidebarStr === 'history') {
    return { type: 'history' }
  }
  if (sidebarStr === 'git') {
    return { type: 'git' }
  }
  if (sidebarStr === 'browser') {
    return { type: 'browser' }
  }
  if (sidebarStr === 'context') {
    return { type: 'context' }
  }
  if (sidebarStr.startsWith('files')) {
    const path = sidebarStr.substring(6) // Remove 'files/' prefix
    return { type: 'files', path: path || undefined }
  }
  if (sidebarStr === 'none') {
    return { type: 'none' }
  }

  return undefined
}

/**
 * Build right sidebar param for URL query string
 *
 * Returns undefined for 'none' type (omit from URL to keep URLs clean)
 */
export function buildRightSidebarParam(panel?: RightSidebarPanel): string | undefined {
  if (!panel || panel.type === 'none') return undefined

  switch (panel.type) {
    case 'history':
      return 'history'
    case 'git':
      return 'git'
    case 'browser':
      return 'browser'
    case 'context':
      return 'context'
    case 'files':
      return panel.path ? `files/${panel.path}` : 'files'
    default:
      return undefined
  }
}
