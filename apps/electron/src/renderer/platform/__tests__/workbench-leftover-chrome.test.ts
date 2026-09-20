import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const platformDir = join(import.meta.dir, '..')
const host = readFileSync(join(platformDir, 'WorkspaceSurfaceHost.tsx'), 'utf8')
const atoms = readFileSync(join(platformDir, '..', 'atoms', 'unified-shell.ts'), 'utf8')

describe('workbench leftover chrome (flags stay default off)', () => {
  it('docks the bottom terminal inside the chrome column, not as a floating overlay', () => {
    expect(host).toContain("import { BottomTerminalDock } from '@/components/session-inspector/BottomTerminalDock'")
    expect(host).toContain('<BottomTerminalDock />')
    expect(host).toContain('<PanelHost slot="bottom"')
    expect(host.indexOf('<BottomTerminalDock />')).toBeLessThan(host.indexOf('<PanelHost slot="bottom"'))
  })

  it('keeps the inspector host for embedded browser when chrome is on', () => {
    expect(host).toContain('<InspectorHost />')
    expect(host).toContain('harnessInspector:')
    expect(host).toContain('browserSurface:')
  })

  it('still docks the bottom terminal and files inspector when chrome surfaces are off', () => {
    expect(host).not.toContain('return <>{children}</>')
    expect(host).toContain('<BottomTerminalDock />')
    expect(host).toContain('inspectorVisibleAtom')
    expect(host).toContain('(chrome.showInspector || inspectorVisible) && <InspectorHost />')
    expect(host).toContain('{chrome.showRail && <ActivityRail />}')
    expect(host).toContain('{chrome.showSurfaceTabs && <SurfaceTabs />}')
  })

  it('does not default unified-shell or workbench atoms on', () => {
    expect(atoms).toMatch(
      /atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.featureUnifiedShell\),\s*false/,
    )
    expect(atoms).toMatch(
      /atomWithStorage<boolean>\(\s*getKeyString\(KEYS\.workbenchEnabled\),\s*false/,
    )
  })
})
