import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { createStore } from 'jotai'
import { focusedPanelIdAtom, panelStackAtom, primaryPanelIdAtom, type PanelStackEntry } from '../../../atoms/panel-stack'
import { activeWorkspaceContextAtom, workspaceProjectContextsAtom } from '../../../atoms/workspace-context'
import { captureWorkspaceToolOpen, openWorkspaceTool } from '../../../lib/open-workspace-tool'
import { routes } from '../../../../shared/routes'

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] }
const React = { createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }) }

// Execute the real component functions with deterministic hooks and JSX values.
// No duplicate route, scope or project-selection implementation is maintained.
function component(file: string, name: string, bindings: Record<string, unknown>): (props: { selectedId?: string | null }) => Element {
  const source = readFileSync(join(import.meta.dir, '..', file), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name) as ts.FunctionDeclaration | undefined
  if (!declaration) throw new Error(`Missing component ${name}`)
  const callable = ts.factory.updateFunctionDeclaration(declaration, undefined, declaration.asteriskToken,
    declaration.name, declaration.typeParameters, declaration.parameters, declaration.type, declaration.body)
  const text = ts.createPrinter().printNode(ts.EmitHint.Unspecified, callable, ast)
  const executable = ts.transpileModule(`${text}\nreturn ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText
  return new Function(...Object.keys(bindings), executable)(...Object.values(bindings))
}

function find(element: Element, type: string): Element | undefined {
  if (element.type === type) return element
  for (const child of element.children.flat()) {
    if (child && typeof child === 'object' && 'type' in child) {
      const result = find(child as Element, type)
      if (result) return result
    }
  }
}

describe('calendar task links keep the canonical task context', () => {
  test('retargets the retained Tasks panel from project A to B without changing the calendar', () => {
    const store = createStore()
    const main: PanelStackEntry = { id: 'calendar', route: routes.view.meetings(), proportion: .5, panelType: 'other', laneId: 'main' }
    const tasks: PanelStackEntry = { id: 'tasks', route: routes.view.tasks('task_old'), proportion: .5, panelType: 'other', laneId: 'main', tool: 'tasks',
      toolContext: { workspaceId: 'workspace', projectId: 'project-a', route: routes.view.pages() } }
    store.set(panelStackAtom, [main, tasks])
    store.set(primaryPanelIdAtom, main.id)
    store.set(focusedPanelIdAtom, main.id)
    store.set(activeWorkspaceContextAtom, 'workspace')
    store.set(workspaceProjectContextsAtom, { workspace: 'project-b' })
    const render = component('PlanWorkspacePage.tsx', 'PlanWorkspacePage', {
      React, Suspense: 'Suspense', Meetings: 'Meetings', WorkspacePlanView: 'WorkspacePlanView', ShellSidebarPortal: 'Sidebar',
      useState: () => ['calendar', () => {}], useEffect: () => {},
      useTranslation: () => ({ t: (key: string) => key }), useNavigation: () => ({ navigate: () => {} }),
      useAppShellContext: () => ({ activeWorkspaceId: 'workspace' }), useStore: () => store,
      useAtomValue: () => store.get(workspaceProjectContextsAtom), workspaceProjectContextsAtom,
      captureWorkspaceToolOpen, openWorkspaceTool, routes,
    })
    const openTask = find(render({}), 'WorkspacePlanView')!.props.onOpenTask as (id: string) => void
    openTask('task_project_b')
    expect(store.get(panelStackAtom)).toHaveLength(2)
    expect(store.get(panelStackAtom)[0]).toBe(main)
    expect(store.get(primaryPanelIdAtom)).toBe(main.id)
    expect(store.get(focusedPanelIdAtom)).toBe(tasks.id)
    expect(store.get(panelStackAtom)[1]).toMatchObject({ id: tasks.id, route: routes.view.tasks('task_project_b'),
      toolContext: { workspaceId: 'workspace', projectId: 'project-b', route: main.route } })

    store.set(focusedPanelIdAtom, main.id)
    store.set(workspaceProjectContextsAtom, { workspace: null })
    const openUnfilteredTask = find(render({}), 'WorkspacePlanView')!.props.onOpenTask as (id: string) => void
    openUnfilteredTask('task_workspace')
    expect(store.get(panelStackAtom)[1].toolContext?.projectId).toBeUndefined()
    expect(store.get(panelStackAtom)[1].route).toBe(routes.view.tasks('task_workspace'))
  })
})

describe('Tasks routes select either canonical scope in a retained panel', () => {
  test('follows workspace → personal → workspace IDs while preserving manual scope on a bare route', () => {
    let state: unknown
    let initialized = false
    let changed = false
    let effect: (() => void) | undefined
    let previousId: unknown = Symbol('initial')
    const render = component('WorkspaceTasksPage.tsx', 'WorkspaceTasksPage', {
      React, Suspense: 'Suspense', PersonalTasks: 'PersonalTasks', WorkspaceTasksView: 'WorkspaceTasksView',
      ShellSidebarContext: { Provider: 'SidebarContext' },
      useTranslation: () => ({ t: (key: string) => key }), useAppShellContext: () => ({ activeWorkspaceId: 'workspace' }),
      useWorkspaceProjectContext: () => 'project-b',
      useState: (initial: unknown) => {
        if (!initialized) { state = initial; initialized = true }
        return [state, (next: unknown) => { if (next !== state) { state = next; changed = true } }]
      },
      useEffect: (callback: () => void, dependencies: unknown[]) => {
        if (dependencies[0] !== previousId) { previousId = dependencies[0]; effect = callback }
      },
    })
    const settle = (selectedId?: string) => {
      let result: Element
      do {
        changed = false; effect = undefined
        result = render({ selectedId })
        const pending = effect as (() => void) | undefined
        pending?.()
      } while (changed)
      return result
    }
    expect(find(settle('task_workspace_first'), 'WorkspaceTasksView')?.props).toMatchObject({ workspaceId: 'workspace', projectId: 'project-b', selectedTaskId: 'task_workspace_first' })
    expect(find(settle('task-2'), 'PersonalTasks')?.props.selectedId).toBe('task-2')
    expect(find(settle('task_workspace_second'), 'WorkspaceTasksView')?.props.selectedTaskId).toBe('task_workspace_second')
    settle()
    expect(state).toBe('workspace')
    state = 'personal'
    expect(find(settle(), 'PersonalTasks')).toBeDefined()
  })
})
