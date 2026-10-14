/**
 * Ready-made Glance pages. Titles are i18n keys resolved at insert time.
 */
import type { GlancePage } from './model'

export interface GlancePreset {
  id: string
  titleKey: string
  build: (title: string) => Omit<GlancePage, 'id'>
}

export const GLANCE_PRESETS: readonly GlancePreset[] = [
  {
    id: 'blank',
    titleKey: 'glance.preset.blank',
    build: (title) => ({ title, width: 'default', columns: [{ id: 'c1', size: 'small', widgets: [] }, { id: 'c2', size: 'full', widgets: [] }, { id: 'c3', size: 'small', widgets: [] }] }),
  },
  {
    id: 'workday',
    titleKey: 'glance.preset.workday',
    build: (title) => ({
      title,
      width: 'default',
      columns: [
        {
          id: 'c1',
          size: 'small',
          widgets: [
            { id: 'w1', type: 'clock', config: {} },
            { id: 'w2', type: 'rox', config: { widget: 'calendar', size: 'L' } },
          ],
        },
        {
          id: 'c2',
          size: 'full',
          widgets: [
            { id: 'w3', type: 'rox', config: { widget: 'taskTracker', size: 'M' } },
            {
              id: 'w4',
              type: 'group',
              config: {},
              children: [
                { id: 'w5', type: 'rox', config: { widget: 'inbox', size: 'M' } },
                { id: 'w6', type: 'rox', config: { widget: 'feed', size: 'M' } },
                { id: 'w7', type: 'rox', config: { widget: 'notes', size: 'M' } },
              ],
            },
          ],
        },
        {
          id: 'c3',
          size: 'small',
          widgets: [
            { id: 'w8', type: 'rox', config: { widget: 'recentSessions', size: 'M' } },
            { id: 'w9', type: 'todo', config: { items: [] } },
          ],
        },
      ],
    }),
  },
  {
    id: 'personal',
    titleKey: 'chrome.section.personal',
    build: (title) => ({
      title,
      width: 'slim',
      columns: [
        { id: 'c1', size: 'small', widgets: [{ id: 'w1', type: 'clock', config: {} }, { id: 'w2', type: 'todo', config: { items: [] } }] },
        { id: 'c2', size: 'full', widgets: [{ id: 'w3', type: 'bookmarks', config: { links: [], style: 'grid' } }, { id: 'w4', type: 'html', config: { text: '' } }] },
      ],
    }),
  },
  {
    id: 'focus',
    titleKey: 'panelWorkspace.presetFocus',
    build: (title) => ({
      title,
      width: 'slim',
      columns: [
        { id: 'c1', size: 'full', widgets: [{ id: 'w1', type: 'rox', config: { widget: 'taskTracker', size: 'L' } }, { id: 'w2', type: 'todo', config: { items: [] } }] },
        { id: 'c2', size: 'small', widgets: [{ id: 'w3', type: 'clock', config: {} }, { id: 'w4', type: 'rox', config: { widget: 'calendar', size: 'M' } }] },
      ],
    }),
  },
  {
    id: 'team',
    titleKey: 'feed.tab.team',
    build: (title) => ({
      title,
      width: 'wide',
      columns: [
        { id: 'c1', size: 'small', widgets: [{ id: 'w1', type: 'rox', config: { widget: 'inbox', size: 'M' } }, { id: 'w2', type: 'rox', config: { widget: 'calendar', size: 'M' } }] },
        { id: 'c2', size: 'full', widgets: [{ id: 'w3', type: 'rox', config: { widget: 'feed', size: 'L' } }] },
        { id: 'c3', size: 'full', widgets: [{ id: 'w4', type: 'rox', config: { widget: 'taskTracker', size: 'M' } }, { id: 'w5', type: 'rox', config: { widget: 'recentSessions', size: 'M' } }] },
      ],
    }),
  },
  {
    id: 'research',
    titleKey: 'label.default.research',
    build: (title) => ({
      title,
      width: 'default',
      columns: [
        { id: 'c1', size: 'small', widgets: [{ id: 'w1', type: 'bookmarks', config: { links: [], style: 'list' } }] },
        {
          id: 'c2',
          size: 'full',
          widgets: [
            { id: 'w2', type: 'group', config: {}, children: [{ id: 'w3', type: 'rox', config: { widget: 'notes', size: 'L' } }, { id: 'w4', type: 'rox', config: { widget: 'feed', size: 'L' } }] },
            { id: 'w5', type: 'html', config: { text: '' } },
          ],
        },
        { id: 'c3', size: 'small', widgets: [{ id: 'w6', type: 'rox', config: { widget: 'recentSessions', size: 'M' } }, { id: 'w7', type: 'todo', config: { items: [] } }] },
      ],
    }),
  },
]
