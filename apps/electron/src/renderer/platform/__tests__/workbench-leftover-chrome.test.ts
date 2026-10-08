import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resolveWorkspaceSurfaceLayout } from '../workspace-surface-layout'

describe('single catalog chrome', () => {
  it('omits an empty generic tab while keeping multiple panel tabs reachable', () => {
    const options = { isCompact: false, panelCount: 1, catalogOnly: true, chrome: { showSurfaceTabs: true, showInspector: false } }
    expect(resolveWorkspaceSurfaceLayout(options).showTabs).toBe(false)
    expect(resolveWorkspaceSurfaceLayout({ ...options, panelCount: 4 }).showTabs).toBe(true)
    expect(resolveWorkspaceSurfaceLayout({ ...options, catalogOnly: false }).showTabs).toBe(true)
  })
})

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

  it('keeps desktop services reachable when optional chrome preferences are off', () => {
    const chrome = Object.freeze({ showSurfaceTabs: false, showInspector: false })
    expect(resolveWorkspaceSurfaceLayout({ isCompact: false, panelCount: 1, chrome })).toEqual({
      showServiceRail: true,
      showTabs: false,
      showInspector: false,
      showAuxiliaryPanels: true,
    })
    expect(chrome).toEqual({ showSurfaceTabs: false, showInspector: false })
  })

  it('hides optional chrome in compact layout without reserving empty space', () => {
    expect(resolveWorkspaceSurfaceLayout({
      isCompact: true,
      panelCount: 3,
      chrome: { showSurfaceTabs: true, showInspector: false },
    })).toEqual({
      showServiceRail: false,
      showTabs: false,
      showInspector: false,
      showAuxiliaryPanels: false,
    })
  })

  it('shows tabs for multiple desktop panels even with the old tab preference off', () => {
    expect(resolveWorkspaceSurfaceLayout({
      isCompact: false,
      panelCount: 2,
      chrome: { showSurfaceTabs: false, showInspector: false },
    }).showTabs).toBe(true)
  })

  it('mounts an explicitly opened native browser with the inspector preference off', () => {
    const chrome = Object.freeze({ showSurfaceTabs: false, showInspector: false })
    const browser = { isWebUI: false, visible: true, chromeCollapsed: false, section: 'browser' }
    const layout = (patch: Partial<typeof browser> = {}) => resolveWorkspaceSurfaceLayout({
      isCompact: false,
      panelCount: 1,
      chrome,
      browser: { ...browser, ...patch },
    })
    expect(layout().showInspector).toBe(true)
    expect(layout({ visible: false }).showInspector).toBe(false)
    expect(layout({ chromeCollapsed: true }).showInspector).toBe(false)
    expect(layout({ section: 'info' }).showInspector).toBe(false)
    expect(layout({ isWebUI: true }).showInspector).toBe(false)
    expect(chrome.showInspector).toBe(false)
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
