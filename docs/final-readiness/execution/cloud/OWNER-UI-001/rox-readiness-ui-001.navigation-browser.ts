import { chromium } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { buildMainFixture } from '../../../../../apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.component-harness'

const temporary = mkdtempSync(join(import.meta.dir, 'rox-readiness-ui-001-nav-temp-'))
const renderer = resolve(import.meta.dir, '../../../../../apps/electron/src/renderer')
// Exercise the shipped AppShell effect with the real selection hook and loader
// atom. Its IPC endpoint is the fixture boundary; no provider is contacted.
function appShellMessageEffect() {
  const file = ts.createSourceFile('AppShell.tsx', readFileSync(join(renderer, 'components/app-shell/AppShell.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const effects: string[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'React.useEffect'
      && node.arguments[0]?.getText(file).includes('ensureMessagesLoaded(session.selected)')) effects.push(node.getText(file))
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(effects.length, 1, 'The actual shell session loader must be exercised')
  return effects[0]
}
const bootstrap = `
import {createRoot} from 'react-dom/client';
import {Provider,createStore,useAtomValue,useSetAtom} from 'jotai';
import {NavigationProvider,useNavigation} from ${JSON.stringify(join(renderer, 'contexts/NavigationContext.tsx'))};
import {sessionMetaMapAtom,ensureSessionMessagesLoadedAtom} from ${JSON.stringify(join(renderer, 'atoms/sessions.ts'))};
import {useSession} from ${JSON.stringify(join(renderer, 'hooks/useSession.ts'))};
import {panelStackAtom} from ${JSON.stringify(join(renderer, 'atoms/panel-stack.ts'))};
import {PanelSlot} from ${JSON.stringify(join(renderer, 'components/app-shell/PanelSlot.tsx'))};
const store=createStore();
const sourceListeners=new Set(),skillListeners=new Set(),deepLinkListeners=new Set();
const requests=[],actions=[];
const source=slug=>({config:{slug,name:slug,type:'api',api:{baseUrl:'https://fixture.invalid'},enabled:true},folderPath:'/fixture/'+slug});
let sources=['one','two'].map(source),skills=[{slug:'skill-one',source:'workspace'}];
window.electronAPI={
 getSources:async(ws)=>{requests.push(['sources',ws]);return sources},getSkills:async(ws,cwd)=>{requests.push(['skills',ws,cwd]);return skills},
 getSessionMessages:async(id)=>{requests.push(['messages',props.workspace,id]);return null},
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
const switchRequests=[];
const switchWorkspaceBySlug=workspace=>{switchRequests.push(workspace);
 if(workspace==='rejected-workspace')throw new Error('fixture workspace switch rejected');
 if(!['workspace-a','workspace-b'].includes(workspace))return false;
 switchWorkspace(workspace);return true};
function Probe(){const nav=useNavigation();const panels=useAtomValue(panelStackAtom);window.ui001.navigation=nav;
 const [session,setSession]=useSession();
 const sessionMetaMap=useAtomValue(sessionMetaMapAtom);
 const activeWorkspaceId=props.workspace,remoteWorkspaceId=props.remoteWorkspaceId;
 const ensureMessagesLoaded=useSetAtom(ensureSessionMessagesLoadedAtom);
 window.ui001.setSelected=id=>setSession({selected:id});
 ${appShellMessageEffect()};
 window.ui001.selected=()=>session.selected;
 return <><pre id="navigation-state">{JSON.stringify(nav.navigationState)}</pre><pre id="panel-stack">{JSON.stringify(panels)}</pre>{panels.map((entry,index)=><PanelSlot key={entry.id} entry={entry} isOnly={panels.length===1} isFocusedPanel={index===panels.length-1} isSidebarAndNavigatorHidden={false} isAtLeftEdge={true} isAtRightEdge={true} proportion={1}/>)}</>}
function FullFixture(){return <Provider store={store}><ShellContext.Provider value={{activeWorkspaceId:props.workspace,workspaces:[{id:props.workspace,remoteServer:{remoteWorkspaceId:props.remoteWorkspaceId}}],sessionStatuses:[],projects:[],loadedProjects:[],labels:[]}}>
 <NavigationProvider workspaceId={props.workspace} workspaceSlug={props.workspace} isReady={props.ready} isSessionsReady={props.sessionsReady}
  remoteWorkspaceId={props.remoteWorkspaceId} onCreateSession={createSession} onSwitchWorkspaceBySlug={switchWorkspaceBySlug}>
  <Probe/>
 </NavigationProvider></ShellContext.Provider></Provider>}
function render(){root.render(<React.StrictMode><FullFixture/></React.StrictMode>)}
window.ui001={navigation:null,ready:()=>{props={...props,ready:true,sessionsReady:true};render()},
 navigate:(route,options)=>window.ui001.navigation.navigate(route,options),
 deepLink:view=>{for(const fn of deepLinkListeners)fn({view})},
 actionLink:(action,actionParams)=>{for(const fn of deepLinkListeners)fn({action,actionParams})},
 removeSession:id=>{const next=new Map(store.get(sessionMetaMapAtom));next.delete(id);store.set(sessionMetaMapAtom,next)},
 publishSession:(id,workspaceId)=>{const next=new Map(store.get(sessionMetaMapAtom));next.set(id,{id,workspaceId,name:id});store.set(sessionMetaMapAtom,next)},
 removeSource:()=>{sources=[];for(const fn of sourceListeners)fn(props.workspace,sources)},
 switchWorkspace,requests:()=>requests,actions:()=>actions,source,
 beginWorkspaceSwitch:()=>{props={...props,workspace:'workspace-b',sessionsReady:false};window.ui001.setSelected(null);store.set(sessionMetaMapAtom,new Map());render()},
 completeWorkspaceSwitch:()=>{store.set(sessionMetaMapAtom,new Map([['foreign',metadata[1]]]));props={...props,sessionsReady:true};render()},
 chatMounts:()=>window.__ui001ChatMounts??[],switchRequests:()=>switchRequests,
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
    await page.waitForFunction(() => history.state.seq === 1, null, { timeout: 3500 })
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
    await page.locator('[data-testid="route-session-missing"]').waitFor()
    assert.equal(await page.locator('[data-testid="route-session-missing"]').getAttribute('data-route-entity'), 'missing')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/missing')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    await page.reload(); await selected('sessions', 'missing')
    await page.evaluate(() => (window as any).ui001.navigate('allSessions/session/local'))
    await selected('sessions', 'local')
    await page.evaluate(() => (window as any).ui001.removeSession('local'))
    await selected('sessions', 'local')
    await page.locator('[data-testid="route-session-missing"]').waitFor()
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    assert.equal(await page.locator('[data-testid="route-session-missing"]').getAttribute('data-route-entity'), 'local')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/local')
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
  await check('Cleared metadata cannot mount a retained chat during a real workspace transition', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=allSessions/session/local`)
    await selected('sessions', 'local')
    await page.locator('[data-route-host="ChatPage"]').waitFor()
    const before = await page.evaluate(() => (window as any).ui001.chatMounts().length)
    await page.evaluate(() => (window as any).ui001.beginWorkspaceSwitch())
    await page.locator('[data-testid="route-unavailable"]').waitFor({ timeout: 3500 })
    assert.equal((await state()).navigator, 'unavailable')
    assert.equal((await state()).route, 'allSessions/session/local')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/local')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    assert.equal(await page.evaluate(() => (window as any).ui001.chatMounts().length), before)
    await page.evaluate(() => (window as any).ui001.completeWorkspaceSwitch())
    await selected('sessions', 'foreign')
    await page.locator('[data-route-host="ChatPage"]').waitFor()
    assert.ok((await page.evaluate(before => (window as any).ui001.chatMounts().slice(before), before)).every((id: string) => id === 'foreign'))
  })
  await check('Cleared ownership metadata cannot restore global selection or trigger the actual shell loader', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=allSessions/session/local`)
    await selected('sessions', 'local')
    await page.waitForFunction(() => (window as any).ui001.selected() === 'local')
    const before = await page.evaluate(() => (window as any).ui001.requests().filter((row: string[]) => row[0] === 'messages').length)
    await page.evaluate(() => (window as any).ui001.beginWorkspaceSwitch())
    await page.locator('[data-testid="route-unavailable"]').waitFor({ timeout: 3500 })
    assert.equal((await state()).navigator, 'unavailable')
    assert.equal((await state()).route, 'allSessions/session/local')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/local')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => (window as any).ui001.selected()), null)
    assert.equal(await page.evaluate(() => (window as any).ui001.requests().filter((row: string[]) => row[0] === 'messages').length), before)
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/local')
    await page.evaluate(() => (window as any).ui001.completeWorkspaceSwitch())
    await selected('sessions', 'foreign')
    await page.waitForFunction(() => (window as any).ui001.requests().some((row: string[]) => row[0] === 'messages' && row[1] === 'workspace-b' && row[2] === 'foreign'))
  })
  await check('The actual shell loader rejects an independent foreign selection and accepts verified local and remote sessions', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=home`)
    await selected('home')
    await page.evaluate(() => (window as any).ui001.setSelected('foreign'))
    await page.waitForFunction(() => (window as any).ui001.selected() === 'foreign')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual(await page.evaluate(() => (window as any).ui001.requests().filter((row: string[]) => row[0] === 'messages')), [])
    await page.evaluate(() => (window as any).ui001.setSelected('missing'))
    await page.waitForFunction(() => (window as any).ui001.selected() === 'missing')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual(await page.evaluate(() => (window as any).ui001.requests().filter((row: string[]) => row[0] === 'messages')), [])
    await page.evaluate(() => (window as any).ui001.publishSession('missing', 'workspace-a'))
    await page.waitForFunction(() => (window as any).ui001.requests().some((row: string[]) => row[0] === 'messages' && row[2] === 'missing'))
    await page.evaluate(() => (window as any).ui001.setSelected('local'))
    await page.waitForFunction(() => (window as any).ui001.requests().some((row: string[]) => row[0] === 'messages' && row[2] === 'local'))
    await page.evaluate(() => (window as any).ui001.setSelected('remote'))
    await page.waitForFunction(() => (window as any).ui001.requests().some((row: string[]) => row[0] === 'messages' && row[2] === 'remote'))
    assert.ok((await page.evaluate(() => (window as any).ui001.requests().filter((row: string[]) => row[0] === 'messages'))).every((row: string[]) => row[1] === 'workspace-a' && ['missing', 'local', 'remote'].includes(row[2])))
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
    await page.goto(`${origin}?ws=workspace-a&route=retired/surface:&panels=${encodeURIComponent('retired/surface:,home:1')}&fi=0`)
    await selected('unavailable')
    assert.equal((await state()).route, 'retired/surface:')
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
  await check('Split-panel reload and history preserve commas and numeric colon suffixes inside unavailable addresses', async () => {
    for (const route of ['knowledge/unknown,id/x', 'retired/surface:0.5']) {
      await page.goto(`${origin}?ws=workspace-a&route=home`)
      await selected('home')
      await page.evaluate(route => (window as any).ui001.navigate(route, { newPanel: true }), route)
      await selected('unavailable')
      await page.waitForFunction(route => new URL(location.href).searchParams.get('route') === route, route)
      await page.reload(); await selected('unavailable')
      assert.equal((await state()).route, route)
      const restored = JSON.parse((await page.locator('#panel-stack').textContent())!)
      assert.deepEqual(restored.map((panel: any) => panel.route), ['home', route])
      await page.evaluate(() => (window as any).ui001.navigate('sources/source/one'))
      await selected('sources', 'one'); await page.waitForFunction(() => new URL(location.href).searchParams.get('route') === 'sources/source/one')
      await page.goBack(); await selected('unavailable')
      assert.equal((await state()).route, route)
      await page.goForward(); await selected('sources', 'one')
    }
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
  await check('Deleted and rejected history workspaces release suppression for later navigation and workspace switches', async () => {
    for (const missing of ['deleted-workspace', 'rejected-workspace']) {
      await page.goto(`${origin}?ws=workspace-a&route=sources/source/one`)
      await selected('sources', 'one')
      await page.evaluate(missing => {
        const url = new URL(location.href); url.searchParams.set('ws', missing)
        history.replaceState({ seq: 0 }, '', url)
        dispatchEvent(new PopStateEvent('popstate', { state: { seq: 0 } }))
      }, missing)
      await page.waitForFunction(missing => (window as any).ui001.switchRequests().includes(missing), missing)
      await page.evaluate(() => (window as any).ui001.navigate('sources/source/two'))
      await selected('sources', 'two')
      await page.waitForFunction(() => new URL(location.href).searchParams.get('ws') === 'workspace-a'
        && new URL(location.href).searchParams.get('route') === 'sources/source/two', null, { timeout: 3500 })
      await page.evaluate(() => (window as any).ui001.switchWorkspace('workspace-b'))
      await page.waitForFunction(() => new URL(location.href).searchParams.get('ws') === 'workspace-b', null, { timeout: 3500 })
      await page.goBack(); await selected('sources', 'two')
      assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    }
  })
  await check('Unmount removes the actual deep-link subscription', async () => {
    assert.equal(await page.evaluate(() => (window as any).ui001.listeners()), 1)
    await page.evaluate(() => (window as any).ui001.unmount())
    assert.equal(await page.evaluate(() => (window as any).ui001.listeners()), 0)
  })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ environment: 'Actual mounted NavigationProvider, PanelSlot, MainContentPanel, session-selection hooks, panel/session atoms and extracted shipped AppShell message-loading effect under production StrictMode in isolated Chromium; leaf presentation and IPC boundary fixtures; no hosted/native service acceptance', browserVersion: browser.version(), results }, null, 2))
  if (results.some(result => !result.pass)) process.exitCode = 1
} finally { await browser.close(); server.stop(); rmSync(temporary, { recursive: true, force: true }) }
