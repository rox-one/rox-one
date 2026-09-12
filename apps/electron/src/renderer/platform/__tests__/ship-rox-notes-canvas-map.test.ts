import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPanelRegistry } from '@craft-agent/core/platform'
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
const knowledgeEntityPageSource = readRendererSource('pages/KnowledgeEntityPage.tsx')
const chatPageSource = readRendererSource('pages/ChatPage.tsx')
const appShellSource = readRendererSource('components/app-shell/AppShell.tsx')
const topBarSource = readRendererSource('components/app-shell/TopBar.tsx')
const panelHostSource = readRendererSource('platform/PanelHost.tsx')
const fundPanelSource = readRendererSource('platform/conation/ConationFundPanel.tsx')
const boardPanelSource = readRendererSource('platform/conation/ConationBoardPanel.tsx')

describe('ship-rox Notes, Canvas, and Map wiring', () => {
  it('keeps Notes on its real route and Electron list/read/save data path', () => {
    expect(notesNavigationSource).toContain('route: () => routes.view.notes()')
    expect(notesPageSource).toContain('window.electronAPI.listNotes')
    expect(notesPageSource).toContain('window.electronAPI.readNote')
    expect(notesPageSource).toContain('window.electronAPI.saveNote')
  })

  it('mounts existing note and session Map surfaces through EntityViewTabs', () => {
    expect(entityViewTabsSource).toContain("id: 'map'")
    expect(notesPageSource).toMatch(
      /<EntityViewTabs[\s\S]{0,5000}map[\s\S]{0,5000}<MindMapHost/,
    )
    expect(knowledgeEntityPageSource).toMatch(
      /view === 'map'[\s\S]{0,2000}<MindMapHost/,
    )
    expect(chatPageSource).toMatch(
      /view === 'map'[\s\S]*<SessionWorkflowEditor/,
    )
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
    expect(panelHostSource).not.toContain('registerMapPanel')
    expect(panelHostSource).not.toContain('void contribution')
    expect(boardPanelSource).not.toContain('/kanban/')
    expect(boardPanelSource).not.toContain('<Kanban')
  })
})
