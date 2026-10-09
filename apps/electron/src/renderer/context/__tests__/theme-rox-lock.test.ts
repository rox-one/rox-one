import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The customer fixed the app to a single Rox theme: users may not select a
 * mode, color theme or per-workspace theme. These source assertions pin the
 * enforcement seams (the shared constant, ThemeProvider coercion, and the two
 * real app entry points). Behavioral coverage of the surrounding provider is
 * kept in theme-app-overrides-wiring.test.ts.
 */
const repo = join(import.meta.dir, '..', '..', '..', '..', '..', '..')
const themeConfig = readFileSync(join(repo, 'packages/shared/src/config/theme.ts'), 'utf8')
const context = readFileSync(join(import.meta.dir, '../ThemeContext.tsx'), 'utf8')
const desktopEntry = readFileSync(join(repo, 'apps/electron/src/renderer/main.tsx'), 'utf8')
const webuiEntry = readFileSync(join(repo, 'apps/webui/src/App.tsx'), 'utf8')

describe('single fixed Rox theme store', () => {
  it('declares the canonical Rox theme id', () => {
    expect(themeConfig).toContain("export const ROX_THEME_ID = 'nordfox-opaque'")
  })

  it('coerces the store to the canonical theme regardless of selection', () => {
    expect(context).toContain('fixedColorTheme')
    expect(context).toContain('const themeLocked = fixedColorTheme !== undefined')
    expect(context).toContain('const effectiveColorTheme = themeLocked')
    expect(context).toContain('setColorThemeState(lockedColorTheme)')
  })

  it('migrates a legacy stored selection to the canonical theme on load', () => {
    // Local preference coerced on boot.
    expect(context).toContain('existing.colorTheme !== lockedColorTheme')
    // Config.json value migrated through the existing setColorTheme API.
    expect(context).toContain('configTheme !== lockedColorTheme')
    expect(context).toContain('api.setColorTheme?.(lockedColorTheme)')
  })

  it('makes mode and theme setters no-ops while locked', () => {
    expect(context).toContain('// A fixed theme has no mode control: ignore user intent.')
    expect(context).toContain('// A fixed theme is not user-selectable: keep the pinned id and ignore input.')
    expect(context).toContain('if (themeLocked || !workspaceId) return Promise.resolve(false)')
  })

  it('pins the fixed theme in both desktop and web entry points', () => {
    expect(desktopEntry).toContain('fixedColorTheme={ROX_THEME_ID}')
    expect(webuiEntry).toContain('fixedColorTheme={ROX_THEME_ID}')
  })
})