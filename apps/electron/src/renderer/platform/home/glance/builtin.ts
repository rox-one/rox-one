/**
 * Built-in Glance widget registrations (metadata only — bodies load lazily).
 */
import { HOME_WIDGET_IDS } from '../dashboard-layout'
import { registerGlanceWidget } from './registry'

let registered = false

export function registerBuiltinGlanceWidgets(): void {
  if (registered) return
  registered = true

  registerGlanceWidget({
    type: 'rox',
    category: 'rox',
    titleKey: 'glance.w.rox',
    icon: 'layout-grid',
    defaultConfig: { widget: 'tasks', size: 'M' },
    fields: [
      {
        key: 'widget',
        kind: 'select',
        labelKey: 'glance.f.roxWidget',
        options: HOME_WIDGET_IDS.filter((id) => id !== 'hero').map((id) => ({ value: id, labelKey: id === 'recentSessions' ? 'workbench.home.recent' : `workbench.home.w.${id}` })),
      },
      {
        key: 'size',
        kind: 'select',
        labelKey: 'glance.f.height',
        options: [
          { value: 'S', labelKey: 'workbench.home.edit.sizeS' },
          { value: 'M', labelKey: 'workbench.home.edit.sizeM' },
          { value: 'L', labelKey: 'workbench.home.edit.sizeL' },
        ],
      },
    ],
    frameless: true,
    load: () => import('./widgets/RoxWidget'),
  })

  registerGlanceWidget({
    type: 'clock',
    category: 'essentials',
    titleKey: 'glance.w.clock',
    icon: 'clock',
    defaultConfig: { hourFormat: '24h', showSeconds: false, timezones: [] },
    fields: [
      {
        key: 'hourFormat',
        kind: 'select',
        labelKey: 'glance.f.hourFormat',
        options: [
          { value: '24h', labelKey: 'glance.o.h24' },
          { value: '12h', labelKey: 'glance.o.h12' },
        ],
      },
      { key: 'showSeconds', kind: 'boolean', labelKey: 'glance.f.showSeconds' },
      { key: 'timezones', kind: 'strings', labelKey: 'glance.f.timezones', hintKey: 'glance.h.timezones', placeholder: 'Europe/Moscow' },
    ],
    load: () => import('./widgets/ClockWidget'),
  })

  registerGlanceWidget({
    type: 'todo',
    category: 'essentials',
    titleKey: 'glance.w.todo',
    icon: 'list-checks',
    defaultConfig: { items: [] },
    fields: [],
    load: () => import('./widgets/TodoWidget'),
  })

  registerGlanceWidget({
    type: 'bookmarks',
    category: 'essentials',
    titleKey: 'glance.w.bookmarks',
    icon: 'bookmark',
    defaultConfig: { links: [], style: 'list' },
    fields: [
      { key: 'links', kind: 'links', labelKey: 'glance.f.links' },
      {
        key: 'style',
        kind: 'select',
        labelKey: 'glance.f.style',
        options: [
          { value: 'list', labelKey: 'glance.o.list' },
          { value: 'grid', labelKey: 'glance.o.grid' },
        ],
      },
    ],
    load: () => import('./widgets/BookmarksWidget'),
  })

  registerGlanceWidget({
    type: 'iframe',
    category: 'advanced',
    titleKey: 'glance.w.iframe',
    icon: 'app-window',
    defaultConfig: { url: '', height: 300 },
    fields: [
      { key: 'url', kind: 'url', labelKey: 'glance.f.url', placeholder: 'https://' },
      { key: 'height', kind: 'number', labelKey: 'glance.f.heightPx', min: 80, max: 1600 },
    ],
    load: () => import('./widgets/IframeWidget'),
  })

  registerGlanceWidget({
    type: 'html',
    category: 'advanced',
    titleKey: 'glance.w.text',
    icon: 'file-text',
    defaultConfig: { text: '' },
    fields: [{ key: 'text', kind: 'textarea', labelKey: 'glance.f.text' }],
    load: () => import('./widgets/TextWidget'),
  })
}
