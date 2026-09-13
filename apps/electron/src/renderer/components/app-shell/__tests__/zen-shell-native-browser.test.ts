import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const rendererRoot = join(import.meta.dir, '../../..')

describe('Zen Shell native browser wiring (ZS-07)', () => {
  it('hides the native view through visibility leases and the existing syncBounds receiver', () => {
    const page = readFileSync(join(rendererRoot, 'pages/BrowserPanelPage.tsx'), 'utf8')
    const handler = readFileSync(join(rendererRoot, '../main/handlers/browser.ts'), 'utf8')
    const remote = readFileSync(join(rendererRoot, 'components/browser/WebBrowserPanel.tsx'), 'utf8')
    expect(page).toContain('createNativeSurfaceTracker')
    expect(page).toContain("acquire('resize')")
    expect(page).toContain("acquire('overlay')")
    expect(page).toContain('syncEmbeddedBounds')
    expect(handler).toContain('syncEmbeddedBounds')
    expect(remote).toContain('width: 390')
    expect(remote).toContain('height: 720')
  })
})
