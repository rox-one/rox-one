/**
 * Core Mode Bar seed (ADR-0001). Renderer-only: routes and nav predicates
 * live next to APP_NAV_DESTINATIONS. Unavailable modes keep `rootRoute: null`.
 */
import type { ModeContribution } from '@craft-agent/core/platform'
import { routes } from '../../shared/routes'
import {
  isKnowledgeNavigation,
  isSessionsNavigation,
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
      rootRoute: null,
      order: 10,
      defaultPinned: true,
      layoutProfileId: 'agent',
    },
    isActive: () => false,
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
      rootRoute: null,
      order: 30,
      defaultPinned: true,
      layoutProfileId: 'agent',
      requiredCapabilities: ['meetings.pipeline.v1'],
    },
    isActive: () => false,
  },
  {
    contribution: {
      id: 'tasks',
      titleKey: 'workbench.mode.tasks',
      icon: 'ListTodo',
      rootRoute: null,
      order: 40,
      defaultPinned: true,
      layoutProfileId: 'agent',
      requiredCapabilities: ['tasks.work-items.v1'],
    },
    isActive: () => false,
  },
  {
    contribution: {
      id: 'knowledge',
      titleKey: 'workbench.mode.knowledge',
      icon: 'BookOpen',
      rootRoute: routes.view.knowledge(),
      order: 50,
      defaultPinned: true,
      layoutProfileId: 'knowledge',
    },
    isActive: isKnowledgeNavigation,
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
