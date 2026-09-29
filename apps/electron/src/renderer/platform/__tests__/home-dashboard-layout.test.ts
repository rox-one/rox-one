import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_HOME_LAYOUT,
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
  })

  it('normalizes corrupt payloads to the default and drops unknown / duplicate widgets', () => {
    expect(normalizeHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(normalizeHomeLayout({ widgets: 'x' })).toEqual(DEFAULT_HOME_LAYOUT)
    expect(normalizeHomeLayout({ widgets: [{ id: 'tasks', size: 'L' }, { id: 'tasks', size: 'S' }, { id: 'nope', size: 'S' }, { id: 'feed', size: 'XL' }] })).toEqual({
      version: 1,
      widgets: [{ id: 'tasks', size: 'L' }, { id: 'feed', size: 'M' }],
    })
    // an emptied dashboard stays empty
    expect(normalizeHomeLayout({ widgets: [] }).widgets).toEqual([])
  })

  it('adds, removes, resizes and reorders without duplicates', () => {
    let layout = normalizeHomeLayout({ widgets: [{ id: 'tasks', size: 'S' }, { id: 'feed', size: 'M' }] })
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
