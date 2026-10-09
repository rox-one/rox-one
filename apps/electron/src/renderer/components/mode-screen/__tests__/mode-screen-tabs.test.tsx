import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Tabs } from '../ModeScreen'

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

const renderTabs = (props: {
  label: string
  value: string
  onChange: (id: string) => void
  tabs: ReadonlyArray<{ id: string; label: string; count?: number }>
}) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(Tabs<string>, props)))

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
    expect(html).toContain('tabular-nums text-text-muted')
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

const source = readFileSync(join(import.meta.dir, '../ModeScreen.tsx'), 'utf8')

describe('ModeScreen Tabs delegates keyboard and ARIA to the primitive', () => {
  it('imports the shared primitive and owns no tablist markup', () => {
    expect(source).toContain('import { Tabs as TabsCore')
    expect(source).toContain('<TabsCore')
    expect(source).not.toContain('role="tablist"')
    expect(source).not.toContain("querySelectorAll<HTMLButtonElement>('[role=\"tab\"]')")
  })
})