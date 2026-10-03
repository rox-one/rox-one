import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { activityRailWidth } from '../../../platform/ActivityRail'
import { resolveWorkbenchChrome } from '../../../platform/workbench-chrome'
import { PANEL_GAP } from '../panel-constants'

const shell = ts.createSourceFile('AppShell.tsx', readFileSync(resolve(import.meta.dir, '../AppShell.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const host = ts.createSourceFile('WorkspaceSurfaceHost.tsx', readFileSync(resolve(import.meta.dir, '../../../platform/WorkspaceSurfaceHost.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function declaration(file: ts.SourceFile, name: string): ts.Expression {
  let expression: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && (ts.isIdentifier(node.name) ? node.name.text === name : node.name.getText(file).includes(name))) expression = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!expression) throw new Error('Actual declaration absent: ' + name)
  return expression
}
function evaluate(file: ts.SourceFile, expression: ts.Expression, environment: Record<string, unknown>): any {
  const code = ts.transpileModule('const actual = ' + expression.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(environment), code + '; return actual')(...Object.values(environment))
}
function callback(expression: ts.Expression): ts.Expression {
  if (!ts.isCallExpression(expression)) throw new Error('Expected actual hook callback')
  return expression.arguments[0]!
}
let persist: ts.Expression | undefined
function findPersistence(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(shell) === 'React.useEffect' && node.arguments[0]?.getText(shell).includes('storage.set(storage.KEYS.sidebarVisible, storedSidebarVisible)')) persist = node.arguments[0]
  ts.forEachChild(node, findPersistence)
}
findPersistence(shell)
if (!persist) throw new Error('Actual sidebar persistence absent')
let ownsPrimaryNavigation = false
function findNavigationOwner(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.name.getText(shell) === 'ownsPrimaryNavigation') {
    ownsPrimaryNavigation = !node.initializer || (ts.isJsxExpression(node.initializer) && node.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword)
  }
  ts.forEachChild(node, findNavigationOwner)
}
findNavigationOwner(shell)
const routes = ['sessions', 'meetings', 'settings', 'home', 'tasks', 'notes', 'projects', 'pages', 'knowledge', 'connections', 'search', 'screen']

describe('actual combined sidebar preference and rail geometry', () => {
  it.each(routes)('restores, toggles, persists, and reloads the sidebar on %s', route => {
    const data: Record<string, unknown> = { 'sidebar-visible': true }
    const storage = { KEYS: { sidebarVisible: 'sidebar-visible' }, get: (key: string, fallback: unknown) => key in data ? data[key] : fallback, set: (key: string, value: unknown) => { data[key] = value } }
    const load = () => evaluate(shell, callback(declaration(shell, 'storedSidebarVisible')), { storage, defaultCollapsed: false })()
    let visible = load()
    const visibility = () => evaluate(shell, declaration(shell, 'isSidebarVisible'), { storedSidebarVisible: visible, navState: { navigator: route }, earlyNavState: { navigator: route } })
    expect(visibility()).toBe(true)
    const toggle = evaluate(shell, callback(declaration(shell, 'handleToggleSidebar')), {
      isSidebarAndNavigatorHidden: false,
      setIsSidebarAndNavigatorHidden: () => { throw new Error('ordinary toggle must preserve focus choice') },
      setIsSidebarVisible: (update: (value: boolean) => boolean) => { visible = update(visible) },
    })
    toggle()
    expect(visibility()).toBe(false)
    evaluate(shell, persist!, { storage, storedSidebarVisible: visible })()
    visible = load()
    expect(visibility()).toBe(false)
    toggle()
    evaluate(shell, persist!, { storage, storedSidebarVisible: visible })()
    expect(load()).toBe(true)
  })

  it('explicit focus and automatic compact suppression preserve the saved sidebar choice', () => {
    let focused = true
    let visible = true
    evaluate(shell, callback(declaration(shell, 'handleToggleSidebar')), {
      isSidebarAndNavigatorHidden: focused,
      setIsSidebarAndNavigatorHidden: (value: boolean) => { focused = value },
      setIsSidebarVisible: (update: (value: boolean) => boolean) => { visible = update(visible) },
    })()
    expect(focused).toBe(false)
    expect(visible).toBe(true)
    expect(evaluate(shell, declaration(shell, 'effectiveSidebarAndNavigatorHidden'), { isSidebarAndNavigatorHidden: false, isAutoCompact: true })).toBe(true)
    expect(evaluate(shell, declaration(shell, 'isSidebarVisible'), { storedSidebarVisible: visible })).toBe(true)
  })

  it('the primary sidebar suppresses duplicate rail geometry for every flag and collapse state', () => {
    expect(ownsPrimaryNavigation).toBe(true)
    for (const unifiedShellEnabled of [false, true]) for (const workbenchEnabled of [false, true]) for (const topChromeEnabled of [false, true]) for (const activityRailCollapsed of [false, true]) {
      const activityRailRendered = evaluate(shell, declaration(shell, 'activityRailRendered'), { unifiedShellEnabled, workbenchEnabled, topChromeEnabled })
      const granularChrome = evaluate(host, declaration(host, 'granularChrome'), { unifiedShell: unifiedShellEnabled, workbenchEnabled })
      const chrome = evaluate(host, declaration(host, 'chrome'), {
        resolveWorkbenchChrome, granularChrome, unifiedShell: unifiedShellEnabled, topChrome: topChromeEnabled,
        tabGroups: false, browserSurface: false, harnessInspector: false,
      })
      const offset = evaluate(shell, declaration(shell, 'unifiedRailOffset'), { activityRailRendered, activityRailCollapsed, activityRailWidth, PANEL_GAP })
      expect(activityRailRendered).toBe(chrome.showRail && !ownsPrimaryNavigation)
      expect(offset).toBe(chrome.showRail && !ownsPrimaryNavigation ? activityRailWidth(activityRailCollapsed) + PANEL_GAP : 0)
    }
  })
})
