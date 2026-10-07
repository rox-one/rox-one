import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const fixtureDir = join(import.meta.dirname, 'fixtures/inspector-resize')
const corruptionPattern = /You have received this identical/

describe('inspector-resize browser fixture', () => {
  it('has no corrupted tool-read truncation in fixture sources', () => {
    for (const name of readdirSync(fixtureDir)) {
      if (!/\.(ts|tsx)$/.test(name)) continue
      const text = readFileSync(join(fixtureDir, name), 'utf8')
      expect(text).not.toMatch(corruptionPattern)
    }
  })

  it('bootstraps harness session mode so InspectorHost renders resize sash', () => {
    const fixture = readFileSync(join(fixtureDir, 'main.tsx'), 'utf8')
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
    const viteConfig = readFileSync(join(fixtureDir, 'vite.config.ts'), 'utf8')
    expect(viteConfig).toContain("find: 'react'")
    expect(viteConfig).toContain('node_modules/react')
    expect(viteConfig).toContain('react/jsx-runtime')
    expect(viteConfig).toContain("find !== 'react'")
    expect(viteConfig).toContain('rox-ui-stub.tsx')
    expect(viteConfig).toContain('inspector-fixture-module-stubs')
    expect(viteConfig).toContain("find !== '@'")
    expect(readFileSync(join(fixtureDir, 'rox-ui-stub.tsx'), 'utf8')).toContain('parseAnsi')
  })
})
