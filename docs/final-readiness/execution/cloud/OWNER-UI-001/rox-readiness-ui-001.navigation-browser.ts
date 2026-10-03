import { chromium } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { buildMainFixture } from '../../../../../apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.component-harness'

const temporary = mkdtempSync(join(import.meta.dir, 'rox-readiness-ui-001-nav-temp-'))
const renderer = resolve(import.meta.dir, '../../../../../apps/electron/src/renderer')
const bootstrap = `
import {createRoot} from 'react-dom/client';
import {Provider,createStore,useAtomValue} from 'jotai';
import {NavigationProvider,useNavigation} from ${JSON.stringify(join(renderer, 'contexts/NavigationContext.tsx'))};
import {sessionMetaMapAtom} from ${JSON.stringify(join(renderer, 'atoms/sessions.ts'))};
import {panelStackAtom} from ${JSON.stringify(join(renderer, 'atoms/panel-stack.ts'))};
import {PanelSlot} from ${JSON.stringify(join(renderer, 'components/app-shell/PanelSlot.tsx'))};
const store=createStore();
const sourceListeners=new Set(),skillListeners=new Set(),deepLinkListeners=new Set();
const requests=[],actions=[];
const source=slug=>({config:{slug,name:slug,type:'api',api:{baseUrl:'https://fixture.invalid'},enabled:true},folderPath:'/fixture/'+slug});
let sources=['one','two'].map(source),skills=[{slug:'skill-one',source:'workspace'}];
window.electronAPI={
 getSources:async(ws)=>{requests.push(['sources',ws]);return sources},getSkills:async(ws,cwd)=>{requests.push(['skills',ws,cwd]);return skills},
 onSourcesChanged:fn=>{sourceListeners.add(fn);return()=>sourceListeners.delete(fn)},
 onSkillsChanged:fn=>{skillListeners.add(fn);return()=>skillListeners.delete(fn)},
 onDeepLinkNavigate:fn=>{deepLinkListeners.add(fn);return()=>deepLinkListeners.delete(fn)},
 listLabels:async()=>[],onLabelsChanged:()=>()=>{},sessionCommand:async(...args)=>{actions.push(['command',...args])},
 sendMessage:async()=>{throw new Error('Provider calls are forbidden in this fixture')}
};
const metadata=[{id:'local',workspaceId:'workspace-a',name:'Local'},{id:'foreign',workspaceId:'workspace-b',name:'Foreign'},
 {id:'remote',workspaceId:'remote-a',name:'Remote'}];
store.set(sessionMetaMapAtom,new Map(metadata.map(row=>[row.id,row])));
const root=createRoot(document.getElementById('root'));
const params=new URLSearchParams(location.search);
let props={workspace:params.get('ws')??'workspace-a',ready:params.get('delayed')!=='1',sessionsReady:params.get('delayed')!=='1',remoteWorkspaceId:'remote-a'};
const createSession=async(workspace,options)=>{actions.push(['create',workspace,options]);const row={id:'created',workspaceId:workspace,name:'Created'};
 store.set(sessionMetaMapAtom,new Map([...store.get(sessionMetaMapAtom),[row.id,row]]));return row};
const switchWorkspace=workspace=>{props={...props,workspace};render()};
function Probe(){const nav=useNavigation();const panels=useAtomValue(panelStackAtom);window.ui001.navigation=nav;
 return <><pre id="navigation-state">{JSON.stringify(nav.navigationState)}</pre><pre id="panel-stack">{JSON.stringify(panels)}</pre>{panels.map((entry,index)=><PanelSlot key={entry.id} entry={entry} isOnly={panels.length===1} isFocusedPanel={index===panels.length-1} isSidebarAndNavigatorHidden={false} isAtLeftEdge={true} isAtRightEdge={true} proportion={1}/>)}</>}
function FullFixture(){return <Provider store={store}><ShellContext.Provider value={{activeWorkspaceId:props.workspace,workspaces:[{id:props.workspace,remoteServer:{remoteWorkspaceId:props.remoteWorkspaceId}}],sessionStatuses:[],projects:[],loadedProjects:[],labels:[]}}>
 <NavigationProvider workspaceId={props.workspace} workspaceSlug={props.workspace} isReady={props.ready} isSessionsReady={props.sessionsReady}
  remoteWorkspaceId={props.remoteWorkspaceId} onCreateSession={createSession} onSwitchWorkspaceBySlug={switchWorkspace}>
  <Probe/>
 </NavigationProvider></ShellContext.Provider></Provider>}
function render(){root.render(<FullFixture/>)}
window.ui001={navigation:null,ready:()=>{props={...props,ready:true,sessionsReady:true};render()},
 navigate:(route,options)=>window.ui001.navigation.navigate(route,options),
 deepLink:view=>{for(const fn of deepLinkListeners)fn({view})},
 actionLink:(action,actionParams)=>{for(const fn of deepLinkListeners)fn({action,actionParams})},
 removeSession:id=>{const next=new Map(store.get(sessionMetaMapAtom));next.delete(id);store.set(sessionMetaMapAtom,next)},
 removeSource:()=>{sources=[];for(const fn of sourceListeners)fn(props.workspace,sources)},
 switchWorkspace,requests:()=>requests,actions:()=>actions,source,
 unmount:()=>root.unmount(),listeners:()=>deepLinkListeners.size};
render();
`
const entry = await buildMainFixture(temporary, true, { realNavigation: true, browserBootstrap: bootstrap })
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  return new URL(request.url).pathname === '/fixture.js'
    ? new Response(Bun.file(entry), { headers: { 'Content-Type': 'application/javascript' } })
    : new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } })
} })
const browser = await chromium.launch({ headless: true, ...(process.env.ROX_UI001_BROWSER_EXECUTABLE ? { executablePath: process.env.ROX_UI001_BROWSER_EXECUTABLE } : {}) })
const page = await browser.newPage()
const origin = `http://127.0.0.1:${server.port}`
const results: Array<{ name: string; pass: boolean; error?: string }> = []
const errors: string[] = []
page.on('pageerror', error => errors.push(error.message))
async function check(name: string, action: () => Promise<void>) {
  try { await action(); results.push({ name, pass: true }) }
  catch (error) { results.push({ name, pass: false, error: `${String(error)}; url=${page.url()}; state=${await page.locator('#navigation-state').textContent()}; actions=${JSON.stringify(await page.evaluate(() => (window as any).ui001?.actions()))}` }) }
}
async function state() { return JSON.parse((await page.locator('#navigation-state').textContent())!) }
async function selected(navigator: string, id?: string) {
  await page.waitForFunction(({ navigator, id }) => {
    const text = document.querySelector('#navigation-state')?.textContent
    if (!text) return false
    const state = JSON.parse(text)
    return state.navigator === navigator && (!id || JSON.stringify(state.details).includes(id))
  }, { navigator, id }, { timeout: 3500 })
}
try {
  await check('The mounted NavigationProvider restores a source deep link, back/forward and reload', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=sources/source/one&sidebar=files/src/main.ts`)
    await selected('sources', 'one')
    await page.locator('[data-route-host="SourceInfoPage"]').waitFor()
    await page.evaluate(() => (window as any).ui001.navigate('sources/source/two'))
    await selected('sources', 'two')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('route') === 'sources/source/two')
    assert.equal(await page.evaluate(() => history.state.seq), 1)
    await page.goBack(); await selected('sources', 'one')
    await page.goForward(); await selected('sources', 'two')
    await page.reload(); await selected('sources', 'two')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.deepEqual((await state()).rightSidebar, { type: 'files', path: 'src/main.ts' })
  })
  await check('A deleted selected source retains its URL and specific missing surface', async () => {
    await page.evaluate(() => (window as any).ui001.removeSource())
    await page.locator('[data-testid="route-resource-missing"]').waitFor()
    await selected('sources', 'two')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'sources/source/two')
  })
  await check('Missing and deleted explicit sessions stay selected instead of choosing another chat', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=allSessions/session/missing`)
    await selected('sessions', 'missing')
    await page.reload(); await selected('sessions', 'missing')
    await page.evaluate(() => (window as any).ui001.navigate('allSessions/session/local'))
    await selected('sessions', 'local')
    await page.evaluate(() => (window as any).ui001.removeSession('local'))
    await selected('sessions', 'local')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').getAttribute('data-props'), '{"sessionId":"local"}')
  })
  await check('A foreign workspace session is unavailable and the remote alias remains valid', async () => {
    await page.evaluate(() => (window as any).ui001.navigate('allSessions/session/foreign'))
    await selected('unavailable')
    assert.equal((await state()).reason, 'workspace-mismatch')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    await page.locator('[data-testid="route-unavailable"]').waitFor()
    await page.evaluate(() => (window as any).ui001.navigate('allSessions/session/remote'))
    await selected('sessions', 'remote')
    await page.locator('[data-route-host="ChatPage"]').waitFor()
    assert.equal(await page.locator('[data-route-host="ChatPage"]').getAttribute('data-props'), '{"sessionId":"remote"}')
  })
  await check('Restoring a foreign session address checks the actual PanelSlot override through reload', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=allSessions/session/foreign`)
    await selected('unavailable')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    await page.locator('[data-testid="route-unavailable"]').waitFor()
    await page.reload(); await selected('unavailable')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/foreign')
  })
  await check('An unfocused foreign-session panel stays unavailable beside a valid local panel', async () => {
    await page.evaluate(() => (window as any).ui001.navigate('allSessions/session/local', { newPanel: true }))
    await selected('sessions', 'local')
    assert.equal(await page.locator('[data-panel-role="content"]').count(), 2)
    assert.equal(await page.locator('[data-testid="route-unavailable"]').count(), 1)
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 1)
    assert.equal(await page.locator('[data-route-host="ChatPage"]').getAttribute('data-props'), '{"sessionId":"local"}')
    await page.reload(); await selected('sessions', 'local')
    assert.equal(await page.locator('[data-testid="route-unavailable"]').count(), 1)
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 1)
  })
  await check('Legacy zero/one panel proportions recover without becoming part of an entity address', async () => {
    const panels = 'allSessions/session/local:1.0000,retired/surface:0.0000'
    await page.goto(`${origin}?ws=workspace-a&route=retired/surface&panels=${encodeURIComponent(panels)}&fi=1`)
    await selected('unavailable')
    assert.equal((await state()).route, 'retired/surface')
    const restored = JSON.parse((await page.locator('#panel-stack').textContent())!)
    assert.deepEqual(restored.map((panel: any) => panel.route), ['allSessions/session/local', 'retired/surface'])
    assert.deepEqual(restored.map((panel: any) => panel.proportion), [0.5, 0.5])
    await page.reload(); await selected('unavailable')
    assert.equal((await state()).route, 'retired/surface')
  })
  await check('Unknown and malformed incoming deep links retain an unavailable surface through reload', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=home`)
    await selected('home')
    for (const route of ['retired/surface', 'knowledge/unknown/id', 'sources/source/%']) {
      await page.waitForFunction(() => (window as any).ui001.listeners() === 1)
      await page.evaluate(route => (window as any).ui001.deepLink(route), route)
      await selected('unavailable')
      assert.equal((await state()).route, route)
      await page.waitForFunction(route => new URL(location.href).searchParams.get('route') === route, route)
      await page.reload(); await selected('unavailable')
      assert.equal((await state()).route, route)
    }
  })
  await check('A queued address keeps its complete entity and new-panel option until readiness', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=home&delayed=1`)
    await page.waitForFunction(() => !!(window as any).ui001?.navigation)
    await page.evaluate(() => (window as any).ui001.navigate('sources/source/two', { newPanel: true, targetLaneId: 'main' }))
    await page.evaluate(() => (window as any).ui001.ready())
    await selected('sources', 'two')
    const panels = JSON.parse((await page.locator('#panel-stack').textContent())!)
    assert.equal(panels.length, 2)
    assert.equal(panels[1].route, 'sources/source/two')
    assert.equal(panels[1].laneId, 'main')
    assert.ok(panels.every((panel: any) => panel.proportion > 0))
    await page.reload(); await page.waitForFunction(() => !!(window as any).ui001?.navigation)
    await page.evaluate(() => (window as any).ui001.ready()); await selected('sources', 'two')
    const restored = JSON.parse((await page.locator('#panel-stack').textContent())!)
    assert.deepEqual(restored.map((panel: any) => panel.route), ['home', 'sources/source/two'])
  })
  await check('A queued deep-link action retains query parameters and executes once after readiness', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=home&delayed=1`)
    await page.waitForFunction(() => !!(window as any).ui001?.navigation)
    await page.waitForFunction(() => (window as any).ui001.listeners() === 1)
    await page.evaluate(() => (window as any).ui001.actionLink('new-session', { model: 'rox/fast', workdir: '/fixture/project', name: 'Linked session' }))
    assert.deepEqual(await page.evaluate(() => (window as any).ui001.actions()), [])
    await page.evaluate(() => (window as any).ui001.ready())
    await selected('sessions', 'created')
    const actions = await page.evaluate(() => (window as any).ui001.actions())
    assert.deepEqual(actions.filter((row: any[]) => row[0] === 'create'), [['create', 'workspace-a', { workingDirectory: '/fixture/project', model: 'rox/fast' }]])
    assert.ok(actions.some((row: any[]) => row[0] === 'command' && row[2].name === 'Linked session'))
  })
  await check('Browser workspace history restores the workspace and its selected address together', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=sources/source/one`)
    await selected('sources', 'one')
    await page.evaluate(() => (window as any).ui001.switchWorkspace('workspace-b'))
    await page.waitForFunction(() => new URL(location.href).searchParams.get('ws') === 'workspace-b')
    await page.evaluate(() => (window as any).ui001.navigate('sources/source/two'))
    await selected('sources', 'two')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('route') === 'sources/source/two')
    await page.goBack(); await page.goBack()
    await selected('sources', 'one')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    await page.goForward(); await page.goForward(); await selected('sources', 'two')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-b')
  })
  await check('Unmount removes the actual deep-link subscription', async () => {
    assert.equal(await page.evaluate(() => (window as any).ui001.listeners()), 1)
    await page.evaluate(() => (window as any).ui001.unmount())
    assert.equal(await page.evaluate(() => (window as any).ui001.listeners()), 0)
  })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ environment: 'Actual mounted NavigationProvider, PanelSlot, MainContentPanel, session-selection hooks and panel/session atoms in isolated Chromium; leaf presentation and IPC boundary fixtures; no hosted/native service acceptance', browserVersion: browser.version(), results }, null, 2))
  if (results.some(result => !result.pass)) process.exitCode = 1
} finally { await browser.close(); server.stop(); rmSync(temporary, { recursive: true, force: true }) }
