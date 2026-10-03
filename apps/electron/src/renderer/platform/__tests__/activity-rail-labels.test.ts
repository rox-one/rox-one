import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHROME_DENSITY } from '../chrome-density'
import { RAIL_AUTO_COLLAPSE_BELOW, resolveRailCollapsed } from '../ActivityRail'
import { APP_NAV_DESTINATIONS } from '../../components/app-shell/nav-destinations'
import { KEYS } from '../../lib/local-storage'

const dir = import.meta.dir
const read = (p: string) => readFileSync(join(dir, p), 'utf8')
const rail = read('../ActivityRail.tsx')
const row = read('../RailRow.tsx')
const group = read('../../pages/extra-screens/ExtraScreensRailGroup.tsx')
const atoms = read('../../atoms/unified-shell.ts')
const locales = join(dir, '../../../../../../packages/shared/src/i18n/locales')
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'hu', 'ja', 'ko', 'pl', 'ru', 'zh-Hans', 'zh-Hant']

describe('activity rail: expanded with labels by default', () => {
  it('expanded width is ~180–200px, collapsed = icon rail', () => {
    expect(CHROME_DENSITY.railExpandedWidth).toBeGreaterThanOrEqual(180)
    expect(CHROME_DENSITY.railExpandedWidth).toBeLessThanOrEqual(200)
    expect(CHROME_DENSITY.railExpandedWidth % 4).toBe(0)
    expect(rail).toContain('activityRailWidth(collapsed)')
  })

  it('preserves the existing preference key and current expanded default', () => {
    expect(KEYS.activityRailCollapsed).toBe('activity-rail-collapsed')
    expect(atoms).toMatch(/activityRailCollapsedAtom = atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.activityRailCollapsed\),\s*false,/)
  })

  it('rows are 28px, radius 6, label visible when expanded, tooltip when collapsed', () => {
    expect(row).toContain('h-[28px]')
    expect(row).toContain('rounded-[6px]')
    expect(row).toContain('{!collapsed && <span')
    expect(row).toContain('<TooltipContent side="right"')
    expect(row).not.toMatch(/\bborder\b/)
    expect(row).toContain('aria-current')
  })

  it('extra screens continue the list: no visible «Ещё» header, shared row', () => {
    expect(group).toContain("aria-label={t('extraScreens.more')}")
    expect(group).not.toContain('aria-hidden')
    expect(group).not.toContain('uppercase')
    expect(group).toContain('<RailRow')
    expect(group).toContain('collapsed={collapsed}')
  })

  it('keeps the collapse toggle at the bottom', () => {
    expect(rail).toContain('testId="rail-toggle"')
    expect(rail).toContain("t('rail.expand')")
    expect(rail).toContain("t('rail.collapse')")
  })

  it('sessions uses the chat glyph, not the «Входящие» inbox glyph', async () => {
    const lucide = await import('lucide-react')
    const byId = Object.fromEntries(APP_NAV_DESTINATIONS.map((d) => [d.id, d]))
    expect(byId.sessions!.icon).toBe(lucide.MessageSquare)
    expect(byId.sessions!.icon).not.toBe(lucide.Inbox)
    expect(byId.tasks!.icon).not.toBe(byId.automations!.icon)
    expect(new Set(APP_NAV_DESTINATIONS.map((d) => d.icon)).size).toBe(APP_NAV_DESTINATIONS.length)
  })

  it('every rail label exists in all 12 locales', () => {
    const keys = [
      ...APP_NAV_DESTINATIONS.map((d) => d.labelKey),
      'extraScreens.more', 'extraScreens.dossier.title', 'extraScreens.radar.title',
      'extraScreens.decisions.title', 'extraScreens.agents.title', 'extraScreens.focus.title',
      'rail.title', 'rail.expand', 'rail.collapse',
    ]
    for (const loc of LOCALES) {
      const dict = JSON.parse(readFileSync(join(locales, `${loc}.json`), 'utf8')) as Record<string, string>
      for (const key of keys) expect(typeof dict[key] === 'string' && dict[key]!.length > 0, `${loc}:${key}`).toBe(true)
    }
    const ru = JSON.parse(readFileSync(join(locales, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru['sidebar.allSessions']).toBe('Сессии')
    expect(ru['extraScreens.more']).toBe('Ещё')
  })
  it('auto-collapses on narrow windows without touching the persisted choice; user can override', () => {
    expect(RAIL_AUTO_COLLAPSE_BELOW).toBeLessThanOrEqual(1280)
    expect(resolveRailCollapsed({ persisted: false, narrow: false, override: false })).toBe(false)
    expect(resolveRailCollapsed({ persisted: false, narrow: true, override: false })).toBe(true)
    expect(resolveRailCollapsed({ persisted: false, narrow: true, override: true })).toBe(false)
    expect(resolveRailCollapsed({ persisted: true, narrow: false, override: false })).toBe(true)
  })

  it('AppShell reserves rail width only when the rail renders (same predicate as the host)', () => {
    const shell = read('../../components/app-shell/AppShell.tsx')
    expect(shell).toContain('useEffectiveRailCollapsed()')
    expect(shell).toMatch(/activityRailRendered = unifiedShellEnabled\s*\|\| \(\(unifiedShellEnabled \|\| workbenchEnabled\) && topChromeEnabled\)/)
  })
})
