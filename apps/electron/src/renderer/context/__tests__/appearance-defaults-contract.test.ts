import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Appearance defaults contract (2026-10-23): Rox Engineering (`super-engineering`)
 * is the out-of-the-box theme for new installs. Arc Glass Design was retired.
 * Rox Ink (`rox-ink`) stays the migration target for existing installs on older
 * defaults. The app does not pin a theme; Settings → Внешний вид offers the
 * color-theme picker; legacy seeds migrate once via `appearance-defaults-v2-ink`.
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
  it('ships Rox Engineering as the default theme id for new installs', () => {
    expect(themeConfig).toContain("export const ROX_THEME_ID = 'super-engineering'")
    // Existing installs migrated to Rox Ink keep it: the one-shot migrations
    // still target the previous default.
    expect(themeConfig).toContain("export const ROX_INK_THEME_ID = 'rox-ink'")
    expect(storageConfig).toContain('config.colorTheme = ROX_INK_THEME_ID;')
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

  it('migrates legacy selections once and no longer seeds deep glass', () => {
    expect(storageConfig).toContain('colorTheme: ROX_THEME_ID')
    expect(storageConfig).toContain("APPEARANCE_DEFAULTS_MIGRATION = 'appearance-defaults-v1'")
    expect(storageConfig).toContain("APPEARANCE_INK_MIGRATION = 'appearance-defaults-v2-ink'")
    expect(storageConfig).toContain('migrateAppearanceDefaults(config)')
    expect(storageConfig).toContain('migrateAppearanceInkDefault(config, v1RanBefore)')
    expect(storageConfig).not.toContain('DEEP_GLASS_MATERIAL_DEFAULT')
  })
})
