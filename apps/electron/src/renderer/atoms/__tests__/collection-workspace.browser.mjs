/** Real React/Jotai and exact current AppShell callbacks; controlled preferences transport, not native OS custody. */
import {before,after,beforeEach,afterEach,describe,it} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import {build} from 'esbuild'
import {chromium} from '@playwright/test'
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../../../..')
const source=readFileSync(resolve(repository,'apps/electron/src/renderer/components/app-shell/AppShell.tsx'),'utf8')
const tree=ts.createSourceFile('AppShell.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let effect,grouping,change
const visit=node=>{
 if(ts.isCallExpression(node)&&node.expression.getText(tree)==='React.useLayoutEffect'&&node.arguments[0]?.getText(tree).includes('previousWorkspaceRef.current')) effect=node.arguments[0].getText(tree)
 if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='chatGroupingMode')grouping=node.initializer.getText(tree)
 if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='setChatGroupingMode')change=node.initializer.arguments[0].getText(tree)
 ts.forEachChild(node,visit)
};visit(tree)
if(!effect||!grouping||!change)throw new Error('Current AppShell collection consumers missing')
let browser,context,page,server,base
const contents=`
import * as React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{Provider,useAtomValue,useSetAtom,createStore}from'jotai';
import{windowWorkspaceIdAtom}from'./apps/electron/src/renderer/atoms/sessions';
import{collectionFiltersAtom,collectionFiltersMapAtom,loadCollectionFiltersAtom}from'./apps/electron/src/renderer/atoms/collection-filters';
import{collectionDisplayAtom,setCollectionDisplayAtom,loadCollectionDisplayAtom}from'./apps/electron/src/renderer/atoms/collection-display';
const seeds={a:{filters:{allSessions:{labels:['a-only']}},display:{version:1,layout:'list',groupBy:'status',sortBy:'updatedAt',sortDirection:'desc',visibleProperties:[]}},b:{filters:{allSessions:{status:['todo']},flagged:{flagged:true}},display:{version:1,layout:'list',groupBy:'project',sortBy:'updatedAt',sortDirection:'desc',visibleProperties:[]}}};
const read=ws=>JSON.parse(localStorage.getItem('collection-'+ws)||JSON.stringify(seeds[ws]));
const write=(ws,kind,value)=>{const data=read(ws);data[kind]=value;localStorage.setItem('collection-'+ws,JSON.stringify(data));return value};
const writes=[];let held=[];let holdNext=false;
window.electronAPI={getCollectionFilters:async ws=>{const value=read(ws).filters;if(holdNext){holdNext=false;return new Promise(resolve=>held.push(()=>resolve(value)))}return value},setCollectionFilters:async(ws,value)=>{writes.push(['filters',ws]);return write(ws,'filters',value)},getCollectionDisplay:async ws=>read(ws).display,setCollectionDisplay:async(ws,value)=>{writes.push(['display',ws]);return write(ws,'display',value)}};
const store=createStore();let scope=new URL(location.href).searchParams.get('workspace')||'a';store.set(windowWorkspaceIdAtom,scope);
const noop=()=>{},storage={KEYS:{},get:(_key,fallback)=>fallback},loadShellLayout=()=>({sidebarWidth:200,navigatorWidth:280});
function Shell(){const[activeWorkspaceId,setWorkspace]=React.useState(scope),previousWorkspaceRef=React.useRef(null);
 const collectionDisplay=useAtomValue(collectionDisplayAtom),map=useAtomValue(collectionFiltersMapAtom);
 const loadCollectionDisplay=useSetAtom(loadCollectionDisplayAtom),loadCollectionFilters=useSetAtom(loadCollectionFiltersAtom),setCollectionDisplay=useSetAtom(setCollectionDisplayAtom),setCollectionFilters=useSetAtom(collectionFiltersAtom);
 const sidebarResize={handleKeyCancel:noop},navigatorResize={handleKeyCancel:noop};
 const setSearchActive=noop,setSearchQuery=noop,setViewFiltersMap=noop,setExpandedFolders=noop,setCollapsedItems=noop,setWorkspaceUiStateId=noop,setSidebarWidth=noop,setSessionListWidth=noop;
 React.useLayoutEffect(()=>{store.set(windowWorkspaceIdAtom,activeWorkspaceId)},[activeWorkspaceId]);
 React.useLayoutEffect(${effect},[activeWorkspaceId,loadCollectionDisplay,loadCollectionFilters]);
 const isStateSubView=false,chatGroupingMode=${grouping};const setChatGroupingMode=${change};
 window.collectionOwner={writes,read,store,scope(ws){flushSync(()=>setWorkspace(ws))},hold(){holdNext=true},release(){held.splice(0).forEach(run=>run())},reload(){return store.set(loadCollectionFiltersAtom,store.get(windowWorkspaceIdAtom))}};
 return React.createElement('main',{'data-workspace':activeWorkspaceId},React.createElement('output',{'data-filter-map':true},JSON.stringify(map)),React.createElement('select',{'aria-label':'Grouping',value:chatGroupingMode,onChange:event=>setChatGroupingMode(event.target.value)},...['date','status','project'].map(value=>React.createElement('option',{key:value,value},value))),React.createElement('input',{'aria-label':'Labels',value:map.allSessions?.labels?.join(',')||'',onChange:event=>void setCollectionFilters({labels:[event.target.value]})}));
}createRoot(document.getElementById('root')).render(React.createElement(Provider,{store},React.createElement(Shell)));
`
describe('current mounted AppShell collection preference ownership', {skip:process.env.ROX_COLLECTION_BROWSER_TEST!=='1'},()=>{
 before(async()=>{
 const result=await build({stdin:{contents,loader:'tsx',resolveDir:repository},bundle:true,write:false,format:'iife',platform:'browser',tsconfig:resolve(repository,'apps/electron/tsconfig.json')})
 const js=result.outputFiles[0].text;server=createServer((req,res)=>{res.setHeader('content-type',req.url.startsWith('/fixture.js')?'text/javascript':'text/html');res.end(req.url.startsWith('/fixture.js')?js:'<!doctype html><div id="root"></div><script src="/fixture.js"></script>')})
 await new Promise(done=>server.listen(0,'127.0.0.1',done));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.ROX_UI001_CHROMIUM_EXECUTABLE,headless:true,args:['--disable-gpu']})
 },{timeout:30000})
 beforeEach(async()=>{context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(5000);await page.goto(base);await page.waitForFunction(()=>window.collectionOwner&&document.querySelector('[data-filter-map]').textContent.includes('a-only'))},{timeout:30000})
 afterEach(async()=>{await context?.close()},{timeout:30000})
 after(async()=>{server?.closeAllConnections();const closed=new Promise(done=>server?.close(done));try{await browser?.close()}finally{await closed}},{timeout:30000})
 it('switches workspaces without deleting persisted multikey filters and project grouping',async()=>{
 await page.evaluate(()=>window.collectionOwner.scope('b'));await page.waitForFunction(()=>document.querySelector('[data-filter-map]').textContent.includes('flagged'));
 assert.equal(await page.getByRole('combobox',{name:'Grouping'}).inputValue(),'project');assert.deepEqual(await page.evaluate(()=>window.collectionOwner.writes),[]);
 assert.deepEqual(await page.evaluate(()=>window.collectionOwner.read('b').filters),{allSessions:{status:['todo']},flagged:{flagged:true}})
 },{timeout:30000})
 it('initial mount and browser reload restore native-contract preferences without a reset write',async()=>{
 await page.goto(base+'/?workspace=b');await page.waitForFunction(()=>document.querySelector('[data-filter-map]').textContent.includes('flagged'));
 assert.equal(await page.getByRole('combobox',{name:'Grouping'}).inputValue(),'project');assert.deepEqual(await page.evaluate(()=>window.collectionOwner.writes),[]);
 await page.reload();await page.waitForFunction(()=>document.querySelector('[data-filter-map]').textContent.includes('flagged'));assert.deepEqual(await page.evaluate(()=>window.collectionOwner.writes),[])
 },{timeout:30000})
 it('actual grouping callback persists project and restores it after reload',async()=>{
 await page.getByRole('combobox',{name:'Grouping'}).selectOption('project');await page.waitForFunction(()=>window.collectionOwner.read('a').display.groupBy==='project');
 await page.reload();await page.waitForFunction(()=>document.querySelector('select').value==='project');assert.equal(await page.getByRole('combobox',{name:'Grouping'}).inputValue(),'project')
 },{timeout:30000})
 it('workspace ABA rejects the obsolete held native-contract snapshot',async()=>{
 await page.evaluate(()=>{window.collectionOwner.hold();void window.collectionOwner.reload()});
 await page.evaluate(()=>{localStorage.setItem('collection-a',JSON.stringify({filters:{allSessions:{labels:['latest-a']}},display:window.collectionOwner.read('a').display}));window.collectionOwner.scope('b')});
 await page.waitForFunction(()=>document.querySelector('[data-filter-map]').textContent.includes('flagged'));await page.evaluate(()=>window.collectionOwner.scope('a'));await page.waitForFunction(()=>document.querySelector('[data-filter-map]').textContent.includes('latest-a'));
 await page.evaluate(()=>window.collectionOwner.release());await page.waitForTimeout(50);assert.equal(await page.getByRole('textbox',{name:'Labels'}).inputValue(),'latest-a')
 },{timeout:30000})
 it('editing the actual mounted input defeats a held initial read and survives reload',async()=>{
 await page.evaluate(()=>{window.collectionOwner.hold();void window.collectionOwner.reload()});await page.getByRole('textbox',{name:'Labels'}).fill('edited');await page.waitForFunction(()=>window.collectionOwner.read('a').filters.allSessions.labels[0]==='edited');
 await page.evaluate(()=>window.collectionOwner.release());await page.waitForTimeout(50);assert.equal(await page.getByRole('textbox',{name:'Labels'}).inputValue(),'edited');await page.reload();await page.waitForFunction(()=>document.querySelector('input').value==='edited')
 },{timeout:30000})
})
