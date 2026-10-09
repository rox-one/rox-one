import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { getDefaultStore } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { commitAfterBrowserWindowAction } from '../../components/browser/use-workspace-browser-windows'
import { osBrowserSurfaceTabs, type OsBrowserInstanceLike } from '../os-browser-tabs'
import { resolveWorkspaceSurfaceLayout } from '../workspace-surface-layout'

// SurfaceTabs reads the active workspace from AppShellContext; the repo's
// SurfaceTabs browser fixture stubs that module the same way, so a bare context
// is the established harness. The other exports are stubbed too because this
// file also loads `use-workspace-browser-windows` for its pure termination
// helper.
mock.module('@/context/AppShellContext', () => ({
  useActiveWorkspace: () => ({ id: 'ws' }),
  useOptionalAppShellContext: () => null,
  useAppShellContext: () => {
    throw new Error('AppShellContext not provided in this test')
  },
}))

import { SurfaceTabs } from '../SurfaceTabs'

const i18n = createInstance()
void i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  keySeparator: false,
  resources: { en: { translation: {} } },
  initAsync: false,
})

const panel = (id: string, route: string, panelType: PanelStackEntry['panelType']): PanelStackEntry =>
  ({ id, route, proportion: 1, panelType, laneId: 'main' })

function renderSurfaceTabs(): string {
  const store = getDefaultStore()
  store.set(panelStackAtom, [
    panel('one', 'notes', 'other'),
    panel('two', 'tasks', 'other'),
    panel('browser', 'browser/instance/hidden', 'browser'),
  ])
  store.set(focusedPanelIdAtom, 'one')
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(SurfaceTabs)))
}

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

  it('renders one tablist through the shared primitive and never an OS BrowserWindow chip', () => {
    // Catches a hand-rolled tablist (extra role=tablist / no data-tabs) and an
    // OS BrowserWindow chip reappearing on the embedded-default SurfaceTabs path.
    const html = renderSurfaceTabs()
    expect(html.match(/role="tablist"/g)).toHaveLength(1)
    expect(html).toContain('data-tabs="surface"')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).not.toContain('data-tab="browser"')
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
    expect(appShellSource).toContain('onOpenBrowserTab={openBrowserTab}')
    expect(topBarSource).toContain('onClick={onAddSessionPanel}')
    // «Новая вкладка» (Plus) — самая правая кнопка топбара; компактное меню
    // продолжает открывать embedded-инспектор.
    expect(topBarSource).toContain('onClick={onOpenBrowserTab}')
    expect(topBarSource).toContain('t("browser.newTab")')
    expect(topBarSource).not.toContain('t("browser.newWindow")')
    expect(topBarSource).toContain('onOpenBrowser={onAddBrowserPanel}')
    expect(topBarSource).not.toContain('<StyledDropdownMenuItem onClick={onAddBrowserPanel}>')
  })
})
