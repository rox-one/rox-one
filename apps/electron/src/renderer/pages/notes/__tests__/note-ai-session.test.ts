import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import {
  bindRightSessionContext,
  describeRightSessionOpen,
  revisionByEntityId,
} from '../../../components/session-workbench/right-session-shell'
import { bindNativeNote, NOTES_SURFACE_ID } from '../../notes-rox2-surface'

// Execute the actual Notes action callback; no component-specific copy of its
// model selection or right-session reuse logic is maintained in this fixture.
const source = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')
const ast = ts.createSourceFile('NotesPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'NativeNotesPage') as ts.FunctionDeclaration
const declaration = component?.body?.statements.filter(ts.isVariableStatement)
  .flatMap(node => [...node.declarationList.declarations])
  .find(node => ts.isIdentifier(node.name) && node.name.text === 'openNotesRightSession')
if (!declaration?.initializer) throw new Error('Actual Notes AI callback is missing')
const executable = ts.transpileModule(`return ${declaration.initializer.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

function fixture(workspaceDefaultModel: string) {
  const events: Array<[string, unknown]> = []
  let context: ReturnType<typeof bindRightSessionContext> | null = null
  const render = () => {
    const bindings = {
      React: { useCallback: (callback: unknown) => callback },
      activeWorkspaceId: 'notes-workspace',
      activeNote: { id: 'note-1', title: 'A note', updatedAt: 123 },
      rightSessionContext: context,
      NOTES_SURFACE_ID,
      bindNativeNote,
      bindRightSessionContext,
      describeRightSessionOpen,
      revisionByEntityId,
      async onCreateSession(workspaceId: string, options: { name: string; model?: string }) {
        const resolvedModel = options.model ?? workspaceDefaultModel
        if (resolvedModel !== workspaceDefaultModel) throw new Error('Requested model is unavailable on the selected provider')
        events.push(['create', { workspaceId, name: options.name, model: resolvedModel }])
        return { id: 'created-session' }
      },
      onInputChange: (sessionId: string, prompt: string) => events.push(['draft', { sessionId, prompt }]),
      setRightSessionContext: (next: typeof context) => { context = next },
      setSideSessionPrompt: (prompt: string) => events.push(['prompt', prompt]),
      setSideNoteChip: (chip: unknown) => events.push(['chip', chip]),
      setRightSessionFocusToken: () => events.push(['focus', true]),
    }
    return new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as
      (options: { sessionName: string; prompt: string; chip: { title: string; path: string } }) => Promise<void>
  }
  return { render, events }
}

const action = { sessionName: 'Analyze note', prompt: 'Summarize this note', chip: { title: 'A note', path: 'notes/a.md' } }

describe('Notes AI uses the selected workspace model', () => {
  test('opens a draft on Rox and on configured external or local providers', async () => {
    for (const model of ['rox/r1-max', 'claude-opus-4-8', 'pi/gpt-6-astra', 'private/local-model']) {
      const f = fixture(model)
      await f.render()(action)
      expect(f.events[0]).toEqual(['create', { workspaceId: 'notes-workspace', name: action.sessionName, model }])
      expect(f.events).toContainEqual(['draft', { sessionId: 'created-session', prompt: action.prompt }])
      expect(f.events.at(-1)).toEqual(['focus', true])
    }
  })

  test('reuses the same note session without replacing its model or draft', async () => {
    const f = fixture('private/local-model')
    await f.render()(action)
    f.events.length = 0
    await f.render()({ ...action, prompt: 'A later prompt' })
    expect(f.events).toEqual([['focus', true]])
  })
})
