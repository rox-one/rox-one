import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../MarketplaceSettingsPage.tsx'), 'utf8')
const importPage = readFileSync(join(import.meta.dir, '../ImportSettingsPage.tsx'), 'utf8')

describe('marketplace and import native-select chrome', () => {
  it('uses PremiumMenuSelect for marketplace tag and sort filters', () => {
    expect(source).toContain('PremiumMenuSelect')
    expect(source).toContain("t('marketplace.sortLabel')")
    expect(source).toContain('Intl.NumberFormat(locale')
    expect(source).not.toMatch(/<select[\s\S]*marketplace.sortStars/)
    expect(source).toContain("t('extensions.action.openBrowser')")
    expect(source).not.toContain("defaultValue: 'Open browser'")
    expect(source).toContain(
      't(`extensions.permissionGroup.${group.group}`, { defaultValue: group.group })',
    )
    expect(source).not.toMatch(/defaultValue:\s*['"]/)
  })

  it('uses PremiumMenuSelect for the import kind filter', () => {
    expect(importPage).toContain('PremiumMenuSelect')
    expect(importPage).toContain("t('settings.import.filterKind')")
    expect(importPage).toContain("t('settings.import.title')")
    expect(importPage).not.toContain("defaultValue: 'Import chats'")
    expect(importPage).not.toContain('<select')
  })
})
