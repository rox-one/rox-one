/**
 * Glance-style Home pages — the layout model (pure, no React).
 *
 * Clean-room design (no code from glanceapp/glance, which is AGPL-3.0): a Home
 * has extra *pages* next to the built-in «Обзор» dashboard. A page holds 1–3
 * *columns*; each column is `small` (fixed narrow track) or `full` (flexible),
 * with at most two `full` columns and at least one. A column holds an ordered
 * list of *widget instances*. An instance has a registry `type`, an optional
 * custom title and a per-instance `config` object, so the same widget type can
 * appear many times with different settings. A `group` instance holds child
 * instances shown as tabs inside one card.
 */

export const GLANCE_LAYOUT_VERSION = 1 as const
export const GLANCE_NS = 'home-glance'
export const GLANCE_MAX_PAGES = 12
export const GLANCE_MAX_COLUMNS = 3
export const GLANCE_MAX_FULL_COLUMNS = 2
export const GLANCE_MAX_WIDGETS_PER_COLUMN = 24

export type GlanceColumnSize = 'small' | 'full'
export type GlancePageWidth = 'default' | 'wide' | 'slim'
export type GlanceConfig = Record<string, unknown>

export interface GlanceWidgetInstance {
  id: string
  type: string
  title?: string
  /** Collapsed cards show only their header. */
  collapsed?: boolean
  config: GlanceConfig
  /** Only for `type === 'group'`. */
  children?: GlanceWidgetInstance[]
}

export interface GlanceColumn {
  id: string
  size: GlanceColumnSize
  widgets: GlanceWidgetInstance[]
}

export interface GlancePage {
  id: string
  title: string
  width: GlancePageWidth
  columns: GlanceColumn[]
}

export interface GlanceLayout {
  version: typeof GLANCE_LAYOUT_VERSION
  pages: GlancePage[]
}

export interface GlanceExport extends GlanceLayout {
  kind: 'rox.home.glance'
  exportedAt: number
}

export const EMPTY_GLANCE_LAYOUT: GlanceLayout = { version: GLANCE_LAYOUT_VERSION, pages: [] }

let counter = 0
export function glanceId(prefix: string): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/
const TYPE_RE = /^[a-z][a-zA-Z0-9-]{0,40}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** JSON-safe, bounded copy of a config object (drops functions, cycles, huge blobs). */
export function sanitizeConfig(value: unknown, depth = 0): GlanceConfig {
  if (!isRecord(value) || depth > 4) return {}
  const out: GlanceConfig = {}
  let n = 0
  for (const [key, v] of Object.entries(value)) {
    if (++n > 64 || key.length > 64 || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const clean = sanitizeValue(v, depth + 1)
    if (clean !== undefined) out[key] = clean
  }
  return out
}

function sanitizeValue(v: unknown, depth: number): unknown {
  if (v === null || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') return v.length > 8192 ? v.slice(0, 8192) : v
  if (Array.isArray(v)) {
    if (depth > 4) return undefined
    return v.slice(0, 200).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined)
  }
  if (isRecord(v)) return sanitizeConfig(v, depth)
  return undefined
}

function normalizeWidget(raw: unknown, seen: Set<string>, allowGroup: boolean): GlanceWidgetInstance | null {
  if (!isRecord(raw) || typeof raw.type !== 'string' || !TYPE_RE.test(raw.type)) return null
  if (raw.type === 'group' && !allowGroup) return null
  let id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : glanceId('w')
  if (seen.has(id)) id = glanceId('w')
  seen.add(id)
  const widget: GlanceWidgetInstance = { id, type: raw.type, config: sanitizeConfig(raw.config) }
  if (typeof raw.title === 'string' && raw.title.trim()) widget.title = raw.title.trim().slice(0, 120)
  if (raw.collapsed === true) widget.collapsed = true
  if (raw.type === 'group') {
    const kids = Array.isArray(raw.children) ? raw.children : []
    widget.children = kids.map((k) => normalizeWidget(k, seen, false)).filter((k): k is GlanceWidgetInstance => k !== null).slice(0, 12)
  }
  return widget
}

function normalizeColumns(raw: unknown, seen: Set<string>): GlanceColumn[] {
  const list = Array.isArray(raw) ? raw : []
  const columns: GlanceColumn[] = []
  for (const c of list.slice(0, GLANCE_MAX_COLUMNS)) {
    if (!isRecord(c)) continue
    let id = typeof c.id === 'string' && ID_RE.test(c.id) ? c.id : glanceId('c')
    if (seen.has(id)) id = glanceId('c')
    seen.add(id)
    const size: GlanceColumnSize = c.size === 'small' ? 'small' : 'full'
    const widgets = (Array.isArray(c.widgets) ? c.widgets : [])
      .map((w) => normalizeWidget(w, seen, true))
      .filter((w): w is GlanceWidgetInstance => w !== null)
      .slice(0, GLANCE_MAX_WIDGETS_PER_COLUMN)
    columns.push({ id, size, widgets })
  }
  return enforceColumnRules(columns)
}

/** At least one and at most two `full` columns; demote extras to `small`. */
export function enforceColumnRules(columns: GlanceColumn[]): GlanceColumn[] {
  if (columns.length === 0) return [{ id: glanceId('c'), size: 'full', widgets: [] }]
  let full = 0
  const next = columns.map((c) => {
    if (c.size !== 'full') return c
    full += 1
    return full > GLANCE_MAX_FULL_COLUMNS ? { ...c, size: 'small' as const } : c
  })
  if (full === 0) {
    const mid = Math.floor((next.length - 1) / 2)
    next[mid] = { ...next[mid]!, size: 'full' }
  }
  return next
}

export function normalizeGlanceLayout(raw: unknown): GlanceLayout {
  if (!isRecord(raw) || raw.version !== GLANCE_LAYOUT_VERSION || !Array.isArray(raw.pages)) return cloneGlance(EMPTY_GLANCE_LAYOUT)
  const seen = new Set<string>()
  const pages: GlancePage[] = []
  for (const p of raw.pages.slice(0, GLANCE_MAX_PAGES)) {
    if (!isRecord(p)) continue
    let id = typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : glanceId('p')
    if (seen.has(id)) id = glanceId('p')
    seen.add(id)
    const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 60) : ''
    const width: GlancePageWidth = p.width === 'wide' || p.width === 'slim' ? p.width : 'default'
    pages.push({ id, title, width, columns: normalizeColumns(p.columns, seen) })
  }
  return { version: GLANCE_LAYOUT_VERSION, pages }
}

export function cloneGlance<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// ---------------------------------------------------------------------------
// Page operations
// ---------------------------------------------------------------------------

export function addPage(layout: GlanceLayout, page: Omit<GlancePage, 'id'> & { id?: string }): GlanceLayout {
  if (layout.pages.length >= GLANCE_MAX_PAGES) return layout
  const fresh = normalizeGlanceLayout({ version: GLANCE_LAYOUT_VERSION, pages: [{ ...cloneGlance(page), id: page.id ?? glanceId('p') }] }).pages[0]
  if (!fresh) return layout
  const ids = collectIds(layout)
  return { ...layout, pages: [...layout.pages, reId(fresh, ids)] }
}

export function removePage(layout: GlanceLayout, pageId: string): GlanceLayout {
  return { ...layout, pages: layout.pages.filter((p) => p.id !== pageId) }
}

export function updatePage(layout: GlanceLayout, pageId: string, patch: Partial<Pick<GlancePage, 'title' | 'width'>>): GlanceLayout {
  return mapPage(layout, pageId, (p) => ({
    ...p,
    title: patch.title !== undefined ? patch.title.trim().slice(0, 60) : p.title,
    width: patch.width ?? p.width,
  }))
}

export function movePage(layout: GlanceLayout, pageId: string, delta: -1 | 1): GlanceLayout {
  const from = layout.pages.findIndex((p) => p.id === pageId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= layout.pages.length) return layout
  const pages = [...layout.pages]
  const [page] = pages.splice(from, 1)
  pages.splice(to, 0, page!)
  return { ...layout, pages }
}

// ---------------------------------------------------------------------------
// Column operations
// ---------------------------------------------------------------------------

export function addColumn(layout: GlanceLayout, pageId: string, size: GlanceColumnSize = 'small'): GlanceLayout {
  return mapPage(layout, pageId, (p) => {
    if (p.columns.length >= GLANCE_MAX_COLUMNS) return p
    const fulls = p.columns.filter((c) => c.size === 'full').length
    const actual: GlanceColumnSize = size === 'full' && fulls >= GLANCE_MAX_FULL_COLUMNS ? 'small' : size
    return { ...p, columns: [...p.columns, { id: glanceId('c'), size: actual, widgets: [] }] }
  })
}

/** Removing a column moves its widgets into the neighbouring column. */
export function removeColumn(layout: GlanceLayout, pageId: string, columnId: string): GlanceLayout {
  return mapPage(layout, pageId, (p) => {
    const index = p.columns.findIndex((c) => c.id === columnId)
    if (index < 0 || p.columns.length <= 1) return p
    const removed = p.columns[index]!
    const columns = p.columns.filter((c) => c.id !== columnId)
    const target = Math.max(0, index - 1)
    columns[target] = { ...columns[target]!, widgets: [...columns[target]!.widgets, ...removed.widgets].slice(0, GLANCE_MAX_WIDGETS_PER_COLUMN) }
    return { ...p, columns: enforceColumnRules(columns) }
  })
}

export function setColumnSize(layout: GlanceLayout, pageId: string, columnId: string, size: GlanceColumnSize): GlanceLayout {
  return mapPage(layout, pageId, (p) => {
    const current = p.columns.find((c) => c.id === columnId)
    if (!current || current.size === size) return p
    const fulls = p.columns.filter((c) => c.size === 'full').length
    if (size === 'full' && fulls >= GLANCE_MAX_FULL_COLUMNS) return p
    if (size === 'small' && fulls <= 1) return p
    return { ...p, columns: p.columns.map((c) => (c.id === columnId ? { ...c, size } : c)) }
  })
}

export function moveColumn(layout: GlanceLayout, pageId: string, columnId: string, delta: -1 | 1): GlanceLayout {
  return mapPage(layout, pageId, (p) => {
    const from = p.columns.findIndex((c) => c.id === columnId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= p.columns.length) return p
    const columns = [...p.columns]
    const [col] = columns.splice(from, 1)
    columns.splice(to, 0, col!)
    return { ...p, columns }
  })
}

// ---------------------------------------------------------------------------
// Widget operations
// ---------------------------------------------------------------------------

export interface WidgetLocation {
  pageId: string
  columnId: string
  index: number
  /** Set when the widget is a child inside a group. */
  groupId?: string
}

export function findWidget(layout: GlanceLayout, widgetId: string): { widget: GlanceWidgetInstance; at: WidgetLocation } | null {
  for (const page of layout.pages) {
    for (const column of page.columns) {
      for (let i = 0; i < column.widgets.length; i++) {
        const w = column.widgets[i]!
        if (w.id === widgetId) return { widget: w, at: { pageId: page.id, columnId: column.id, index: i } }
        const kids = w.children ?? []
        for (let j = 0; j < kids.length; j++) {
          if (kids[j]!.id === widgetId) return { widget: kids[j]!, at: { pageId: page.id, columnId: column.id, index: j, groupId: w.id } }
        }
      }
    }
  }
  return null
}

export function addWidgetInstance(
  layout: GlanceLayout,
  pageId: string,
  columnId: string,
  widget: Omit<GlanceWidgetInstance, 'id'> & { id?: string },
  index?: number,
): GlanceLayout {
  const ids = collectIds(layout)
  const seen = new Set(ids)
  const fresh = normalizeWidget({ ...cloneGlance(widget), id: widget.id && !ids.has(widget.id) ? widget.id : glanceId('w') }, seen, true)
  if (!fresh) return layout
  return mapColumn(layout, pageId, columnId, (c) => {
    if (c.widgets.length >= GLANCE_MAX_WIDGETS_PER_COLUMN) return c
    const widgets = [...c.widgets]
    widgets.splice(index === undefined ? widgets.length : clamp(index, 0, widgets.length), 0, fresh)
    return { ...c, widgets }
  })
}

export function removeWidgetInstance(layout: GlanceLayout, widgetId: string): GlanceLayout {
  return mapAllColumns(layout, (c) => ({
    ...c,
    widgets: c.widgets
      .filter((w) => w.id !== widgetId)
      .map((w) => (w.children ? { ...w, children: w.children.filter((k) => k.id !== widgetId) } : w)),
  }))
}

export function updateWidgetInstance(
  layout: GlanceLayout,
  widgetId: string,
  patch: { title?: string | null; config?: GlanceConfig; collapsed?: boolean },
): GlanceLayout {
  const apply = (w: GlanceWidgetInstance): GlanceWidgetInstance => {
    if (w.id !== widgetId) return w.children ? { ...w, children: w.children.map(apply) } : w
    const next: GlanceWidgetInstance = { ...w }
    if (patch.title === null || (typeof patch.title === 'string' && !patch.title.trim())) delete next.title
    else if (typeof patch.title === 'string') next.title = patch.title.trim().slice(0, 120)
    if (patch.config) next.config = sanitizeConfig(patch.config)
    if (patch.collapsed !== undefined) {
      if (patch.collapsed) next.collapsed = true
      else delete next.collapsed
    }
    return next
  }
  return mapAllColumns(layout, (c) => ({ ...c, widgets: c.widgets.map(apply) }))
}

/**
 * Move a top-level widget to `toColumnId` at `toIndex` (index in the target
 * list after removal). Works across columns of the same page and across pages.
 */
export function moveWidgetInstance(layout: GlanceLayout, widgetId: string, to: { pageId: string; columnId: string; index: number }): GlanceLayout {
  const found = findWidget(layout, widgetId)
  if (!found || found.at.groupId) return layout
  const targetPage = layout.pages.find((p) => p.id === to.pageId)
  const targetColumn = targetPage?.columns.find((c) => c.id === to.columnId)
  if (!targetColumn) return layout
  const sameColumn = found.at.columnId === to.columnId
  if (!sameColumn && targetColumn.widgets.length >= GLANCE_MAX_WIDGETS_PER_COLUMN) return layout
  const without = mapAllColumns(layout, (c) => (c.id === found.at.columnId ? { ...c, widgets: c.widgets.filter((w) => w.id !== widgetId) } : c))
  return mapColumn(without, to.pageId, to.columnId, (c) => {
    const widgets = [...c.widgets]
    widgets.splice(clamp(to.index, 0, widgets.length), 0, found.widget)
    return { ...c, widgets }
  })
}

/** Shift a widget by one slot inside its column (keyboard reorder). */
export function shiftWidgetInstance(layout: GlanceLayout, widgetId: string, delta: -1 | 1): GlanceLayout {
  const found = findWidget(layout, widgetId)
  if (!found || found.at.groupId) return layout
  return moveWidgetInstance(layout, widgetId, { pageId: found.at.pageId, columnId: found.at.columnId, index: found.at.index + delta })
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export function exportGlance(layout: GlanceLayout, pageIds?: readonly string[], now = Date.now()): GlanceExport {
  const pages = pageIds ? layout.pages.filter((p) => pageIds.includes(p.id)) : layout.pages
  return { kind: 'rox.home.glance', version: GLANCE_LAYOUT_VERSION, exportedAt: now, pages: cloneGlance(pages) }
}

export type GlanceImportResult = { ok: true; pages: GlancePage[] } | { ok: false; reason: 'json' | 'format' | 'empty' }

/** Parse exported JSON; ids are re-minted on merge so imports never collide. */
export function parseGlanceImport(text: string): GlanceImportResult {
  if (text.length > 2_000_000) return { ok: false, reason: 'format' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'json' }
  }
  if (!isRecord(raw) || raw.kind !== 'rox.home.glance' || raw.version !== GLANCE_LAYOUT_VERSION) return { ok: false, reason: 'format' }
  const layout = normalizeGlanceLayout({ version: GLANCE_LAYOUT_VERSION, pages: raw.pages })
  if (layout.pages.length === 0) return { ok: false, reason: 'empty' }
  return { ok: true, pages: layout.pages }
}

export function mergeImportedPages(layout: GlanceLayout, pages: readonly GlancePage[], mode: 'append' | 'replace'): GlanceLayout {
  const base = mode === 'replace' ? cloneGlance(EMPTY_GLANCE_LAYOUT) : layout
  const ids = collectIds(base)
  const room = GLANCE_MAX_PAGES - base.pages.length
  return { ...base, pages: [...base.pages, ...pages.slice(0, Math.max(0, room)).map((p) => reId(cloneGlance(p), ids))] }
}

// ---------------------------------------------------------------------------
// Persistence record
// ---------------------------------------------------------------------------

export interface PersistedGlanceLayout extends GlanceLayout {
  ownerId: string
  revision: string
}

export function persistGlance(layout: GlanceLayout, ownerId: string, revision: string): PersistedGlanceLayout {
  return { ...cloneGlance(layout), ownerId, revision }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)))
}

function collectIds(layout: GlanceLayout): Set<string> {
  const ids = new Set<string>()
  for (const p of layout.pages) {
    ids.add(p.id)
    for (const c of p.columns) {
      ids.add(c.id)
      for (const w of c.widgets) {
        ids.add(w.id)
        for (const k of w.children ?? []) ids.add(k.id)
      }
    }
  }
  return ids
}

function reId(page: GlancePage, taken: Set<string>): GlancePage {
  const mint = (prefix: string, id: string) => {
    const next = taken.has(id) ? glanceId(prefix) : id
    taken.add(next)
    return next
  }
  const widget = (w: GlanceWidgetInstance): GlanceWidgetInstance => ({
    ...w,
    id: mint('w', w.id),
    ...(w.children ? { children: w.children.map(widget) } : {}),
  })
  return {
    ...page,
    id: mint('p', page.id),
    columns: page.columns.map((c) => ({ ...c, id: mint('c', c.id), widgets: c.widgets.map(widget) })),
  }
}

/** Returns the same layout object when nothing changed (cheap no-op detection). */
function mapPage(layout: GlanceLayout, pageId: string, fn: (p: GlancePage) => GlancePage): GlanceLayout {
  let changed = false
  const pages = layout.pages.map((p) => {
    if (p.id !== pageId) return p
    const next = fn(p)
    if (next !== p) changed = true
    return next
  })
  return changed ? { ...layout, pages } : layout
}

function mapColumn(layout: GlanceLayout, pageId: string, columnId: string, fn: (c: GlanceColumn) => GlanceColumn): GlanceLayout {
  return mapPage(layout, pageId, (p) => ({ ...p, columns: p.columns.map((c) => (c.id === columnId ? fn(c) : c)) }))
}

function mapAllColumns(layout: GlanceLayout, fn: (c: GlanceColumn) => GlanceColumn): GlanceLayout {
  return { ...layout, pages: layout.pages.map((p) => ({ ...p, columns: p.columns.map(fn) })) }
}
