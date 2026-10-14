import { describe, expect, it } from 'bun:test'
import {
  GLANCE_MAX_GROUP_CHILDREN,
  GLANCE_MAX_HEIGHT,
  GLANCE_MIN_HEIGHT,
  addGroupChild,
  addPage,
  findWidget,
  normalizeGlanceLayout,
  replacePage,
  resizeColumnByDrag,
  shiftGroupChild,
  updateWidgetInstance,
  type GlanceLayout,
} from '../home/glance/model'
import { GLANCE_PRESETS } from '../home/glance/presets'

function base(): GlanceLayout {
  return normalizeGlanceLayout({
    version: 1,
    pages: [
      { id: 'p1', title: 'A', width: 'default', columns: [
        { id: 'c1', size: 'small', widgets: [{ id: 'g', type: 'group', config: {}, children: [{ id: 'k1', type: 'clock', config: {} }, { id: 'k2', type: 'todo', config: {} }] }] },
        { id: 'c2', size: 'full', widgets: [{ id: 'w1', type: 'html', config: {} }] },
      ] },
      { id: 'p2', title: 'B', width: 'default', columns: [{ id: 'c3', size: 'full', widgets: [] }] },
    ],
  })
}

describe('group children', () => {
  it('adds a child with a fresh id and refuses nested groups', () => {
    const l = addGroupChild(base(), 'g', { type: 'bookmarks', config: {}, id: 'k1' })
    const kids = findWidget(l, 'g')!.widget.children!
    expect(kids.map((k) => k.type)).toEqual(['clock', 'todo', 'bookmarks'])
    expect(kids[2]!.id).not.toBe('k1')
    expect(findWidget(addGroupChild(base(), 'g', { type: 'group', config: {} }), 'g')!.widget.children).toHaveLength(2)
  })
  it('caps children', () => {
    let l = base()
    for (let i = 0; i < 20; i++) l = addGroupChild(l, 'g', { type: 'clock', config: {} })
    expect(findWidget(l, 'g')!.widget.children).toHaveLength(GLANCE_MAX_GROUP_CHILDREN)
  })
  it('shifts children and no-ops at the edges', () => {
    const l = shiftGroupChild(base(), 'g', 'k1', 1)
    expect(findWidget(l, 'g')!.widget.children!.map((k) => k.id)).toEqual(['k2', 'k1'])
    const same = base()
    expect(shiftGroupChild(same, 'g', 'k1', -1)).toBe(same)
  })
  it('child settings save through updateWidgetInstance', () => {
    const l = updateWidgetInstance(base(), 'k1', { title: 'Tokyo', config: { timezones: ['Asia/Tokyo'] } })
    expect(findWidget(l, 'k1')!.widget).toMatchObject({ title: 'Tokyo', config: { timezones: ['Asia/Tokyo'] } })
  })
})

describe('widget height', () => {
  it('clamps, persists through normalize and resets', () => {
    let l = updateWidgetInstance(base(), 'w1', { height: 5 })
    expect(findWidget(l, 'w1')!.widget.height).toBe(GLANCE_MIN_HEIGHT)
    l = updateWidgetInstance(l, 'w1', { height: 99999 })
    expect(findWidget(l, 'w1')!.widget.height).toBe(GLANCE_MAX_HEIGHT)
    expect(findWidget(normalizeGlanceLayout(JSON.parse(JSON.stringify(l))), 'w1')!.widget.height).toBe(GLANCE_MAX_HEIGHT)
    l = updateWidgetInstance(l, 'w1', { height: null })
    expect(findWidget(l, 'w1')!.widget.height).toBeUndefined()
  })
})

describe('column drag resize', () => {
  it('snaps by direction past the threshold and honours column rules', () => {
    const l = base()
    expect(resizeColumnByDrag(l, 'p1', 'c1', 20)).toBe(l)
    const wide = resizeColumnByDrag(l, 'p1', 'c1', 120)
    expect(wide.pages[0]!.columns.map((c) => c.size)).toEqual(['full', 'full'])
    // The only full column cannot shrink.
    expect(resizeColumnByDrag(l, 'p1', 'c2', -120)).toBe(l)
    expect(resizeColumnByDrag(wide, 'p1', 'c2', -120).pages[0]!.columns.map((c) => c.size)).toEqual(['full', 'small'])
  })
})

describe('per-page import', () => {
  it('replaces one page in place with fresh ids', () => {
    const l = base()
    const imported = base().pages[1]!
    const next = replacePage(l, 'p1', { ...imported, title: 'Imported' })
    expect(next.pages.map((p) => p.title)).toEqual(['Imported', 'B'])
    expect(new Set(next.pages.map((p) => p.id)).size).toBe(2)
    expect(next.pages[0]!.id).not.toBe('p2')
    expect(replacePage(l, 'nope', imported)).toBe(l)
  })
})

describe('presets', () => {
  it('every preset builds a valid page', () => {
    expect(GLANCE_PRESETS.length).toBeGreaterThanOrEqual(6)
    for (const preset of GLANCE_PRESETS) {
      const l = addPage({ version: 1, pages: [] }, preset.build('x'))
      expect(l.pages).toHaveLength(1)
      const fulls = l.pages[0]!.columns.filter((c) => c.size === 'full').length
      expect(fulls).toBeGreaterThanOrEqual(1)
      expect(fulls).toBeLessThanOrEqual(2)
    }
  })
})
