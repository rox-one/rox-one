import { chromium } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { buildMainFixture } from '../../../../../apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.component-harness'

const temp = mkdtempSync(join(import.meta.dir, 'rox-readiness-ui-001-recovery-temp-'))
const atoms = resolve(import.meta.dir, '../../../../../apps/electron/src/renderer/atoms/unified-shell.ts')
const storage = resolve(import.meta.dir, '../../../../../apps/electron/src/renderer/lib/local-storage.ts')
const bootstrap = `
import {createRoot} from 'react-dom/client';
import {createStore} from 'jotai/vanilla';
import {RESET} from 'jotai/utils';
import {inspectorPanelWidthAtom,bottomDockHeightAtom} from ${JSON.stringify(atoms)};
import {KEYS,getKeyString} from ${JSON.stringify(storage)};
const sourceListeners=new Set(),skillListeners=new Set();
const source=(slug='one')=>({config:{id:slug,slug,name:'Source '+slug,type:'api',api:{baseUrl:'https://fixture.invalid'},enabled:true},folderPath:'/fixture/sources/'+slug});
const skill=(slug='one')=>({slug,metadata:{name:'Skill '+slug,description:'Fixture skill'},content:'',path:'/fixture/skills/'+slug,source:'workspace'});
let sources=[source('one'),source('two')],skills=[skill('one'),skill('two')],directorySkills={},failure=false,delayed=false;
const pending=[],calls=[];
function read(method,ws,directory) {
 calls.push({method,ws,directory});
 const snapshot=structuredClone(method==='sources'?sources:directorySkills[directory]??skills);
 const error=failure?new Error('temporary fixture unavailable'):null;
 if(delayed) return new Promise((resolve,reject)=>pending.push(()=>error?reject(error):resolve(snapshot)));
 return error?Promise.reject(error):Promise.resolve(snapshot);
}
window.electronAPI={
 getRuntimeTraceSnapshot:async(query)=>({schemaVersion:1,workspaceId:query.workspaceId,sessionId:query.sessionId,
  runs:[],events:[],coverage:{state:'unavailable',source:'runtime',missing:['ui001-runtime-not-recorded'],reason:'UI-001 recovery fixture does not record runtime execution'}}),
 readRuntimeTraceEvents:async()=>{throw new Error('Runtime event paging is outside this recovery fixture')},
 readRuntimeTracePayload:async()=>{throw new Error('Runtime payload reads are outside this recovery fixture')},
 getSources:(ws)=>read('sources',ws),getSkills:(ws,directory)=>read('skills',ws,directory),
 getSourcePermissionsConfig:async()=>null,getWorkspaceSettings:async()=>({localMcpEnabled:false}),
 onSourcesChanged:(fn)=>{sourceListeners.add(fn);return()=>sourceListeners.delete(fn)},
 onSkillsChanged:(fn)=>{skillListeners.add(fn);return()=>skillListeners.delete(fn)}
};
const root=createRoot(document.getElementById('root'));
let version=0,props={route:'sources/source/one',workspace:'workspace-a'};
function render(){root.render(<Fixture key={version} {...props}/>)};
function fromUrl(){const q=new URLSearchParams(location.search);props={route:q.get('route')??'sources/source/one',workspace:q.get('ws')??'workspace-a'};render()};
window.addEventListener('popstate',fromUrl);
const store=createStore();
const subscriptions=[store.sub(inspectorPanelWidthAtom,()=>{}),store.sub(bottomDockHeightAtom,()=>{})];
const inspectorKey=getKeyString(KEYS.inspectorPanelWidth),dockKey=getKeyString(KEYS.bottomDockHeight);
window.ui001={
 configure:(next)=>{sources=next.sources??[source('one'),source('two')];skills=next.skills??[skill('one'),skill('two')];directorySkills=next.directorySkills??{};failure=!!next.failure;delayed=!!next.delayed;props={route:next.route??'sources/source/one',workspace:next.workspace??'workspace-a',directory:next.directory};version++;render()},
 navigate:(route,workspace=props.workspace)=>{const url=new URL(location.href);url.searchParams.set('route',route);url.searchParams.set('ws',workspace);history.pushState({},'',url);fromUrl()},
 ready:()=>{failure=false;delayed=false},
 failReads:(value)=>{failure=value},
 directory:(directory)=>{props={...props,directory};render()},
 release:()=>{for(const done of pending.splice(0))done()},
 pendingCount:()=>pending.length,calls:()=>calls,
 sources:(ws,items)=>{sources=items;for(const fn of sourceListeners)fn(ws,items)},
 skills:(ws,items)=>{skills=items;for(const fn of skillListeners)fn(ws,items)},
 skillsEvent:(ws,items)=>{for(const fn of skillListeners)fn(ws,items)},
 source,skill,
 layout:{read:()=>({inspector:store.get(inspectorPanelWidthAtom),dock:store.get(bottomDockHeightAtom)}),
 set:(inspector,dock)=>{store.set(inspectorPanelWidthAtom,inspector);store.set(bottomDockHeightAtom,dock)},
 increment:()=>store.set(bottomDockHeightAtom,(previous)=>previous+0.6),
 reset:()=>{store.set(inspectorPanelWidthAtom,RESET);store.set(bottomDockHeightAtom,RESET)},
 keys:{inspector:inspectorKey,dock:dockKey},
 saved:()=>({inspector:localStorage.getItem(inspectorKey),dock:localStorage.getItem(dockKey)}),
 unsubscribe:()=>{for(const off of subscriptions)off()}}
};
fromUrl();
`
const entry = await buildMainFixture(temp, true, { realEntityPages: true, browserBootstrap: bootstrap })
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  return new URL(request.url).pathname === '/fixture.js'
    ? new Response(Bun.file(entry), { headers: { 'Content-Type': 'application/javascript' } })
    : new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } })
} })
const browser = await chromium.launch({ headless: true, ...(process.env.ROX_UI001_BROWSER_EXECUTABLE ? { executablePath: process.env.ROX_UI001_BROWSER_EXECUTABLE } : {}) })
const context = await browser.newContext()
const page = await context.newPage()
const second = await context.newPage()
const origin = `http://127.0.0.1:${server.port}`
const results: Array<{ name: string; pass: boolean; error?: string }> = []
const errors: string[] = []
page.on('pageerror', error => errors.push(error.message))
second.on('pageerror', error => errors.push(error.message))
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, pass: true }) }
  catch (error) { results.push({ name, pass: false, error: String(error) }) }
}
async function waitText(text: string) {
  await page.waitForFunction(expected => document.querySelector('[data-entity-page]')?.textContent?.includes(expected), text, { timeout: 1800 })
}
async function waitLayout(inspector: number, dock: number) {
  await page.waitForFunction(expected => {
    const got = (window as any).ui001.layout.read()
    return got.inspector === expected.inspector && got.dock === expected.dock
  }, { inspector, dock }, { timeout: 1800 })
}
try {
  await page.goto(origin)
  await waitText('Source one')
  await check('A direct missing skill recovers when it is created without changing route', async () => {
    await page.evaluate(() => (window as any).ui001.configure({ route: 'skills/skill/one', skills: [] }))
    await page.waitForFunction(() => document.body.textContent?.includes('skillInfo.notFound'))
    await page.evaluate(() => { const x = (window as any).ui001; x.skills('workspace-a', [x.skill('one')]) })
    await waitText('Skill one')
  })
  await check('An initial source load failure recovers after an authoritative live update', async () => {
    await page.evaluate(() => (window as any).ui001.configure({ route: 'sources/source/one', failure: true }))
    await page.waitForFunction(() => document.body.textContent?.includes('temporary fixture unavailable') || document.body.textContent?.includes('common.unavailable'))
    await page.evaluate(() => { const x = (window as any).ui001; x.ready(); x.sources('workspace-a', [x.source('one')]) })
    await waitText('Source one')
  })
  await check('An initial skill load failure recovers after an authoritative live update', async () => {
    await page.evaluate(() => (window as any).ui001.configure({ route: 'skills/skill/one', failure: true }))
    await page.waitForFunction(() => document.body.textContent?.includes('temporary fixture unavailable') || document.body.textContent?.includes('common.unavailable'))
    await page.evaluate(() => { const x = (window as any).ui001; x.ready(); x.skills('workspace-a', [x.skill('one')]) })
    await waitText('Skill one')
  })
  await check('A live skill creation outranks an older missing initial snapshot', async () => {
    await page.evaluate(() => (window as any).ui001.configure({ route: 'skills/skill/one', skills: [], delayed: true }))
    await page.waitForFunction(() => (window as any).ui001.pendingCount() > 0)
    await page.evaluate(() => { const x = (window as any).ui001; x.ready(); x.skills('workspace-a', [x.skill('one')]); x.release() })
    await waitText('Skill one')
  })
  await check('A direct missing source remains specific after reload and recovers on creation', async () => {
    await page.evaluate(() => (window as any).ui001.configure({ route: 'sources/source/deleted', sources: [] }))
    await page.waitForFunction(() => document.body.textContent?.includes('sourceInfo.notFound'))
    await page.evaluate(() => (window as any).ui001.navigate('sources/source/deleted'))
    await page.reload()
    await page.waitForFunction(() => document.body.textContent?.includes('sourceInfo.notFound'))
    await page.evaluate(() => { const x = (window as any).ui001; x.sources('workspace-a', [x.source('deleted')]) })
    await waitText('Source deleted')
  })
  await check('Browser back/forward and reload keep the selected source and workspace through actual parsing', async () => {
    await page.goto(origin)
    await waitText('Source one')
    await page.evaluate(() => (window as any).ui001.navigate('sources/source/two', 'workspace-b'))
    await waitText('Source two')
    await page.goBack()
    await waitText('Source one')
    await page.goForward()
    await waitText('Source two')
    await page.reload()
    await waitText('Source two')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-b')
    const calls = await page.evaluate(() => (window as any).ui001.calls())
    assert.ok(calls.some((call: any) => call.method === 'sources' && call.ws === 'workspace-b'))
  })
  await check('A source read from the previous workspace cannot replace the current source', async () => {
    await page.evaluate(() => {
      const x = (window as any).ui001
      const old = x.source('one'); old.config.name = 'Source old workspace'
      x.configure({ route: 'sources/source/one', workspace: 'workspace-a', sources: [old], delayed: true })
    })
    await page.waitForFunction(() => (window as any).ui001.pendingCount() > 0)
    await page.evaluate(() => {
      const x = (window as any).ui001
      const current = x.source('one'); current.config.name = 'Source current workspace'
      x.ready(); x.sources('workspace-b', [current]); x.navigate('sources/source/one', 'workspace-b')
    })
    await waitText('Source current workspace')
    await page.evaluate(() => (window as any).ui001.release())
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await waitText('Source current workspace')
    assert.ok(!(await page.locator('[data-entity-page]').textContent())?.includes('Source old workspace'))
  })
  await check('A live source deletion wins over a pending initial existing-source snapshot', async () => {
    await page.evaluate(() => (window as any).ui001.configure({ route: 'sources/source/one', delayed: true }))
    await page.waitForFunction(() => (window as any).ui001.pendingCount() > 0)
    await page.evaluate(() => { const x = (window as any).ui001; x.ready(); x.sources('workspace-a', []); x.release() })
    await page.locator('[data-testid="route-resource-missing"][data-route-resource="source"]').waitFor()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.locator('[data-entity-page]').count(), 0)
  })
  await check('Changing the selected skill directory cancels its old pending lookup', async () => {
    await page.evaluate(() => {
      const x = (window as any).ui001
      const old = x.skill('one'); old.metadata.name = 'Skill old directory'
      x.configure({ route: 'skills/skill/one', directory: '/fixture/old', skills: [old], delayed: true })
    })
    await page.waitForFunction(() => (window as any).ui001.pendingCount() > 0)
    await page.evaluate(() => {
      const x = (window as any).ui001
      const current = x.skill('one'); current.metadata.name = 'Skill current directory'
      x.ready(); x.skills('workspace-a', [current]); x.directory('/fixture/current')
    })
    await waitText('Skill current directory')
    await page.evaluate(() => (window as any).ui001.release())
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await waitText('Skill current directory')
    const calls = await page.evaluate(() => (window as any).ui001.calls())
    assert.ok(calls.some((call: any) => call.method === 'skills' && call.directory === '/fixture/current'))
  })
  await check('Ordinary selected-source updates keep the mounted editor and focused input', async () => {
    await page.evaluate(() => (window as any).ui001.configure({ route: 'sources/source/one' }))
    await waitText('Source one')
    const field = page.locator('[data-entity-page] input:not(:disabled)').first()
    await field.focus()
    await page.evaluate(() => {
      const x = (window as any).ui001
      const element = document.activeElement
      ;(window as any).ui001FocusedElement = element
      x.sources('workspace-a', [x.source('one')])
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => document.activeElement === (window as any).ui001FocusedElement), true)
  })
  await check('A workspace-only skill event cannot mark a selected project skill as missing', async () => {
    await page.evaluate(() => {
      const x = (window as any).ui001
      const project = x.skill('one'); project.source = 'project'; project.metadata.name = 'Project skill'
      x.configure({ route: 'skills/skill/one', directory: '/fixture/project', skills: [], directorySkills: { '/fixture/project': [project] } })
    })
    await waitText('Project skill')
    await page.evaluate(() => (window as any).ui001.skillsEvent('workspace-a', []))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await waitText('Project skill')
  })
  await check('A lower-priority workspace snapshot cannot overwrite the selected project skill', async () => {
    await page.evaluate(() => {
      const x = (window as any).ui001
      const project = x.skill('one'); project.source = 'project'; project.metadata.name = 'Project wins'
      x.configure({ route: 'skills/skill/one', directory: '/fixture/project', skills: [], directorySkills: { '/fixture/project': [project] } })
    })
    await waitText('Project wins')
    await page.evaluate(() => {
      const x = (window as any).ui001
      const workspace = x.skill('one'); workspace.metadata.name = 'Workspace shadow'
      x.skillsEvent('workspace-a', [workspace])
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await waitText('Project wins')
    assert.ok(!(await page.locator('[data-entity-page]').textContent())?.includes('Workspace shadow'))
  })
  await check('A workspace-only snapshot cannot remove an OMP skill from a selected route', async () => {
    await page.evaluate(() => {
      const x = (window as any).ui001
      const omp = x.skill('one'); omp.source = 'omp'; omp.metadata.name = 'OMP skill'
      x.configure({ route: 'skills/skill/one', skills: [omp] })
    })
    await waitText('OMP skill')
    await page.evaluate(() => (window as any).ui001.skillsEvent('workspace-a', []))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await waitText('OMP skill')
  })
  await check('A failed background skill refresh retains the mounted workspace editor and its draft', async () => {
    await page.evaluate(() => (window as any).ui001.configure({ route: 'skills/skill/one' }))
    await waitText('Skill one')
    const field = page.locator('[data-entity-page] input:not(:disabled)').first()
    await field.fill('Local unsaved draft')
    await field.focus()
    await page.evaluate(() => {
      const x = (window as any).ui001
      ;(window as any).ui001DraftField = document.activeElement
      x.failReads(true); x.skillsEvent('workspace-a', [])
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => {
      const field = (window as any).ui001DraftField
      return field.isConnected && field === document.activeElement && field.value === 'Local unsaved draft'
    }),true)
    await page.evaluate(() => (window as any).ui001.ready())
  })
  await check('An ordinary skill watcher update preserves an edited field and its focus', async () => {
    await page.evaluate(() => (window as any).ui001.configure({ route: 'skills/skill/one' }))
    await waitText('Skill one')
    const field = page.locator('[data-entity-page] input:not(:disabled)').first()
    await field.fill('Unsaved local name')
    await field.focus()
    await page.evaluate(() => {
      const x = (window as any).ui001
      ;(window as any).ui001DraftField = document.activeElement
      const updated = x.skill('one'); updated.metadata.name = 'Watcher name'
      x.skills('workspace-a', [updated])
    })
    await page.waitForFunction(() => document.querySelector('[data-entity-page]')?.textContent?.includes('Watcher name'))
    assert.equal(await field.inputValue(), 'Unsaved local name')
    assert.equal(await page.evaluate(() => document.activeElement === (window as any).ui001DraftField), true)
  })
  await check('Real browser atom writes persist rounded bounded values through reload', async () => {
    await page.evaluate(() => { const x = (window as any).ui001; x.layout.set(5000,119.6); x.layout.increment() })
    await waitLayout(1400,121)
    assert.deepEqual(await page.evaluate(() => (window as any).ui001.layout.saved()), { inspector: '1400', dock: '121' })
    await page.reload()
    await waitLayout(1400,121)
  })
  await second.goto(origin)
  await second.waitForFunction(() => !!(window as any).ui001)
  await check('Actual cross-window storage events normalize corrupt and non-finite values', async () => {
    await second.evaluate(() => { const x = (window as any).ui001; localStorage.setItem(x.layout.keys.inspector,'5000'); localStorage.setItem(x.layout.keys.dock,'1e999') })
    await waitLayout(1400,104)
    await second.evaluate(() => { const x = (window as any).ui001; localStorage.setItem(x.layout.keys.inspector,'{'); localStorage.setItem(x.layout.keys.dock,'120.6') })
    await waitLayout(320,121)
    await page.reload()
    await waitLayout(320,121)
  })
  await check('Removing a persisted key in another window restores its default', async () => {
    await second.evaluate(() => localStorage.removeItem((window as any).ui001.layout.keys.dock))
    await waitLayout(320,104)
  })
  await check('A real clear event restores both geometry defaults', async () => {
    await second.evaluate(() => { const x = (window as any).ui001; localStorage.setItem(x.layout.keys.inspector,'720'); localStorage.setItem(x.layout.keys.dock,'300') })
    await waitLayout(720,300)
    await second.evaluate(() => localStorage.clear())
    await waitLayout(320,104)
  })
  await check('The same preference keys in sessionStorage cannot change local layout', async () => {
    await page.evaluate(() => {
      const x = (window as any).ui001
      sessionStorage.setItem(x.layout.keys.dock,'400')
      window.dispatchEvent(new StorageEvent('storage',{key:x.layout.keys.dock,newValue:'400',storageArea:sessionStorage}))
    })
    assert.deepEqual(await page.evaluate(() => (window as any).ui001.layout.read()), { inspector: 320, dock: 104 })
  })
  await check('Denied browser localStorage keeps live resize and RESET usable', async () => {
    const observed = await page.evaluate(() => {
      const x = (window as any).ui001
      const descriptor = Object.getOwnPropertyDescriptor(window,'localStorage')!
      Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('denied','SecurityError')}})
      try {
        x.layout.set(640,200)
        const resized=x.layout.read()
        x.layout.reset()
        return {resized,reset:x.layout.read()}
      } finally { Object.defineProperty(window,'localStorage',descriptor) }
    })
    assert.deepEqual(observed,{resized:{inspector:640,dock:200},reset:{inspector:320,dock:104}})
  })
  await check('Unmounted atom subscriptions ignore later native storage events', async () => {
    await page.evaluate(() => (window as any).ui001.layout.unsubscribe())
    await second.evaluate(() => { const x = (window as any).ui001; localStorage.setItem(x.layout.keys.inspector,'850'); localStorage.setItem(x.layout.keys.dock,'350') })
    assert.deepEqual(await page.evaluate(() => (window as any).ui001.layout.read()),{inspector:320,dock:104})
  })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ environment: 'isolated local headless Chromium; actual MainContentPanel, SourceInfoPage, SkillInfoPage, route parser and Jotai atoms; presentation and IPC fixtures; history adapter is a fixture, not NavigationProvider; no installed/native/hosted/backend acceptance', browserVersion: browser.version(), results }, null, 2))
  if (results.some(result => !result.pass)) process.exitCode = 1
} finally { await browser.close(); server.stop(); rmSync(temp, { recursive: true, force: true }) }
