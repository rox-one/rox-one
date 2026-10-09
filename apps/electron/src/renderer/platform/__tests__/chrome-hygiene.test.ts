/**
 * ship-rox-chrome-hygiene — the tab row must come from the shared `Tabs`
 * primitive and the embedded-default SurfaceTabs path must not mount OS
 * BrowserWindow chips. These are asserted by rendering the real component
 * (its committed markup), not by grepping its source.
 */
import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { getDefaultStore } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, type PanelStackEntry } from '@/atoms/panel-stack'

// SurfaceTabs reads the active workspace from AppShellContext; the repo's
// SurfaceTabs browser fixture stubs that module the same way, so a bare context
// is the established harness — no AppShell provider needed for the strip alone.
mock.module('@/context/AppShellContext', () => ({
  useActiveWorkspace: () => ({ id: 'ws' }),
  useOptionalAppShellContext: () => null,
  useAppShellContext: () => {
    throw new Error('AppShellContext not provided in this test')
  },
}))

import { SurfaceTabs } from '../SurfaceTabs'

const platformDir = join(import.meta.dir, '..')
const topBarPath = join(platformDir, '..', 'components', 'app-shell', 'TopBar.tsx')

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

describe('ship-rox-chrome-hygiene', () => {
  const inspectorHostSource = readFileSync(join(platformDir, 'InspectorHost.tsx'), 'utf8')
  const topBarSource = readFileSync(topBarPath, 'utf8')

  it('renders one tablist through the shared primitive and never an OS BrowserWindow chip', () => {
    // Catches a hand-rolled tablist (extra role=tablist / no data-tabs) and an
    // OS BrowserWindow chip reappearing on the embedded-default SurfaceTabs path.
    const html = renderSurfaceTabs()
    expect(html.match(/role="tablist"/g)).toHaveLength(1)
    expect(html).toContain('data-tabs="surface"')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).not.toContain('data-tab="browser"')
  })

  it('renders a collapsed restore strip in InspectorHost', () => {
    expect(inspectorHostSource).toContain('if (chromeCollapsed) {')
    expect(inspectorHostSource).not.toContain('return null')
    expect(inspectorHostSource).toContain('data-inspector="collapsed"')
    // One terminal entry point: the rail/panel chrome (no duplicate TopBar button).
    expect(inspectorHostSource).not.toContain('{terminalControl}')
    expect(topBarSource).not.toContain('data-testid="bottom-terminal-toggle"')
    expect(topBarSource).not.toContain('resolveBottomTerminalToggle')
  })
})