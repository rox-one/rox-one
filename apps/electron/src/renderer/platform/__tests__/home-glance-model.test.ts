import { describe, expect, it } from 'bun:test'
import {
  EMPTY_GLANCE_LAYOUT,
  GLANCE_MAX_PAGES,
  addColumn,
  addPage,
  addWidgetInstance,
  exportGlance,
  findWidget,
  mergeImportedPages,
  moveWidgetInstance,
  normalizeGlanceLayout,
  parseGlanceImport,
  removeColumn,
  removeWidgetInstance,
  sanitizeConfig,
  setColumnSize,
  shiftWidgetInstance,
  updateWidgetInstance,
  type GlanceLayout,
} from '../home/glance/model'
import { resolveConfig, safeHttpUrl, type GlanceWidgetDef } from '../home/glance/registry'
import { GLANCE_PRESETS } from '../home/glance/presets'
import { parseLinksText } from '../home/glance/GlanceHome'
import { readTodoItems } from '../home/glance/widgets/TodoWidget'

function base(): GlanceLayout {
  return normalizeGlanceLayout({
    version: 1,
    pages: [
      {
        id: 'p1',
        title: 'Main',
        width: 'default',
        columns: [
          { id: 'a', size: 'small', widgets: [{ id: 'w1', type: 'clock', config: {} }, { id: 'w2', type: 'todo', config: {} }] },
          { id: 'b', size: 'full', widgets: [{ id: 'w3', type: 'bookmarks', config: {} }] },
        ],
      },
    ],
  })
}

describe('glance layout model', () => {
  it('normalizes garbage to an empty layout and keeps valid pages', () => {
    expect(normalizeGlanceLayout(null)).toEqual(EMPTY_GLANCE_LAYOUT)
    expect(normalizeGlanceLayout({ version: 2, pages: [] })).toEqual(EMPTY_GLANCE_LAYOUT)
    const l = base()
    expect(l.pages).toHaveLength(1)
    expect(l.pages[0]!.columns.map((c) => c.size)).toEqual(['small', 'full'])
  })

  it('enforces 1..2 full columns and at most 3 columns', () => {
    const l = normalizeGlanceLayout({ version: 1, pages: [{ id: 'p', title: '', columns: [{ size: 'full' }, { size: 'full' }, { size: 'full' }, { size: 'full' }] }] })
    expect(l.pages[0]!.columns).toHaveLength(3)
    expect(l.pages[0]!.columns.map((c) => c.size)).toEqual(['full', 'full', 'small'])
    const none = normalizeGlanceLayout({ version: 1, pages: [{ id: 'p', title: '', columns: [{ size: 'small' }, { size: 'small' }, { size: 'small' }] }] })
    expect(none.pages[0]!.columns.filter((c) => c.size === 'full')).toHaveLength(1)
    const empty = normalizeGlanceLayout({ version: 1, pages: [{ id: 'p', title: '', columns: [] }] })
    expect(empty.pages[0]!.columns).toHaveLength(1)
  })

  it('drops invalid widgets, nested groups and dedupes ids', () => {
    const l = normalizeGlanceLayout({
      version: 1,
      pages: [{ id: 'p', title: '', columns: [{ id: 'c', size: 'full', widgets: [
        { id: 'x', type: 'clock' },
        { id: 'x', type: 'todo' },
        { id: 'bad', type: 'Not A Type' },
        { id: 'g', type: 'group', children: [{ id: 'k', type: 'clock' }, { id: 'g2', type: 'group' }] },
      ] }] }],
    })
    const ws = l.pages[0]!.columns[0]!.widgets
    expect(ws.map((w) => w.type)).toEqual(['clock', 'todo', 'group'])
    expect(new Set(ws.map((w) => w.id)).size).toBe(3)
    expect(ws[2]!.children!.map((k) => k.type)).toEqual(['clock'])
  })

  it('sanitizes config: no prototype keys, no functions, bounded strings', () => {
    const c = sanitizeConfig(JSON.parse('{"__proto__":{"x":1},"a":1,"b":"' + 'z'.repeat(9000) + '","n":null}'))
    expect(Object.keys(c).sort()).toEqual(['a', 'b', 'n'])
    expect((c.b as string).length).toBe(8192)
    expect(sanitizeConfig({ f: () => 1, inf: Infinity } as unknown as Record<string, unknown>)).toEqual({})
  })

  it('adds, moves across columns, shifts and removes widgets', () => {
    let l = base()
    l = addWidgetInstance(l, 'p1', 'b', { type: 'iframe', config: { url: 'https://example.com' } }, 0)
    const iframe = l.pages[0]!.columns[1]!.widgets[0]!
    expect(iframe.type).toBe('iframe')
    l = moveWidgetInstance(l, iframe.id, { pageId: 'p1', columnId: 'a', index: 1 })
    expect(l.pages[0]!.columns[0]!.widgets.map((w) => w.id)).toEqual(['w1', iframe.id, 'w2'])
    l = shiftWidgetInstance(l, iframe.id, -1)
    expect(l.pages[0]!.columns[0]!.widgets[0]!.id).toBe(iframe.id)
    l = shiftWidgetInstance(l, iframe.id, -1)
    expect(l.pages[0]!.columns[0]!.widgets[0]!.id).toBe(iframe.id)
    l = removeWidgetInstance(l, iframe.id)
    expect(findWidget(l, iframe.id)).toBeNull()
  })

  it('updates title/config/collapsed, including group children', () => {
    let l = addWidgetInstance(base(), 'p1', 'b', { type: 'group', config: {}, children: [{ id: 'kid', type: 'clock', config: {} }] })
    l = updateWidgetInstance(l, 'kid', { title: '  Время  ', config: { showSeconds: true } })
    const kid = findWidget(l, 'kid')!
    expect(kid.widget.title).toBe('Время')
    expect(kid.widget.config).toEqual({ showSeconds: true })
    expect(kid.at.groupId).toBeDefined()
    l = updateWidgetInstance(l, 'kid', { title: null, collapsed: true })
    expect(findWidget(l, 'kid')!.widget.title).toBeUndefined()
    expect(findWidget(l, 'kid')!.widget.collapsed).toBe(true)
  })

  it('column ops keep rules and carry widgets over on removal', () => {
    let l = base()
    l = addColumn(l, 'p1', 'full')
    expect(l.pages[0]!.columns).toHaveLength(3)
    expect(l.pages[0]!.columns[2]!.size).toBe('full')
    l = addColumn(l, 'p1')
    expect(l.pages[0]!.columns).toHaveLength(3)
    expect(setColumnSize(l, 'p1', 'a', 'full')).toBe(l)
    const one = removeColumn(removeColumn(l, 'p1', l.pages[0]!.columns[2]!.id), 'p1', 'b')
    expect(one.pages[0]!.columns).toHaveLength(1)
    expect(one.pages[0]!.columns[0]!.size).toBe('full')
    expect(one.pages[0]!.columns[0]!.widgets.map((w) => w.id)).toEqual(['w1', 'w2', 'w3'])
    expect(setColumnSize(one, 'p1', one.pages[0]!.columns[0]!.id, 'small')).toBe(one)
  })

  it('caps pages', () => {
    let l: GlanceLayout = { version: 1, pages: [] }
    for (let i = 0; i < GLANCE_MAX_PAGES + 3; i++) l = addPage(l, { title: `P${i}`, width: 'default', columns: [] })
    expect(l.pages).toHaveLength(GLANCE_MAX_PAGES)
  })

  it('export → import round-trips and re-mints colliding ids', () => {
    const l = base()
    const text = JSON.stringify(exportGlance(l, undefined, 1))
    const parsed = parseGlanceImport(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const merged = mergeImportedPages(l, parsed.pages, 'append')
    expect(merged.pages).toHaveLength(2)
    const ids = merged.pages.flatMap((p) => [p.id, ...p.columns.flatMap((c) => [c.id, ...c.widgets.map((w) => w.id)])])
    expect(new Set(ids).size).toBe(ids.length)
    expect(mergeImportedPages(l, parsed.pages, 'replace').pages).toHaveLength(1)
    expect(parseGlanceImport('{').ok).toBe(false)
    expect(parseGlanceImport('{"kind":"other","version":1,"pages":[]}')).toEqual({ ok: false, reason: 'format' })
    expect(parseGlanceImport('{"kind":"rox.home.glance","version":1,"pages":[]}')).toEqual({ ok: false, reason: 'empty' })
  })

  it('presets build valid pages', () => {
    for (const preset of GLANCE_PRESETS) {
      const l = addPage({ version: 1, pages: [] }, preset.build('X'))
      expect(l.pages).toHaveLength(1)
      expect(l.pages[0]!.columns.length).toBeGreaterThan(0)
    }
  })
})

describe('glance registry config', () => {
  const def: GlanceWidgetDef = {
    type: 't',
    category: 'essentials',
    titleKey: 'x',
    descriptionKey: 'x',
    icon: 'clock',
    defaultConfig: { n: 5, mode: 'a', on: false, list: [], links: [], url: '' },
    fields: [
      { key: 'n', kind: 'number', labelKey: 'x', min: 1, max: 10 },
      { key: 'mode', kind: 'select', labelKey: 'x', options: [{ value: 'a', labelKey: 'x' }, { value: 'b', labelKey: 'x' }] },
      { key: 'on', kind: 'boolean', labelKey: 'x' },
      { key: 'list', kind: 'strings', labelKey: 'x' },
      { key: 'links', kind: 'links', labelKey: 'x' },
      { key: 'url', kind: 'url', labelKey: 'x' },
    ],
    load: async () => ({ default: () => null }),
  }
  it('coerces and clamps values, filters unsafe links', () => {
    const c = resolveConfig(def, { n: 99, mode: 'zzz', on: 'yes', list: [' a ', '', 3], links: [{ url: 'javascript:alert(1)' }, { url: 'https://ex.com/a' }], url: 'file:///etc/passwd' })
    expect(c.n).toBe(10)
    expect(c.mode).toBe('a')
    expect(c.on).toBe(false)
    expect(c.list).toEqual(['a'])
    expect(c.links).toEqual([{ title: 'ex.com', url: 'https://ex.com/a' }])
    expect(c.url).toBe('')
    expect(resolveConfig(def, {}).n).toBe(5)
  })
  it('safeHttpUrl only allows http(s)', () => {
    expect(safeHttpUrl('https://a.b/')).toBe('https://a.b/')
    expect(safeHttpUrl('javascript:1')).toBeNull()
    expect(safeHttpUrl('data:text/html,x')).toBeNull()
    expect(safeHttpUrl(42)).toBeNull()
  })
  it('parses link text and to-do items', () => {
    expect(parseLinksText('Rox | https://rox.one\nhttps://x.y\n\n')).toEqual([{ title: 'Rox', url: 'https://rox.one' }, { title: '', url: 'https://x.y' }])
    expect(readTodoItems([{ id: 'a', text: 'x', done: 1 }, { text: 'no id' }, null])).toEqual([{ id: 'a', text: 'x', done: false }])
  })
})
