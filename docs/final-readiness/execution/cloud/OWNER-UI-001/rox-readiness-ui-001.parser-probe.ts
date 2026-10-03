import { parseRouteToNavigationState } from '../../../../../apps/electron/src/shared/route-parser'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const routes = ['unknown-surface/one', 'knowledge/unknown-kind/one', 'knowledge/document/%E0%A4%A']
const observed = routes.map(route => {
  try { return { route, observed: parseRouteToNavigationState(route) } }
  catch (error) { return { route, thrown: String(error) } }
})
const source = readFileSync(new URL('../../../../../apps/electron/src/renderer/contexts/NavigationContext.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('NavigationContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback: ts.Expression | undefined
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'resolveAutoSelection' && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0]
  ts.forEachChild(node, visit)
}
visit(file)
if (!callback) throw new Error('Actual resolveAutoSelection callback not found')
const code = ts.transpileModule(`return (${callback.getText(file)})(newState)`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const dependencies = {
  isSessionsNavigation: (state: { navigator: string }) => state.navigator === 'sessions',
  store: { get: () => new Map([['unrelated-session', { id: 'unrelated-session', workspaceId: 'workspace-a' }]]) },
  sessionMetaMapAtom: {}, workspaceId: 'workspace-a', remoteWorkspaceId: null,
  getLastSelectedSessionId: () => null, getFirstSessionId: () => 'unrelated-session',
  newState: { navigator: 'sessions', filter: { kind: 'allSessions' }, details: { type: 'session', sessionId: 'deleted-session' } },
}
const selection = Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
console.log(JSON.stringify({ scope: 'Read-only characterization of lead-owned code; these gaps are not repaired by OWNER-UI-001', routes: observed, deletedSessionSelection: selection }, null, 2))
