import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const hostPath = join(__dirname, '..', 'InspectorHost.tsx')

describe('InspectorHost H1 session inspector', () => {
  const src = readFileSync(hostPath, 'utf8')

  it('does not pull node-pty and hosts a command-runner terminal', () => {
    expect(src).not.toMatch(/node-pty/)
    expect(src).toContain('InspectorTerminal')
    expect(src).toContain('WORKBENCH_FLAG.terminalV1')
    expect(src).toContain("t('inspector.terminal')")
    expect(src).not.toContain('const terminalEnabled = false')
    expect(src).not.toContain('disabled={!terminalEnabled}')
  })

  it('preserves session files/git/context tabs behind the harness inspector flag', () => {
    expect(src).toContain('featureWorkbenchHarnessInspectorV1Atom')
    expect(src).toContain('SessionInspectorBody')
    expect(src).toContain("inspectorSectionsForMode(sessionMode ? 'session' : 'knowledge')")
    expect(src).toContain('sessionFolderPath={sessionFolderPath}')
  })

  it('renders the embedded browser pane directly for the shared browser section', () => {
    expect(src).toContain("activeSection === 'browser'")
    expect(src).toContain('<InspectorBrowserPane />')
    expect(src).not.toContain('inspector.browserDisabled')
  })

  it('keeps the terminal control on the expanded rail; R-hide is true zero-width', () => {
    expect(src.match(/\{terminalControl\}/g)).toHaveLength(1)
    expect(src).toContain('onClick={handleBottomTerminalToggle}')
    expect(src).toContain('data-testid="bottom-terminal-toggle"')
    expect(src).toContain('setTerminalOpen(next.sideOpen)')
    expect(src).toContain('setBottomTerminalOpen(next.bottomOpen)')
    expect(src).toContain('<RetainedSurface visible={!chromeCollapsed}>')
    expect(src).toContain('<RetainedSurface visible={browserVisible}>')
    expect(src).not.toContain('Movable cycle')
  })
})

describe('SessionInspectorBody H1 browser', () => {
  const body = readFileSync(join(__dirname, '..', '..', 'components', 'session-inspector', 'SessionInspectorBody.tsx'), 'utf8')
  const pane = readFileSync(join(__dirname, '..', '..', 'components', 'session-inspector', 'InspectorBrowserPane.tsx'), 'utf8')

  it('hosts an embedded browser pane instead of a native BrowserWindow', () => {
    expect(body).not.toContain('WebBrowserPanel')
    expect(body).toContain('InspectorBrowserPane')
    expect(body).not.toContain('inspector.browserDisabled')
    expect(pane).toContain('window.electronAPI.browserPane.createEmbedded')
    expect(pane).toContain('<BrowserPanelPage instanceId={instanceId} persist />')
  })
})
