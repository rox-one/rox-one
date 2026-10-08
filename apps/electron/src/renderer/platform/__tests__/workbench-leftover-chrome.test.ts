import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const platformDir = join(import.meta.dir, '..')
const host = readFileSync(join(platformDir, 'WorkspaceSurfaceHost.tsx'), 'utf8')
const stack = readFileSync(join(platformDir, '..', 'components', 'app-shell', 'PanelStackContainer.tsx'), 'utf8')
const atoms = readFileSync(join(platformDir, '..', 'atoms', 'unified-shell.ts'), 'utf8')

describe('workbench leftover chrome (flags stay default off)', () => {
  it('renders the terminal inside the first panel cell, not as a floating or full-width dock', () => {
    expect(host).not.toContain('BottomTerminalDock')
    expect(host).toContain('<PanelHost slot="bottom"')
    expect(stack).toContain('bottomTerminalOpenAtom')
    expect(stack).toContain('data-terminal-cell="true"')
    expect(stack).toContain('<TerminalPanel autoFocus=')
  })

  it('keeps the inspector host for embedded browser when chrome is on', () => {
    expect(host).toContain('<InspectorHost />')
    expect(host).toContain('harnessInspector:')
    expect(host).toContain('browserSurface:')
  })

  it('still renders the terminal panel and files inspector when chrome surfaces are off', () => {
    expect(host).not.toContain('return <>{children}</>')
    expect(host).not.toContain('BottomTerminalDock')
    expect(stack).toContain('<TerminalPanel autoFocus=')
    expect(host).toContain('inspectorVisibleAtom')
    expect(host).toContain('inspectorChromeCollapsedAtom')
    expect(host).toContain('<RetainedSurface visible={!inspectorSuppressed && (chrome.showInspector || inspectorVisible || chromeCollapsed)}>')
    expect(host).toContain('<InspectorHost />')
    expect(host).toContain('{chrome.showRail && !ownsPrimaryNavigation && <ActivityRail />}')
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
