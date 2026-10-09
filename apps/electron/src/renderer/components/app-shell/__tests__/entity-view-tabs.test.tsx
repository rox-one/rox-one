import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { EntityViewTabs, defaultSessionEntityCapabilities, type EntityViewTabsProps } from '../EntityViewTabs'

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
      'entityView.teamChat': 'Team chat',
    } } },
  })
})

const renderTabs = (props: EntityViewTabsProps) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(EntityViewTabs, props)))

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

const source = readFileSync(join(import.meta.dir, '../EntityViewTabs.tsx'), 'utf8')

describe('EntityViewTabs delegates keyboard and ARIA to the primitive', () => {
  it('has no tablist/keyboard markup of its own', () => {
    expect(source).toContain("from '@/components/ui/tabs'")
    expect(source).not.toContain('role="tablist"')
    expect(source).not.toContain('role="tab"')
    expect(source).not.toContain('onKeyDown')
    expect(source).not.toContain('aria-selected')
    expect(source).not.toContain('Tooltip')
  })

  it('sizes tab and placeholder glyphs by token, not a literal stroke', () => {
    expect(source).toContain('icon-caption')
    expect(source).toContain('icon-empty')
    expect(source).not.toContain('strokeWidth')
  })
})