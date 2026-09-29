/**
 * Core Mode Bar seed (ADR-0001). Renderer-only: routes and nav predicates
 * live next to APP_NAV_DESTINATIONS. Unavailable modes keep `rootRoute: null`.
 *
 * Mode screens carry a `flag` (workbench.mode.<id>.v1): resolveSeededModes()
 * nulls their rootRoute while the flag is off — that is the capability gate
 * behind `requiredCapabilities`.
 */
import type { ModeContribution } from '@craft-agent/core/platform'
import { routes } from '../../shared/routes'
import {
  isHomeNavigation,
  isKnowledgeNavigation,
  isMeetingsNavigation,
  isInboxNavigation,
  isNotesNavigation,
  isSessionsNavigation,
  isTasksNavigation,
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
      rootRoute: null,
      order: 60,
      defaultPinned: true,
      layoutProfileId: 'research',
      requiredCapabilities: ['feed.ingest'],
    },
    isActive: () => false,
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

/** Apply mode-screen flags: a flagged mode whose flag is off becomes non-navigable. */
export function resolveSeededModes(
  modes: readonly ModeContribution[],
  flags: Partial<ModeScreenFlags>,
): ModeContribution[] {
  const byId = new Map(CORE_MODES.map((mode) => [mode.contribution.id, mode]))
  return modes.map((mode) => {
    const flag = byId.get(mode.id)?.flag
    if (!flag || flags[flag] !== false) return mode
    return { ...mode, rootRoute: null }
  })
}

/** ⌥⌘1…7 → the n-th mode of the pill (order-sorted), or null. */
export function modeForSlot(modes: readonly ModeContribution[], slot: number): ModeContribution | null {
  const sorted = [...modes].sort((a, b) => a.order - b.order)
  return sorted[slot - 1] ?? null
}
