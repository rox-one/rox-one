import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHROME_DENSITY } from '../chrome-density'
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

  it('persists under a v2 key defaulting to expanded (legacy collapsed flag ignored once)', () => {
    expect(KEYS.activityRailCollapsedV2).toBe('activity-rail-collapsed-v2')
    expect(atoms).toMatch(/activityRailCollapsedAtom = atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.activityRailCollapsedV2\),\s*false,/)
  })

  it('rows are 28px, radius 6, label visible when expanded, tooltip when collapsed', () => {
    expect(row).toContain('h-[28px]')
    expect(row).toContain('rounded-[6px]')
    expect(row).toContain('{!collapsed && <span')
    expect(row).toContain('<TooltipContent side="right"')
    expect(row).not.toMatch(/\bborder\b/)
    expect(row).toContain('aria-current')
  })

  it('«Ещё» header and extra screens use the shared row', () => {
    expect(group).toContain("t('extraScreens.more')")
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
})
