/**
 * Route Registry
 *
 * Type-safe route definitions for navigation throughout the app.
 * All navigation should use these route builders instead of hardcoded strings.
 *
 * Route Formats:
 * - action/{name}[/{id}] - Trigger side effects
 * - {filter}[/session/{sessionId}] - Compound view routes for full navigation state
 *
 * Usage:
 *   import { routes } from '@/shared/routes'
 *   navigate(routes.action.newSession())
 *   navigate(routes.view.allSessions())
 *   navigate(routes.view.settings('shortcuts'))
 */

import type { SettingsSubpage } from './settings-registry'
import type { PermissionMode } from '@rox/shared/agent/mode-types'
import type { KnowledgeRefKind } from './types'
import { buildExtraScreenRoute, type ExtraScreenId } from './extra-screens'
import { entityRoute } from '@rox/core/entities'

// Helper to build query strings from params
function toQueryString(params?: Record<string, string | undefined>): string {
  if (!params) return ''
  const filtered = Object.entries(params).filter(([, v]) => v !== undefined)
  if (filtered.length === 0) return ''
  const searchParams = new URLSearchParams(
    filtered as [string, string][]
  )
  return `?${searchParams.toString()}`
}
function buildNotesRoute(noteId?: string) {
  if (!noteId) return 'notes' as const
  return `notes/note/${encodeURIComponent(noteId)}` as const
}


/**
 * Route definitions with type-safe builders
 */
export const routes = {
  // ============================================
  // Action Routes - Trigger actions
  // ============================================
  action: {
    /**
     * Create a new session
     * @param input - Optional initial message to pre-fill or send
     * @param name - Optional session name
     * @param send - If true and input is provided, immediately sends the message
     * @param status - Optional status/todo-state ID to apply to the new session
     * @param label - Optional label ID to apply to the new session
     * @param project - Optional project id to bind the new session to
     */
    newSession: (params?: { input?: string; name?: string; send?: boolean; status?: string; label?: string; project?: string }) =>
      `action/new-session${toQueryString(params ? { ...params, send: params.send ? 'true' : undefined } : undefined)}` as const,

    /** Rename a session */
    renameSession: (sessionId: string, name: string) =>
      `action/rename-session/${sessionId}?name=${encodeURIComponent(name)}` as const,

    /** Delete a session (with confirmation) */
    deleteSession: (sessionId: string) =>
      `action/delete-session/${sessionId}` as const,

    /** Toggle flag on a session */
    flagSession: (sessionId: string) =>
      `action/flag-session/${sessionId}` as const,

    /** Unflag a session */
    unflagSession: (sessionId: string) =>
      `action/unflag-session/${sessionId}` as const,

    /** Start OAuth flow for a source */
    oauth: (sourceSlug: string) => `action/oauth/${sourceSlug}` as const,

    /** Open add source UI */
    addSource: () => 'action/add-source' as const,

    // Note: test-source route can be added when API support is available
    // testSource: (sourceSlug: string) => `action/test-source/${sourceSlug}` as const,

    /** Delete a source */
    deleteSource: (sourceSlug: string) =>
      `action/delete-source/${sourceSlug}` as const,

    /** Set permission mode for a session */
    setPermissionMode: (
      sessionId: string,
      mode: PermissionMode
    ) => `action/set-mode/${sessionId}?mode=${mode}` as const,

    /** Copy text to clipboard */
    copyToClipboard: (text: string) =>
      `action/copy?text=${encodeURIComponent(text)}` as const,

    /** Open the local Open Design runtime inside an embedded browser panel. */
    openDesign: () => 'action/open-design' as const,
  },

  // ============================================
  // View Routes - Compound sidebar/navigator/details routes
  // ============================================
  view: {
    /** Global, workspace-scoped Search page; query remains URL-encoded for restore/back. */
    search: (query?: string) =>
      `search${toQueryString(query ? { q: query } : undefined)}` as const,

    /** All sessions view (sessions navigator, allSessions filter) */
    allSessions: (sessionId?: string) =>
      sessionId ? `allSessions/session/${sessionId}` as const : 'allSessions' as const,

    /** Flagged view (sessions navigator, flagged filter) */
    flagged: (sessionId?: string) =>
      sessionId ? `flagged/session/${sessionId}` as const : 'flagged' as const,

    /** Archived view (sessions navigator, archived filter) */
    archived: (sessionId?: string) =>
      sessionId ? `archived/session/${sessionId}` as const : 'archived' as const,

    /** Todo state filter view (sessions navigator, state filter) */
    state: (stateId: string, sessionId?: string) =>
      sessionId
        ? `state/${stateId}/session/${sessionId}` as const
        : `state/${stateId}` as const,

    /** Label filter view (sessions navigator, label filter — includes descendants via tree hierarchy) */
    label: (labelId: string, sessionId?: string) =>
      sessionId
        ? `label/${encodeURIComponent(labelId)}/session/${sessionId}` as const
        : `label/${encodeURIComponent(labelId)}` as const,

    /** View filter (sessions navigator, view filter — evaluated dynamically) */
    view: (viewId: string, sessionId?: string) =>
      sessionId
        ? `view/${encodeURIComponent(viewId)}/session/${sessionId}` as const
        : `view/${encodeURIComponent(viewId)}` as const,

    /** Sources view (sources navigator) - supports type filtering */
    sources: (params?: { sourceSlug?: string; type?: 'api' | 'mcp' | 'local' }) => {
      const { sourceSlug, type } = params ?? {}
      // Build base from filter type
      const base = type ? `sources/${type}` : 'sources'
      if (sourceSlug) {
        return `${base}/source/${sourceSlug}` as const
      }
      return base as 'sources' | `sources/${'api' | 'mcp' | 'local'}`
    },

    /** API sources view (sources navigator, api filter) */
    sourcesApi: (sourceSlug?: string) =>
      sourceSlug
        ? `sources/api/source/${sourceSlug}` as const
        : 'sources/api' as const,

    /** MCP sources view (sources navigator, mcp filter) */
    sourcesMcp: (sourceSlug?: string) =>
      sourceSlug
        ? `sources/mcp/source/${sourceSlug}` as const
        : 'sources/mcp' as const,

    /** Local folder sources view (sources navigator, local filter) */
    sourcesLocal: (sourceSlug?: string) =>
      sourceSlug
        ? `sources/local/source/${sourceSlug}` as const
        : 'sources/local' as const,

    /** Skills view (skills navigator). Pass a slug string for a local skill detail view. */
    skills: (skillSlug?: string) => {
      if (!skillSlug) return 'skills' as const
      return `skills/skill/${skillSlug}` as const
    },
    /** Memory view (memory navigator — self-learning panel) */
    memory: () => 'memory' as const,

    /** Learning view (learning navigator — self-learning dashboard, PRD §25-30) */
    learning: () => 'learning' as const,

    /** Things-style personal tasks (Issue 17). Distinct from DAG Conductor tasks. */
    tasks: (taskId?: string) =>
      taskId ? `tasks/task/${encodeURIComponent(taskId)}` as const : 'tasks' as const,

    /** Mode screen `inbox` — `inbox[/item/{itemId}]` */
    inbox: (itemId?: string) =>
      itemId ? `inbox/item/${encodeURIComponent(itemId)}` as const : 'inbox' as const,
    /** Mode screen `feed` — `feed[/item/{itemId}]` */
    feed: (itemId?: string) =>
      itemId ? `feed/item/${encodeURIComponent(itemId)}` as const : 'feed' as const,
    meetings: (meetingId?: string) =>
      meetingId ? `meetings/meeting/${encodeURIComponent(meetingId)}` as const : 'meetings' as const,

    /** Canonical local Markdown Notes route. */
    notes: buildNotesRoute,


    /** Automations view (automations navigator) - supports type filtering */
    automations: (params?: { automationId?: string; type?: 'scheduled' | 'event' | 'agentic' }) => {
      const { automationId, type } = params ?? {}
      const base = type ? `automations/${type}` : 'automations'
      if (automationId) return `${base}/automation/${automationId}` as const
      return base as 'automations' | `automations/${'scheduled' | 'event' | 'agentic'}`
    },

    /** Scheduled automations view (automations navigator, scheduled filter) */
    automationsScheduled: (automationId?: string) =>
      automationId ? `automations/scheduled/automation/${automationId}` as const : 'automations/scheduled' as const,

    /** Event-based automations view (automations navigator, event filter) */
    automationsEvent: (automationId?: string) =>
      automationId ? `automations/event/automation/${automationId}` as const : 'automations/event' as const,

    /** Agentic automations view (automations navigator, agentic filter) */
    automationsAgentic: (automationId?: string) =>
      automationId ? `automations/agentic/automation/${automationId}` as const : 'automations/agentic' as const,

    /** Settings view (settings navigator) - uses SettingsSubpage from registry */
    settings: (subpage?: SettingsSubpage) =>
      subpage
        ? `settings/${subpage}` as const
        : 'settings' as const,

    /** Projects view (projects navigator) */
    projects: (projectSlug?: string) =>
      projectSlug
        ? `projects/project/${projectSlug}` as const
        : 'projects' as const,

    /** Pages view (full-width library grid, or one page's embedded render) */
    pages: (pageSlug?: string) =>
      pageSlug
        ? `pages/page/${pageSlug}` as const
        : 'pages' as const,

    /** Embedded browser instance view (browser navigator) */
    browser: (instanceId: string) =>
      `browser/instance/${encodeURIComponent(instanceId)}` as const,

    /** Kanban board view. Optional sessionId opens that session's board card (`board/session/{id}`). */
    board: (sessionId?: string) =>
      sessionId ? `board/session/${sessionId}` as const : 'board' as const,

    /** Dense table collection view (sessions navigator, table view mode, all sessions) */
    table: () => 'table' as const,

    /** Year heatmap collection view (sessions navigator, heatmap view mode, all sessions) */
    heatmap: () => 'heatmap' as const,

    // ----------------------------------------------------------------
    // Unified shell surface routes (W1 scaffolding, spec S-02 §3.5/§3.6).
    // These parse back through route-parser; rendering degrades to the
    // nearest existing view until their hosts land (W2/W5).
    // ----------------------------------------------------------------

    /**
     * Workbench Home Front Page — `home`.
     */
    home: () => 'home' as const,

    /**
     * Connection Fabric surface (CF-6) — `connections`.
     * Native Workbench page: Services / Credentials / Imports / Policies / Audit.
     */
    connections: () => 'connections' as const,

    /**
     * Knowledge home (knowledge navigator root, no document focused) — `knowledge`.
     * Pairs with the bare-'knowledge' key in `parseNavigationState` (W1).
     */
    knowledge: () => 'knowledge' as const,

    /**
     * Saved knowledge view (P5) — `knowledge/view/{viewId}`.
     * KnowledgeHome reads the viewId and runs viewRun.
     */
    knowledgeView: (viewId: string) =>
      `knowledge/view/${encodeURIComponent(viewId)}` as const,

    /**
     * Knowledge surface (SiYuan ref) — `knowledge/{kind}/{id}`.
     * Serves both SurfaceTab kinds `knowledge` and `database` (kind:'database').
     */
    siyuan: (ref: { kind: KnowledgeRefKind; id: string }) =>
      `knowledge/${ref.kind}/${encodeURIComponent(ref.id)}` as const,

    /** Cloud run surface — `cloud-run/{runId}` */
    cloudRun: (runId: string) =>
      `cloud-run/${encodeURIComponent(runId)}` as const,

    /** Extension sandbox view — `extension/{extensionId}/{viewId}` */
    extension: (extensionId: string, viewId: string) =>
      `extension/${encodeURIComponent(extensionId)}/${encodeURIComponent(viewId)}` as const,

    /** Write-proposal diff surface — `diff/{proposalId}` (spec K-05 contour) */
    proposal: (proposalId: string) =>
      `diff/${encodeURIComponent(proposalId)}` as const,

    /** Extra workbench screen («Ещё»: Досье, Радар…) — `{screen}[/item/{itemId}]` */
    screen: (screen: ExtraScreenId, itemId?: string) => buildExtraScreenRoute(screen, itemId),

    /** Local terminal surface — `terminal/{terminalId}` */
    terminal: (terminalId: string) =>
      `terminal/${encodeURIComponent(terminalId)}` as const,

    // ----------------------------------------------------------------
    // Kind-first entity routes (W1-01). Built through the shared
    // `@rox/core/entities` `entityRoute` so the parser round-trips exactly.
    // ----------------------------------------------------------------

    /** Docs file surface — `docs/file/{id}` */
    entityFile: (id: string) => entityRoute({ kind: 'file', id }),
    /** Docs folder — `docs/folder/{id}` */
    entityFolder: (id: string) => entityRoute({ kind: 'folder', id }),
    /** Docs file link — `docs/link/{id}` (drive-link) */
    entityDriveLink: (id: string) => entityRoute({ kind: 'drive-link', id }),
    /** Wiki space — `docs/wiki/{id}[/{fragment}]` */
    entityWikiSpace: (id: string, fragment?: string) =>
      entityRoute({ kind: 'wiki-space', id, ...(fragment ? { fragment } : {}) }),

    /** Messenger channel — `messenger/{id}` */
    entityChannel: (id: string) => entityRoute({ kind: 'channel', id }),
    /** Messenger channel message — `messenger/{id}?seq={seq}` */
    entityChannelMessage: (channelId: string, seq: string) =>
      entityRoute({ kind: 'channel-message', id: channelId, fragment: seq }),

    /** Calendar event — `calendar/event/{id}` */
    entityCalendarEvent: (id: string) => entityRoute({ kind: 'calendar-event', id }),
    /** Calendar reminder — `calendar/reminder/{id}` */
    entityReminder: (id: string) => entityRoute({ kind: 'reminder', id }),
    /** Calendar — `calendar/cal/{id}` */
    entityCalendar: (id: string) => entityRoute({ kind: 'calendar', id }),
    /** Meeting room — `calendar/room/{id}` */
    entityRoom: (id: string) => entityRoute({ kind: 'room', id }),

    /** Goal — `goals/goal/{id}` */
    entityGoal: (id: string) => entityRoute({ kind: 'goal', id }),
    /** Goal key result — `goals/goal/{id}#t-{fragment}` */
    entityGoalTarget: (goalId: string, target: string) =>
      entityRoute({ kind: 'goal-target', id: goalId, fragment: target }),
    /** Goal check — `goals/goal/{id}#k-{fragment}` */
    entityGoalCheck: (goalId: string, check: string) =>
      entityRoute({ kind: 'goal-check', id: goalId, fragment: check }),
    /** Goal check-in — `goals/check-in/{id}` */
    entityCheckIn: (id: string) => entityRoute({ kind: 'check-in', id }),
    /** Goal review — `goals/review/{id}` */
    entityReview: (id: string) => entityRoute({ kind: 'review', id }),
    /** OKR cycle — `goals/okrs?cycle={id}` */
    entityOkrCycle: (id: string) => entityRoute({ kind: 'okr-cycle', id }),
    /** Goal space — `goals/space/{id}` */
    entitySpace: (id: string) => entityRoute({ kind: 'space', id }),
    /** KPI inside a space — `goals/space/{id}/kpis[/{fragment}]` */
    entityKpi: (spaceId: string, fragment?: string) =>
      entityRoute({ kind: 'kpi', id: spaceId, ...(fragment ? { fragment } : {}) }),
    /** KPI entry — `goals/kpis/{id}` */
    entityKpiEntry: (id: string) => entityRoute({ kind: 'kpi-entry', id }),
    /** Project template — `goals/templates/{id}` */
    entityProjectTemplate: (id: string) => entityRoute({ kind: 'project-template', id }),

    /** CRM company — `contacts/company/{id}` */
    entityCompany: (id: string) => entityRoute({ kind: 'crm-company', id }),
    /** Person — `contacts/person/{id}` */
    entityPerson: (id: string) => entityRoute({ kind: 'person', id }),
    /** Department — `contacts/department/{id}` */
    entityDepartment: (id: string) => entityRoute({ kind: 'department', id }),
    /** Invitation — `contacts/invitations/{id}` */
    entityInvitation: (id: string) => entityRoute({ kind: 'invitation', id }),

    /** Workflow — `workflows/{id}` */
    entityWorkflow: (id: string) => entityRoute({ kind: 'workflow', id }),
    /** Workflow run — `workflows/run/{id}` */
    entityWorkflowRun: (id: string) => entityRoute({ kind: 'workflow-run', id }),

    /** Base — `base/{id}` */
    entityBase: (id: string) => entityRoute({ kind: 'base', id }),
    /** Base table — `base/{id}/{table}` */
    entityBaseTable: (id: string, table: string) =>
      entityRoute({ kind: 'base-table', id, fragment: table }),
    /** Base view — `base/{id}/{table}/{view}` */
    entityBaseView: (id: string, table: string, view: string) =>
      entityRoute({ kind: 'base-view', id, fragment: `${table}/${view}` }),
    /** Base record — `base/{id}/{table}/{view}?record={record}` */
    entityBaseRecord: (id: string, table: string, view: string, record: string) =>
      entityRoute({ kind: 'base-record', id, fragment: `${table}/${view}/${record}` }),

    /** Form — `forms/{id}` */
    entityForm: (id: string) => entityRoute({ kind: 'form', id }),
    /** Comment — `comments/{id}` */
    entityComment: (id: string) => entityRoute({ kind: 'comment', id }),

    /** Task list — `tasks/list/{id}` */
    entityTaskList: (id: string) => entityRoute({ kind: 'task-list', id }),
    /** Task list section — `tasks/list/{id}?section={fragment}` */
    entityTaskSection: (listId: string, section: string) =>
      entityRoute({ kind: 'task-section', id: listId, fragment: section }),
    /** Task list group — `tasks/group/{id}` */
    entityTaskListGroup: (id: string) => entityRoute({ kind: 'task-list-group', id }),

    /** Project milestone — `projects/milestone/{id}` */
    entityMilestone: (id: string) => entityRoute({ kind: 'milestone', id }),

    /** License component — `settings/licences/{id}` */
    entityLicenseComponent: (id: string) => entityRoute({ kind: 'license-component', id }),

    /** Installed app — `home/apps/{id}` */
    entityApp: (id: string) => entityRoute({ kind: 'app', id }),
  },
} as const

/**
 * Type representing any valid route string
 */
export type ActionRoute = ReturnType<(typeof routes.action)[keyof typeof routes.action]>
export type ViewRoute = ReturnType<(typeof routes.view)[keyof typeof routes.view]>
export type Route = ActionRoute | ViewRoute
