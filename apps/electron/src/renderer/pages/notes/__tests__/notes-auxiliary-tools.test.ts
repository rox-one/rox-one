import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { notesAuxiliaryFits } from '../notes-layout'
const text=readFileSync(new URL('../../NotesPage.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('NotesPage.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
function expression(code:string,ports:Record<string,unknown>){return new Function(...Object.keys(ports),ts.transpileModule(`return (${code});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(ports))}
function find(predicate:(node:ts.Node)=>boolean){const result:ts.Node[]=[];function walk(node:ts.Node){if(predicate(node))result.push(node);ts.forEachChild(node,walk)}walk(ast);return result}
function toggle(inlineAuxiliary:boolean){const declaration=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='toggleInspector')[0] as ts.VariableDeclaration;const callback=(declaration.initializer as ts.CallExpression).arguments[0]!;let open=false,collapsed=false;const writes:unknown[]=[];const fn=expression(callback.getText(ast),{inlineAuxiliary,setInspectorSheetOpen:(next:(value:boolean)=>boolean)=>{open=next(open)},setInspectorCollapsed:(next:(value:boolean)=>boolean)=>{collapsed=next(collapsed)},localStorage:{setItem:(key:string,value:string)=>writes.push([key,value])}});return {fn,open:()=>open,collapsed:()=>collapsed,writes}}
test('Notes Inspector fit preserves the document width without reserving a second Agent composer', () => {
 expect(notesAuxiliaryFits(779, false, false)).toBe(false)
 expect(notesAuxiliaryFits(780, false, false)).toBe(true)
 expect(notesAuxiliaryFits(491, true, false)).toBe(false)
 expect(notesAuxiliaryFits(492, true, false)).toBe(true)
 expect(notesAuxiliaryFits(0, false, false)).toBe(true)
 expect(notesAuxiliaryFits(1500, false, false)).toBe(true)
})
test('actual narrow page Inspector callback toggles sheet without mutating saved collapse preference',()=>{
 const f=toggle(false);f.fn();expect(f.open()).toBe(true);f.fn();expect(f.open()).toBe(false);expect(f.collapsed()).toBe(false);expect(f.writes).toEqual([])
})
test('actual wide page Inspector callback retains current persisted collapse preference',()=>{
 const f=toggle(true);f.fn();expect(f.collapsed()).toBe(true);expect(f.open()).toBe(false);expect(f.writes).toEqual([['notes:inspector-collapsed','true']])
})
test('actual page preserves the Inspector owner when switching between inline and narrow sheet', () => {
 const rails = find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === 'NotesResponsiveRail') as ts.JsxElement[]
 const inspector = rails.find(n => n.children.some(child => ts.isJsxSelfClosingElement(child) && child.tagName.getText(ast) === 'NoteInspector'))
 expect(Boolean(inspector)).toBe(true)
 const attribute = (name: string) => {
  const value = inspector!.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === name) as ts.JsxAttribute
  return (value.initializer as ts.JsxExpression).expression!.getText(ast)
 }
 expect(expression(attribute('open'), { inlineAuxiliary: true, inspectorSheetOpen: true })).toBe(false)
 expect(expression(attribute('open'), { inlineAuxiliary: false, inspectorSheetOpen: true })).toBe(true)
 expect(expression(attribute('open'), { inlineAuxiliary: false, inspectorSheetOpen: false })).toBe(false)
 let open = true
 expression(attribute('onClose'), { setInspectorSheetOpen: (value: boolean) => { open = value } })()
 expect(open).toBe(false)
 // Shared Agent creation and canonical draft preservation are exercised by
 // note-ai-session.test.ts; this test owns only the remaining Notes Inspector.
})
test('actual contextual metadata guard retires another workspace without touching durable session or draft',()=>{
 const call=find(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='React.useEffect'&&n.arguments[0]?.getText(ast).includes('rightSessionContext.workspaceId'))[0] as ts.CallExpression
 expect(Boolean(call)).toBe(true)
 const changes:unknown[]=[];const fn=expression(call.arguments[0]!.getText(ast),{rightSessionContext:{workspaceId:'a',sessionId:'s'},activeWorkspaceId:'b',setRightSessionContext:(v:unknown)=>changes.push(['context',v]),onInputChange:()=>changes.push(['unexpected-draft-write']),onDeleteSession:()=>changes.push(['unexpected-session-delete'])});fn()
 expect(changes).toEqual([['context',null]])
 changes.length = 0
 expression(call.arguments[0]!.getText(ast), { rightSessionContext: { workspaceId: 'a', sessionId: 's' }, activeWorkspaceId: 'a', setRightSessionContext: (value: unknown) => changes.push(['context', value]) })()
 expect(changes).toEqual([])
})
