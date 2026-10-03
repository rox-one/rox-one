import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import ts from 'typescript'
import * as navigationGuards from '../../../../shared/types'
import { parseRouteToNavigationState } from '../../../../shared/route-parser'
import { createStore } from 'jotai/vanilla'
import { bottomTerminalOpenAtom } from '../../../atoms/unified-shell'
import { navigationEntity } from '../../../features/product-tour/runtime/routes'

const mainContentSource = readFileSync(join(__dirname, '../MainContentPanel.tsx'), 'utf8')
const navContextSource = readFileSync(
  join(__dirname, '../../../contexts/NavigationContext.tsx'),
  'utf8',
)
const terminalPage = readFileSync(
  join(__dirname, '../../../pages/TerminalSurfacePage.tsx'),
  'utf8',
)
const cloudRunPage = readFileSync(
  join(__dirname, '../../../pages/CloudRunSurfacePage.tsx'),
  'utf8',
)
const localesDir = join(__dirname, '../../../../../../../packages/shared/src/i18n/locales')

const SURFACE_KEYS = [
  'terminal.surface.noTerminalSelected',
  'terminal.surface.openDock',
  'terminal.surface.useDockHint',
  'cloudRuns.surface.noRunSelected',
  'cloudRuns.surface.unavailable',
  'cloudRuns.surface.notFound',
  'cloudRuns.surface.openSettings',
  'cloudRuns.surface.useChipHint',
  'cloudRuns.surface.openSession',
] as const

// Execute the production dispatcher with context/hooks and leaf host boundaries
// controlled. This checks addresses delivered to hosts, not installed UI state.
function dispatch(route: string): React.ReactElement {
  const file = ts.createSourceFile('MainContentPanel.tsx', mainContentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = file.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'MainContentPanel')
  if (!declaration) throw new Error('MainContentPanel production dispatcher is missing')
  const javascript = ts.transpileModule(declaration.getText(file).replace(/^export /, '') + ';return MainContentPanel', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText
  const selection = {
    useIsMultiSelectActive: () => false, useSelectionCount: () => 0,
    useSelectedIds: () => new Set(), useSelection: () => ({ clearMultiSelect() {} }),
  }
  const names = ['Panel', 'StoplightProvider', 'TourPanelScope', 'RouteErrorBoundary', 'SendResourceToWorkspaceDialog',
    'TerminalSurfacePage', 'CloudRunSurfacePage', 'ChatPage']
  const sessionMetaMapAtom = Symbol()
  const state = parseRouteToNavigationState(route)!
  const bindings: Record<string, unknown> = {
    ...navigationGuards, ...Object.fromEntries(names.map(name => [name, name])), React, navigationEntity,
    useCallback: (callback: unknown) => callback, useEffect() {}, useMemo: (callback: () => unknown) => callback(),
    useState: (initial: unknown) => [initial, () => {}], useTranslation: () => ({ t: (key: string) => key }),
    useNavigationState: () => state, useNavigation: () => ({ isSessionsReady: true }),
    useAppShellContext: () => ({ activeWorkspaceId: 'workspace-owner', workspaces: [], sessionStatuses: [], projects: [], loadedProjects: [], labels: [] }),
    sessionMetaMapAtom, automationsAtom: Symbol(),
    useAtomValue: (atom: symbol) => atom === sessionMetaMapAtom ? new Map() : [], useSetAtom: () => () => {},
    knowledgeHomeViewAtom: Symbol(), knowledgeActiveViewIdAtom: Symbol(),
    TourPanelScope: ({ children }: { children: React.ReactNode }) => children, sourceSelection: selection, skillSelection: selection, automationSelection: selection,
    useSelectedResourceAvailability: () => ({ status: 'ready', retry() {} }),
  }
  const panel = Function(...Object.keys(bindings), javascript)(...Object.values(bindings))
  return panel({ navStateOverride: state })
}

function element(root: unknown, type: string): React.ReactElement<Record<string, unknown>> | undefined {
  if (!React.isValidElement<Record<string, unknown>>(root)) return undefined
  if (root.type === type) return root
  const children = root.props.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = element(child, type)
    if (found) return found
  }
  return undefined
}

function terminalSurface(terminalId: string | null) {
  const file = ts.createSourceFile('TerminalSurfacePage.tsx', terminalPage, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = file.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'TerminalSurfacePage')
  if (!declaration) throw new Error('TerminalSurfacePage production host is missing')
  const code = ts.transpileModule(declaration.getText(file).replace(/^export default /, '') + ';return TerminalSurfacePage', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText
  const store = createStore()
  store.set(bottomTerminalOpenAtom, false)
  const host = Function('React', 'useSetAtom', 'useTranslation', 'bottomTerminalOpenAtom', code)(
    { ...React, useCallback: (callback: unknown) => callback },
    (atom: typeof bottomTerminalOpenAtom) => (value: boolean) => store.set(atom, value),
    () => ({ t: (key: string) => key }), bottomTerminalOpenAtom,
  )
  return { root: host({ terminalId }) as React.ReactElement<Record<string, unknown>>, store }
}

describe('MainContentPanel terminal + cloud-run hosts (#571)', () => {
  it('wires isTerminalNavigation / isCloudRunNavigation to dedicated surface pages', () => {
    expect(mainContentSource).toContain('isTerminalNavigation')
    expect(mainContentSource).toContain('isCloudRunNavigation')
    expect(mainContentSource).toContain('TerminalSurfacePage')
    expect(mainContentSource).toContain('CloudRunSurfacePage')
    expect(navContextSource).toContain('isTerminalNavigation')
  })

  it('dispatches selected and empty terminal/cloud-run addresses to their own hosts', () => {
    for (const [route, host, field, expected] of [
      ['terminal/pty-alpha', 'TerminalSurfacePage', 'terminalId', 'pty-alpha'],
      ['terminal', 'TerminalSurfacePage', 'terminalId', null],
      ['cloud-run/run-alpha', 'CloudRunSurfacePage', 'runId', 'run-alpha'],
      ['cloud-run', 'CloudRunSurfacePage', 'runId', null],
    ] as const) {
      const rendered = dispatch(route)
      expect(element(rendered, host)?.props[field]).toBe(expected)
      expect(element(rendered, 'ChatPage')).toBeUndefined()
    }
  })

  it('leaves browser/extension hosts intact', () => {
    expect(mainContentSource).toContain('isBrowserNavigation')
    expect(mainContentSource).toContain('BrowserPanelPage')
    expect(mainContentSource).toContain('isExtensionNavigation')
    expect(mainContentSource).toContain('ExtensionSurfacePage')
    expect(mainContentSource).toContain("t('browser.noInstanceSelected')")
    expect(mainContentSource).toContain("t('extensions.surface.noViewSelected')")
  })

  it('preserves a selected terminal as unavailable and opens the existing dock only on the explicit action', () => {
    const selected = terminalSurface('owned-pty-address')
    expect(selected.root.props['data-terminal-surface']).toBe('unavailable')
    expect(selected.root.props['data-terminal-id']).toBe('owned-pty-address')
    expect(selected.store.get(bottomTerminalOpenAtom)).toBe(false)
    const button = element(selected.root, 'button')!
    expect(typeof button.props.onClick).toBe('function')
    ;(button.props.onClick as () => void)()
    expect(selected.store.get(bottomTerminalOpenAtom)).toBe(true)

    const empty = terminalSurface(null)
    expect(empty.root.props['data-terminal-surface']).toBe('empty')
    expect(empty.root.props['data-terminal-id']).toBeUndefined()
    expect(empty.store.get(bottomTerminalOpenAtom)).toBe(false)
  })

  it('terminal preserves unsupported IDs on unavailable surface with an explicit dock path', () => {
    expect(terminalPage).not.toContain('<InspectorTerminal')
    expect(terminalPage).toContain('bottomTerminalOpenAtom')
    expect(terminalPage).toContain("t('terminal.surface.noTerminalSelected')")
    expect(terminalPage).toContain("t('terminal.surface.openDock')")
    expect(terminalPage).toContain("data-testid=\"terminal-surface-unavailable\"")
    expect(terminalPage).toContain("data-testid=\"terminal-surface-empty\"")
  })

  it('cloud-run host loads run status or honest unavailable + settings path', () => {
    expect(cloudRunPage).toContain('listCloudRuns')
    expect(cloudRunPage).toContain('getCloudRunsConfig')
    expect(cloudRunPage).toContain("t('cloudRuns.surface.unavailable')")
    expect(cloudRunPage).toContain("t('cloudRuns.surface.openSettings')")
    expect(cloudRunPage).toContain("settings('cloudRuns')")
    expect(cloudRunPage).toContain("data-testid=\"cloud-run-surface-host\"")
  })

  it('English and Russian locales keep distinct surface copy', () => {
    const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(en['terminal.surface.noTerminalSelected']).toBe('No terminal selected')
    expect(ru['terminal.surface.noTerminalSelected']).toBe('Терминал не выбран')
    expect(ru['terminal.surface.noTerminalSelected']).not.toBe(en['terminal.surface.noTerminalSelected'])
    expect(en['cloudRuns.surface.unavailable']).toBe('Cloud Runs surface is unavailable')
    expect(ru['cloudRuns.surface.unavailable']).toBe('Поверхность Cloud Runs недоступна')
  })

  it('all 12 locales define the wired surface keys', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([
      'ar.json',
      'de.json',
      'en.json',
      'es.json',
      'fr.json',
      'hu.json',
      'ja.json',
      'ko.json',
      'pl.json',
      'ru.json',
      'zh-Hans.json',
      'zh-Hant.json',
    ])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of SURFACE_KEYS) {
        expect(locale[key]?.length ?? 0).toBeGreaterThan(0)
      }
    }
  })
})
