import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const source = readFileSync(join(import.meta.dir, '../../../App.tsx'), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback: ts.Expression | undefined
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleSwitchWorkspaceBySlug') callback = node.initializer
  ts.forEachChild(node, visit)
}
visit(ast)
if (!callback) throw new Error('Actual App workspace-history callback is absent')
const program = ts.transpileModule(`const callback = ${callback.getText(ast)}; return callback;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
function fixture(switchWorkspace: (id: string) => Promise<void>) {
  return new Function('useCallback', 'workspaces', 'handleSelectWorkspace', program)(
    (fn: unknown) => fn, [{ id: 'workspace-id', slug: 'workspace-slug' }], switchWorkspace,
  ) as (slug: string) => Promise<boolean>
}

test('actual App rejects a deleted workspace slug without requesting a switch', async () => {
  const calls: string[] = []
  const switchBySlug = fixture(async id => { calls.push(id) })
  expect(await switchBySlug('deleted-workspace')).toBe(false)
  expect(calls).toEqual([])
})

test('actual App confirms a history switch only after its asynchronous operation finishes', async () => {
  let finish!: () => void
  const calls: string[] = []
  const switchBySlug = fixture(id => { calls.push(id); return new Promise(resolve => { finish = resolve }) })
  let confirmed = false
  const result = switchBySlug('workspace-slug').then(value => { confirmed = value; return value })
  await Promise.resolve()
  expect(confirmed).toBe(false)
  expect(calls).toEqual(['workspace-id'])
  finish()
  expect(await result).toBe(true)
})

test('actual App propagates a failed workspace operation to NavigationProvider recovery', async () => {
  const error = new Error('workspace switch rejected')
  const switchBySlug = fixture(async () => { throw error })
  await expect(switchBySlug('workspace-slug')).rejects.toBe(error)
})
