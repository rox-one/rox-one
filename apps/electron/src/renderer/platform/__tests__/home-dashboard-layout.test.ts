import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_HOME_LAYOUT,
  HOME_WIDGET_GROUPS,
  HOME_WIDGET_IDS,
  addWidget,
  availableWidgets,
  canReadHomeLayout,
  moveWidget,
  normalizeHomeLayout,
  removeWidget,
  persistHomeLayout,
  isSupportedHomeLayout,
  resizeWidget,
  shiftWidget,
  widgetSpan,
  widgetRowSpan,
  widgetItemLimit,
  widgetWidth,
  widgetContentLayout,
  HOME_GRID_GAP,
  HOME_GRID_ROW_HEIGHT,
  HOME_WIDGET_ALLOWED_SIZES,
  flatV2DefaultLayout,
  isFlatV2Default,
  normalizeHomeMeta,
  packHomeLayout,
  upgradeFlatDefault,
} from '../home/dashboard-layout'

describe('home dashboard layout', () => {
  it('keeps full-span narrow cards in a readable internal layout', () => {
    const width = 380
    for (const size of ['S', 'M', 'L'] as const) {
      const cardWidth = widgetWidth(widgetSpan(size, width), width)
      expect(cardWidth).toBe(width)
      expect(widgetContentLayout(cardWidth)).toEqual({
        summaryColumns: 2,
        quickActionColumns: 2,
        listColumns: 1,
        splitPanels: false,
        calendarView: 'list',
        trackerColumns: 2,
      })
    }
    const desktopWidth = 1400
    const small = widgetContentLayout(widgetWidth(widgetSpan('S', desktopWidth), desktopWidth))
    expect(small.listColumns).toBe(1)
    expect(small.calendarView).toBe('list')
    const large = widgetContentLayout(widgetWidth(widgetSpan('L', desktopWidth), desktopWidth))
    expect(large.listColumns).toBe(2)
    expect(large.calendarView).toBe('week')
    expect(large.summaryColumns).toBe(6)
  })

  it('accounts for grid gutters when resolving card widths', () => {
    expect(widgetWidth(3, 1200)).toBe(291)
    expect(widgetWidth(6, 1200)).toBe(594)
    expect(widgetWidth(12, 1200)).toBe(1200)
  })

  it('increases height and visible items for each size even on a narrow screen', () => {
    const sizes = ['S', 'M', 'L'] as const
    const heights = sizes.map((size) => widgetRowSpan(size) * HOME_GRID_ROW_HEIGHT + (widgetRowSpan(size) - 1) * HOME_GRID_GAP)
    expect(heights).toEqual([232, 354, 476])
    expect(sizes.map((size) => widgetSpan(size, 500))).toEqual([12, 12, 12])
    expect(sizes.map((size) => widgetItemLimit(size, 4))).toEqual([4, 7, 10])
    expect(widgetItemLimit('L', 4, 2)).toBe(20)
    const saved = normalizeHomeLayout({ version: 2, widgets: [{ id: 'feed', size: 'M' }] })
    expect(widgetRowSpan(saved.widgets[0]!.size)).toBe(3)
  })

  it('default layout has unique known widgets filling whole 12-column rows at desktop width', () => {
    const ids = DEFAULT_HOME_LAYOUT.widgets.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(HOME_WIDGET_IDS).toContain(id)
    // Dense auto-flow on a 12-column grid (row units = widgetRowSpan): the
    // bento default packs without holes except in the final band.
    const cells: boolean[][] = []
    const free = (r: number, c: number, w: number, h: number) => {
      for (let y = r; y < r + h; y += 1) for (let x = c; x < c + w; x += 1) if (cells[y]?.[x]) return false
      return true
    }
    let bottom = 0
    for (const w of DEFAULT_HOME_LAYOUT.widgets) {
      const span = widgetSpan(w.size, 1400)
      const h = widgetRowSpan(w.size)
      let placed = false
      for (let r = 0; !placed; r += 1) {
        for (let c = 0; c + span <= 12 && !placed; c += 1) {
          if (!free(r, c, span, h)) continue
          for (let y = r; y < r + h; y += 1) { cells[y] ??= []; for (let x = c; x < c + span; x += 1) cells[y]![x] = true }
          bottom = Math.max(bottom, r + h)
          placed = true
        }
      }
    }
    const lastBand = bottom - widgetRowSpan(DEFAULT_HOME_LAYOUT.widgets.at(-1)!.size)
    for (let y = 0; y < lastBand; y += 1) for (let x = 0; x < 12; x += 1) expect(cells[y]?.[x] ?? false).toBe(true)
    expect(ids[0]).toBe('hero')
    expect(DEFAULT_HOME_LAYOUT.widgets[0]!.size).toBe('XL')
    expect(ids).toContain('recentSessions')
    expect(ids).toContain('activity')
    for (const id of ['taskTracker', 'inboxTracker', 'automations', 'meetings', 'calls', 'calendar'] as const) expect(ids).toContain(id)
  })

  it('normalizes corrupt payloads to the default and drops unknown / duplicate widgets', () => {
    expect(normalizeHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(normalizeHomeLayout({ widgets: 'x' })).toEqual(DEFAULT_HOME_LAYOUT)
    expect(normalizeHomeLayout({ version: 2, widgets: [{ id: 'tasks', size: 'L' }, { id: 'tasks', size: 'S' }, { id: 'nope', size: 'S' }, { id: 'feed', size: 'XXL' }, { id: 'hero', size: 'XL' }] })).toEqual({
      version: 2,
      widgets: [{ id: 'tasks', size: 'L' }, { id: 'feed', size: 'M' }, { id: 'hero', size: 'XL' }],
    })
    // an emptied dashboard stays empty
    expect(normalizeHomeLayout({ version: 2, widgets: [] }).widgets).toEqual([])
  })

  it('upgrades v1 layouts: untouched default → v2 default, customised → keeps order and gains the new widgets', () => {
    const v1Default = { version: 1, widgets: 'summary,quickActions,recentSessions,agents,inbox,usage,models,balance,tasks,meetings,focus,automations,feed,notes,decisions'.split(',').map((id) => ({ id, size: 'S' })) }
    expect(normalizeHomeLayout(v1Default)).toEqual(DEFAULT_HOME_LAYOUT)
    const custom = normalizeHomeLayout({ version: 1, widgets: [{ id: 'feed', size: 'L' }, { id: 'calls', size: 'M' }] })
    expect(custom.version).toBe(2)
    expect(custom.widgets).toEqual([
      { id: 'feed', size: 'L' },
      { id: 'calls', size: 'M' },
      { id: 'calendar', size: 'L' },
      { id: 'taskTracker', size: 'M' },
      { id: 'inboxTracker', size: 'S' },
    ])
    // a v1 layout the user emptied gains only the new widgets
    expect(normalizeHomeLayout({ version: 1, widgets: [] }).widgets.map((w) => w.id)).toEqual(['calendar', 'taskTracker', 'inboxTracker', 'calls'])
  })

  it('every widget belongs to exactly one picker group', () => {
    const grouped = HOME_WIDGET_GROUPS.flatMap((g) => g.widgets)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual([...HOME_WIDGET_IDS].sort())
  })

  it('keeps future or damaged layouts from being rewritten as the current default', () => {
    expect(isSupportedHomeLayout({ version: 1, widgets: [{ id: 'feed', size: 'L' }] })).toBe(true)
    expect(isSupportedHomeLayout({ version: 2, widgets: [{ id: 'feed', size: 'M' }] })).toBe(true)
    expect(isSupportedHomeLayout({ version: 3, widgets: [] })).toBe(false)
    expect(isSupportedHomeLayout({ version: 2, widgets: [{ id: 'pluginWidget', size: 'M' }] })).toBe(false)
    expect(isSupportedHomeLayout({ version: 2, widgets: 'not-an-array' })).toBe(false)
    expect(isSupportedHomeLayout({ version: 2, widgets: [{ id: 'feed', size: 'M' }, { id: 'feed', size: 'S' }] })).toBe(false)
    expect(isSupportedHomeLayout({ version: 2, widgets: [], serverRevision: 4 })).toBe(false)
    expect(isSupportedHomeLayout({ version: 2, widgets: [{ id: 'feed', size: 'M', sourceIds: ['source-a'] }] })).toBe(false)
    expect(isSupportedHomeLayout(null)).toBe(false)
    expect(canReadHomeLayout({ version: 2, widgets: [], ownerId: 'workspace-a', revision: 'r1' }, 'workspace-a')).toBe(true)
    expect(canReadHomeLayout({ version: 2, widgets: [], ownerId: 'workspace-a', revision: 'r1' }, 'workspace-b')).toBe(false)
  })

  it('adds, removes, resizes and reorders without duplicates', () => {
    let layout = normalizeHomeLayout({ version: 2, widgets: [{ id: 'tasks', size: 'S' }, { id: 'feed', size: 'M' }] })
    expect(availableWidgets(layout)).not.toContain('tasks')
    layout = addWidget(layout, 'radar')
    expect(layout.widgets.map((w) => w.id)).toEqual(['tasks', 'feed', 'radar'])
    expect(addWidget(layout, 'radar')).toBe(layout)
    layout = moveWidget(layout, 'radar', 'tasks')
    expect(layout.widgets.map((w) => w.id)).toEqual(['radar', 'tasks', 'feed'])
    layout = shiftWidget(layout, 'radar', 1)
    expect(layout.widgets.map((w) => w.id)).toEqual(['tasks', 'radar', 'feed'])
    expect(shiftWidget(layout, 'tasks', -1)).toBe(layout)
    layout = resizeWidget(layout, 'feed', 'L')
    expect(layout.widgets.find((w) => w.id === 'feed')?.size).toBe('L')
    layout = removeWidget(layout, 'radar')
    expect(layout.widgets.map((w) => w.id)).toEqual(['tasks', 'feed'])
  })
  it('restores saved order and widget density after serialization', () => {
    const saved = { version: 2, widgets: [{ id: 'calendar', size: 'L' }, { id: 'feed', size: 'S' }] }
    expect(normalizeHomeLayout(JSON.parse(JSON.stringify(saved)))).toEqual({
      version: 2,
      widgets: [{ id: 'calendar', size: 'L' }, { id: 'feed', size: 'S' }],
    })
  })
  it('persists stable owner and revision metadata alongside the chosen widgets', () => {
    expect(persistHomeLayout(
      { version: 2, widgets: [{ id: 'feed', size: 'L' }] },
      'workspace-a',
      'home-layout-rev-1',
    )).toEqual({
      version: 2,
      widgets: [{ id: 'feed', size: 'L' }],
      ownerId: 'workspace-a',
      revision: 'home-layout-rev-1',
    })
  })



  it('spans never exceed the grid and collapse on narrow containers (no horizontal overflow)', () => {
    for (const width of [400, 800, 1000, 1280, 1440, 1728]) {
      for (const size of ['S', 'M', 'L'] as const) {
        const span = widgetSpan(size, width)
        expect(span).toBeGreaterThan(0)
        expect(span).toBeLessThanOrEqual(12)
      }
    }
    expect(widgetSpan('S', 1400)).toBe(3)
    expect(widgetSpan('S', 900)).toBe(6)
    expect(widgetSpan('M', 500)).toBe(12)
  })

  it('upgrades the untouched flat v2 default unless the user kept it, and keeps customised layouts', () => {
    const flat = flatV2DefaultLayout()
    expect(isFlatV2Default(flat)).toBe(true)
    expect(upgradeFlatDefault(flat, normalizeHomeLayout(flat), {})).toEqual({ layout: DEFAULT_HOME_LAYOUT, upgraded: true })
    expect(upgradeFlatDefault(flat, normalizeHomeLayout(flat), { keepFlat: true }).upgraded).toBe(false)
    const moved = { version: 2, widgets: [flat.widgets[1]!, flat.widgets[0]!, ...flat.widgets.slice(2)] }
    expect(isFlatV2Default(moved)).toBe(false)
    const tinted = { version: 2, widgets: flat.widgets.map((w, i) => (i === 0 ? { ...w, appearance: { tint: 'accent' } } : w)) }
    expect(isFlatV2Default(tinted)).toBe(false)
    expect(normalizeHomeMeta({ keepFlat: true, bentoNoticeSeen: 'x', other: 1 })).toEqual({ keepFlat: true })
  })

  it('packs explicitly so data order equals visual order, without holes for the bento default', () => {
    const { layout, cells } = packHomeLayout(DEFAULT_HOME_LAYOUT, 1400)
    const positions = layout.widgets.map((w) => cells.get(w.id)!)
    for (let i = 1; i < positions.length; i += 1) {
      const a = positions[i - 1]!
      const b = positions[i]!
      expect(a.row < b.row || (a.row === b.row && a.col < b.col)).toBe(true)
    }
    expect(cells.get('hero')).toEqual({ col: 0, row: 0, span: 9, rows: 4 })
    expect(cells.get('balance')).toEqual({ col: 9, row: 0, span: 3, rows: 2 })
    expect(cells.get('agents')).toEqual({ col: 9, row: 2, span: 3, rows: 2 })
    // Re-packing the packed order is stable (what the user sees is what is saved).
    expect(packHomeLayout(layout, 1400).layout).toEqual(layout)
    const narrow = packHomeLayout(DEFAULT_HOME_LAYOUT, 500)
    expect(narrow.layout.widgets.map((w) => w.id)).toEqual(DEFAULT_HOME_LAYOUT.widgets.map((w) => w.id))
  })

  it('restricts XL to the hero and wide charts and keeps the hero at least L', () => {
    expect(HOME_WIDGET_ALLOWED_SIZES.hero).toEqual(['L', 'XL'])
    expect(HOME_WIDGET_ALLOWED_SIZES.tasks).not.toContain('XL')
    expect(HOME_WIDGET_ALLOWED_SIZES.activity).toContain('XL')
    expect(resizeWidget(DEFAULT_HOME_LAYOUT, 'hero', 'S')).toBe(DEFAULT_HOME_LAYOUT)
    expect(normalizeHomeLayout({ version: 2, widgets: [{ id: 'tasks', size: 'XL' }, { id: 'hero', size: 'S' }] }).widgets).toEqual([{ id: 'tasks', size: 'S' }, { id: 'hero', size: 'XL' }])
    for (const id of HOME_WIDGET_IDS) expect(HOME_WIDGET_ALLOWED_SIZES[id]).toContain(DEFAULT_HOME_LAYOUT.widgets.find((w) => w.id === id)?.size ?? HOME_WIDGET_ALLOWED_SIZES[id][0]!)
  })

  it('sizes XL as a 9-column hero on wide screens and full width below', () => {
    expect(widgetSpan('XL', 1400)).toBe(9)
    expect(widgetSpan('XL', 900)).toBe(12)
    expect(widgetSpan('XL', 500)).toBe(12)
    expect(widgetRowSpan('XL')).toBe(widgetRowSpan('L'))
    expect(isSupportedHomeLayout({ version: 2, widgets: [{ id: 'hero', size: 'XL' }, { id: 'activity', size: 'M' }] })).toBe(true)
    expect(resizeWidget(DEFAULT_HOME_LAYOUT, 'activity', 'XL').widgets.find((w) => w.id === 'activity')!.size).toBe('XL')
  })
})
