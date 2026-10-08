/**
 * App navigation destinations — single source of truth for the top-level
 * navigation entries (spec S-03 §3.2 seed list, W1).
 *
 * Consumers:
 * - `AppShell.tsx` `links[]` — consumes identity meta (`icon`, `labelKey`)
 *   per entry; click handling stays in AppShell (context menus, filters).
 * - `platform/ActivityRail.tsx` — consumes the whole entry: icon, label,
 *   route (via NavigationContext) and active-state predicate.
 *
 * Do NOT duplicate this list per consumer: add a destination here once.
 * SE profile rail styling: see `lib/se-icon-map.ts` (stroke 1.5, active bg-white/6).
 * Wave-gated destinations carry `route: null` + `disabledTooltipKey`; the
 * rail renders them disabled-with-tooltip (spec degradation rule). Knowledge
 * was rail-gated in W1 and navigates since W2 — when the feature flag is off
 * the entry still renders and the surface shows the featureDisabled state.
 * Action-backed entries (`action: 'open-browser'`) carry `route: null` too,
 * but open their existing native surface instead of a route.
 */
import {
  Brain,
  BookOpen,
  Calendar,
  Cable,
  DatabaseZap,
  FolderKanban,
  Globe,
  GraduationCap,
  House,
  ListTodo,
  MessageSquare,
  NotebookPen,
  PanelsTopLeft,
  Settings,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { routes, type ViewRoute } from '../../../shared/routes'
import {
  isAutomationsNavigation,
  isBrowserNavigation,
  isConnectionsNavigation,
  isDiffNavigation,
  isHomeNavigation,
  isKnowledgeNavigation,
  isNotesNavigation,
  isMemoryNavigation,
  isLearningNavigation,
  isTasksNavigation,
  isMeetingsNavigation,
  isPagesNavigation,
  isProjectsNavigation,
  isSessionsNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isSourcesNavigation,
  type NavigationState,
} from '../../../shared/types'

export type AppNavDestinationId =
  | 'sessions'
  | 'notes'
  | 'sources'
  | 'skills'
  | 'memory'
  | 'learning'
  | 'browser'
  | 'tasks'
  | 'meetings'
  | 'projects'
  | 'pages'
  | 'automations'
  | 'connections'
  | 'home'
  | 'knowledge'
  | 'settings'

export interface AppNavDestination {
  /** Stable destination id (rail item id, registry seed id input). */
  id: AppNavDestinationId
  /** Matching `links[]` entry id in AppShell. */
  linkId: string
  icon: LucideIcon
  /** Flat i18n label key (`sidebar.*`). */
  labelKey: string
  /** Service-level label when the existing sidebar label is more specific. */
  railLabelKey?: string
  /** Primary services stay visible; supporting services live in More. */
  railGroup: 'primary' | 'more' | 'footer'
  /** Top-level sidebar sections belonging to this service. */
  contextLinkIds: readonly string[]
  /** View route; action-backed surfaces can use null without being disabled. */
  route: (() => ViewRoute) | null
  /** Browser must reuse the existing native/WebUI opener, not a made-up route. */
  action?: 'open-browser'
  /** Active-state predicate over the focused panel's navigation state. */
  isActive: (navState: NavigationState) => boolean
  /**
   * When set, the destination is wave-gated: the rail renders it disabled
   * with this i18n key as the tooltip (spec S-03 §3.2 degradation).
   */
  disabledTooltipKey?: string
}

/** Primary ordering is stable; supporting services keep their prior identities. */
export const APP_NAV_DESTINATIONS: readonly AppNavDestination[] = [
  {
    id: 'sessions',
    linkId: 'nav:allSessions',
    // MessageSquare = the Mode Bar «Сессии» icon. The Inbox glyph belongs to
    // «Входящие» (routes.view.inbox); using it here made «Сессии» look like
    // the inbox screen.
    icon: MessageSquare,
    labelKey: 'sidebar.allSessions',
    railLabelKey: 'serviceRail.agents',
    railGroup: 'primary',
    contextLinkIds: ['nav:allSessions', 'nav:labels', 'nav:views', 'nav:skills'],
    route: () => routes.view.allSessions(),
    isActive: isSessionsNavigation,
  },
  {
    id: 'notes',
    linkId: 'nav:notes',
    icon: NotebookPen,
    labelKey: 'sidebar.notes',
    railGroup: 'primary',
    contextLinkIds: ['nav:notes'],
    route: () => routes.view.notes(),
    isActive: isNotesNavigation,
  },
  {
    id: 'memory',
    linkId: 'nav:memory',
    icon: Brain,
    labelKey: 'sidebar.memory',
    railGroup: 'primary',
    contextLinkIds: ['nav:memory'],
    route: () => routes.view.memory(),
    isActive: isMemoryNavigation,
  },
  {
    id: 'browser',
    linkId: 'nav:browser',
    icon: Globe,
    labelKey: 'surfaceTabs.browser',
    railGroup: 'primary',
    contextLinkIds: ['nav:browser'],
    route: null,
    action: 'open-browser',
    isActive: isBrowserNavigation,
  },
  {
    id: 'automations',
    linkId: 'nav:automations',
    icon: Workflow, // ListTodo is «Задачи»
    labelKey: 'sidebar.automations',
    railGroup: 'primary',
    contextLinkIds: ['nav:automations'],
    route: () => routes.view.automations(),
    isActive: isAutomationsNavigation,
  },
  {
    id: 'projects',
    linkId: 'nav:projects',
    icon: FolderKanban,
    labelKey: 'sidebar.projects',
    railGroup: 'more',
    contextLinkIds: ['nav:projects'],
    route: () => routes.view.projects(),
    isActive: isProjectsNavigation,
  },
  {
    id: 'pages',
    linkId: 'nav:pages',
    icon: PanelsTopLeft,
    labelKey: 'sidebar.pages',
    railGroup: 'more',
    contextLinkIds: ['nav:pages'],
    route: () => routes.view.pages(),
    isActive: isPagesNavigation,
  },
  {
    id: 'tasks',
    linkId: 'nav:tasks',
    icon: ListTodo, // same glyph as the Mode Bar «Задачи»
    labelKey: 'sidebar.tasks',
    railGroup: 'more',
    contextLinkIds: ['nav:tasks'],
    route: () => routes.view.tasks(),
    isActive: isTasksNavigation,
  },
  {
    id: 'learning',
    linkId: 'nav:learning',
    icon: GraduationCap,
    labelKey: 'sidebar.learning',
    railGroup: 'more',
    contextLinkIds: ['nav:learning'],
    route: () => routes.view.learning(),
    isActive: isLearningNavigation,
  },
  {
    id: 'meetings',
    linkId: 'nav:meetings',
    icon: Calendar,
    labelKey: 'sidebar.meetings',
    railGroup: 'more',
    contextLinkIds: ['nav:meetings'],
    route: () => routes.view.meetings(),
    isActive: isMeetingsNavigation,
  },
  {
    id: 'sources',
    linkId: 'nav:sources',
    icon: DatabaseZap,
    labelKey: 'sidebar.sources',
    railGroup: 'more',
    contextLinkIds: ['nav:sources'],
    route: () => routes.view.sources(),
    isActive: isSourcesNavigation,
  },
  {
    id: 'skills',
    linkId: 'nav:skills',
    icon: Zap,
    labelKey: 'sidebar.skills',
    railGroup: 'more',
    contextLinkIds: ['nav:skills'],
    route: () => routes.view.skills(),
    isActive: isSkillsNavigation,
  },
  {
    id: 'connections',
    linkId: 'nav:connections',
    icon: Cable,
    labelKey: 'sidebar.connections',
    railGroup: 'more',
    contextLinkIds: ['nav:connections'],
    route: () => routes.view.connections(),
    isActive: isConnectionsNavigation,
  },
  {
    id: 'home',
    linkId: 'nav:home',
    icon: House,
    labelKey: 'workbench.mode.home',
    railGroup: 'more',
    contextLinkIds: ['nav:home'],
    route: () => routes.view.home(),
    isActive: isHomeNavigation,
  },
  {
    id: 'knowledge',
    linkId: 'nav:knowledge',
    icon: BookOpen,
    labelKey: 'knowledge.nav.title',
    railGroup: 'more',
    contextLinkIds: ['nav:knowledge'],
    route: () => routes.view.knowledge(),
    isActive: (navState) => isKnowledgeNavigation(navState) || isDiffNavigation(navState),
  },
  {
    id: 'settings',
    linkId: 'nav:settings',
    icon: Settings,
    labelKey: 'sidebar.settings',
    railGroup: 'footer',
    contextLinkIds: ['nav:settings'],
    route: () => routes.view.settings(),
    isActive: isSettingsNavigation,
  },
] as const

/** ROX2-021: sessions collection + chat are native; Conation flags do not hide this rail. */
export const SESSIONS_REQUIRES_CONATION_FLAG = false as const

/** ROX2-022..030: remaining rail destinations stay native without Conation flags. */
export { NATIVE_SURFACE_REQUIRES_CONATION_FLAG } from '../../pages/rox2-native-surfaces'

/** Lookup by destination id for AppShell's hand-written `links[]` entries. */
export const APP_NAV_DESTINATIONS_BY_ID: Record<AppNavDestinationId, AppNavDestination> =
  Object.fromEntries(APP_NAV_DESTINATIONS.map((dest) => [dest.id, dest])) as Record<
    AppNavDestinationId,
    AppNavDestination
  >