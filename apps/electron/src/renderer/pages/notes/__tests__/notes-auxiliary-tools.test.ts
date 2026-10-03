import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { notesAuxiliaryFits } from '../notes-layout'
const text=readFileSync(new URL('../../NotesPage.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('NotesPage.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
function expression(code:string,ports:Record<string,unknown>){return new Function(...Object.keys(ports),ts.transpileModule(`return (${code});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(ports))}
function find(predicate:(node:ts.Node)=>boolean){const result:ts.Node[]=[];function walk(node:ts.Node){if(predicate(node))result.push(node);ts.forEachChild(node,walk)}walk(ast);return result}
function toggle(inlineAuxiliary:boolean){const declaration=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='toggleInspector')[0] as ts.VariableDeclaration;const callback=(declaration.initializer as ts.CallExpression).arguments[0]!;let open=false,collapsed=false;const writes:unknown[]=[];const fn=expression(callback.getText(ast),{inlineAuxiliary,setInspectorSheetOpen:(next:(value:boolean)=>boolean)=>{open=next(open)},setInspectorCollapsed:(next:(value:boolean)=>boolean)=>{collapsed=next(collapsed)},localStorage:{setItem:(key:string,value:string)=>writes.push([key,value])}});return {fn,open:()=>open,collapsed:()=>collapsed,writes}}
test('current Notes auxiliary fit preserves460px document and all real320/32/380 widths',()=>{
 expect(notesAuxiliaryFits(779,false,false)).toBe(false);expect(notesAuxiliaryFits(780,false,false)).toBe(true)
 expect(notesAuxiliaryFits(1159,false,true)).toBe(false);expect(notesAuxiliaryFits(1160,false,true)).toBe(true)
 expect(notesAuxiliaryFits(871,true,true)).toBe(false);expect(notesAuxiliaryFits(872,true,true)).toBe(true)
 expect(notesAuxiliaryFits(0,false,true)).toBe(true);expect(notesAuxiliaryFits(1500,false,true)).toBe(true)
})
test('actual narrow page Inspector callback toggles sheet without mutating saved collapse preference',()=>{
 const f=toggle(false);f.fn();expect(f.open()).toBe(true);f.fn();expect(f.open()).toBe(false);expect(f.collapsed()).toBe(false);expect(f.writes).toEqual([])
})
test('actual wide page Inspector callback retains current persisted collapse preference',()=>{
 const f=toggle(true);f.fn();expect(f.collapsed()).toBe(true);expect(f.open()).toBe(false);expect(f.writes).toEqual([['notes:inspector-collapsed','true']])
})
test('actual page wraps existing session and Inspector owners; wide session never invokes narrow close',()=>{
 const rails=find(n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='NotesResponsiveRail') as ts.JsxElement[]
 const session=rails.find(n=>n.children.some(child=>ts.isJsxSelfClosingElement(child)&&child.tagName.getText(ast)==='RightSessionShell'))
 const inspector=rails.find(n=>n.children.some(child=>ts.isJsxSelfClosingElement(child)&&child.tagName.getText(ast)==='NoteInspector'))
 expect(Boolean(session)).toBe(true);expect(Boolean(inspector)).toBe(true)
 const attr=(node:ts.JsxElement,name:string)=>{const a=node.openingElement.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)===name) as ts.JsxAttribute;return (a.initializer as ts.JsxExpression).expression!.getText(ast)}
 expect(expression(attr(session!,'open'),{inlineAuxiliary:true})).toBe(false)
 expect(expression(attr(session!,'open'),{inlineAuxiliary:false})).toBe(true)
 expect(attr(session!,'onClose')).toBe('closeSideSession')
 expect(expression(attr(inspector!,'open'),{inlineAuxiliary:true,inspectorSheetOpen:true})).toBe(false)
 expect(expression(attr(inspector!,'open'),{inlineAuxiliary:false,inspectorSheetOpen:true})).toBe(true)
})
test('actual contextual owner workspace guard revokes foreign UI without deleting durable session or prompt owner',()=>{
 const call=find(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='React.useEffect'&&n.arguments[0]?.getText(ast).includes('rightSessionContext.workspaceId'))[0] as ts.CallExpression
 expect(Boolean(call)).toBe(true)
 const changes:unknown[]=[];const fn=expression(call.arguments[0]!.getText(ast),{rightSessionContext:{workspaceId:'a',sessionId:'s'},activeWorkspaceId:'b',setRightSessionContext:(v:unknown)=>changes.push(['context',v]),setSideSessionPrompt:(v:unknown)=>changes.push(['prompt-ui',v]),setSideNoteChip:(v:unknown)=>changes.push(['chip',v])});fn()
 expect(changes).toEqual([['context',null],['prompt-ui',''],['chip',null]])
})
