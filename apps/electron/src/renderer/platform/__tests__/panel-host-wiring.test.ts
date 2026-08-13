import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * S-09/S-03 wiring guard: UnifiedShellLayout must mount PanelHost for the
 * shell's panel slots so registered panels (packages/core panel registry)
 * have a host. Ticket 11 registers knowledge.inspector; other slots stay
 * empty. Renderer harness has no jsdom — this slices the layout source.
 */

const layoutPath = join(__dirname, '..', 'index.tsx')
const hostPath = join(__dirname, '..', 'PanelHost.tsx')
const atomPath = join(__dirname, '..', '..', 'atoms', 'unified-shell.ts')

describe('UnifiedShellLayout PanelHost wiring', () => {
  const src = readFileSync(layoutPath, 'utf8')

  it('mounts PanelHost for the bottom slot inside the center column', () => {
    expect(src).toContain('<PanelHost slot="bottom"')
  })

  it('mounts PanelHost for the inspector slot at the right edge', () => {
    expect(src).toContain('<PanelHost slot="inspector"')
  })

  it('exports PanelHost from the platform barrel', () => {
    expect(src).toContain("export { PanelHost } from './PanelHost'")
  })

  it('PanelHost resolves panels through the registry + persisted overrides', () => {
    const host = readFileSync(hostPath, 'utf8')
    expect(host).toContain('resolveSlotPanels')
    expect(host).toContain('KEYS.panelState')
    expect(host).toContain('onDidChange')
  })

  it('bootstraps core panels with the real KnowledgeInspectorPanel render', () => {
    const host = readFileSync(hostPath, 'utf8')
    expect(host).toContain('registerCorePanels')
    expect(host).toContain('KnowledgeInspectorPanel')
    expect(host).toContain('panelContextKeysFromRoute')
  })

  it('keeps featureUnifiedShellAtom defaulted to false', () => {
    const src = readFileSync(atomPath, 'utf8')
    expect(src).toMatch(
      /atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.featureUnifiedShell\),\s*false/,
    )
  })
})
