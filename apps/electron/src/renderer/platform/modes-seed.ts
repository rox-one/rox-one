/**
 * Core Mode Bar seed (ADR-0001). Renderer-only: routes and nav predicates
 * live next to APP_NAV_DESTINATIONS. Unavailable modes keep `rootRoute: null`.
 */
import type { ModeContribution } from '@craft-agent/core/platform'
import { routes } from '../../shared/routes'
import {
  isHomeNavigation,
  isKnowledgeNavigation,
  isMeetingsNavigation,
  isNotesNavigation,
  isSessionsNavigation,
  isTasksNavigation,
  type NavigationState,
} from '../../shared/types'

export interface SeededMode {
  contribution: ModeContribution
  isActive: (navState: NavigationState) => boolean
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
      rootRoute: routes.view.meetings(),
      order: 30,
      defaultPinned: true,
      layoutProfileId: 'agent',
    },
    isActive: isMeetingsNavigation,
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
    },
    isActive: isTasksNavigation,
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
      rootRoute: null,
      order: 70,
      defaultPinned: true,
      layoutProfileId: 'agent',
      requiredCapabilities: ['notifications.in-app.v1'],
    },
    isActive: () => false,
  },
]
