import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { PersonalTaskStore } from '@rox/core/tasks/personal'

const source = readFileSync(join(import.meta.dir, '../TasksPage.tsx'), 'utf8')
const ast = ts.createSourceFile('TasksPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let initializer: ts.Expression | undefined
function scan(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'onImport') initializer = node.initializer
  ts.forEachChild(node, scan)
}
scan(ast); if (!initializer) throw new Error('Actual TasksPage file import consumer missing')
const program = ts.transpileModule(`return (${initializer.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
function fixture() {
  const store = new PersonalTaskStore(); store.create({ id: 'existing', title: 'Existing task' })
  const events: Array<[string, unknown]> = []; const persisted: PersonalTaskStore[] = []
  const toast = Object.assign((value: string) => events.push(['toast', value]), { error: (value: string) => events.push(['error', value]) })
  const args = { PersonalTaskStore, store, persist: (value: PersonalTaskStore) => persisted.push(value), toast, t: (key: string) => key }
  const onImport = new Function(...Object.keys(args), program)(...Object.values(args)) as (file: File) => Promise<void>
  return { onImport, events, persisted }
}
describe('actual TasksPage imported file callback', () => {
  test('malformed or duplicate task rows produce failure notice and perform no persistence', async () => {
    for (const raw of ['{"version":1,"tasks":[null]}', (() => { const s = new PersonalTaskStore(); const task = s.create({ title: 'Duplicate' }); return JSON.stringify({ version: 1, tasks: [task, task] }) })()]) {
      const f = fixture(); await f.onImport(new File([raw], 'tasks.json'))
      expect(f.events).toEqual([['error', 'tasks.toast.importFailed']]); expect(f.persisted).toEqual([])
    }
  })
  test('valid current meeting/mail links import alongside existing tasks through current persistence port', async () => {
    const imported = new PersonalTaskStore(); imported.create({ id: 'incoming', title: 'Imported', links: [{ id: 'meeting', kind: 'meeting' }, { id: 'mail', kind: 'mail' }] })
    const f = fixture(); await f.onImport(new File([imported.exportJson()], 'tasks.json'))
    expect(f.persisted).toHaveLength(1); expect(f.persisted[0]!.list().map(task => task.id)).toEqual(['existing', 'incoming'])
    expect(f.persisted[0]!.get('incoming')!.links).toEqual([{ id: 'meeting', kind: 'meeting' }, { id: 'mail', kind: 'mail' }])
    expect(f.events).toEqual([['toast', 'tasks.toast.imported']])
  })
})
