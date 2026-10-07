import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('inspector-resize browser fixture', () => {
  it('bootstraps harness session mode so InspectorHost renders resize sash', () => {
    const fixture = readFileSync(join(import.meta.dirname, 'fixtures/inspector-resize/main.tsx'), 'utf8')
    expect(fixture).toContain('featureWorkbenchHarnessInspectorV1Atom')
    expect(fixture).toContain('panelStackAtom')
    expect(fixture).toContain('routes.view.allSessions')
    expect(fixture).not.toContain('inspectorUserOpenedAtom')
    expect(fixture).toContain('featureWorkbenchHarnessInspectorV1')
    expect(fixture).toContain('localStorage.setItem')
    expect(fixture).toContain('getItem(panelWidthKey) == null')
    expect(fixture).toContain('inspectorChromeCollapsed')
    expect(fixture).toContain('data-inspector-fixture-ready')
    expect(fixture).toContain('getSessionFiles')
    expect(fixture).not.toMatch(/You have received this identical/)
    const viteConfig = readFileSync(join(import.meta.dirname, 'fixtures/inspector-resize/vite.config.ts'), 'utf8')
    expect(viteConfig).toContain("find: 'react'")
    expect(viteConfig).toContain('node_modules/react')
  })
})
