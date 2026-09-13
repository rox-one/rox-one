import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { UI_BRAND_ALLOWLIST, UI_BRAND_MANIFEST } from '../ui-brand.ts'

const ROOT = join(import.meta.dir, '../../../../..')

describe('ROX-AUD-181 visible brand leftovers', () => {
  it('keeps dashboard and playground window titles on Rox', () => {
    const dashboard = readFileSync(join(ROOT, 'dashboard.html'), 'utf8')
    const playground = readFileSync(join(ROOT, 'apps/electron/src/renderer/playground.html'), 'utf8')
    expect(dashboard).toContain(`<title>${UI_BRAND_MANIFEST.dashboardTitle}</title>`)
    expect(playground).toContain(`<title>${UI_BRAND_MANIFEST.playgroundTitle}</title>`)
    expect(dashboard).toContain(`<span class="glow">${UI_BRAND_MANIFEST.productName}</span>`)
    expect(dashboard).not.toContain('Craft Agents —')
    expect(playground).not.toContain('Craft Agent</title>')
  })

  it('does not rename protocol, storage, or package-scope IDs', () => {
    expect(UI_BRAND_ALLOWLIST).toContain('@craft-agent')
    expect(UI_BRAND_ALLOWLIST).toContain('com.lukilabs.craft-agent')
    const shared = JSON.parse(readFileSync(join(ROOT, 'packages/shared/package.json'), 'utf8')) as { name: string }
    expect(shared.name.startsWith('@craft-agent/')).toBe(true)
  })
})
