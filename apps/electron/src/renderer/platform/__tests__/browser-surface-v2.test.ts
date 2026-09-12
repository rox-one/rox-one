import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { removeBrowserWindowAfterDestroy } from '../../components/browser/use-workspace-browser-windows'
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

describe('removeBrowserWindowAfterDestroy', () => {
  it('commits removal after destroy succeeds', async () => {
    let resolveDestroy!: () => void
    const destroyResult = new Promise<void>((resolve) => {
      resolveDestroy = resolve
    })
    let removed = false

    const termination = removeBrowserWindowAfterDestroy(
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
      await removeBrowserWindowAfterDestroy(
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

describe('browser surface v2 source wiring', () => {
  const surfaceTabsSource = readFileSync(join(platformDir, 'SurfaceTabs.tsx'), 'utf8')
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

  it('keeps the live browser subscription in SurfaceTabs while v2 is enabled', () => {
    expect(surfaceTabsSource).toContain('useWorkspaceBrowserWindows({')
    expect(surfaceTabsSource).toMatch(/enabled:\s*browserSurfaceEnabled/)
    expect(surfaceTabsSource).toContain('osBrowserSurfaceTabs(')
    expect(surfaceTabsSource).toContain('onFocus={browserWindows.focusBrowserWindow}')
    expect(surfaceTabsSource).toContain('onTerminate={browserWindows.terminateBrowserWindow}')
  })

  it('routes OS tab activation and termination without panel-stack ids', () => {
    const osWindowControlSource = surfaceTabsSource.slice(
      surfaceTabsSource.indexOf('function OsBrowserWindowControl'),
      surfaceTabsSource.indexOf('export function SurfaceTabs'),
    )

    expect(osWindowControlSource).toContain('onFocus(instance)')
    expect(osWindowControlSource).toContain('onTerminate(instance)')
    expect(osWindowControlSource).toContain('onAuxClick=')
    expect(osWindowControlSource).toContain('role="group"')
    expect(osWindowControlSource).not.toContain('role="tab"')
    expect(osWindowControlSource).not.toContain('aria-selected')
    expect(osWindowControlSource).not.toContain('setFocusedPanelId')
    expect(osWindowControlSource).not.toContain('closePanel')
    expect(surfaceTabsSource.match(/role="tablist"/g)).toHaveLength(1)
    expect(surfaceTabsSource).toContain("aria-label={t('surfaceTabs.browser')}")
    expect(browserWindowsSource).toContain('browserPaneApi.focus(instance.id)')
    expect(browserWindowsSource).toContain('browserPaneApi.destroy(instance.id)')
    expect(browserWindowsSource).toContain('removeBrowserWindowAfterDestroy(')
  })

  it('mounts the strip and creates a real desktop window only for browser surface v2', () => {
    expect(appShellSource).toContain(
      'const browserSurfaceEnabled = useAtomValue(featureWorkbenchBrowserSurfaceV2Atom)',
    )
    expect(appShellSource).toContain(
      '(unifiedShellEnabled || workbenchEnabled || browserSurfaceEnabled) && <SurfaceTabs />',
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
