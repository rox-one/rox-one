import { describe, expect, test } from 'bun:test'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '../../../../../../../packages/shared/src/i18n/locales/en.json'
import { ProfileStrip, type ProfileStripData } from '../ProfileStrip'

const i18n = createInstance()
await i18n.init({
  lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const profile: ProfileStripData = {
  displayName: 'Ada Lovelace',
  plan: 'pro',
  balance: 42,
  level: 1,
  xp: 0,
  progress: 0,
  xpIntoLevel: 0,
  xpForNext: 100,
  nextThreshold: 100,
}

function render(data: ProfileStripData = profile, compact = false) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ProfileStrip data={data} compact={compact} onClick={() => {}} />
    </I18nextProvider>,
  )
}

function description(html: string) {
  const id = html.match(/aria-describedby="([^"]+)"/)?.[1]
  expect(id).toBeDefined()
  return html.match(new RegExp(`<span id="${id}" class="sr-only">(.*?)</span>`))?.[1]
}

describe('ProfileStrip accessible account details', () => {
  test('keeps plan and balance available when only the avatar is visible', () => {
    const html = render(profile, true)
    expect(html).toContain('aria-label="Open settings for Ada Lovelace"')
    expect(description(html)).toBe('Pro · Balance 42')
    expect(html).toContain('title="Ada Lovelace · Pro · Balance 42"')
    expect(html).not.toContain('data-testid="profile-strip-balance"')
  })

  test('describes the same account in the expanded presentation', () => {
    const html = render()
    expect(description(html)).toBe('Pro · Balance 42')
    expect(html).toContain('data-testid="profile-strip-balance"')
  })

  test('unknown and non-finite balances stay unknown rather than presenting invalid amounts', () => {
    for (const balance of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const html = render({ ...profile, balance }, true)
      expect(description(html)).toBe('Pro · Balance —')
      expect(html).not.toContain('NaN')
      expect(html).not.toContain('Infinity')
    }
  })

  test('uses the localized identity fallback for an empty nickname', () => {
    expect(render({ ...profile, displayName: '   ', plan: undefined }, true))
      .toContain('aria-label="Open settings for User"')
  })

  test('preserves full escaped nicknames and spend in the compact description', () => {
    const html = render({ ...profile, displayName: '<Ada> & Lovelace', spentUsd: 0.005 }, true)
    expect(html).toContain('aria-label="Open settings for &lt;Ada&gt; &amp; Lovelace"')
    expect(description(html)).toBe('Pro · Balance 42 · Spent &lt;$0.01')
    expect(html).not.toContain('<Ada>')
  })
})
