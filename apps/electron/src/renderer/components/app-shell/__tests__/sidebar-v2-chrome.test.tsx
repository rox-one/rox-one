import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { SidebarChrome, SidebarHeaderControls } from '../SidebarChrome'
import type { ProfileStripData } from '../ProfileStrip'

const i18n = createInstance()
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {
  'rail.pin': 'Pin sidebar', 'rail.unpin': 'Unpin sidebar', 'sidebar.show': 'Expand', 'sidebar.hide': 'Collapse', 'profile.openMenu': 'Open profile menu for {{name}}',
} } } })
const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
const profile: ProfileStripData = { displayName: 'Rox User', plan: 'standard', level: 1, xp: 0, progress: 0, xpIntoLevel: 0, xpForNext: 100, nextThreshold: 100, balance: 12 }
const noop = () => {}

describe('sidebar v2 chrome', () => {
  it('header: collapse and pin sit side by side; pin only while expanded', () => {
    const expanded = render(<SidebarHeaderControls collapsed={false} onToggleSidebar={noop} onPin={noop} />)
    expect(expanded).toContain('data-testid="rail-pin"')
    expect(expanded).toContain('data-testid="rail-toggle"')
    expect(expanded).not.toContain('flex-col')
    expect(expanded.indexOf('rail-pin')).toBeLessThan(expanded.indexOf('rail-toggle'))
    const collapsed = render(<SidebarHeaderControls collapsed onToggleSidebar={noop} onPin={noop} />)
    expect(collapsed).not.toContain('data-testid="rail-pin"')
    expect(collapsed).toContain('aria-label="Expand"')
  })

  it('footer: no profile card, gear, pin or collapse buttons; empty without a hint', () => {
    expect(render(<SidebarChrome promoKind={null} onPromoCta={noop} />)).toBe('')
    const html = render(<SidebarChrome promoKind="reminder" reminderDueCount={1} onPromoCta={noop} />)
    for (const id of ['rail-settings', 'rail-pin', 'rail-toggle', 'profile-strip']) expect(html).not.toContain(id)
  })

  it('rail: no gear — Settings is reached only from the avatar popover', () => {
    const rail = readFileSync(resolve(import.meta.dir, '../../shell/PrimaryRail.tsx'), 'utf8')
    expect(rail).not.toContain('model.bottom.map')
    const shell = readFileSync(resolve(import.meta.dir, '../AppShell.tsx'), 'utf8')
    expect(shell).toContain('variant="rail"')
  })

  it('the profile popover offers «Настройки»', () => {
    const source = readFileSync(resolve(import.meta.dir, '../UserProfilePopover.tsx'), 'utf8')
    expect(source).toContain("t('sidebar.settings')")
    expect(source).toContain('profile-open-settings')
  })

  it('top pills are fully rounded', () => {
    const css = readFileSync(resolve(import.meta.dir, '../titlebar-mode-pill.css'), 'utf8')
    for (const selector of ['.rox-mode-pill {', '.rox-mode-pill-item {', '.rox-mode-pill-indicator {']) {
      const start = css.indexOf(selector)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(css.slice(start, css.indexOf('}', start))).toContain('border-radius: var(--radius-full)')
    }
  })
})
