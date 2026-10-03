/**
 * Главная — composable widget dashboard: the layout model (pure, no React).
 *
 * A layout is an ordered list of widgets, each at most once, with a size
 * S/M/L. Sizes map to grid column spans per container width (see
 * `widgetSpan`), so the dashboard uses the full width at 1280/1440/1728
 * without horizontal overflow. Saved in the existing workspace-scoped JSON
 * store with owner and revision metadata; it is deliberately local, not team-synchronized state.
 */

export const HOME_WIDGET_IDS = [
  'summary',
  'quickActions',
  'recentSessions',
  'agents',
  'inbox',
  'usage',
  'models',
  'balance',
  'tasks',
  'meetings',
  'focus',
  'automations',
  'feed',
  'notes',
  'decisions',
  'radar',
  'taskTracker',
  'inboxTracker',
  'calls',
  'calendar',
] as const

export type HomeWidgetId = (typeof HOME_WIDGET_IDS)[number]
export type HomeWidgetSize = 'S' | 'M' | 'L'
export const HOME_WIDGET_SIZES: readonly HomeWidgetSize[] = ['S', 'M', 'L']

export interface HomeWidgetPlacement {
  id: HomeWidgetId
  size: HomeWidgetSize
}

export interface HomeDashboardLayout {
  version: 2
  widgets: HomeWidgetPlacement[]
}
export interface PersistedHomeLayout extends HomeDashboardLayout {
  ownerId: string
  revision: string
}
/** Picker groups (order = picker order). */
export const HOME_WIDGET_GROUPS: readonly { id: string; widgets: readonly HomeWidgetId[] }[] = [
  { id: 'overview', widgets: ['summary', 'quickActions', 'calendar', 'focus'] },
  { id: 'work', widgets: ['taskTracker', 'tasks', 'inboxTracker', 'inbox', 'decisions', 'notes'] },
  { id: 'meetings', widgets: ['meetings', 'calls'] },
  { id: 'agents', widgets: ['recentSessions', 'agents', 'automations', 'feed', 'radar'] },
  { id: 'spend', widgets: ['usage', 'models', 'balance'] },
]

export const HOME_LAYOUT_NS = 'home-dashboard'

/** Natural size of each widget when it is added from the picker. */
export const HOME_WIDGET_DEFAULT_SIZE: Record<HomeWidgetId, HomeWidgetSize> = {
  summary: 'M',
  quickActions: 'M',
  recentSessions: 'M',
  agents: 'S',
  inbox: 'S',
  usage: 'M',
  models: 'S',
  balance: 'S',
  tasks: 'S',
  meetings: 'S',
  focus: 'S',
  automations: 'S',
  feed: 'M',
  notes: 'S',
  decisions: 'S',
  radar: 'S',
  taskTracker: 'M',
  inboxTracker: 'S',
  calls: 'S',
  calendar: 'L',
}

/**
 * Default: even 12-column rows at desktop widths (S=3, M=6, L=12). Радар stays
 * in the picker — it needs topics set up on its own screen first.
 */
export const DEFAULT_HOME_LAYOUT: HomeDashboardLayout = {
  version: 2,
  widgets: [
    { id: 'summary', size: 'M' },
    { id: 'quickActions', size: 'M' },
    { id: 'calendar', size: 'L' },
    { id: 'taskTracker', size: 'M' },
    { id: 'inboxTracker', size: 'S' },
    { id: 'agents', size: 'S' },
    { id: 'recentSessions', size: 'M' },
    { id: 'meetings', size: 'S' },
    { id: 'calls', size: 'S' },
    { id: 'usage', size: 'M' },
    { id: 'models', size: 'S' },
    { id: 'balance', size: 'S' },
    { id: 'automations', size: 'S' },
    { id: 'tasks', size: 'S' },
    { id: 'inbox', size: 'S' },
    { id: 'focus', size: 'S' },
    { id: 'feed', size: 'M' },
    { id: 'notes', size: 'S' },
    { id: 'decisions', size: 'S' },
  ],
}

/** The v1 default (first release of the dashboard) — used to upgrade untouched layouts. */
const V1_DEFAULT_IDS = 'summary,quickActions,recentSessions,agents,inbox,usage,models,balance,tasks,meetings,focus,automations,feed,notes,decisions'
/** Widgets introduced in v2; appended to customised v1 layouts. */
const V2_NEW_WIDGETS: readonly HomeWidgetId[] = ['calendar', 'taskTracker', 'inboxTracker', 'calls']

export function isHomeWidgetId(value: unknown): value is HomeWidgetId {
  return typeof value === 'string' && (HOME_WIDGET_IDS as readonly string[]).includes(value)
}

function isSize(value: unknown): value is HomeWidgetSize {
  return value === 'S' || value === 'M' || value === 'L'
}

/** Future or structurally corrupt layouts stay read-only until explicitly recovered. */
export function isSupportedHomeLayout(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as { version?: unknown; widgets?: unknown; ownerId?: unknown; revision?: unknown }
  if (value.version !== 1 && value.version !== 2) return false
  if (Object.keys(value).some((key) => !['version', 'widgets', 'ownerId', 'revision'].includes(key))) return false
  if (value.ownerId !== undefined && (typeof value.ownerId !== 'string' || !value.ownerId)) return false
  if (value.revision !== undefined && (typeof value.revision !== 'string' || !value.revision)) return false
  if (!Array.isArray(value.widgets)) return false
  const seen = new Set<string>()
  for (const item of value.widgets) {
    if (!item || typeof item !== 'object') return false
    const placement = item as { id?: unknown; size?: unknown }
    if (Object.keys(placement).some((key) => key !== 'id' && key !== 'size')) return false
    if (!isHomeWidgetId(placement.id) || seen.has(placement.id)) return false
    if (placement.size !== undefined && !isSize(placement.size)) return false
    seen.add(placement.id)
  }
  return true
}
/** Legacy layouts without owner metadata remain readable during migration. */
export function canReadHomeLayout(raw: unknown, ownerId: string): boolean {
  if (!isSupportedHomeLayout(raw)) return false
  const storedOwner = (raw as { ownerId?: unknown } | null)?.ownerId
  return storedOwner === undefined || storedOwner === ownerId
}
/** Attach durable scope/revision metadata without changing the widget schema. */
export function persistHomeLayout(layout: HomeDashboardLayout, ownerId: string, revision: string): PersistedHomeLayout {
  return { ...cloneLayout(layout), ownerId, revision }
}

export function cloneLayout(layout: HomeDashboardLayout): HomeDashboardLayout {
  return { version: 2, widgets: layout.widgets.map((w) => ({ ...w })) }
}

/** Corrupt/unknown payload → default; unknown ids and duplicates are dropped. */
export function normalizeHomeLayout(raw: unknown): HomeDashboardLayout {
  if (!raw || typeof raw !== 'object') return cloneLayout(DEFAULT_HOME_LAYOUT)
  const list = (raw as { widgets?: unknown }).widgets
  if (!Array.isArray(list)) return cloneLayout(DEFAULT_HOME_LAYOUT)
  const seen = new Set<HomeWidgetId>()
  const widgets: HomeWidgetPlacement[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const { id, size } = item as { id?: unknown; size?: unknown }
    if (!isHomeWidgetId(id) || seen.has(id)) continue
    seen.add(id)
    widgets.push({ id, size: isSize(size) ? size : HOME_WIDGET_DEFAULT_SIZE[id] })
  }
  // v1 → v2: an untouched v1 default becomes the richer v2 default; a
  // customised v1 layout keeps the user's arrangement and gains the new widgets.
  if ((raw as { version?: unknown }).version !== 2) {
    if (widgets.map((w) => w.id).join(',') === V1_DEFAULT_IDS) return cloneLayout(DEFAULT_HOME_LAYOUT)
    for (const id of V2_NEW_WIDGETS) {
      if (!seen.has(id)) widgets.push({ id, size: HOME_WIDGET_DEFAULT_SIZE[id] })
    }
  }
  // An explicitly emptied dashboard stays empty (the user removed everything).
  return { version: 2, widgets }
}

export function availableWidgets(layout: HomeDashboardLayout): HomeWidgetId[] {
  const used = new Set(layout.widgets.map((w) => w.id))
  return HOME_WIDGET_IDS.filter((id) => !used.has(id))
}

export function addWidget(layout: HomeDashboardLayout, id: HomeWidgetId, size?: HomeWidgetSize): HomeDashboardLayout {
  if (layout.widgets.some((w) => w.id === id)) return layout
  return { version: 2, widgets: [...layout.widgets, { id, size: size ?? HOME_WIDGET_DEFAULT_SIZE[id] }] }
}

export function removeWidget(layout: HomeDashboardLayout, id: HomeWidgetId): HomeDashboardLayout {
  if (!layout.widgets.some((w) => w.id === id)) return layout
  return { version: 2, widgets: layout.widgets.filter((w) => w.id !== id) }
}

export function resizeWidget(layout: HomeDashboardLayout, id: HomeWidgetId, size: HomeWidgetSize): HomeDashboardLayout {
  return { version: 2, widgets: layout.widgets.map((w) => (w.id === id ? { ...w, size } : w)) }
}

/** Move `activeId` to the position of `overId` (drag-and-drop reorder). */
export function moveWidget(layout: HomeDashboardLayout, activeId: HomeWidgetId, overId: HomeWidgetId): HomeDashboardLayout {
  const from = layout.widgets.findIndex((w) => w.id === activeId)
  const to = layout.widgets.findIndex((w) => w.id === overId)
  if (from < 0 || to < 0 || from === to) return layout
  const widgets = layout.widgets.slice()
  const [moved] = widgets.splice(from, 1)
  widgets.splice(to, 0, moved!)
  return { version: 2, widgets }
}

/** Keyboard reorder: shift by ±1 inside bounds. */
export function shiftWidget(layout: HomeDashboardLayout, id: HomeWidgetId, delta: -1 | 1): HomeDashboardLayout {
  const from = layout.widgets.findIndex((w) => w.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= layout.widgets.length) return layout
  return moveWidget(layout, id, layout.widgets[to]!.id)
}

/** Grid columns for a container width (px). Always 12 so spans stay simple. */
export const HOME_GRID_COLUMNS = 12

/**
 * Column span for a widget size at a container width. Wide (≥1100): S=3,
 * M=6, L=12 (four small widgets per row). Medium (≥760): S=4 is too narrow
 * against M=6, so S=6/M=6/L=12. Narrow: everything full width.
 */
export function widgetSpan(size: HomeWidgetSize, containerWidth: number): number {
  if (containerWidth >= 1100) return size === 'S' ? 3 : size === 'M' ? 6 : 12
  if (containerWidth >= 760) return size === 'L' ? 12 : 6
  return 12
}
