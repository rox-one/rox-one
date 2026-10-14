/**
 * Primary navigation registry — WP5 (#1580).
 *
 * ONE ordered list drives both left-navigation renderers:
 * - the legacy sidebar (`ShellSidebarNav` → `LeftSidebar`): expanded = labelled
 *   rows, collapsed = the icon rail;
 * - the workbench `ActivityRail` (two-key rollout): the same entries, same
 *   order, same flag gating.
 *
 * Order (unified spec): Inbox, Messenger (chat/sessions), Docs (notes), Base,
 * Calendar, Tasks, Wiki, Goals & Projects — then the «Ещё» group.
 *
 * Gating:
 * - `shellFlag`: the entry exists only while that workbench flag is enabled
 *   (`enabledShellFlagsAtom`); Messenger / Calendar / Goals and the
 *   Developers / Playbooks masters keep their existing flags.
 * - `route: null` without an `action`: the surface has no root screen yet
 *   (Base, Wiki), so the entry never renders even with its flag on — nothing
 *   dead shows up.
 * - `hiddenWhenShellFlag`: an older alias that the flagged surface replaces
 *   (Встречи → Календарь surface).
 * - `demotedWhenShellFlag`: moves to «Ещё» while the flag is on (Projects
 *   gives the primary slot to «Цели и проекты»).
 * - `modeFlag`: a built mode screen whose flag is off stays visible but
 *   disabled with a tooltip in the rail (prior rail behaviour); the legacy
 *   sidebar keeps it navigable as before.
 *
 * WP6: the ⌘1…7 slots follow the pill's slot list (`pillSlotSurfaces`) —
 * Главная leads the pill but is not numbered. Nothing here changes routes, deep links, the old mode-pill slot data
 * (`modes-seed.ts` order) or persisted rail preferences.
 */
import { Target, type LucideIcon } from 'lucide-react'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import type { ModeScreenId, ModeScreenFlags } from '../../atoms/mode-flags'
import { GLYPHS } from '../../platform/glyphs'
import { SEEDED_MODES } from '../../platform/modes-seed'
import { routes, type ViewRoute } from '../../../shared/routes'
import {
  isAutomationsNavigation,
  isBrowserNavigation,
  isClipboardHistoryNavigation,
  isConnectionsNavigation,
  isDevelopersNavigation,
  isDriveNavigation,
  isKnowledgeNavigation,
  isMissionsNavigation,
  isLearningNavigation,
  isMemoryNavigation,
  isPagesNavigation,
  isPlaybooksNavigation,
  isCookbooksNavigation,
  isProjectsNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isSourcesNavigation,
  type NavigationState,
} from '../../../shared/types'
import type { RoutePageName } from './route-pages'
import { notesTitleKey } from '../../platform/surface-shell'
import { FIXED_NAV_IDS, HOME_NAV_ID, type NavPlacement, type NavPlacements } from './nav-placement'

export type PrimaryNavGroup = 'primary' | 'more'

export interface PrimaryNavEntry {
  id: string
  /** Legacy sidebar link id (AppShell `sidebarLinks`); reused when present. */
  linkId: string
  group: PrimaryNavGroup
  labelKey: string
  icon: LucideIcon
  /** Root route; null = no root screen (hidden unless `action`). */
  route: (() => ViewRoute) | null
  action?: 'open-browser'
  isActive: (navState: NavigationState) => boolean
  shellFlag?: string
  hiddenWhenShellFlag?: string
  demotedWhenShellFlag?: string
  modeFlag?: ModeScreenId
  /** Lazy route chunk to prefetch on hover/focus. */
  preload?: RoutePageName
  /** Footer entry (settings): the rail renders it in its footer, not in «Ещё». */
  footer?: boolean
  /** Seeded mode id when the surface is a registry mode (pill highlight, ⌘-slots). */
  modeId?: string
  /** The workbench rail renders this surface through its own group (no duplicate row). */
  railOwned?: boolean
}

/** Not registered as workbench flags yet: always off until those surfaces ship. */
export const BASE_SURFACE_FLAG = 'tables.base.v1'
export const WIKI_SURFACE_FLAG = 'docs.wiki.v1'

const seeded = (id: string) => {
  const mode = SEEDED_MODES.find(entry => entry.contribution.id === id)
  if (!mode) throw new Error(`primary-nav: unknown seeded mode ${id}`)
  return mode.isActive
}

export const PRIMARY_NAV: readonly PrimaryNavEntry[] = [
  // --- primary ---
  { id: 'inbox', linkId: 'nav:inbox', group: 'primary', labelKey: 'workbench.mode.inbox', icon: GLYPHS.inbox, route: () => routes.view.inbox(), isActive: seeded('inbox'), modeId: 'inbox', modeFlag: 'inbox', preload: 'inbox' },
  { id: 'sessions', linkId: 'nav:allSessions', group: 'primary', labelKey: 'workbench.mode.chat', icon: GLYPHS.sessions, route: () => routes.view.allSessions(), isActive: seeded('chat'), modeId: 'chat' },
  { id: 'messenger', linkId: 'nav:messenger', group: 'primary', labelKey: 'workbench.mode.messenger', icon: GLYPHS.team, route: () => routes.view.surface('messenger'), isActive: seeded('messenger'), modeId: 'messenger', shellFlag: WORKBENCH_FLAG.modeMessengerV1, preload: 'surfaces' },
  { id: 'docs', linkId: 'nav:notes', group: 'primary', labelKey: 'sidebar.notes', icon: GLYPHS.notes, route: () => routes.view.notes(), isActive: seeded('notes'), modeId: 'notes', preload: 'notes' },
  { id: 'base', linkId: 'nav:base', group: 'primary', labelKey: 'workbench.mode.base', icon: GLYPHS.pages, route: null, isActive: () => false, shellFlag: BASE_SURFACE_FLAG },
  { id: 'calendar', linkId: 'nav:calendar', group: 'primary', labelKey: 'workbench.mode.calendar', icon: GLYPHS.calendar, route: () => routes.view.surface('calendar'), isActive: seeded('calendar'), modeId: 'calendar', shellFlag: WORKBENCH_FLAG.modeCalendarV1, preload: 'surfaces' },
  { id: 'tasks', linkId: 'nav:tasks', group: 'primary', labelKey: 'workbench.mode.tasks', icon: GLYPHS.tasks, route: () => routes.view.tasks(), isActive: seeded('tasks'), modeId: 'tasks', modeFlag: 'tasks', preload: 'tasks' },
  { id: 'wiki', linkId: 'nav:wiki', group: 'primary', labelKey: 'workbench.mode.wiki', icon: GLYPHS.knowledge, route: null, isActive: () => false, shellFlag: WIKI_SURFACE_FLAG },
  { id: 'goals', linkId: 'nav:goals', group: 'primary', labelKey: 'workbench.mode.goals', icon: GLYPHS.goals, route: () => routes.view.surface('goals'), isActive: seeded('goals'), modeId: 'goals', shellFlag: WORKBENCH_FLAG.modeGoalsV1, preload: 'surfaces' },
  { id: 'projects', linkId: 'nav:projects', group: 'primary', labelKey: 'sidebar.projects', icon: GLYPHS.projects, route: () => routes.view.projects(), isActive: isProjectsNavigation, demotedWhenShellFlag: WORKBENCH_FLAG.modeGoalsV1 },
  // --- «Ещё» ---
  { id: 'memory', linkId: 'nav:memory', group: 'more', labelKey: 'sidebar.memory', icon: GLYPHS.memory, route: () => routes.view.memory(), isActive: navState => isMemoryNavigation(navState) && navState.tab !== 'repo' },
  { id: 'memoryRepo', linkId: 'nav:memoryRepo', group: 'more', labelKey: 'sidebar.memoryRepo', icon: GLYPHS.repository, route: () => routes.view.memory('repo'), isActive: navState => isMemoryNavigation(navState) && navState.tab === 'repo' },
  { id: 'learning', linkId: 'nav:learning', group: 'more', labelKey: 'sidebar.learning', icon: GLYPHS.learning, route: () => routes.view.learning(), isActive: isLearningNavigation },
  { id: 'browser', linkId: 'nav:browser', group: 'primary', labelKey: 'surfaceTabs.browser', icon: GLYPHS.browser, route: null, action: 'open-browser', isActive: isBrowserNavigation },
  { id: 'automations', linkId: 'nav:automations', group: 'more', labelKey: 'sidebar.automations', icon: GLYPHS.automations, route: () => routes.view.automations(), isActive: isAutomationsNavigation },
  // W3.2: Встречи = the calendar surface alias; hidden once the Calendar surface owns the primary slot.
  { id: 'meetings', linkId: 'nav:meetings', group: 'primary', labelKey: 'workbench.mode.calendar', icon: GLYPHS.calendar, route: () => routes.view.meetings(), isActive: navState => navState.navigator === 'surface' && navState.surface === 'calendar', hiddenWhenShellFlag: WORKBENCH_FLAG.modeCalendarV1, modeFlag: 'meetings', preload: 'planWorkspace' },
  { id: 'home', linkId: 'nav:home', group: 'primary', labelKey: 'workbench.mode.home', icon: GLYPHS.home, route: () => routes.view.home(), isActive: seeded('home'), modeId: 'home' },
  { id: 'feed', linkId: 'nav:feed', group: 'primary', labelKey: 'workbench.mode.feed', icon: GLYPHS.feed, route: () => routes.view.feed(), isActive: seeded('feed'), modeId: 'feed', modeFlag: 'feed', preload: 'feed' },
  { id: 'pages', linkId: 'nav:pages', group: 'more', labelKey: 'sidebar.pages', icon: GLYPHS.pages, route: () => routes.view.pages(), isActive: isPagesNavigation, preload: 'pagesHome' },
  // WP6: surfaces that had no sidebar entry at all (reachable only by deep link / rail).
  { id: 'knowledge', linkId: 'nav:knowledge', group: 'more', labelKey: 'sidebar.knowledge', icon: GLYPHS.knowledge, route: () => routes.view.knowledge(), isActive: isKnowledgeNavigation },
  { id: 'missions', linkId: 'nav:missions', group: 'more', labelKey: 'missions.rail.title', icon: Target, route: () => routes.view.missions(), isActive: isMissionsNavigation, railOwned: true },
  { id: 'drive', linkId: 'nav:drive', group: 'more', labelKey: 'sidebar.drive', icon: GLYPHS.drive, route: () => routes.view.drive(), isActive: isDriveNavigation },
  { id: 'clipboardHistory', linkId: 'nav:clipboardHistory', group: 'more', labelKey: 'clipboard.title', icon: GLYPHS.clipboard, route: () => routes.view.clipboardHistory(), isActive: isClipboardHistoryNavigation },
  { id: 'sources', linkId: 'nav:sources', group: 'more', labelKey: 'sidebar.sources', icon: GLYPHS.sources, route: () => routes.view.sources(), isActive: isSourcesNavigation, preload: 'integrationsCatalog' },
  { id: 'skills', linkId: 'nav:skills', group: 'more', labelKey: 'sidebar.skills', icon: GLYPHS.skills, route: () => routes.view.skills(), isActive: isSkillsNavigation, preload: 'skillsCatalog' },
  { id: 'connections', linkId: 'nav:connections', group: 'more', labelKey: 'sidebar.connections', icon: GLYPHS.connections, route: () => routes.view.connections(), isActive: isConnectionsNavigation, preload: 'connections' },
  { id: 'developers', linkId: 'nav:developers', group: 'more', labelKey: 'sidebar.developers', icon: GLYPHS.developers, route: () => routes.view.developers(), isActive: isDevelopersNavigation, shellFlag: WORKBENCH_FLAG.devSpaceV1 },
  { id: 'playbooks', linkId: 'nav:playbooks', group: 'more', labelKey: 'sidebar.playbooks', icon: GLYPHS.playbooks, route: () => routes.view.playbooks(), isActive: isPlaybooksNavigation, shellFlag: WORKBENCH_FLAG.playbooksV1 },
  { id: 'cookbooks', linkId: 'nav:cookbooks', group: 'more', labelKey: 'sidebar.cookbooks', icon: GLYPHS.cookbooks, route: () => routes.view.cookbooks(), isActive: isCookbooksNavigation, shellFlag: WORKBENCH_FLAG.cookbooksV1, preload: 'cookbooks' },
  { id: 'settings', linkId: 'nav:settings', group: 'more', labelKey: 'sidebar.settings', icon: GLYPHS.settings, route: () => routes.view.settings(), isActive: isSettingsNavigation, footer: true },
]

export interface ResolvedPrimaryNavEntry extends PrimaryNavEntry {
  /** Docs relabel applied. */
  labelKey: string
  /** Where the sidebar renders it (after flags and the user's placement). */
  group: PrimaryNavGroup
  /** Mode-screen flag off: the rail shows it disabled with a tooltip. */
  disabled: boolean
  /** Effective placement: the user's choice, else the default. */
  placement: NavPlacement
}

export interface PrimaryNavContext {
  shellFlags: ReadonlySet<string>
  modeFlags?: Partial<ModeScreenFlags>
  /** User placements (`nav-placement.ts`); omitted = defaults. */
  placements?: NavPlacements
  /**
   * Registry ids the titlebar pill actually renders (`resolvePillModel`).
   * A pill-placed surface missing from it (scene, flag off, compact window…)
   * falls back to the sidebar's primary list, so nothing is unreachable.
   * Omitted = every pill-placed surface is assumed to be in the pill.
   */
  pillNavIds?: ReadonlySet<string>
}

/** Flag-resolved group before any user choice. */
function defaultGroup(entry: PrimaryNavEntry, shellFlags: ReadonlySet<string>): PrimaryNavGroup {
  return entry.demotedWhenShellFlag && shellFlags.has(entry.demotedWhenShellFlag) ? 'more' : entry.group
}

/**
 * Default placement (exclusive, one surface = one place): the starter pill
 * surfaces — Главная (icon), Лента, Команда (Мессенджер, else Чат), Заметки,
 * Браузер — live in the pills; everything else keeps its registry group.
 */
export function defaultPlacement(entry: PrimaryNavEntry, shellFlags: ReadonlySet<string>): NavPlacement {
  void shellFlags
  return DEFAULT_PILL_NAV_IDS.has(entry.id) ? 'pills' : 'menu'
}

/** Registry ids of the starter pill composition (`DEFAULT_PILL_SURFACES`); Чат joins while Мессенджер is off. */
/**
 * Mark (shell-layout + onboarding polish): Главная (icon) · Лента · Сессии ·
 * Заметки · Браузер · Мессенджер · Задачи. Мессенджер only resolves while its
 * surface flag (`workbench.mode.messenger.v1`) is on; otherwise it is skipped.
 */
export const DEFAULT_PILL_NAV_IDS: ReadonlySet<string> = new Set([HOME_NAV_ID, 'feed', 'sessions', 'docs', 'browser', 'messenger', 'tasks'])

/** Every surface available under the current flags, with its effective placement (Settings list). */
export function resolveNavSurfaces({ shellFlags, modeFlags = {}, placements = {} }: PrimaryNavContext): ResolvedPrimaryNavEntry[] {
  const resolved: ResolvedPrimaryNavEntry[] = []
  for (const entry of PRIMARY_NAV) {
    if (entry.shellFlag && !shellFlags.has(entry.shellFlag)) continue
    if (entry.hiddenWhenShellFlag && shellFlags.has(entry.hiddenWhenShellFlag)) continue
    if (!entry.route && !entry.action) continue
    const placement = FIXED_NAV_IDS.has(entry.id) ? defaultPlacement(entry, shellFlags) : placements[entry.id] ?? defaultPlacement(entry, shellFlags)
    resolved.push({
      ...entry,
      labelKey: entry.id === 'docs' ? notesTitleKey(shellFlags, entry.labelKey) : entry.labelKey,
      // The registry group only sorts the «Все экраны» menu (Навигация / Инструменты).
      group: defaultGroup(entry, shellFlags),
      disabled: entry.modeFlag ? modeFlags[entry.modeFlag] === false : false,
      placement,
    })
  }
  return resolved
}

/**
 * Sidebar v2: the fixed order of the core surfaces in the primary list —
 * Главная, Входящие, Команда/Чат, Лента, Заметки, Задачи, Проекты, Календарь,
 * Браузер. Same order on every page and in the collapsed rail; primary
 * surfaces not listed here follow in registry order.
 */
export const CORE_NAV_ORDER: readonly string[] = [
  HOME_NAV_ID, 'inbox', 'messenger', 'sessions', 'feed', 'docs', 'tasks', 'goals', 'projects', 'calendar', 'meetings', 'browser',
]

function coreRank(id: string): number {
  const index = CORE_NAV_ORDER.indexOf(id)
  return index === -1 ? CORE_NAV_ORDER.length : index
}

/**
 * The sidebar's visible, ordered entries (primary first, then «Ещё»).
 *
 * Sidebar v2: the sidebar is the complete navigation — a surface placed in
 * the top pills ALSO keeps its sidebar row (the pills are a shortcut, not a
 * second home). Before v2 placement was exclusive, so the default pill set
 * (Главная, Лента, Команда, Заметки, Браузер) vanished from the sidebar and
 * the expanded list shrank to Входящие / Задачи / Проекты. Only «Скрыт»
 * removes a surface. `pillNavIds` is accepted for API compatibility.
 */
export function resolvePrimaryNav(context: PrimaryNavContext): ResolvedPrimaryNavEntry[] {
  const visible = resolveNavSurfaces(context).filter(entry => entry.placement !== 'hidden')
  const primary = visible
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.group === 'primary')
    .sort((a, b) => coreRank(a.entry.id) - coreRank(b.entry.id) || a.index - b.index)
    .map(({ entry }) => entry)
  return [...primary, ...visible.filter(e => e.group === 'more')]
}

/** Link ids the registry owns (primary + «Ещё»), whatever the flags. */
export const PRIMARY_NAV_LINK_IDS: ReadonlySet<string> = new Set(PRIMARY_NAV.map(entry => entry.linkId))
