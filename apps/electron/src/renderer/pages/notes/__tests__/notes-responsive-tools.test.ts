import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { canFocusNotesControl, isNotesPanelUnavailable } from '../focus-state'
import { notesRailKeyWidth } from '../notes-layout'

const source = (file: string) => readFileSync(join(import.meta.dir, '..', file), 'utf8')
function actualFunction(file: string, name: string) {
 const text = source(file), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
 const fn = ast.statements.find(x => ts.isFunctionDeclaration(x) && x.name?.text === name)
 if (!fn) throw new Error('Actual component missing: ' + name)
 return ts.transpileModule(fn.getText(ast).replace('export function', 'function') + `\nreturn ${name};`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
}
const createElement = (type: unknown, props: any, ...children: any[]) => ({ type, props: props ?? {}, children })
function find(node: any, type: unknown): any {
 if (node?.type === type) return node
 for (const child of node?.children ?? []) { const result = find(child, type); if (result) return result }
}
function element(parent: any = null) {
 const listeners = new Map<string, () => void>(); let focus = 0
 const doc = { visibilityState: 'visible', activeElement: null as any,
  defaultView: { getComputedStyle: (node: any) => node.style },
  addEventListener: (key: string, fn: () => void) => listeners.set(key, fn), removeEventListener: (key: string) => listeners.delete(key) }
 const node: any = { isConnected: true, ownerDocument: parent?.ownerDocument ?? doc, parentElement: parent,
  hidden: false, inert: false, style: {}, closest: () => null, getClientRects: () => [1], focus: () => { focus++ } }
 return { node, focus: () => focus, listeners }
}
function rail(inline = false) {
 const owner = element(), target = element(); owner.node.ownerDocument.activeElement = target.node
 const refs: any[] = [], layout: (() => void)[] = [], effects: (() => unknown)[] = [], mutations: (() => void)[] = []
 let closed = 0, disconnected = 0
 const React = { createElement, useRef: (current: any) => { const ref = { current }; refs.push(ref); return ref },
  useLayoutEffect: (fn: () => void) => layout.push(fn), useEffect: (fn: () => unknown) => effects.push(fn) }
 class Observer { constructor(fn: () => void) { mutations.push(fn) } observe() {} disconnect() { disconnected++ } }
 const component = new Function('React', 'Dialog', 'DialogContent', 'DialogTitle', 'document', 'MutationObserver', 'canFocusNotesControl', 'isNotesPanelUnavailable', actualFunction('NotesWorkspaceChrome.tsx', 'NotesResponsiveRail'))(React, 'dialog', 'content', 'title', owner.node.ownerDocument, Observer, canFocusNotesControl, isNotesPanelUnavailable)
 const tree = component({ inline, open: true, title: 'Contents', onClose: () => { closed++ }, children: 'tools' })
 refs[0].current = owner.node; layout.forEach(fn => fn()); const cleanups = effects.map(fn => fn())
 return { tree, owner, target, closed: () => closed, mutations, cleanups, disconnected: () => disconnected }
}

describe('consumed Notes responsive rails and focus fence', () => {
 test('narrow rail opens a controlled sheet, keeps its document owner, and returns focus to the captured control', () => {
  const f = rail(); expect(find(f.tree, 'dialog').props.open).toBe(true); expect(f.closed()).toBe(0)
  let prevented = false; find(f.tree, 'content').props.onCloseAutoFocus({ preventDefault: () => { prevented = true } })
  expect(prevented).toBe(true); expect(f.target.focus()).toBe(1)
 })
 test('modal aria-hidden is compatible with visible owner; inert/hidden retained workspace revokes sheet', () => {
  const f = rail(); f.owner.node.closest = () => ({ ariaHidden: true }); f.mutations[0]!(); expect(f.closed()).toBe(0)
  f.owner.node.inert = true; f.mutations[0]!(); expect(f.closed()).toBe(1)
  f.target.node.inert = true; find(f.tree, 'content').props.onCloseAutoFocus({ preventDefault() {} }); expect(f.target.focus()).toBe(0)
 })
 test('document visibility and unmount cleanup revoke ownership without focus to disconnected or hidden control', () => {
  const f = rail(); f.owner.node.ownerDocument.visibilityState = 'hidden'; f.mutations[0]!(); expect(f.closed()).toBe(1)
  f.target.node.isConnected = false; find(f.tree, 'content').props.onCloseAutoFocus({ preventDefault() {} }); expect(f.target.focus()).toBe(0)
  f.cleanups.forEach(fn => { if (typeof fn === 'function') fn() }); expect(f.disconnected()).toBe(1); expect(f.owner.listeners.size).toBe(0)
 })
 test('growing tile closes sheet and keeps the existing inline rail, rather than another visible dialog', () => {
  const f = rail(true); expect(find(f.tree, 'dialog')).toBeUndefined(); expect(f.closed()).toBe(1)
 })
 test('computed hidden ancestors and zero-layout/aria-hidden controls cannot receive return focus', () => {
  const parent = element(), child = element(parent.node); parent.node.style.contentVisibility = 'hidden'
  expect(isNotesPanelUnavailable(child.node)).toBe(true)
  parent.node.style = {}; expect(isNotesPanelUnavailable(child.node)).toBe(false)
  child.node.getClientRects = () => []; expect(canFocusNotesControl(child.node)).toBe(false)
  child.node.getClientRects = () => [1]; child.node.closest = () => ({}); expect(canFocusNotesControl(child.node)).toBe(false)
 })
})

function sash() {
 const widths: number[] = [], events = new Map<string, (event: any) => void>(), effects: (() => unknown)[] = []
 const React = { createElement, useRef: (current: any) => ({ current }), useEffect: (fn: () => unknown) => effects.push(fn) }
 const window = { addEventListener: (name: string, fn: (event: any) => void) => events.set(name, fn), removeEventListener: (name: string) => events.delete(name) }
 const component = new Function('React', 'window', 'notesRailKeyWidth', actualFunction('NotesDocumentChrome.tsx', 'NotesRailSash'))(React, window, notesRailKeyWidth)
 const tree = component({ width: 220, maximumWidth: 260, onWidth: (width: number) => widths.push(width), label: 'Resize', invert: true })
 const cleanups = effects.map(fn => fn())
 return { button: find(tree, 'button').props, widths, events, cleanups }
}
describe('actual Notes sash keyboard and pointer ownership', () => {
 test('keyboard width respects direction, shift, endpoint and current maximum; modified platform shortcuts remain available', () => {
  const f = sash(); const key = (key: string, shiftKey = false, metaKey = false) => ({ key, shiftKey, metaKey, preventDefault() {} })
  f.button.onKeyDown(key('ArrowLeft')); f.button.onKeyDown(key('ArrowRight', true)); f.button.onKeyDown(key('End')); f.button.onKeyDown(key('Home')); f.button.onKeyDown(key('ArrowLeft', false, true))
  expect(f.widths).toEqual([230, 180, 260, 140]); expect(f.button.role).toBe('separator'); expect(f.button['aria-valuemax']).toBe(260)
 })
 test('pointer lease ignores foreign pointer, clamps width, and Escape restores starting preference and removes all listeners', () => {
  const f = sash(); f.button.onPointerDown({ button: 0, pointerId: 8, clientX: 100, preventDefault() {}, currentTarget: { focus() {} } })
  f.events.get('pointermove')!({ pointerId: 9, clientX: 80 }); expect(f.widths).toEqual([])
  f.events.get('pointerup')!({ pointerId: 9 }); expect(f.events.size).toBe(5)
  f.events.get('pointermove')!({ pointerId: 8, clientX: 0 }); expect(f.widths).toEqual([260])
  f.events.get('keydown')!({ key: 'Escape', preventDefault() {} }); expect(f.widths).toEqual([260, 220]); expect(f.events.size).toBe(0)
 })
 test('unmount and pointer cancellation release subscriptions; a second pointer lease replaces the first', () => {
  const f = sash(); const down = { button: 0, pointerId: 8, clientX: 100, preventDefault() {}, currentTarget: { focus() {} } }
  f.button.onPointerDown(down); f.button.onPointerDown(down); expect(f.events.size).toBe(5)
  f.events.get('pointercancel')!({}); expect(f.events.size).toBe(0)
  f.button.onPointerDown(down); f.cleanups.forEach(fn => { if (typeof fn === 'function') fn() }); expect(f.events.size).toBe(0)
 })
})

test('actual NativeNotesPage delegates tool visibility and current preference callbacks to its production controls', () => {
 const text = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8'), ast = ts.createSourceFile('NotesPage.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
 const controls: ts.JsxAttribute[] = []
 function visit(node: ts.Node) { if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onCollapse' && node.initializer?.getText(ast).includes('setRailLayout')) controls.push(node); ts.forEachChild(node, visit) }
 visit(ast); expect(controls.length).toBe(1)
 const updates: unknown[] = []
 const arrow = (controls[0]!.initializer as ts.JsxExpression).expression!.getText(ast)
 const code = ts.transpileModule(`return (${arrow});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
 const fn = new Function('setRailLayout', code)((patch: unknown) => updates.push(patch)); fn('toc'); fn('comments')
 expect(updates).toEqual([{ tocCollapsed: true }, { commentsCollapsed: true }])
 expect(text).toContain('<NotesRailTools tocShown={tocShown} commentsShown={commentsShown} sheet={railSheet} onOpen={setRailSheet}')
 expect(text).toContain('const NOTE_COLUMN_MIN = 460'); expect(text).toContain('<EntityViewTabs'); expect(text).toContain('<ShellSidebarPortal')
 expect(text).toContain('inline={tocShown}'); expect(text).toContain('inline={commentsShown}')
})

test('actual width observer keeps last useful width while a retained panel is hidden and disconnects on unmount', () => {
 let state = 0, reads = 0, width = 900, disconnected = 0, notify = () => {}
 const node = { getBoundingClientRect: () => ({ width }) }, layouts: (() => unknown)[] = []
 const React = { useState: () => reads++ === 0 ? [node, () => {}] : [state, (update: (previous: number) => number) => { state = update(state) }], useCallback: (fn: unknown) => fn, useLayoutEffect: (fn: () => unknown) => layouts.push(fn) }
 class Observer { constructor(fn: () => void) { notify = fn } observe() {} disconnect() { disconnected++ } }
 const hook = new Function('React', 'ResizeObserver', actualFunction('NotesWorkspaceChrome.tsx', 'useNotesPanelWidth'))(React, Observer)
 hook(); const cleanup = layouts[0]!(); expect(state).toBe(900); width = 0; notify(); expect(state).toBe(900)
 width = 720; notify(); expect(state).toBe(720); if (typeof cleanup === 'function') cleanup(); expect(disconnected).toBe(1)
})
