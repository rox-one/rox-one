import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { commitAfterBrowserWindowAction } from '../../components/browser/use-workspace-browser-windows'
import { osBrowserSurfaceTabs, type OsBrowserInstanceLike } from '../os-browser-tabs'

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

  it('mounts one persistent SurfaceTabs owner from WorkspaceSurfaceHost', () => {
    expect(workspaceSurfaceHostSource).toContain("import { SurfaceTabs } from './SurfaceTabs'")
    expect(workspaceSurfaceHostSource).toContain(
      '{chrome.showSurfaceTabs && <SurfaceTabs />}',
    )
    expect(workspaceSurfaceHostSource.indexOf('<SurfaceTabs />')).toBeLessThan(
      workspaceSurfaceHostSource.lastIndexOf('{children}'),
    )
    expect(appShellSource).not.toContain('SurfaceTabs')
    expect(
      `${workspaceSurfaceHostSource}\n${appShellSource}`.match(/<SurfaceTabs \/>/g),
    ).toHaveLength(1)
  })

  it('keeps the live browser subscription in SurfaceTabs while v2 is enabled', () => {
    expect(surfaceTabsSource).toContain('useWorkspaceBrowserWindows({')
    expect(surfaceTabsSource).toMatch(/enabled:\s*browserSurfaceEnabled/)
    expect(surfaceTabsSource).toContain('osBrowserSurfaceTabs(')
    expect(surfaceTabsSource).toContain('onFocus={browserWindows.focusBrowserWindow}')
    expect(surfaceTabsSource).toContain('onTerminate={browserWindows.terminateBrowserWindow}')
  })

  it('routes OS window controls without panel-stack ids', () => {
    const osWindowControlSource = surfaceTabsSource.slice(
      surfaceTabsSource.indexOf('function OsBrowserWindowControl'),
      surfaceTabsSource.indexOf('export function SurfaceTabs'),
    )

    expect(osWindowControlSource).toContain('onFocus(instance)')
    expect(osWindowControlSource).toContain('onTerminate(instance)')
    expect(osWindowControlSource).toContain('onAuxClick=')
    expect(osWindowControlSource).toContain('role="group"')
    expect(osWindowControlSource).toContain('aria-label={tab.title}')
    expect(osWindowControlSource).toContain('aria-pressed={tab.focused}')
    expect(osWindowControlSource).toContain(
      "aria-label={t('workbench.browser.showWindow')}",
    )
    expect(osWindowControlSource).not.toContain('aria-label={`${')
    expect(osWindowControlSource).not.toContain('role="tab"')
    expect(osWindowControlSource).not.toContain('aria-selected')
    expect(osWindowControlSource).not.toContain('setFocusedPanelId')
    expect(osWindowControlSource).not.toContain('closePanel')
    expect(surfaceTabsSource.match(/role="tablist"/g)).toHaveLength(1)
    expect(surfaceTabsSource).toContain("aria-label={t('surfaceTabs.browser')}")
    expect(browserWindowsSource).toContain('browserPaneApi.focus(instance.id)')
    expect(browserWindowsSource).toContain('browserPaneApi.destroy(instance.id)')
    expect(browserWindowsSource.match(/commitAfterBrowserWindowAction\(/g)).toHaveLength(3)
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
    expect(focusSource).toMatch(
      /if \(instancesOverride\) \{\s+setActiveInstanceId\(instance\.id\)\s+return/,
    )
    expect(focusSource).toContain('commitAfterBrowserWindowAction(')
    expect(focusSource).toContain(
      'Failed to focus browser window ${instance.id}',
    )

    const liveFocusSource = focusSource.slice(focusSource.indexOf('const browserPaneApi'))
    expect(liveFocusSource.indexOf('browserPaneApi.focus(instance.id)')).toBeLessThan(
      liveFocusSource.indexOf('setActiveInstanceId(instance.id)'),
    )
  })

  it('creates a real desktop window only for browser surface v2', () => {
    expect(appShellSource).toContain(
      'const browserSurfaceEnabled = useAtomValue(featureWorkbenchBrowserSurfaceV2Atom)',
    )

    const openBrowserSource = appShellSource.slice(
      appShellSource.indexOf('const handleNewBrowserWindow'),
      appShellSource.indexOf('// Delete Source'),
    )
    expect(openBrowserSource).toContain('if (isWebUI)')
    expect(openBrowserSource).toContain('setWebBrowserOpen(true)')
    expect(openBrowserSource).not.toContain('if (!isWebUI) return')
    expect(openBrowserSource).toContain('if (browserSurfaceEnabled)')
    expect(openBrowserSource).toContain('browserPane.create({ show: true })')
    expect(openBrowserSource).toContain("setInspectorSection('browser')")
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
    expect(topBarSource).toContain('<StyledDropdownMenuItem onClick={onAddBrowserPanel}>')
    expect(topBarSource).toContain('t("browser.newWindow")')
  })
})
