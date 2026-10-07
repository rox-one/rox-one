import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const srcRoot = join(import.meta.dir, '../../..')

describe('super.engineering wave-1 acceptance', () => {
  it('wires ui profile dataset in ThemeContext', () => {
    const theme = readFileSync(join(srcRoot, 'renderer/context/ThemeContext.tsx'), 'utf8')
    expect(theme).toContain('dataset.uiProfile')
  })

  it('integrates shell layout mode in AppShell only', () => {
    const shell = readFileSync(join(srcRoot, 'renderer/components/app-shell/AppShell.tsx'), 'utf8')
    expect(shell).toContain('ShellLayoutMode')
    expect(shell).toContain('WorkspaceNavigator')
  })

  it('exposes edge reveal zone in workspace host', () => {
    const host = readFileSync(join(srcRoot, 'renderer/platform/WorkspaceSurfaceHost.tsx'), 'utf8')
    expect(host).toContain('inspector-edge-zone')
    expect(host).toContain('useEdgeRevealPanel')
  })

  it('ships super-engineering theme preset with uiProfile', () => {
    const json = JSON.parse(readFileSync(join(srcRoot, '../resources/themes/super-engineering.json'), 'utf8')) as { uiProfile?: string }
    expect(json.uiProfile).toBe('super-engineering')
  })
})

describe('super.engineering wave-2 acceptance', () => {
  it('loads workspace git via IPC hook', () => {
    const hook = readFileSync(join(srcRoot, 'renderer/hooks/useWorkspaceGitModel.ts'), 'utf8')
    expect(hook).toContain('getGitWorkspaceSnapshot')
  })

  it('wires SE shell extras and inspector toggle', () => {
    const shell = readFileSync(join(srcRoot, 'renderer/components/app-shell/AppShell.tsx'), 'utf8')
    expect(shell).toContain('SuperEngineeringShellExtras')
    expect(shell).toContain("useAction('view.toggleInspector'")
  })

  it('shimmers session titles while streaming in SE profile', () => {
    const item = readFileSync(join(srcRoot, 'renderer/components/app-shell/SessionItem.tsx'), 'utf8')
    expect(item).toContain('useSuperEngineeringProfile')
    expect(item).toMatch(/seProfile\s*&&\s*item\.isProcessing/)
    expect(item).toContain('animate-shimmer-text')
  })
})


[You have received this identical output 3 times. Re-reading '/Users/t/Projects/rox-one/apps/electron/src/renderer/platform/__tests__/super-engineering-acceptance.test.ts:raw' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]