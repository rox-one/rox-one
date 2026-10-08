/**
 * W1-07 (#1504): with a mode flag ON the surface root renders its i18n'd
 * empty state until a wave-2 package registers `<surface>.page`.
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
import { UNIFIED_SURFACE_IDS, type UnifiedSurfaceId } from '../../../shared/surface-routes'

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
  for (const surface of UNIFIED_SURFACE_IDS) {
    it(`${surface}: renders the RU empty state (default locale)`, () => {
      const html = render(<SurfaceHost surface={surface} />)
      const { titleKey, bodyKey } = surfaceEmptyStateKeys(surface)
      expect(html).toContain(`data-testid="surface-empty-${surface}"`)
      expect(html).toContain(locale('ru')[titleKey]!)
      expect(html).toContain(locale('ru')[bodyKey]!)
      expect(html).not.toContain(titleKey)
    })
  }

  it('renders EN copy when the UI language is English', () => {
    const html = render(<SurfaceEmptyState surface="messenger" />, 'en')
    expect(html).toContain('No chats yet')
  })
})

describe('surface pages via slots (wave-2 fake)', () => {
  function FakeMessenger({ surface }: SurfacePageProps) {
    return <div data-testid="fake-page">fake:{surface}</div>
  }

  it('the first visible <surface>.page contribution replaces the empty state', () => {
    getSlotRegistry().register({ id: 'fake.messenger', slot: surfacePageSlot('messenger'), source: 'fake', payload: { component: FakeMessenger } })
    const html = render(<SurfaceHost surface="messenger" />)
    expect(html).toContain('fake:messenger')
    expect(html).not.toContain('surface-empty-messenger')
    // Other surfaces are unaffected.
    expect(render(<SurfaceHost surface={'calendar' as UnifiedSurfaceId} />)).toContain('surface-empty-calendar')
  })

  it('negative: a page gated by an OFF flag (or without a component) keeps the empty state', () => {
    getSlotRegistry().register({ id: 'fake.gated', slot: 'goals.page', flag: 'fake.off.v1', source: 'fake', payload: { component: FakeMessenger } })
    getSlotRegistry().register({ id: 'fake.empty', slot: 'goals.page', source: 'fake', payload: {} })
    const html = render(<SurfaceHost surface="goals" />)
    expect(html).toContain('surface-empty-goals')
    expect(html).not.toContain('fake:goals')
  })
})
