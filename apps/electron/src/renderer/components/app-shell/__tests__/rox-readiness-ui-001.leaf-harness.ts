import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as React from 'react'

/** Execute the exact production closure with only external boundaries supplied. */
export function leafCallback(path: URL, name: string, bindings: Record<string, unknown>) {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!expression) throw new Error(`Missing production callback ${name}`)
  const code = ts.transpileModule(`const callback = ${expression.getText(file)}; return callback`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  return Function(...Object.keys(bindings), code)(...Object.values(bindings)) as (...args: any[]) => any
}

/** Render the production function's JSX; hooks and external transport are seams. */
export function leafComponent(path: URL, name: string, bindings: Record<string, unknown>) {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)
  if (!fn) throw new Error(`Missing production component ${name}`)
  const code = ts.transpileModule(`${fn.getText(file).replace(/^export\s+default\s+/, '')}; return ${name}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText
  return Function(...Object.keys(bindings), code)(...Object.values(bindings)) as (props: any) => React.ReactElement
}

export function elementIn(tree: React.ReactNode, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined {
  if (!React.isValidElement(tree)) return undefined
  const element = tree as React.ReactElement<any>
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props.children)) {
    const found = elementIn(child, predicate)
    if (found) return found
  }
  return undefined
}

/** Execute a production function declaration with injected external boundaries. */
export function leafFunction(path: URL, name: string, bindings: Record<string, unknown>) {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = file.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)
  if (!fn) throw new Error('Missing production function ' + name)
  const code = ts.transpileModule(fn.getText(file).replace('export default function', 'function').replace('export function', 'function') + '; return ' + name, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText
  return Function(...Object.keys(bindings), code)(...Object.values(bindings)) as (...args: any[]) => any
}

/** The framework's state commit is supplied; the production Retry is unchanged. */
export function leafClass(path: URL, name: string, bindings: Record<string, unknown>) {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = file.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)
  if (!declaration) throw new Error('Missing production class ' + name)
  const code = ts.transpileModule(declaration.getText(file) + '; return ' + name, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText
  return Function(...Object.keys(bindings), code)(...Object.values(bindings)) as {
    new (props: any): any
    getDerivedStateFromError(error?: unknown): any
  }
}

/** Compile an actual top-level registry; the module loader is the external seam. */
export function leafRegistry(path: URL, name: string, bindings: Record<string, unknown>) {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = file.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find(node => node.name.getText(file) === name)
  if (!declaration?.initializer) throw new Error('Missing production registry ' + name)
  const registry = ts.createSourceFile('registry.tsx', 'const registry = ' + declaration.initializer.getText(file) + '; return registry', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const transformed = ts.transform(registry, [context => node => {
    const visit: ts.Visitor = current => {
      if (ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword) {
        return context.factory.updateCallExpression(current, context.factory.createIdentifier('__load'), current.typeArguments, current.arguments)
      }
      return ts.visitEachChild(current, visit, context)
    }
    return ts.visitNode(node, visit) as ts.SourceFile
  }])
  const code = ts.transpileModule(ts.createPrinter().printFile(transformed.transformed[0]!), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText
  transformed.dispose()
  return Function(...Object.keys(bindings), code)(...Object.values(bindings)) as Record<string, React.ComponentType<any>>
}

export { deferred, rendererEffect, settle } from './rox-readiness-ui-001.effect-harness'
