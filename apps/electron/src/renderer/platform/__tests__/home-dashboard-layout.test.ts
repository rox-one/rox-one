import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_HOME_LAYOUT,
  HOME_WIDGET_GROUPS,
  HOME_WIDGET_IDS,
  addWidget,
  availableWidgets,
  moveWidget,
  normalizeHomeLayout,
  removeWidget,
  resizeWidget,
  shiftWidget,
  widgetSpan,
} from '../home/dashboard-layout'

describe('home dashboard layout', () => {
  it('default layout has unique known widgets filling whole 12-column rows at desktop width', () => {
    const ids = DEFAULT_HOME_LAYOUT.widgets.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(HOME_WIDGET_IDS).toContain(id)
    const total = DEFAULT_HOME_LAYOUT.widgets.reduce((sum, w) => sum + widgetSpan(w.size, 1400), 0)
    expect(total % 12).toBe(0)
    expect(ids).toContain('recentSessions')
    expect(ids).toContain('quickActions')
    for (const id of ['taskTracker', 'inboxTracker', 'automations', 'meetings', 'calls', 'calendar'] as const) expect(ids).toContain(id)
  })

  it('normalizes corrupt payloads to the default and drops unknown / duplicate widgets', () => {
    expect(normalizeHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(normalizeHomeLayout({ widgets: 'x' })).toEqual(DEFAULT_HOME_LAYOUT)
    expect(normalizeHomeLayout({ version: 2, widgets: [{ id: 'tasks', size: 'L' }, { id: 'tasks', size: 'S' }, { id: 'nope', size: 'S' }, { id: 'feed', size: 'XL' }] })).toEqual({
      version: 2,
      widgets: [{ id: 'tasks', size: 'L' }, { id: 'feed', size: 'M' }],
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
})
