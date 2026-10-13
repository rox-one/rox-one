import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Appearance defaults contract (2026-10-13): Rox Engineering
 * (`super-engineering`) is the out-of-the-box theme, the app no longer pins a
 * single theme, Settings → Внешний вид offers the color-theme picker again,
 * and legacy installs are migrated once (`appearance-defaults-v1`), which also
 * seeds the deep-glass material default.
 */
const repo = join(import.meta.dir, '..', '..', '..', '..', '..', '..')
const themeConfig = readFileSync(join(repo, 'packages/shared/src/config/theme.ts'), 'utf8')
const storageConfig = readFileSync(join(repo, 'packages/shared/src/config/storage.ts'), 'utf8')
const desktopEntry = readFileSync(join(repo, 'apps/electron/src/renderer/main.tsx'), 'utf8')
const webuiEntry = readFileSync(join(repo, 'apps/webui/src/App.tsx'), 'utf8')
const appearancePage = readFileSync(
  join(repo, 'apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx'),
  'utf8',
)

describe('appearance defaults', () => {
  it('ships Rox Engineering as the default theme id', () => {
    expect(themeConfig).toContain("export const ROX_THEME_ID = 'super-engineering'")
    expect(themeConfig).toContain('DEEP_GLASS_MATERIAL_DEFAULT')
  })

  it('no longer pins a fixed theme in the app entry points', () => {
    expect(desktopEntry).not.toContain('fixedColorTheme')
    expect(webuiEntry).not.toContain('fixedColorTheme')
  })

  it('restores the color-theme picker in the appearance settings page', () => {
    expect(appearancePage).toContain('settings.appearance.colorTheme')
    expect(appearancePage).toContain('loadPresetThemes')
    expect(appearancePage).toContain('setColorTheme')
    expect(appearancePage).toContain('color-theme-picker')
    // No mode or per-workspace theme picker lives in this section.
    expect(appearancePage).not.toContain('settings.appearance.workspaceThemes')
  })

  it('migrates legacy selections and seeds deep glass exactly once', () => {
    expect(storageConfig).toContain("colorTheme: 'super-engineering'")
    expect(storageConfig).toContain("APPEARANCE_DEFAULTS_MIGRATION = 'appearance-defaults-v1'")
    expect(storageConfig).toContain('migrateAppearanceDefaults(config)')
  })
})
