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
    titleKey: 'workbench.home.glance.w.rox',
    descriptionKey: 'workbench.home.glance.d.rox',
    icon: 'layout-grid',
    defaultConfig: { widget: 'tasks', size: 'M' },
    fields: [
      {
        key: 'widget',
        kind: 'select',
        labelKey: 'workbench.home.glance.f.roxWidget',
        options: HOME_WIDGET_IDS.filter((id) => id !== 'hero').map((id) => ({ value: id, labelKey: id === 'recentSessions' ? 'workbench.home.recent' : `workbench.home.w.${id}` })),
      },
      {
        key: 'size',
        kind: 'select',
        labelKey: 'workbench.home.glance.f.height',
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
    titleKey: 'workbench.home.glance.w.clock',
    descriptionKey: 'workbench.home.glance.d.clock',
    icon: 'clock',
    defaultConfig: { hourFormat: '24h', showSeconds: false, timezones: [] },
    fields: [
      {
        key: 'hourFormat',
        kind: 'select',
        labelKey: 'workbench.home.glance.f.hourFormat',
        options: [
          { value: '24h', labelKey: 'workbench.home.glance.o.h24' },
          { value: '12h', labelKey: 'workbench.home.glance.o.h12' },
        ],
      },
      { key: 'showSeconds', kind: 'boolean', labelKey: 'workbench.home.glance.f.showSeconds' },
      { key: 'timezones', kind: 'strings', labelKey: 'workbench.home.glance.f.timezones', hintKey: 'workbench.home.glance.h.timezones', placeholder: 'Europe/Moscow' },
    ],
    load: () => import('./widgets/ClockWidget'),
  })

  registerGlanceWidget({
    type: 'todo',
    category: 'essentials',
    titleKey: 'workbench.home.glance.w.todo',
    descriptionKey: 'workbench.home.glance.d.todo',
    icon: 'list-checks',
    defaultConfig: { items: [] },
    fields: [],
    load: () => import('./widgets/TodoWidget'),
  })

  registerGlanceWidget({
    type: 'bookmarks',
    category: 'essentials',
    titleKey: 'workbench.home.glance.w.bookmarks',
    descriptionKey: 'workbench.home.glance.d.bookmarks',
    icon: 'bookmark',
    defaultConfig: { links: [], style: 'list' },
    fields: [
      { key: 'links', kind: 'links', labelKey: 'workbench.home.glance.f.links' },
      {
        key: 'style',
        kind: 'select',
        labelKey: 'workbench.home.glance.f.style',
        options: [
          { value: 'list', labelKey: 'workbench.home.glance.o.list' },
          { value: 'grid', labelKey: 'workbench.home.glance.o.grid' },
        ],
      },
    ],
    load: () => import('./widgets/BookmarksWidget'),
  })

  registerGlanceWidget({
    type: 'iframe',
    category: 'advanced',
    titleKey: 'workbench.home.glance.w.iframe',
    descriptionKey: 'workbench.home.glance.d.iframe',
    icon: 'app-window',
    defaultConfig: { url: '', height: 300 },
    fields: [
      { key: 'url', kind: 'url', labelKey: 'workbench.home.glance.f.url', placeholder: 'https://' },
      { key: 'height', kind: 'number', labelKey: 'workbench.home.glance.f.heightPx', min: 80, max: 1600 },
    ],
    load: () => import('./widgets/IframeWidget'),
  })

  registerGlanceWidget({
    type: 'html',
    category: 'advanced',
    titleKey: 'workbench.home.glance.w.text',
    descriptionKey: 'workbench.home.glance.d.text',
    icon: 'file-text',
    defaultConfig: { text: '' },
    fields: [{ key: 'text', kind: 'textarea', labelKey: 'workbench.home.glance.f.text' }],
    load: () => import('./widgets/TextWidget'),
  })
}
