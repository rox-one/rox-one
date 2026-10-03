import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createStore } from 'jotai'
import { focusServicePanelAtom } from '../service-navigation'
import { APP_NAV_DESTINATIONS_BY_ID, type AppNavDestinationId } from '../nav-destinations'
import { routes } from '../../../../shared/routes'

// Executes the actual named/sidebar callback and, when present, its actual
// central service callback. Navigation is a recording sink; focus uses real atoms.
export function invokeShellNavigationCallback(path: string, target: { name: string } | { sidebarId: string }, store = createStore()): string[] {
  const source = readFileSync(process.env.ROX_UI001_SHELL_CALLBACK_SOURCE ?? path, 'utf8')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback = '', serviceCallback = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleServiceClick'
      && node.initializer && ts.isCallExpression(node.initializer)) serviceCallback = node.initializer.arguments[0]?.getText(file) ?? ''
    if ('name' in target && ts.isVariableDeclaration(node) && node.name.getText(file) === target.name
      && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0]?.getText(file) ?? ''
    if ('sidebarId' in target && ts.isObjectLiteralExpression(node)) {
      const property = (name: string) => node.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(file) === name) as ts.PropertyAssignment | undefined
      const id = property('id')?.initializer
      if (id && ts.isStringLiteral(id) && id.text === target.sidebarId) callback = property('onClick')?.initializer.getText(file) ?? ''
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!callback) throw new Error(`Actual shell callback missing: ${JSON.stringify(target)}`)
  const calls: string[] = []
  const script = ts.transpileModule(
    `const handleServiceClick = ${serviceCallback || 'undefined'}; const handler = (${callback});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText
  const handler = new Function('navigate', 'routes', 'focusServicePanel', 'APP_NAV_DESTINATIONS_BY_ID', `${script}; return handler`)(
    (route: string) => calls.push(route), routes,
    (serviceId: AppNavDestinationId) => store.set(focusServicePanelAtom, serviceId),
    APP_NAV_DESTINATIONS_BY_ID,
  ) as () => void
  handler()
  return calls
}
