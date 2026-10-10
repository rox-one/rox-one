/**
 * EntityViewTabs — the entity multi-view strip. Static markup proves the ARIA
 * surface; mounted behaviour proves it actually delegates keyboard + selection
 * to the shared primitive.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import {
  EntityViewTabs,
  EntityViewPlaceholder,
  ENTITY_VIEW_LABEL_KEYS,
  defaultSessionEntityCapabilities,
  defaultNoteEntityCapabilities,
  defaultKnowledgeEntityCapabilities,
  type EntityViewId,
  type EntityViewTabsProps,
} from '../EntityViewTabs'

useDomForFile()

let i18n: I18n
beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    resources: { en: { translation: {
      'entityView.tabsLabel': 'Views',
      'entityView.standard': 'Standard',
      'entityView.map': 'Map',
      'entityView.outline': 'Outline',
      'entityView.graph': 'Graph',
      'entityView.mindmapSiyuan': 'Mind map',
      'entityView.mindmapKnowledge': 'Rox Notes map',
      'entityView.teamChat': 'Team chat',
      'entityView.table': 'Table',
      'entityView.canvas': 'Canvas',
      'entityView.comingSoon': 'Coming soon',
    } } },
  })
})

const renderTabs = (props: EntityViewTabsProps) =>
  renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, React.createElement(EntityViewTabs, props)))

describe('EntityViewTabs renders through the shared tab primitive', () => {
  it('exposes one tablist with ARIA tabs and a roving stop', () => {
    const html = renderTabs({ value: 'standard', capabilities: defaultSessionEntityCapabilities(), onChange() {} })
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Views"')
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html).toContain('aria-selected="true"')
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Standard"')
  })

  it('renders the segmented profile with the collapse label class', () => {
    const html = renderTabs({ value: 'map', capabilities: defaultSessionEntityCapabilities(), variant: 'segmented', onChange() {} })
    expect(html).toContain('role="tablist"')
    expect(html).toContain('rox-view-switch-item')
    expect(html).toContain('rox-view-switch-label')
    expect(html).toContain('aria-selected="true"')
  })
})

// --- mounted behaviour: the strip is driven through the consumer ---

let roots: Root[] = []
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount() })
  roots = []
  resetDom()
})

async function mount(props: EntityViewTabsProps): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<I18nextProvider i18n={i18n}><EntityViewTabs {...props} /></I18nextProvider>) })
  return container
}

const tab = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)!

const press = (element: Element, key: string) => act(async () => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
})

describe('EntityViewTabs delegates behaviour to the shared primitive', () => {
  it('emits the primitive-owned tablist marker instead of hand-rolling the markup', async () => {
    // catches: EntityViewTabs rendering its own tablist instead of delegating to <Tabs> (only the primitive emits data-tabs).
    const container = await mount({ value: 'standard', capabilities: defaultSessionEntityCapabilities(), onChange() {} })
    const strip = container.querySelector('[data-tabs="surface"]')
    expect(strip?.getAttribute('role')).toBe('tablist')
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3)
  })

  it('moves the view with arrow keys through the mounted strip', async () => {
    // catches: keyboard navigation lost upstream of the primitive (items stripped or <Tabs> bypassed).
    const changed: EntityViewId[] = []
    const container = await mount({
      value: 'standard',
      capabilities: defaultSessionEntityCapabilities(),
      onChange: (id) => changed.push(id),
    })
    const standard = tab(container, 'standard')
    standard.focus()
    await press(standard, 'ArrowRight')
    expect(document.activeElement).toBe(tab(container, 'map'))
    expect(changed).toEqual(['map'])
  })

  it('selects the view when its tab is clicked', async () => {
    // catches: onChange wiring removed from the consumer's onSelect adapter.
    const changed: EntityViewId[] = []
    const container = await mount({
      value: 'standard',
      capabilities: defaultSessionEntityCapabilities(),
      onChange: (id) => changed.push(id),
    })
    await act(async () => { tab(container, 'outline').click() })
    expect(changed).toEqual(['outline'])
  })
})

// --- label keys are a single explicit source, never fabricated from the id ---

const renderPlaceholder = (view: EntityViewId, labelKey?: string) =>
  renderToStaticMarkup(
    React.createElement(I18nextProvider, { i18n },
      React.createElement(EntityViewPlaceholder, { view, ...(labelKey != null ? { labelKey } : {}) })),
  )

describe('EntityViewPlaceholder labels come from the capability key map', () => {
  it('every capability labelKey is exactly ENTITY_VIEW_LABEL_KEYS[id]', () => {
    // catches: a capability shipping a key the placeholder/id map does not know about.
    const all = [
      ...defaultSessionEntityCapabilities({ siyuanConnected: true }),
      ...defaultNoteEntityCapabilities(),
      ...defaultKnowledgeEntityCapabilities({ siyuanConnected: true }),
    ]
    for (const cap of all) {
      expect(cap.labelKey).toBe(ENTITY_VIEW_LABEL_KEYS[cap.id])
    }
  })

  it('placeholder resolves real keys for teamchat/mindmap instead of fabricating them', () => {
    // catches: `entityView.${view}` regression — entityView.teamchat / entityView.mindmap do not exist.
    expect(renderPlaceholder('teamchat')).toContain('Team chat')
    expect(renderPlaceholder('teamchat')).not.toContain('entityView.teamchat')
    expect(renderPlaceholder('mindmap')).toContain('Rox Notes map')
    expect(renderPlaceholder('mindmap')).not.toContain('entityView.mindmap')
  })

  it('an explicit capability labelKey wins over the id default', () => {
    expect(renderPlaceholder('teamchat', 'entityView.map')).toContain('Map')
  })
})