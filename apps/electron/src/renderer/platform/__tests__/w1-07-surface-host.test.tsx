/**
 * W1-07 (#1504): with a mode flag ON the surface root renders its i18n'd
 * empty state until a package registers `<surface>.page`.
 *
 * W3.2/W3.3 (Согласованность-20261009): `calendar` and `messenger` now ship
 * their own pages (Встречи / Команда), so only a still-unregistered surface
 * (`goals`) shows the empty state.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { SurfaceEmptyState, SurfaceHost, surfaceEmptyStateKeys, surfacePageSlot, type SurfacePageProps } from '../SurfaceHost'
import { __resetSlotRegistryForTests, getSlotRegistry } from '../slots'

const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')
const locale = (lang: string) => JSON.parse(readFileSync(join(localesDir, `${lang}.json`), 'utf8')) as Record<string, string>

function i18nFor(lang: string) {
  const instance = createInstance()
  void instance.init({
    lng: lang,
    fallbackLng: 'ru',
    resources: { ru: { translation: locale('ru') }, en: { translation: locale('en') } },
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    initAsync: false,
  })
  return instance
}

function render(node: React.ReactNode, lang = 'ru') {
  return renderToStaticMarkup(<I18nextProvider i18n={i18nFor(lang)}>{node}</I18nextProvider>)
}

afterEach(() => __resetSlotRegistryForTests())

describe('surface empty states', () => {
  it('an unregistered surface renders the RU empty state (default locale)', () => {
    const html = render(<SurfaceHost surface="goals" />)
    const { titleKey, bodyKey } = surfaceEmptyStateKeys('goals')
    expect(html).toContain('data-testid="surface-empty-goals"')
    expect(html).toContain(locale('ru')[titleKey]!)
    expect(html).toContain(locale('ru')[bodyKey]!)
    expect(html).not.toContain(titleKey)
  })

  it('renders EN copy when the UI language is English', () => {
    const html = render(<SurfaceEmptyState surface="messenger" />, 'en')
    expect(html).toContain('No chats yet')
  })

  it('W3.2/W3.3: the merged surfaces ship a page instead of an empty state', () => {
    const registry = getSlotRegistry()
    expect(registry.get('calendar.page', 'calendar.page')).toBeDefined()
    expect(registry.get('messenger.page', 'messenger.page')).toBeDefined()
  })
})

describe('surface pages via slots (wave-2 fake)', () => {
  function FakePage({ surface }: SurfacePageProps) {
    return <div data-testid="fake-page">fake:{surface}</div>
  }

  it('the first visible <surface>.page contribution replaces the empty state', () => {
    getSlotRegistry().register({ id: 'fake.goals', slot: surfacePageSlot('goals'), source: 'fake', payload: { component: FakePage } })
    const html = render(<SurfaceHost surface="goals" />)
    expect(html).toContain('fake:goals')
    expect(html).not.toContain('surface-empty-goals')
  })

  it('negative: a page gated by an OFF flag (or without a component) keeps the empty state', () => {
    getSlotRegistry().register({ id: 'fake.gated', slot: 'goals.page', flag: 'fake.off.v1', source: 'fake', payload: { component: FakePage } })
    getSlotRegistry().register({ id: 'fake.empty', slot: 'goals.page', source: 'fake', payload: {} })
    const html = render(<SurfaceHost surface="goals" />)
    expect(html).toContain('surface-empty-goals')
    expect(html).not.toContain('fake:goals')
  })
})