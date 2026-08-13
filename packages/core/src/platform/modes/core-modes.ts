/**
 * Core mode seed (ADR-0001; shell-seam spec T4).
 *
 * Shape lives in platform/; the renderer injects concrete routes and maps
 * `icon` string names to Lucide. Titles are i18n keys, never translated text.
 */

import type { ModeContribution } from './types.ts';

export interface CoreModeRoutes {
  chat: string;
  knowledge: string;
  settings: string;
}

export const CORE_MODE_CHAT_ID = 'core.chat';
export const CORE_MODE_KNOWLEDGE_ID = 'core.knowledge';
export const CORE_MODE_SETTINGS_ID = 'core.settings';

export function createCoreModeContributions(routes: CoreModeRoutes): ModeContribution[] {
  return [
    {
      id: CORE_MODE_CHAT_ID,
      title: 'modes.core.chat.title',
      icon: 'message-square',
      rootRoute: routes.chat,
      order: 20,
      defaultPinned: true,
      layoutProfileId: 'agent',
      source: { type: 'core', id: 'craft' },
    },
    {
      id: CORE_MODE_KNOWLEDGE_ID,
      title: 'modes.core.knowledge.title',
      icon: 'book-open',
      rootRoute: routes.knowledge,
      order: 30,
      defaultPinned: true,
      layoutProfileId: 'knowledge',
      source: { type: 'core', id: 'craft' },
    },
    {
      id: CORE_MODE_SETTINGS_ID,
      title: 'modes.core.settings.title',
      icon: 'settings',
      rootRoute: routes.settings,
      order: 90,
      defaultPinned: true,
      layoutProfileId: 'default',
      source: { type: 'core', id: 'craft' },
    },
  ];
}
