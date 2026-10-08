import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { commitAfterBrowserWindowAction } from '../../components/browser/use-workspace-browser-windows'
import { osBrowserSurfaceTabs, type OsBrowserInstanceLike } from '../os-browser-tabs'
import { resolveWorkspaceSurfaceLayout } from '../workspace-surface-layout'

const platformDir = join(import.meta.dir, '..')
const rendererDir = join(platformDir, '..')

function instance(partial: Partial<OsBrowserInstanceLike> & { id: string }): OsBrowserInstanceLike {
  return {
    title: '',
    url: 'https://example.com',
    boundSessionId: null,
    ownerSessionId: null,
    agentControlActive: false,
    ...partial,
  }
}

describe('browser surface v2 model', () => {
  it('maps OS windows without duplicating embedded browser panes', () => {
    const tabs = osBrowserSurfaceTabs(
      [
        instance({ id: 'os-1', title: 'Docs' }),
        instance({ id: 'embedded-1', title: 'Inspector', embedded: true }),
      ],
      'os-1',
      'Browser',
    )

    expect(tabs).toEqual([{
      instanceId: 'os-1',
      title: 'Docs',
      focused: true,
      boundSessionId: null,
      agentControlActive: false,
    }])
  })
})

describe('commitAfterBrowserWindowAction termination boundary', () => {
  it('commits removal after destroy succeeds', async () => {
    let resolveDestroy!: () => void
    const destroyResult = new Promise<void>((resolve) => {
      resolveDestroy = resolve
    })
    let removed = false

    const termination = commitAfterBrowserWindowAction(
      () => destroyResult,
      () => {
        removed = true
      },
    )

    await Promise.resolve()
    expect(removed).toBe(false)

    resolveDestroy()
    await termination
    expect(removed).toBe(true)
  })

  it('does not remove the live instance when destroy rejects', async () => {
    const failure = new Error('destroy failed')
    let removed = false
    let thrown: unknown

    try {
      await commitAfterBrowserWindowAction(
        async () => {
          throw failure
        },
        () => {
          removed = true
        },
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(failure)
    expect(removed).toBe(false)
  })
})

describe('commitAfterBrowserWindowAction focus boundary', () => {
  it('commits the active id only after focus succeeds', async () => {
    let resolveFocus!: () => void
    const focusResult = new Promise<void>((resolve) => {
      resolveFocus = resolve
    })
    let activeId = 'previous'

    const focus = commitAfterBrowserWindowAction(
      () => focusResult,
      () => {
        activeId = 'focused'
      },
    )

    await Promise.resolve()
    expect(activeId).toBe('previous')

    resolveFocus()
    await focus
    expect(activeId).toBe('focused')
  })

  it('retains the prior active id when focus rejects', async () => {
    const failure = new Error('focus failed')
    let activeId = 'previous'
    let thrown: unknown

    try {
      await commitAfterBrowserWindowAction(
        async () => {
          throw failure
        },
        () => {
          activeId = 'focused'
        },
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(failure)
    expect(activeId).toBe('previous')
  })
})

describe('browser surface v2 source wiring', () => {
  const surfaceTabsSource = readFileSync(join(platformDir, 'SurfaceTabs.tsx'), 'utf8')
  const osBrowserTabsSource = readFileSync(join(platformDir, 'os-browser-tabs.ts'), 'utf8')
  const workspaceSurfaceHostSource = readFileSync(
    join(platformDir, 'WorkspaceSurfaceHost.tsx'),
    'utf8',
  )
  const appShellSource = readFileSync(
    join(rendererDir, 'components', 'app-shell', 'AppShell.tsx'),
    'utf8',
  )
  const topBarSource = readFileSync(
    join(rendererDir, 'components', 'app-shell', 'TopBar.tsx'),
    'utf8',
  )
  const browserWindowsSource = readFileSync(
    join(rendererDir, 'components', 'browser', 'use-workspace-browser-windows.ts'),
    'utf8',
  )
  const inspectorBrowserPaneSource = readFileSync(
    join(rendererDir, 'components', 'session-inspector', 'InspectorBrowserPane.tsx'),
    'utf8',
  )

  it('mounts one persistent SurfaceTabs owner from WorkspaceSurfaceHost', () => {
    expect(workspaceSurfaceHostSource).toContain("import { SurfaceTabs } from './SurfaceTabs'")
    expect(resolveWorkspaceSurfaceLayout({
      isCompact: false,
      panelCount: 1,
      chrome: { showSurfaceTabs: true, showInspector: false },
    }).showTabs).toBe(true)
    expect(workspaceSurfaceHostSource.indexOf('<SurfaceTabs />')).toBeLessThan(
      workspaceSurfaceHostSource.lastIndexOf('{children}'),
    )
    expect(appShellSource).not.toContain('SurfaceTabs')
    expect(
      `${workspaceSurfaceHostSource}\n${appShellSource}`.match(/<SurfaceTabs \/>/g),
    ).toHaveLength(1)
  })

  it('does not mount OS BrowserWindow chips on the embedded-default SurfaceTabs path', () => {
    expect(surfaceTabsSource).not.toContain('useWorkspaceBrowserWindows({')
    expect(surfaceTabsSource).not.toContain('osBrowserSurfaceTabs(')
    expect(surfaceTabsSource).not.toContain('function OsBrowserWindowControl')
    expect(surfaceTabsSource).toContain('do not mount OS BrowserWindow chips')
    expect(surfaceTabsSource.match(/role="tablist"/g)).toHaveLength(1)
    expect(osBrowserTabsSource).toContain('export function osBrowserSurfaceTabs')
  })

  it('keeps workspace browser window focus/terminate helpers for non-SurfaceTabs callers', () => {
    expect(browserWindowsSource).toContain('browserPaneApi.focus(instance.id)')
    expect(browserWindowsSource).toContain('browserPaneApi.destroy(instance.id)')
    expect(browserWindowsSource.match(/commitAfterBrowserWindowAction\(/g)).toHaveLength(2)
    const terminateSource = browserWindowsSource.slice(
      browserWindowsSource.indexOf('const terminateBrowserWindow'),
      browserWindowsSource.indexOf('return {', browserWindowsSource.indexOf('const terminateBrowserWindow')),
    )
    expect(terminateSource).toContain('if (instancesOverride)')
    expect(terminateSource).toContain('instancesOverride.find((item) => item.id !== instance.id)')
    expect(terminateSource).toContain('setActiveInstanceId')
  })

  it('cancels pending list owners and commits live focus only after success', () => {
    expect(browserWindowsSource.match(/let cancelled = false/g)).toHaveLength(2)
    expect(browserWindowsSource.match(/cancelled = true/g)).toHaveLength(2)
    expect(browserWindowsSource.match(/if \(cancelled\) return/g)).toHaveLength(7)

    const focusSource = browserWindowsSource.slice(
      browserWindowsSource.indexOf('const focusBrowserWindow'),
      browserWindowsSource.indexOf('const openSessionUsingWindow'),
    )
    expect(focusSource).toContain('if (instancesOverride)')
    expect(focusSource).toContain('setActiveInstanceId(instance.id)')
    expect(focusSource).toContain('commitAfterBrowserWindowAction(')
    expect(focusSource).toContain(
      'Failed to focus browser window ${instance.id}',
    )

    const liveFocusSource = focusSource.slice(focusSource.indexOf('const browserPaneApi'))
    expect(liveFocusSource.indexOf('browserPaneApi.focus(instance.id)')).toBeLessThan(
      liveFocusSource.indexOf('setActiveInstanceId(instance.id)'),
    )
  })

  it('routes every desktop browser-open affordance to the embedded inspector pane', () => {
    const openBrowserSource = appShellSource.slice(
      appShellSource.indexOf('const handleNewBrowserWindow'),
      appShellSource.indexOf('// Delete Source'),
    )
    expect(openBrowserSource).toContain('if (isWebUI)')
    expect(openBrowserSource).toContain('setWebBrowserOpen(true)')
    expect(openBrowserSource).not.toContain('if (!isWebUI) return')
    expect(openBrowserSource).not.toContain('browserPane.create({ show: true })')
    expect(openBrowserSource).toContain('setInspectorChromeCollapsed(false)')
    expect(openBrowserSource).toContain('setInspectorVisible(true)')
    expect(openBrowserSource).toContain("setInspectorSection('browser')")
    expect(inspectorBrowserPaneSource).toContain('window.electronAPI.browserPane.createEmbedded')
    expect(inspectorBrowserPaneSource).toContain('<BrowserPanelPage instanceId={instanceId} persist />')
    expect(openBrowserSource).toContain('void handleNewBrowserWindow()')
    expect(openBrowserSource).toContain(
      "window.addEventListener('craft:open-vps-browser', handleOpenBrowser)",
    )
    expect(openBrowserSource).toContain('[handleNewBrowserWindow]')
    expect(appShellSource.match(/addEventListener\('craft:open-vps-browser'/g)).toHaveLength(1)
    expect(appShellSource.indexOf('const handleNewBrowserWindow')).toBeLessThan(
      appShellSource.indexOf("addEventListener('craft:open-vps-browser'"),
    )
    expect(appShellSource).toContain(
      'onAddBrowserPanel={() => { void handleNewBrowserWindow() }}',
    )
    expect(topBarSource).toContain('onClick={onAddSessionPanel}')
    expect(topBarSource).toContain('onClick={onAddBrowserPanel}')
    expect(topBarSource).toContain('t("browser.newWindow")')
    expect(topBarSource).not.toContain('<StyledDropdownMenuItem onClick={onAddBrowserPanel}>')
  })
})
