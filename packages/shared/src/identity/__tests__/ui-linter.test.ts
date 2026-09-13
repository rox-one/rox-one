import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROX_BRAND_MANIFEST, ROX_PRODUCT_NAME } from '../manifest.ts'
import { localeMenuViolations, menuCopyUsesBrand, scanUiBrandSource, uiBrandViolations } from '../ui-linter.ts'

const REPO_ROOT = join(import.meta.dir, '../../../../../')

describe('BrandManifest (issue 341)', () => {
  it('names Rox for windows and menus without rewriting package ids', () => {
    expect(ROX_BRAND_MANIFEST.productName).toBe(ROX_PRODUCT_NAME)
    expect(ROX_BRAND_MANIFEST.windowTitle).toBe('Rox')
    expect(ROX_BRAND_MANIFEST.installer.legacyAppId).toBe('com.lukilabs.craft-agent')
    expect(menuCopyUsesBrand('About Rox')).toBe(true)
  })

  it('flags user-facing Craft Agents copy and ignores @craft-agent imports', () => {
    expect(uiBrandViolations('import { x } from "@craft-agent/shared"\nconst title = "Craft Agents"')).toEqual(['Craft Agents'])
    expect(uiBrandViolations('const dir = process.env.CRAFT_CONFIG_DIR')).toEqual([])
  })

  it('scans window and menu resources for leftover product names', () => {
    const files = [
      'apps/electron/src/main/menu.ts',
      'apps/electron/src/main/window-manager.ts',
      'apps/electron/electron-builder.yml',
    ]
    const leaks: string[] = []
    for (const rel of files) {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf8')
      for (const hit of scanUiBrandSource(rel, source)) leaks.push(`${hit.path}: ${hit.hit}`)
    }
    expect(leaks).toEqual([])
    expect(localeMenuViolations('menu.aboutCraftAgents', 'About Rox')).toEqual([])
    expect(localeMenuViolations('menu.aboutCraftAgents', 'About Craft Agents')).toContain('Craft Agents')
  })
})
