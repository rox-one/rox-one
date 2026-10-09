/**
 * TabsCore — the shared tab primitive. ARIA/anatomy is proven on static markup,
 * keyboard/middle-click/focus behaviour on a real mounted strip (happy-dom).
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Tabs, type TabItem, type TabsProps } from '../tabs'

useDomForFile()

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
  renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, React.createElement(Tabs, props)))

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
    expect(html.match(/tabindex="0"/g)).toHaveLength(2) // active tab + its close button
    expect(html).toContain('tabindex="-1"')
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

// --- mounted behaviour: every case drives the real strip, no source text ---

let roots: Root[] = []
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount() })
  roots = []
  resetDom()
})

async function mount(props: TabsProps): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<I18nextProvider i18n={i18n}><Tabs {...props} /></I18nextProvider>) })
  return container
}

const tab = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)!

const press = (element: Element, key: string) => act(async () => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
})

describe('TabsCore keyboard and pointer behaviour', () => {
  it('moves focus and selection with arrows, Home and End, wrapping across the ends', async () => {
    // catches: ArrowLeft/ArrowRight/Home/End handling or tabNavigationTarget wrap-around loss.
    const selected: string[] = []
    const container = await mount({
      items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      activeId: 'a',
      onSelect: (id) => selected.push(id),
    })
    const a = tab(container, 'a'), b = tab(container, 'b'), c = tab(container, 'c')

    a.focus()
    await press(a, 'ArrowRight')
    expect(document.activeElement).toBe(b)
    expect(selected).toEqual(['b'])

    await press(b, 'End')
    expect(document.activeElement).toBe(c)
    expect(selected).toEqual(['b', 'c'])

    await press(c, 'ArrowRight')
    expect(document.activeElement).toBe(a) // wraps forward past the last tab

    await press(a, 'ArrowLeft')
    expect(document.activeElement).toBe(c) // wraps backward past the first tab

    await press(c, 'Home')
    expect(document.activeElement).toBe(a)
  })

  it('gives the single Tab stop to the active tab only', async () => {
    // catches: roving tabindex regression where every tab (or none) becomes a Tab stop.
    const container = await mount({
      items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      activeId: 'b',
      onSelect() {},
    })
    expect(tab(container, 'a').tabIndex).toBe(-1)
    expect(tab(container, 'b').tabIndex).toBe(0)
    expect(tab(container, 'c').tabIndex).toBe(-1)
  })

  it('selects the focused tab on both Enter and Space', async () => {
    // catches: Enter/Space activation removal from onItemKeyDown.
    const selected: string[] = []
    const container = await mount({
      items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      activeId: 'a',
      onSelect: (id) => selected.push(id),
    })
    const b = tab(container, 'b')
    b.focus()
    await press(b, 'Enter')
    await press(b, ' ')
    expect(selected).toEqual(['b', 'b'])
  })

  it('closes a closable tab on Delete and on Backspace and focuses the surviving neighbour', async () => {
    // catches: Delete/Backspace close handling or tabCloseTarget focus restoration loss.
    const deleted: string[] = []
    const first = await mount({
      items: [
        { id: 'a', label: 'A', closable: true },
        { id: 'b', label: 'B', closable: true },
        { id: 'c', label: 'C', closable: true },
      ],
      activeId: 'a',
      onSelect() {},
      onClose: (id) => deleted.push(id),
    })
    const a = tab(first, 'a')
    a.focus()
    await press(a, 'Delete')
    expect(deleted).toEqual(['a'])
    expect(document.activeElement).toBe(tab(first, 'b')) // active close keeps its neighbour

    const second = await mount({
      items: [
        { id: 'a', label: 'A', closable: true },
        { id: 'b', label: 'B', closable: true },
        { id: 'c', label: 'C', closable: true },
      ],
      activeId: 'b',
      onSelect() {},
      onClose: (id) => deleted.push(id),
    })
    const b = tab(second, 'b')
    b.focus()
    await press(b, 'Backspace')
    expect(deleted).toEqual(['a', 'b'])
    expect(document.activeElement).toBe(tab(second, 'c'))
  })

  it('closes a closable tab on a middle-click (auxclick button 1)', async () => {
    // catches: onAuxClick middle-button close removal from the closable item wrapper.
    const deleted: string[] = []
    const container = await mount({
      items: [{ id: 'a', label: 'A', closable: true }, { id: 'b', label: 'B', closable: true }],
      activeId: 'a',
      onSelect() {},
      onClose: (id) => deleted.push(id),
    })
    const wrapper = container.querySelector<HTMLElement>('[data-tab-item="b"]')!
    await act(async () => {
      wrapper.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))
    })
    expect(deleted).toEqual(['b'])
  })

  it('leaves arrow keys inert when keyboard is disabled', async () => {
    // catches: keyboard={false} no longer suppressing arrow navigation.
    const selected: string[] = []
    const container = await mount({
      items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      activeId: 'a',
      keyboard: false,
      onSelect: (id) => selected.push(id),
    })
    const a = tab(container, 'a')
    a.focus()
    await press(a, 'ArrowRight')
    expect(document.activeElement).toBe(a)
    expect(selected).toEqual([])
    // without roving every tab is its own Tab stop so the strip stays reachable
    expect(tab(container, 'a').tabIndex).toBe(0)
    expect(tab(container, 'b').tabIndex).toBe(0)
  })

  it('skips disabled items in navigation and refuses to select them', async () => {
    // catches: disabled tabs counting as navigation targets or firing onSelect.
    const selected: string[] = []
    const container = await mount({
      items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', disabled: true }, { id: 'c', label: 'C' }],
      activeId: 'a',
      onSelect: (id) => selected.push(id),
    })
    const a = tab(container, 'a'), b = tab(container, 'b'), c = tab(container, 'c')
    a.focus()
    await press(a, 'ArrowRight')
    expect(document.activeElement).toBe(c) // jumps over the disabled tab
    expect(selected).toEqual(['c'])

    await act(async () => { b.click() })
    expect(selected).toEqual(['c']) // a disabled tab never activates
  })

  it('links a tab to its panel with aria-controls when controls is set', async () => {
    // catches: dropping the item.controls -> aria-controls mapping in renderTabButton.
    const container = await mount({
      items: [{ id: 'a', label: 'A', controls: 'panel-a' }, { id: 'b', label: 'B' }],
      activeId: 'a',
      onSelect() {},
    })
    expect(tab(container, 'a').getAttribute('aria-controls')).toBe('panel-a')
    expect(tab(container, 'b').getAttribute('aria-controls')).toBeNull()
  })
})