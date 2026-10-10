/**
 * ModeScreen Tabs — the mode-screen section strip. Static markup proves the
 * ARIA surface and badges; mounted behaviour proves it delegates keyboard +
 * selection to the shared primitive.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Tabs } from '../ModeScreen'

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

interface ModeTabsProps {
  label: string
  value: string
  onChange: (id: string) => void
  tabs: ReadonlyArray<{ id: string; label: string; count?: number }>
}

const renderTabs = (props: ModeTabsProps) =>
  renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, React.createElement(Tabs<string>, props)))

describe('ModeScreen Tabs renders through the shared tab primitive', () => {
  it('exposes one tablist with ARIA tabs, roving and counter badges', () => {
    const html = renderTabs({
      label: 'Sections',
      value: 'a',
      onChange() {},
      tabs: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta', count: 3 }],
    })
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Sections"')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('numeric text-text-muted')
    expect(html).toContain('>3<')
  })

  it('marks the active tab with the accent tone and token-sized glyphs', () => {
    const html = renderTabs({
      label: 'Sections',
      value: 'a',
      onChange() {},
      tabs: [{ id: 'a', label: 'Alpha' }],
    })
    expect(html).toContain('bg-accent/15')
    expect(html).toContain('icon-caption')
  })
})

// --- mounted behaviour: the strip is driven through the consumer ---

let roots: Root[] = []
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount() })
  roots = []
  resetDom()
})

async function mount(props: ModeTabsProps): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<I18nextProvider i18n={i18n}><Tabs<string> {...props} /></I18nextProvider>) })
  return container
}

const tab = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)!

const press = (element: Element, key: string) => act(async () => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
})

describe('ModeScreen Tabs delegates behaviour to the shared primitive', () => {
  it('emits the primitive-owned tablist marker instead of hand-rolling the markup', async () => {
    // catches: ModeScreen Tabs rendering its own tablist instead of delegating to <TabsCore> (only the primitive emits data-tabs).
    const container = await mount({
      label: 'Sections',
      value: 'a',
      onChange() {},
      tabs: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta', count: 3 }],
    })
    const strip = container.querySelector('[data-tabs="surface"]')
    expect(strip?.getAttribute('role')).toBe('tablist')
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2)
  })

  it('moves the section with arrow keys through the mounted strip', async () => {
    // catches: keyboard navigation lost upstream of the primitive (items stripped or <TabsCore> bypassed).
    const changed: string[] = []
    const container = await mount({
      label: 'Sections',
      value: 'a',
      onChange: (id) => changed.push(id),
      tabs: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
    })
    const a = tab(container, 'a')
    a.focus()
    await press(a, 'ArrowRight')
    expect(document.activeElement).toBe(tab(container, 'b'))
    expect(changed).toEqual(['b'])
  })

  it('selects the section when its tab is clicked', async () => {
    // catches: onChange wiring removed from the consumer's onSelect adapter.
    const changed: string[] = []
    const container = await mount({
      label: 'Sections',
      value: 'a',
      onChange: (id) => changed.push(id),
      tabs: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
    })
    await act(async () => { tab(container, 'b').click() })
    expect(changed).toEqual(['b'])
  })
})