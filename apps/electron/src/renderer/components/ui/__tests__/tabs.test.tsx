import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Tabs, tabCloseTarget, type TabItem, type TabsProps } from '../tabs'

let i18n: I18n
beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    resources: { en: { translation: { 'common.close': 'Close' } } },
  })
})

const render = (props: TabsProps) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(Tabs, props)))

const items: TabItem[] = [
  { id: 'a', label: 'Alpha', title: 'Alpha', controls: 'panel-a', closable: true },
  { id: 'b', label: 'Beta', title: 'Beta', closable: true, disabled: true },
  { id: 'c', label: 'Gamma', title: 'Gamma', closable: true },
]

describe('TabsCore ARIA and roving tabindex', () => {
  it('renders one tablist with tab children, selection and controls', () => {
    const html = render({ items, activeId: 'a', ariaLabel: 'Panels', closeLabel: 'Close tab', onSelect() {} })
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Panels"')
    expect(html).toContain('aria-orientation="horizontal"')
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-controls="panel-a"')
    expect(html.match(/aria-selected="false"/g)).toHaveLength(2)
  })

  it('keeps a single Tab stop on the active/enabled item', () => {
    const html = render({ items, activeId: 'a', onSelect() {}, onClose() {} })
    expect(html.match(/tabindex="0"/g)).toHaveLength(1) // the active tab owns the only Tab stop
    expect(html).toContain('tabindex="-1"')
  })

  it('close-target skips disabled neighbours and keeps the roving stop', () => {
    const strip = [{ id: 'a' }, { id: 'b', disabled: true }, { id: 'c' }]
    // Closing the active tab prefers the next enabled neighbour, not the disabled one.
    expect(tabCloseTarget(strip, 'a', 'a')).toBe('c')
    // Closing a background tab leaves the active roving stop alone.
    expect(tabCloseTarget(strip, 'c', 'a')).toBe('a')
    expect(tabCloseTarget([{ id: 'a' }, { id: 'b', disabled: true }], 'a', 'a')).toBeNull()
  })

  it('marks disabled tabs and keeps them out of the roving stop', () => {
    const html = render({ items, activeId: 'b', onSelect() {} })
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('disabled=""')
    // activeId points at the disabled tab, so the first enabled tab owns the stop
    expect(html).toContain('data-tab="a"')
  })

  it('renders a labelled close button per closable tab and a middle-click surface', () => {
    const html = render({ items, activeId: 'a', closeLabel: 'Close tab', onSelect() {}, onClose() {} })
    expect(html).toContain('aria-label="Close tab: Alpha"')
    expect(html).toContain('aria-label="Close tab: Gamma"')
    expect(html).toContain('data-tab-item="a"')
    expect(html).toContain('icon-status')
  })

  it('keeps the segmented profile semantic and adds the collapse label class', () => {
    const html = render({
      items: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
      activeId: 'a',
      variant: 'segmented',
      collapseLabels: true,
      onSelect() {},
    })
    expect(html).toContain('role="tablist"')
    expect(html).toContain('rox-view-switch-item')
    expect(html).toContain('rox-view-switch-label')
    expect(html).toContain('aria-selected="true"')
  })
})

const source = readFileSync(join(import.meta.dir, '../tabs.tsx'), 'utf8')

describe('TabsCore source contract', () => {
  it('owns the keyboard: arrows, Home/End, Enter/Space, Delete/Backspace', () => {
    expect(source).toContain("ArrowLeft: true")
    expect(source).toContain("ArrowRight: true")
    expect(source).toContain("ArrowUp: true")
    expect(source).toContain("ArrowDown: true")
    expect(source).toContain('tabNavigationTarget')
    expect(source).toContain("key === 'Enter'")
    expect(source).toContain("key === ' '")
    expect(source).toContain("key === 'Delete'")
    expect(source).toContain("key === 'Backspace'")
    expect(source).toContain('onKeyDown')
  })

  it('owns middle-click close and roving focus restoration', () => {
    expect(source).toContain('onAuxClick')
    expect(source).toContain('event.button === 1')
    expect(source).toContain('tabCloseTarget')
    expect(source).toContain('tabRovingId')
    expect(source).toContain('scrollIntoView')
  })

  it('uses tokens for sizes and never a literal strokeWidth', () => {
    expect(source).toContain('--control-sm')
    expect(source).toContain('--control-md')
    expect(source).toContain('--icon-inline')
    expect(source).toContain('--radius-control')
    expect(source).not.toContain('strokeWidth')
  })

  it('exposes the frozen interface fields', () => {
    for (const field of ['label', 'icon?', 'badge?', 'closable?', 'disabled?', 'title?']) {
      expect(source).toContain(field)
    }
    expect(source).toContain("variant?: TabsVariant")
    expect(source).toContain("'surface' | 'segmented' | 'browser'")
    expect(source).toContain("density?: TabsDensity")
    expect(source).toContain("overflow?: 'scroll' | 'menu'")
    expect(source).toContain('onSelect(id: string): void')
    expect(source).toContain('onClose?(id: string): void')
  })
})