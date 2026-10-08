import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { createStore } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, primaryPanelIdAtom, type PanelStackEntry } from '../../../atoms/panel-stack'
import { activeWorkspaceContextAtom } from '../../../atoms/workspace-context'
import { captureWorkspaceToolOpen, openWorkspaceTool } from '../../../lib/open-workspace-tool'
import { routes } from '../../../../shared/routes'
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

function fixture(workspaceDefaultModel: string, projectId?: string) {
  const events: Array<[string, unknown]> = []
  let context: ReturnType<typeof bindRightSessionContext> | null = null
  const store = createStore()
  const main: PanelStackEntry = { id: 'notes-main', route: routes.view.notes('note-1'), proportion: 1, panelType: 'other', laneId: 'main' }
  store.set(panelStackAtom, [main])
  store.set(primaryPanelIdAtom, main.id)
  store.set(focusedPanelIdAtom, main.id)
  store.set(activeWorkspaceContextAtom, 'notes-workspace')
  const sessionMetaMap = new Map<string, { projectId?: string }>()
  const openingAgentRef = { current: false }
  let created = 0
  let beforeResolve: (() => Promise<void> | void) | undefined
  const render = () => {
    const bindings = {
      React: { useCallback: (callback: unknown) => callback },
      activeWorkspaceId: 'notes-workspace',
      activeNote: { id: 'note-1', title: 'A note', updatedAt: 123 },
      activeProjectId: projectId,
      noteScope: { kind: 'workspace' },
      rightSessionContext: context,
      openingAgentRef,
      sessionMetaMap,
      store,
      panelId: main.id,
      captureWorkspaceToolOpen,
      openWorkspaceTool,
      routes,
      NOTES_SURFACE_ID,
      bindNativeNote,
      bindRightSessionContext,
      describeRightSessionOpen,
      revisionByEntityId,
      t: (key: string) => key,
      toast: { error: (message: unknown) => events.push(['error', message]) },
      async onCreateSession(workspaceId: string, options: { name: string; model?: string; projectId?: string }) {
        const resolvedModel = options.model ?? workspaceDefaultModel
        if (resolvedModel !== workspaceDefaultModel) throw new Error('Requested model is unavailable on the selected provider')
        const id = ++created === 1 ? 'created-session' : `created-session-${created}`
        events.push(['create', { workspaceId, name: options.name, model: resolvedModel, projectId: options.projectId }])
        await beforeResolve?.()
        sessionMetaMap.set(id, { projectId: options.projectId })
        return { id }
      },
      onInputChange: (sessionId: string, prompt: string) => events.push(['draft', { sessionId, prompt }]),
      setRightSessionContext: (next: typeof context) => { context = next },
      setOpeningAgent: () => {},
    }
    return new Function(...Object.keys(bindings), executable)(...Object.values(bindings)) as
      (options: { sessionName: string; prompt: string; chip: { title: string; path: string }; reuse?: boolean }) => Promise<void>
  }
  return { render, events, store, main, sessionMetaMap, beforeResolve: (callback: typeof beforeResolve) => { beforeResolve = callback } }
}

const action = { sessionName: 'Analyze note', prompt: 'Summarize this note', chip: { title: 'A note', path: 'notes/a.md' } }

describe('Notes AI uses the selected workspace model and invariant Agent utility', () => {
  test('opens a canonical draft on Rox and configured external or local providers, preserving the note', async () => {
    for (const model of ['rox/r1-max', 'claude-opus-4-8', 'pi/gpt-6-astra', 'private/local-model']) {
      const f = fixture(model)
      await f.render()(action)
      expect(f.events[0]).toEqual(['create', { workspaceId: 'notes-workspace', name: action.sessionName, model, projectId: undefined }])
      expect(f.events).toContainEqual(['draft', { sessionId: 'created-session', prompt: action.prompt }])
      const stack = f.store.get(panelStackAtom)
      expect(stack[0]).toMatchObject({ id: f.main.id, route: f.main.route })
      expect(stack[1].tool).toBe('agent')
      expect(stack[1].route).toBe(routes.view.allSessions('created-session'))
      expect(f.store.get(focusedPanelIdAtom)).toBe(stack[1].id)
    }
  })

  test('reuses the same note session without replacing its model or draft', async () => {
    const f = fixture('private/local-model')
    await f.render()(action)
    f.events.length = 0
    f.store.set(focusedPanelIdAtom, f.main.id)
    await f.render()({ ...action, prompt: 'A later prompt' })
    expect(f.events).toEqual([])
    expect(f.store.get(panelStackAtom)).toHaveLength(2)
    expect(f.store.get(focusedPanelIdAtom)).toBe(f.store.get(panelStackAtom)[1].id)
  })

  test('binds the explicit workspace project to both the new session and utility context', async () => {
    const f = fixture('private/local-model', 'selected-project')
    await f.render()(action)
    expect(f.events[0][1]).toMatchObject({ projectId: 'selected-project' })
    expect(f.store.get(panelStackAtom)[1].toolContext?.projectId).toBe('selected-project')
  })

  test('creates a fresh conversion draft when reuse is explicitly disabled', async () => {
    const f = fixture('private/local-model')
    await f.render()(action)
    f.store.set(focusedPanelIdAtom, f.main.id)
    await f.render()({ ...action, prompt: 'Converted prompt', reuse: false })
    expect(f.events).toContainEqual(['draft', { sessionId: 'created-session-2', prompt: 'Converted prompt' }])
    expect(f.store.get(panelStackAtom)[0]).toMatchObject({ id: f.main.id, route: f.main.route })
    expect(f.store.get(panelStackAtom)[1].route).toBe(routes.view.allSessions('created-session-2'))
  })

  test('does not reuse a deleted note session', async () => {
    const f = fixture('private/local-model')
    await f.render()(action)
    f.store.set(focusedPanelIdAtom, f.main.id)
    f.sessionMetaMap.delete('created-session')
    await f.render()(action)
    expect(f.events.filter(([kind]) => kind === 'create')).toHaveLength(2)
  })

  test('keeps a late created draft but never replaces a later main surface', async () => {
    const f = fixture('private/local-model')
    f.beforeResolve(() => f.store.set(panelStackAtom, [{ ...f.main, route: routes.view.inbox() }]))
    await f.render()(action)
    expect(f.events).toContainEqual(['draft', { sessionId: 'created-session', prompt: action.prompt }])
    expect(f.store.get(panelStackAtom)).toHaveLength(1)
    expect(f.store.get(panelStackAtom)[0].route).toBe(routes.view.inbox())
  })
})
