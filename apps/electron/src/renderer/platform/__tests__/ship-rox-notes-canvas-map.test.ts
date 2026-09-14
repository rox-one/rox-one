import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { createPanelRegistry } from '@craft-agent/core/platform'
import { defaultNoteEntityCapabilities } from '../../components/app-shell/EntityViewTabs'
import { NotesViewMenu } from '../../pages/notes/NotesWorkspaceChrome'
import {
  CONATION_BOARD_PANEL_ID,
  registerBoardPanel,
} from '../conation/conation-board-panels.ts'
import {
  CONATION_FUND_DEEP_LINK,
  CONATION_FUND_PANEL_ID,
  registerFundPanel,
} from '../conation/conation-fund-panels.ts'

const rendererRoot = join(__dirname, '..', '..')
const readRendererSource = (path: string): string =>
  readFileSync(join(rendererRoot, path), 'utf8')

const notesNavigationSource = readRendererSource('components/app-shell/nav-destinations.ts')
const entityViewTabsSource = readRendererSource('components/app-shell/EntityViewTabs.tsx')
const notesPageSource = readRendererSource('pages/NotesPage.tsx')
const notesWorkspaceChromeSource = readRendererSource('pages/notes/NotesWorkspaceChrome.tsx')
const knowledgeEntityPageSource = readRendererSource('pages/KnowledgeEntityPage.tsx')
const chatPageSource = readRendererSource('pages/ChatPage.tsx')
const appShellSource = readRendererSource('components/app-shell/AppShell.tsx')
const topBarSource = readRendererSource('components/app-shell/TopBar.tsx')
const panelHostSource = readRendererSource('platform/PanelHost.tsx')
const omniboxBootstrapSource = readRendererSource('platform/omnibox-bootstrap.ts')
const omniboxHostSource = readRendererSource('platform/OmniboxHost.tsx')
const omniboxConationSource = readRendererSource('platform/omnibox-conation.ts')
const fundPanelSource = readRendererSource('platform/conation/ConationFundPanel.tsx')
const boardPanelSource = readRendererSource('platform/conation/ConationBoardPanel.tsx')

describe('ship-rox Notes, Canvas, and Map wiring', () => {
  it('keeps Notes on its real route and Electron list/read/save data path', () => {
    expect(notesNavigationSource).toContain('route: () => routes.view.notes()')
    expect(notesPageSource).toContain('window.electronAPI.listNotes')
    expect(notesPageSource).toContain('window.electronAPI.readNote')
    expect(notesPageSource).toContain('window.electronAPI.saveNote')
  })

  it('connects the compact note view menu and existing session tabs to real Map/Canvas surfaces', () => {
    expect(entityViewTabsSource).toContain("id: 'map'")
    expect(notesPageSource).toContain('defaultNoteEntityCapabilities()')
    expect(notesPageSource).toMatch(/<NotesViewMenu\s+value=\{noteView\}\s+onChange=\{setNoteView\}\s+capabilities=\{noteViewCapabilities\}/)
    expect(notesWorkspaceChromeSource).toContain('capabilities.filter((capability) => capability.available)')
    expect(notesWorkspaceChromeSource).toContain('onSelect={() => onChange(id)}')
    expect(notesPageSource).toMatch(/noteView === 'map'\s*\?\s*\(\s*<MindMapHost/)
    expect(notesPageSource).toMatch(/noteView === 'canvas'[\s\S]{0,150}<NotesViewHost\s+view=\{noteView\}/)
    expect(knowledgeEntityPageSource).toMatch(
      /view === 'map'[\s\S]{0,2000}<MindMapHost/,
    )
    expect(chatPageSource).toMatch(
      /view === 'map'[\s\S]*<SessionWorkflowEditor/,
    )
  })

  it('keeps Map and Canvas selectable and announces their names in compact note controls', async () => {
    const capabilities = defaultNoteEntityCapabilities()
    const i18n = createInstance()
    await i18n.init({
      lng: 'en', fallbackLng: 'en',
      resources: { en: { translation: {
        'entityView.tabsLabel': 'View', 'entityView.map': 'Map', 'entityView.canvas': 'Canvas',
      } } },
    })
    for (const value of ['map', 'canvas'] as const) {
      expect(capabilities.find((capability) => capability.id === value)?.available).toBe(true)
      const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
        createElement(NotesViewMenu, { value, capabilities, compact: true, onChange: () => {} }),
      ))
      const trigger = html.match(/<button\b[^>]*>/)?.[0]
      expect(trigger).toBeDefined()
      expect(trigger).toContain('aria-haspopup="menu"')
      expect(trigger).toContain('aria-expanded="false"')
      expect(trigger).not.toContain('disabled=""')
      // Other shell suites use a global key-returning translation mock.
      const expectedName = value === 'map' ? /aria-label="(?:View: Map|entityView.tabsLabel: entityView.map)"/
        : /aria-label="(?:View: Canvas|entityView.tabsLabel: entityView.canvas)"/
      expect(trigger).toMatch(expectedName)
    }
  })

  it('opens the focused session Map from a dedicated TopBar affordance', () => {
    expect(topBarSource).toContain('onClick={onOpenMap}')
    expect(topBarSource).toContain('disabled={!mapAvailable}')
    expect(topBarSource).toContain('aria-label={t("entityView.map")}')
    expect(appShellSource).toContain('const handleOpenMap = useCallback')
    expect(appShellSource).toContain("new CustomEvent('craft:session-view'")
    expect(appShellSource).toContain("detail: { sessionId: effectiveSessionId, view: 'map' }")
    expect(chatPageSource).toContain("window.addEventListener('craft:session-view', handler)")
    expect(chatPageSource).toContain("if (targetId === sessionId && (view === 'map'")
  })

  it('keeps Map disabled when no session is focused', () => {
    expect(appShellSource).toContain('mapAvailable={Boolean(effectiveSessionId)}')
    expect(topBarSource).toContain('disabled={!mapAvailable}')
  })

  it('registers Fund Canvas in the real registry while keeping Board separate', () => {
    const registry = createPanelRegistry()
    registerFundPanel(
      registry,
      () => null,
      {
        shellEnabled: true,
        inspectorEnabled: true,
        canvasEnabled: true,
      },
      'Fund Canvas',
    )
    registerBoardPanel(
      registry,
      () => null,
      {
        shellEnabled: true,
        inspectorEnabled: true,
        boardEnabled: true,
      },
      'Board',
    )

    expect(registry.list('inspector', {}).map((panel) => panel.id)).toEqual(
      expect.arrayContaining([CONATION_FUND_PANEL_ID, CONATION_BOARD_PANEL_ID]),
    )
    expect(CONATION_BOARD_PANEL_ID).not.toBe(CONATION_FUND_PANEL_ID)
    expect(CONATION_FUND_DEEP_LINK).toBe('https://conation.dev')
    expect(fundPanelSource).toContain('CONATION_FUND_DEEP_LINK')
    expect(fundPanelSource).toContain('openUrl')
    expect(panelHostSource).toContain('getAppPanelRegistry()')
    expect(panelHostSource).toContain('registerFundPanel(')
    expect(panelHostSource).toContain('registerBoardPanel(')
    expect(omniboxBootstrapSource).toContain('registerConationCommands(')
    expect(omniboxConationSource).toContain("CONATION_OPEN_FUND_COMMAND_ID = 'conation.openFund'")
    expect(omniboxConationSource).toContain("CONATION_OPEN_BOARD_COMMAND_ID = 'conation.openBoard'")
    expect(omniboxHostSource).toContain('createConationContextKeyProvider(')
    expect(panelHostSource).not.toContain('registerMapPanel')
    expect(panelHostSource).not.toContain('void contribution')
    expect(boardPanelSource).not.toContain('/kanban/')
    expect(boardPanelSource).not.toContain('<Kanban')
  })
})
