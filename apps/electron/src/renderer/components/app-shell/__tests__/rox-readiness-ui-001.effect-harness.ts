import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { pathToFileURL } from 'node:url'

/** Compile the production effect closure; no copy of its logic or module-wide mocks. */
export function rendererEffect(path: URL, needle: string, bindings: Record<string, unknown>) {
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile('AppShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const effects: ts.Expression[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && /(?:^|\.)use(?:Layout)?Effect$/.test(node.expression.getText(file))) {
      const effect = node.arguments[0]
      if (effect?.getText(file).includes(needle)) effects.push(effect)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (effects.length !== 1) throw new Error(`Expected one effect for ${needle}, found ${effects.length}`)
  const javascript = ts.transpileModule(`const effect = ${effects[0]!.getText(file)}; return effect()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  return Function(...Object.keys(bindings), javascript)(...Object.values(bindings)) as undefined | (() => void)
}

export function appShellEffect(needle: string, bindings: Record<string, unknown>) {
  return rendererEffect(process.env.ROX_UI001_SHELL_SOURCE ? pathToFileURL(process.env.ROX_UI001_SHELL_SOURCE) : new URL('../AppShell.tsx', import.meta.url), needle, bindings)
}
export function mainPanelEffect(bindings: Record<string, unknown>) {
  return rendererEffect(process.env.ROX_UI001_MAIN_SOURCE ? pathToFileURL(process.env.ROX_UI001_MAIN_SOURCE) : new URL('../MainContentPanel.tsx', import.meta.url), 'api.onSourcesChanged', bindings)
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
