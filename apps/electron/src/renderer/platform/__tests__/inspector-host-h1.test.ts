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

  it('renders session files/git/browser tabs behind the harness inspector flag', () => {
    expect(src).toContain('featureWorkbenchHarnessInspectorV1Atom')
    expect(src).toContain('SessionInspectorBody')
    expect(src).toContain("inspectorSectionsForMode(sessionMode ? 'session' : 'knowledge')")
    expect(src).toContain('sessionFolderPath={sessionFolderPath}')
  })
})

describe('SessionInspectorBody H1 browser', () => {
  const body = readFileSync(join(__dirname, '..', '..', 'components', 'session-inspector', 'SessionInspectorBody.tsx'), 'utf8')

  it('hosts an embedded browser pane instead of a native BrowserWindow', () => {
    expect(body).not.toContain('WebBrowserPanel')
    expect(body).toContain('InspectorBrowserPane')
    expect(body).not.toContain('inspector.browserDisabled')
  })
})
