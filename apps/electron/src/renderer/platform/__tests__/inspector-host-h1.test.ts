import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const hostPath = join(__dirname, '..', 'InspectorHost.tsx')

describe('InspectorHost H1 session inspector', () => {
  const src = readFileSync(hostPath, 'utf8')

  it('does not pull node-pty and keeps the terminal command disabled', () => {
    expect(src).not.toMatch(/node-pty/)
    expect(src).toContain('const terminalEnabled = false')
    expect(src).toContain('disabled={!terminalEnabled}')
    expect(src).toContain('WORKBENCH_FLAG.terminalV1')
    expect(src).toContain("t('inspector.terminalDisabled')")
  })

  it('renders session files/git/browser tabs behind the harness inspector flag', () => {
    expect(src).toContain('featureWorkbenchHarnessInspectorV1Atom')
    expect(src).toContain('SessionInspectorBody')
    expect(src).toContain("inspectorSectionsForMode(sessionMode ? 'session' : 'knowledge')")
  })
})
