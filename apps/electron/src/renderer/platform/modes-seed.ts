/**
 * Core Mode Bar seed (ADR-0001). Renderer-only: routes and nav predicates
 * live next to APP_NAV_DESTINATIONS. Unavailable modes keep `rootRoute: null`.
 *
 * Mode screens carry a `flag` (workbench.mode.<id>.v1): resolveSeededModes()
 * nulls their rootRoute while the flag is off — that is the capability gate
 * behind `requiredCapabilities`.
 */
import { WORKBENCH_FLAG, type ModeContribution } from '@rox/core/platform'
import { kindDescriptor, type ModuleId } from '@rox/core/entities'
import { routes } from '../../shared/routes'
import type { UnifiedSurfaceId } from '../../shared/surface-routes'
import {
  isHomeNavigation,
  isKnowledgeNavigation,
  isMeetingsNavigation,
  isInboxNavigation,
  isFeedNavigation,
  isNotesNavigation,
  isSessionsNavigation,
  isTasksNavigation,
  isSurfaceNavigation,
  type NavigationState,
} from '../../shared/types'
import type { ModeScreenFlags, ModeScreenId } from '../atoms/mode-flags'

export interface SeededMode {
  contribution: ModeContribution
  isActive: (navState: NavigationState) => boolean
  /** Mode-screen flag; when off the mode renders disabled (rootRoute null). */
  flag?: ModeScreenId
}

export const CORE_MODES: readonly SeededMode[] = [
  {
    contribution: {
      id: 'home',
      titleKey: 'workbench.mode.home',
      icon: 'Home',
      rootRoute: routes.view.home(),
      order: 10,
      defaultPinned: true,
      layoutProfileId: 'agent',
    },
    isActive: isHomeNavigation,
  },
  {
    contribution: {
      id: 'chat',
      titleKey: 'workbench.mode.chat',
      icon: 'MessageSquare',
      rootRoute: routes.view.allSessions(),
      order: 20,
      defaultPinned: true,
      layoutProfileId: 'agent',
    },
    isActive: isSessionsNavigation,
  },
  {
    contribution: {
      id: 'meetings',
      titleKey: 'workbench.mode.meetings',
      icon: 'Calendar',
      // The Встречи page works (rail + deep link); gated only by its
      // workbench.mode.meetings.v1 flag like Задачи.
      rootRoute: routes.view.meetings(),
      order: 30,
      defaultPinned: true,
      layoutProfileId: 'agent',
    },
    isActive: isMeetingsNavigation,
    flag: 'meetings',
  },
  {
    contribution: {
      id: 'tasks',
      titleKey: 'workbench.mode.tasks',
      icon: 'ListTodo',
      rootRoute: routes.view.tasks(),
      order: 40,
      defaultPinned: true,
      layoutProfileId: 'agent',
      // Capability 'tasks.work-items.v1' is the workbench.mode.tasks.v1 flag
      // (resolveSeededModes); no separate capability set is checked.
    },
    isActive: isTasksNavigation,
    flag: 'tasks',
  },
  {
    contribution: {
      // One notes surface: the legacy Knowledge surface (external core) is
      // folded into Rox Notes; its deep links still resolve and highlight here.
      id: 'notes',
      titleKey: 'workbench.mode.notes',
      icon: 'NotebookPen',
      rootRoute: routes.view.notes(),
      order: 50,
      defaultPinned: true,
      layoutProfileId: 'knowledge',
    },
    isActive: (navState) => isNotesNavigation(navState) || isKnowledgeNavigation(navState),
  },
  {
    contribution: {
      id: 'feed',
      titleKey: 'workbench.mode.feed',
      icon: 'Rss',
      rootRoute: routes.view.feed(),
      order: 60,
      defaultPinned: true,
      layoutProfileId: 'research',
      // Capability 'feed.ingest' is the workbench.mode.feed.v1 flag (feed:list aggregator).
    },
    isActive: isFeedNavigation,
    flag: 'feed',
  },
  {
    contribution: {
      id: 'inbox',
      titleKey: 'workbench.mode.inbox',
      icon: 'Inbox',
      rootRoute: routes.view.inbox(),
      order: 70,
      defaultPinned: true,
      layoutProfileId: 'agent',
      // Capability 'notifications.in-app.v1' is the workbench.mode.inbox.v1 flag.
    },
    isActive: isInboxNavigation,
    flag: 'inbox',
  },
]

// ---------------------------------------------------------------------------
// W1-07 (#1504): unified modes (UI-SPEC §3.1). Each carries `when: <flag id>`,
// so `ModeRegistry.list()` drops it unless the caller passes the enabled flags
// as context keys (`flagContextKeys`). With every flag OFF the pill, the ⌘1…7
// slots and every `list()` caller see exactly the baseline seven modes.
// ---------------------------------------------------------------------------

/** Entity-owner modules whose kind-first routes highlight a unified mode. */
const UNIFIED_MODE_OWNERS: Record<UnifiedSurfaceId, readonly ModuleId[]> = {
  messenger: ['messenger'],
  calendar: ['calendar'],
  goals: ['goals', 'spaces', 'kpis'],
  contacts: ['contacts'],
}

function isUnifiedModeActive(surface: UnifiedSurfaceId) {
  return (navState: NavigationState): boolean => {
    if (isSurfaceNavigation(navState)) return navState.surface === surface
    if (navState.navigator !== 'entity') return false
    return UNIFIED_MODE_OWNERS[surface].includes(kindDescriptor(navState.ref.kind).owner)
  }
}

function unifiedMode(
  surface: UnifiedSurfaceId,
  order: number,
  icon: string,
  flag: string,
): SeededMode {
  return {
    contribution: {
      id: surface,
      titleKey: `workbench.mode.${surface}`,
      icon,
      rootRoute: routes.view.surface(surface),
      order,
      defaultPinned: true,
      layoutProfileId: 'agent',
      when: flag,
    },
    isActive: isUnifiedModeActive(surface),
  }
}

export const UNIFIED_MODES: readonly SeededMode[] = [
  unifiedMode('messenger', 25, 'MessagesSquare', WORKBENCH_FLAG.modeMessengerV1),
  unifiedMode('calendar', 35, 'CalendarDays', WORKBENCH_FLAG.modeCalendarV1),
  unifiedMode('goals', 45, 'Target', WORKBENCH_FLAG.modeGoalsV1),
  unifiedMode('contacts', 55, 'Contact', WORKBENCH_FLAG.modeContactsV1),
]

/** Every seeded mode (registered once by `mode-registry-bootstrap.ts`). */
export const SEEDED_MODES: readonly SeededMode[] = [...CORE_MODES, ...UNIFIED_MODES]

/** i18n key of the Notes mode while `docs.shared.v1` is on (PRD §11 #2). */
export const DOCS_RELABEL_TITLE_KEY = 'workbench.mode.docs'

/**
 * Apply mode-screen flags: a flagged mode whose flag is off becomes
 * non-navigable. `shellFlags` (enabled workbench flag ids) additionally
 * relabels Notes → «Документы» while `docs.shared.v1` is on; omitted or
 * empty = baseline labels.
 */
export function resolveSeededModes(
  modes: readonly ModeContribution[],
  flags: Partial<ModeScreenFlags>,
  shellFlags: ReadonlySet<string> = new Set(),
): ModeContribution[] {
  const byId = new Map(SEEDED_MODES.map((mode) => [mode.contribution.id, mode]))
  const docsShared = shellFlags.has(WORKBENCH_FLAG.docsSharedV1)
  return modes.map((mode) => {
    const resolved = docsShared && mode.id === 'notes' ? { ...mode, titleKey: DOCS_RELABEL_TITLE_KEY } : mode
    const flag = byId.get(mode.id)?.flag
    if (!flag || flags[flag] !== false) return resolved
    return { ...resolved, rootRoute: null }
  })
}

/** ⌘/Ctrl 1…7 → the n-th mode of the pill (order-sorted), or null. */
export function modeForSlot(modes: readonly ModeContribution[], slot: number): ModeContribution | null {
  const sorted = [...modes].sort((a, b) => a.order - b.order)
  return sorted[slot - 1] ?? null
}
