import { describe, expect, test } from 'bun:test'
import { atom, createStore } from 'jotai'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { panelStackAtom, focusedPanelIdAtom, getPanelTypeFromRoute, type PanelStackEntry } from '../../../atoms/panel-stack'
import { routes, type ViewRoute } from '../../../../shared/routes'
import { focusServicePanelAtom } from '../service-navigation'
import { APP_NAV_DESTINATIONS_BY_ID, type AppNavDestinationId } from '../nav-destinations'

const source = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
const ast = ts.createSourceFile('AppShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(x => ts.isFunctionDeclaration(x) && x.name?.text === 'AppShellContent') as ts.FunctionDeclaration
if (!component?.body) throw new Error('Actual AppShellContent missing')
const selected = ['handleServiceClick', 'handleAllSessionsClick', 'handleNotesClick', 'handleSourcesClick', 'handleSourcesApiClick', 'handleSourcesMcpClick', 'handleSourcesLocalClick', 'handleSkillsClick', 'handleMemoryClick', 'handleTasksClick', 'handleMeetingsClick', 'handleAutomationsClick', 'handleProjectsClick', 'handlePagesClick', 'handleSettingsClick']
const declarations = component.body.statements.filter(ts.isVariableStatement).flatMap(x => [...x.declarationList.declarations])
const body = selected.map(name => {
 const declaration = declarations.find(x => ts.isIdentifier(x.name) && x.name.text === name)
 if (!declaration?.initializer && name === 'handleServiceClick') return 'const handleServiceClick = undefined;'
 if (!declaration?.initializer) throw new Error('Actual service callback absent: ' + name)
 return `const ${name} = ${declaration.initializer.getText(ast)};`
}).join('\n')
const program = ts.transpileModule(body + `\nreturn { ${selected.join(', ')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const panel = (id: string, route: ViewRoute, proportion = 0.5): PanelStackEntry => ({ id, route, proportion, panelType: getPanelTypeFromRoute(route), laneId: 'main' })
function fixture(panels: PanelStackEntry[], focused: string, compact = false) {
 const store = createStore(); store.set(panelStackAtom, panels); store.set(focusedPanelIdAtom, focused)
 const calls: ViewRoute[] = []
 const draftAtom = atom(new Map([['chat-a', 'unsent text']]))
 const args = { useCallback: (fn: unknown) => fn, focusServicePanel: (id: AppNavDestinationId) => store.set(focusServicePanelAtom, id),
  APP_NAV_DESTINATIONS_BY_ID, routes, isAutoCompact: compact, navState: { navigator: 'sessions' }, navigate: (route: ViewRoute) => calls.push(route) }
 const callbacks = new Function(...Object.keys(args), program)(...Object.values(args)) as Record<string, (...args: any[]) => void>
 return { store, callbacks, calls, draftAtom }
}
describe('actual AppShell service selection over current panel owner', () => {
 test('Notes root focuses an existing detailed panel and preserves panel identities/routes/proportions and drafts', () => {
  const panels = [panel('chat', routes.view.allSessions('chat-a'), 0.35), panel('notes', routes.view.notes('selected-note'), 0.65)]
  const f = fixture(panels, 'chat'); const before = f.store.get(panelStackAtom); const drafts = f.store.get(f.draftAtom)
  f.callbacks.handleNotesClick!()
  expect(f.store.get(focusedPanelIdAtom)).toBe('notes'); expect(f.store.get(panelStackAtom)).toBe(before); expect(f.store.get(f.draftAtom)).toBe(drafts); expect(f.calls).toEqual([])
  f.callbacks.handleAllSessionsClick!(); expect(f.store.get(focusedPanelIdAtom)).toBe('chat'); expect(f.calls).toEqual([])
 })
 test('same-service focus is preferred among multiple matching panels; absent service navigates current registry route', () => {
  const panels = [panel('note-a', routes.view.notes('a')), panel('note-b', routes.view.notes('b'))]; const f = fixture(panels, 'note-b')
  f.callbacks.handleNotesClick!(); expect(f.store.get(focusedPanelIdAtom)).toBe('note-b'); expect(f.calls).toEqual([])
  f.callbacks.handleSkillsClick!(); expect(f.calls).toEqual([routes.view.skills()]); expect(f.store.get(panelStackAtom)).toBe(panels)
 })
 test('explicit source subcategory and settings subpage preserve navigation; compact bare Settings keeps drill-in', () => {
  const panels = [panel('chat', routes.view.allSessions('chat-a')), panel('settings', routes.view.settings('account'))]
  const f = fixture(panels, 'chat'); f.callbacks.handleSettingsClick!(); expect(f.store.get(focusedPanelIdAtom)).toBe('settings'); expect(f.calls).toEqual([])
  f.callbacks.handleSettingsClick!('app'); f.callbacks.handleSourcesApiClick!(); f.callbacks.handleSourcesMcpClick!(); f.callbacks.handleSourcesLocalClick!()
  expect(f.calls).toEqual([routes.view.settings('app'), routes.view.sourcesApi(), routes.view.sourcesMcp(), routes.view.sourcesLocal()])
  const compact = fixture(panels, 'chat', true); compact.callbacks.handleSettingsClick!(); expect(compact.calls).toEqual([routes.view.settings()]); expect(compact.store.get(focusedPanelIdAtom)).toBe('chat')
 })
 test('every current root service has fallback through its existing registry; Connections inline selection shares the same callback', () => {
  const names = ['handleAllSessionsClick', 'handleNotesClick', 'handleSourcesClick', 'handleSkillsClick', 'handleMemoryClick', 'handleTasksClick', 'handleMeetingsClick', 'handleAutomationsClick', 'handleProjectsClick', 'handlePagesClick']
  const ids = ['sessions', 'notes', 'sources', 'skills', 'memory', 'tasks', 'meetings', 'automations', 'projects', 'pages'] as const
  const f = fixture([], 'none'); names.forEach(name => f.callbacks[name]!()); f.callbacks.handleServiceClick!('connections')
  expect(f.calls).toEqual([...ids.map(id => APP_NAV_DESTINATIONS_BY_ID[id].route!()), routes.view.connections()])
  expect(source).toContain("onClick: () => handleServiceClick('connections')")
 })
})
