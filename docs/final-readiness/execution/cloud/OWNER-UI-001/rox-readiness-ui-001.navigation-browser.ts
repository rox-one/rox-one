import { chromium, type Locator } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { buildMainFixture } from '../../../../../apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.component-harness'

// The fixture surface the bootstrap below hangs on `window`. Page callbacks are
// serialized into the browser and cannot close over module scope, so each one
// reads it from the global; declaring the shape once keeps those reads checked
// instead of casting at every call site.
declare global {
  interface Window {
    ui001: {
      navigation: unknown
      ready(): void
      navigate(route: string, options?: { newPanel?: boolean; targetLaneId?: string }): void
      deepLink(view: string): void
      actionLink(action: string, actionParams: Record<string, string>): void
      removeSession(id: string): void
      publishSession(id: string, workspaceId: string): void
      removeSource(): void
      switchWorkspace(workspace: string): void
      setSelected(id: string | null): void
      selected(): string | null
      requests(): string[][]
      // ['create', workspaceId, options] | ['command', ...args]
      actions(): Array<[string, unknown?, { name?: string }?]>
      chatMounts(): string[]
      switchRequests(): string[]
      unmount(): void
      listeners(): number
      beginWorkspaceSwitch(): void
      completeWorkspaceSwitch(): void
      source(slug: string): unknown
    }
    // Committed-render selections, appended by the bootstrap's recorder effect.
    __ui001Commits?: Array<string | null>
  }
}

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
import {TooltipProvider} from ${JSON.stringify(join(renderer, '../../../../packages/ui/src/components/tooltip.tsx'))};
const store=createStore();
const sourceListeners=new Set(),skillListeners=new Set(),deepLinkListeners=new Set();
const requests=[],actions=[];
const source=slug=>({config:{slug,name:slug,type:'api',api:{baseUrl:'https://fixture.invalid'},enabled:true},folderPath:'/fixture/'+slug});
let sources=['one','two'].map(source),skills=[{slug:'skill-one',source:'workspace'}];
window.electronAPI={
 getRuntimeTraceSnapshot:async(query)=>({schemaVersion:1,workspaceId:query.workspaceId,sessionId:query.sessionId,
  runs:[],events:[],coverage:{state:'unavailable',source:'runtime',missing:['ui001-runtime-not-recorded'],reason:'UI-001 navigation fixture does not record runtime execution'}}),
 readRuntimeTraceEvents:async()=>{throw new Error('Runtime event paging is outside this navigation fixture')},
 readRuntimeTracePayload:async()=>{throw new Error('Runtime payload reads are outside this navigation fixture')},
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
 // Record the selection of every render this component commits. React flushes a
 // component's passive effects in declaration order, so this runs *after* the
 // extracted shipped effect above: a later entry proves that commit's loader
 // call has already been made (or deliberately skipped). The gate waits on this
 // instead of sleeping animation frames, which only guessed at it.
 React.useEffect(()=>{(window.__ui001Commits??=[]).push(session.selected)});
 window.ui001.selected=()=>session.selected;
 return <><pre id="navigation-state">{JSON.stringify(nav.navigationState)}</pre><pre id="panel-stack">{JSON.stringify(panels)}</pre>{panels.map((entry,index)=><PanelSlot key={entry.id} entry={entry} isOnly={panels.length===1} isFocusedPanel={index===panels.length-1} isSidebarAndNavigatorHidden={false} isAtLeftEdge={true} isAtRightEdge={true} proportion={1}/>)}</>}
function FullFixture(){return <Provider store={store}><ShellContext.Provider value={{activeWorkspaceId:props.workspace,workspaces:[{id:props.workspace,remoteServer:{remoteWorkspaceId:props.remoteWorkspaceId}}],sessionStatuses:[],projects:[],loadedProjects:[],labels:[]}}>
 <TooltipProvider delayDuration={0}>
 <NavigationProvider workspaceId={props.workspace} workspaceSlug={props.workspace} isReady={props.ready} isSessionsReady={props.sessionsReady}
  remoteWorkspaceId={props.remoteWorkspaceId} onCreateSession={createSession} onSwitchWorkspaceBySlug={switchWorkspaceBySlug}>
  <Probe/>
 </NavigationProvider>
 </TooltipProvider></ShellContext.Provider></Provider>}
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

// Every wait in this file runs on one named budget. It used to be a fixed
// `{ timeout: 3500 }` per call, which is a slice of wall clock rather than a
// description of anything: on a loaded runner or a cold renderer the wait
// expired while the app was still settling, so the check reported a *timeout*
// instead of the state it was waiting for -- which is how several reds this
// month were misread. A wait now names the condition it waits for, so a slow
// machine slows the wait instead of failing it, while a condition that
// genuinely never holds still fails with the state that was observed.
//
// 30s is Playwright's own default for these waits, so nothing became tighter
// than the wait it replaces (the fixed ones were 3.5s) and the budget lives in
// exactly one place.
const WAIT = 30_000
// Poll on a wall-clock interval instead of on animation frames: the predicates
// describe application state, and a frame loop is the kind of race this file no
// longer relies on.
const POLL = 25

const results: Array<{ name: string; pass: boolean; error?: string }> = []
// A page error belongs to the check that was running when it was raised: an
// unrelated error can never be attributed to a later case, and a failure report
// carries only its own check's errors.
const errors: Array<{ check: string | null; message: string }> = []
// Reported, never fatal. Chromium raises the browser's own layout notifications
// as a window ErrorEvent and the resizable shell schedules ResizeObserver work
// in the same turn, so these are not failures of the product under test. Same
// allowlist as
// apps/electron/src/renderer/components/markdown/__tests__/openui-block/openui-block.browser.test.ts.
const BENIGN_PAGE_ERRORS = [/ResizeObserver loop/]
let runningCheck: string | null = null
page.on('pageerror', error => errors.push({ check: runningCheck, message: error.message }))

// Diagnostics must never throw: a render-time error that unmounts the whole root
// removes #navigation-state, and an undefended textContent() then raised its own
// locator timeout that reported the locator instead of the actual cause. This is
// shared by the failure report in check() and by every wait that exhausts its
// budget, so a red always shows what the app was actually doing.
async function observed() {
  const state = await page.locator('#navigation-state').textContent().catch(() => '<#navigation-state absent: root unmounted>')
  const panels = await page.locator('#panel-stack').textContent().catch(() => '<#panel-stack absent: root unmounted>')
  // The committed selections are what makes a selection-leak red readable.
  const commits = await page.evaluate(() => window.__ui001Commits?.slice(-4) ?? null).catch(() => null)
  const actions = await page.evaluate(() => window.ui001?.actions() ?? null).catch(() => null)
  const own = errors.filter(error => error.check === runningCheck).map(error => error.message)
  return `url=${page.url()}; state=${state}; panels=${panels}; committed=${JSON.stringify(commits)}; pageErrors=${JSON.stringify(own)}; actions=${JSON.stringify(actions)}`
}
// A wait that exhausted its budget already reports the observed state, so
// check() must not append it a second time.
class WaitTimeout extends Error {}
// Wait for a condition that is named. The predicate runs in the page, so it
// costs nothing while it holds and the one budget above bounds it.
async function waitFor<Arg>(description: string, predicate: (arg: Arg) => unknown, arg?: Arg) {
  try { await page.waitForFunction(predicate, arg as Arg, { timeout: WAIT, polling: POLL }) }
  catch { throw new WaitTimeout(`the condition "${description}" did not hold within ${WAIT}ms; ${await observed()}`) }
}
// Locator visibility, on the same budget and with the same failure report.
async function visible(description: string, locator: Locator) {
  try { await locator.waitFor({ timeout: WAIT }) }
  catch { throw new WaitTimeout(`the condition "${description}" did not hold within ${WAIT}ms; ${await observed()}`) }
}
// The shipped AppShell loader is a passive effect, so it runs after the commit
// that carries a selection -- and `window.ui001.selected()` is assigned during
// render, which means seeing it change does not prove that commit, let alone its
// effects, has happened. Every "the loader must NOT run" assertion below needs
// that proof. The bootstrap records the selection of each committed render from
// its own effect, which React flushes after the extracted shipped effect (effects
// run in declaration order within a component), so a commit started after
// `action` whose recorded selection is `selection` is a real predicate for "the
// shell has processed this state" -- what a two-frame sleep only guessed at.
async function committed(description: string, action: () => Promise<void>, selection: string | null) {
  const before = await page.evaluate(() => window.__ui001Commits?.length ?? 0)
  await action()
  await waitFor(description, ({ before, selection }: { before: number; selection: string | null }) => {
    const log = window.__ui001Commits
    return !!log && log.length > before && log[log.length - 1] === selection
  }, { before, selection })
}
async function check(name: string, action: () => Promise<void>) {
  runningCheck = name
  try {
    // The shell persists per-workspace URLs in localStorage. Checks share one browser
    // context, so start each check from clean storage to keep them independent.
    if (page.url() !== 'about:blank') await page.evaluate(() => localStorage.clear())
    await action(); results.push({ name, pass: true })
  }
  catch (error) {
    // A wait that exhausted its budget already carries the observed state.
    results.push({ name, pass: false, error: error instanceof WaitTimeout ? String(error) : `${String(error)}; ${await observed()}` })
  }
}
async function state() { return JSON.parse((await page.locator('#navigation-state').textContent())!) }
async function selected(navigator: string, id?: string) {
  await waitFor(`the navigation state is ${navigator}${id ? ` for ${id}` : ''}`, ({ navigator, id }: { navigator: string; id?: string }) => {
    const text = document.querySelector('#navigation-state')?.textContent
    if (!text) return false
    const state = JSON.parse(text)
    return state.navigator === navigator && (!id || JSON.stringify(state.details).includes(id))
  }, { navigator, id })
}
// The keep-alive host leaves the last visited surfaces mounted but hidden, so a
// route state that several of those surfaces can render (missing sessions are
// one) must be addressed on the surface the shell is actually showing.
function surface(testId: string) {
  return page.locator(`[data-surface-active="true"] [data-testid="${testId}"]`)
}
try {
  await check('The mounted NavigationProvider restores a source deep link, back/forward and reload', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=sources/source/one&sidebar=files/src/main.ts`)
    await selected('sources', 'one')
    await visible('the source surface for the restored route', page.locator('[data-route-host="SourceInfoPage"]'))
    await page.evaluate(() => window.ui001.navigate('sources/source/two'))
    await selected('sources', 'two')
    await waitFor('the address carries the navigated route', () => new URL(location.href).searchParams.get('route') === 'sources/source/two')
    await waitFor('the address entry carries history sequence 1', () => history.state.seq === 1)
    assert.equal(await page.evaluate(() => history.state.seq), 1)
    await page.goBack(); await selected('sources', 'one')
    await page.goForward(); await selected('sources', 'two')
    await page.reload(); await selected('sources', 'two')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.deepEqual((await state()).rightSidebar, { type: 'files', path: 'src/main.ts' })
  })
  await check('A deleted selected source retains its URL and specific missing surface', async () => {
    await page.evaluate(() => window.ui001.removeSource())
    await visible('the missing-source surface for the deleted source', page.locator('[data-testid="route-resource-missing"]'))
    await selected('sources', 'two')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'sources/source/two')
  })
  await check('Missing and deleted explicit sessions stay selected instead of choosing another chat', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=allSessions/session/missing`)
    await selected('sessions', 'missing')
    await visible('the missing-session surface on the active panel', surface('route-session-missing'))
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/' + (await state()).details.sessionId)
    assert.equal(await surface('route-session-missing').getAttribute('data-route-entity'), 'missing')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/missing')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    await page.reload(); await selected('sessions', 'missing')
    await page.evaluate(() => window.ui001.navigate('allSessions/session/local'))
    await selected('sessions', 'local')
    await page.evaluate(() => window.ui001.removeSession('local'))
    await selected('sessions', 'local')
    await visible('the missing-session surface for the deleted local session', surface('route-session-missing'))
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    assert.equal(await surface('route-session-missing').getAttribute('data-route-entity'), 'local')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/local')
  })
  await check('A foreign workspace session is unavailable and the remote alias remains valid', async () => {
    await page.evaluate(() => window.ui001.navigate('allSessions/session/foreign'))
    await selected('unavailable')
    assert.equal((await state()).reason, 'workspace-mismatch')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    await visible('the unavailable surface for the foreign session', page.locator('[data-testid="route-unavailable"]'))
    await page.evaluate(() => window.ui001.navigate('allSessions/session/remote'))
    await selected('sessions', 'remote')
    await visible('the chat surface for the remote alias session', page.locator('[data-route-host="ChatPage"]'))
    assert.equal(await page.locator('[data-route-host="ChatPage"]').getAttribute('data-props'), '{"sessionId":"remote"}')
  })
  await check('Restoring a foreign session address checks the actual PanelSlot override through reload', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=allSessions/session/foreign`)
    await selected('unavailable')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    await visible('the unavailable surface for the restored foreign address', page.locator('[data-testid="route-unavailable"]'))
    await page.reload(); await selected('unavailable')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/foreign')
  })
  await check('An unfocused foreign-session panel stays unavailable beside a valid local panel', async () => {
    await page.evaluate(() => window.ui001.navigate('allSessions/session/local', { newPanel: true }))
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
    await visible('the chat surface for the selected local session', page.locator('[data-route-host="ChatPage"]'))
    const before = await page.evaluate(() => window.ui001.chatMounts().length)
    await committed('the shell has committed the cleared workspace switch without a selection',
      () => page.evaluate(() => window.ui001.beginWorkspaceSwitch()), null)
    await visible('the unavailable surface for the cleared workspace', page.locator('[data-testid="route-unavailable"]'))
    assert.equal((await state()).navigator, 'unavailable')
    assert.equal((await state()).route, 'allSessions/session/local')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/local')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    assert.equal(await page.evaluate(() => window.ui001.chatMounts().length), before)
    await committed('the rebuilt shell has committed without restoring the former workspace selection',
      () => page.evaluate(() => window.ui001.completeWorkspaceSwitch()), null)
    // The rebuilt shell opens the new workspace's own address (no saved URL in this
    // fixture: the initial Home, per 1046fb5d0 "старт на Главной") instead of adopting
    // the former workspace's session route. Its sessions stay reachable only through
    // an explicit new-owner navigation.
    await waitFor('the address is the new workspace', () => new URL(location.href).searchParams.get('ws') === 'workspace-b')
    await selected('home')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'home')
    assert.equal(await page.locator('[data-route-host="ChatPage"]').count(), 0)
    assert.equal(await page.evaluate(() => window.ui001.chatMounts().length), before)
    await page.evaluate(() => window.ui001.navigate('allSessions/session/foreign'))
    await selected('sessions', 'foreign')
    await visible('the chat surface for the new workspace session', page.locator('[data-route-host="ChatPage"]'))
    assert.ok((await page.evaluate(before => window.ui001.chatMounts().slice(before), before)).every((id: string) => id === 'foreign'))
  })
  await check('Cleared ownership metadata cannot restore global selection or trigger the actual shell loader', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=allSessions/session/local`)
    await selected('sessions', 'local')
    await waitFor('the selection hook holds the local session', () => window.ui001.selected() === 'local')
    const before = await page.evaluate(() => window.ui001.requests().filter((row: string[]) => row[0] === 'messages').length)
    await committed('the shell has committed the cleared workspace switch without a selection',
      () => page.evaluate(() => window.ui001.beginWorkspaceSwitch()), null)
    await visible('the unavailable surface for the cleared workspace', page.locator('[data-testid="route-unavailable"]'))
    assert.equal((await state()).navigator, 'unavailable')
    assert.equal((await state()).route, 'allSessions/session/local')
    assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/local')
    assert.equal(await page.evaluate(() => window.ui001.selected()), null)
    assert.equal(await page.evaluate(() => window.ui001.requests().filter((row: string[]) => row[0] === 'messages').length), before)
    assert.equal(new URL(page.url()).searchParams.get('route'), 'allSessions/session/local')
    await committed('the rebuilt shell has committed without restoring the former workspace selection',
      () => page.evaluate(() => window.ui001.completeWorkspaceSwitch()), null)
    // The former workspace's selection is not restored: the rebuilt shell opens the
    // new workspace's own address (Home, per 1046fb5d0) and the shell loader stays
    // silent for the cleared metadata. An explicit new-owner selection is what reaches
    // the loader.
    await waitFor('the address is the new workspace', () => new URL(location.href).searchParams.get('ws') === 'workspace-b')
    await selected('home')
    assert.equal(await page.evaluate(() => window.ui001.selected()), null)
    assert.equal(await page.evaluate(() => window.ui001.requests().filter((row: string[]) => row[0] === 'messages').length), before)
    await page.evaluate(() => window.ui001.navigate('allSessions/session/foreign'))
    await selected('sessions', 'foreign')
    await waitFor('the shell loader reads the new workspace session from its new owner', () => window.ui001.requests().some((row: string[]) => row[0] === 'messages' && row[1] === 'workspace-b' && row[2] === 'foreign'))
    assert.ok((await page.evaluate(before => window.ui001.requests().filter((row: string[]) => row[0] === 'messages').slice(before), before)).every((row: string[]) => row[1] === 'workspace-b' && row[2] === 'foreign'))
  })
  await check('The actual shell loader rejects an independent foreign selection and accepts verified local and remote sessions', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=home`)
    await selected('home')
    await committed('the shell has committed the rejected independent selection',
      () => page.evaluate(() => window.ui001.setSelected('foreign')), 'foreign')
    assert.deepEqual(await page.evaluate(() => window.ui001.requests().filter((row: string[]) => row[0] === 'messages')), [])
    await committed('the shell has committed the selection of an unpublished session',
      () => page.evaluate(() => window.ui001.setSelected('missing')), 'missing')
    assert.deepEqual(await page.evaluate(() => window.ui001.requests().filter((row: string[]) => row[0] === 'messages')), [])
    await page.evaluate(() => window.ui001.publishSession('missing', 'workspace-a'))
    await waitFor('the shell loader accepts the session once its owner publishes it', () => window.ui001.requests().some((row: string[]) => row[0] === 'messages' && row[2] === 'missing'))
    await page.evaluate(() => window.ui001.setSelected('local'))
    await waitFor('the shell loader reads the verified local session', () => window.ui001.requests().some((row: string[]) => row[0] === 'messages' && row[2] === 'local'))
    await page.evaluate(() => window.ui001.setSelected('remote'))
    await waitFor('the shell loader reads the remote alias session', () => window.ui001.requests().some((row: string[]) => row[0] === 'messages' && row[2] === 'remote'))
    assert.ok((await page.evaluate(() => window.ui001.requests().filter((row: string[]) => row[0] === 'messages'))).every((row: string[]) => row[1] === 'workspace-a' && ['missing', 'local', 'remote'].includes(row[2])))
  })
  await check('Legacy zero/one panel proportions recover without becoming part of an entity address', async () => {
    const panels = 'allSessions/session/local:1.0000,retired/surface:0.0000'
    await page.goto(`${origin}?ws=workspace-a&route=retired/surface&panels=${encodeURIComponent(panels)}&fi=1&pi=1`)
    await selected('unavailable')
    assert.equal((await state()).route, 'retired/surface')
    const restored = JSON.parse((await page.locator('#panel-stack').textContent())!)
    assert.deepEqual(restored.map((panel: { route: string }) => panel.route), ['allSessions/session/local', 'retired/surface'])
    assert.deepEqual(restored.map((panel: { proportion: number }) => panel.proportion), [0.5, 0.5])
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
      await waitFor('the deep-link subscription is installed', () => window.ui001.listeners() === 1)
      await page.evaluate(route => window.ui001.deepLink(route), route)
      await selected('unavailable')
      assert.equal((await state()).route, route)
      await waitFor('the address carries the incoming route', incoming => new URL(location.href).searchParams.get('route') === incoming, route)
      await page.reload(); await selected('unavailable')
      assert.equal((await state()).route, route)
    }
  })
  await check('A queued address keeps its complete entity and new-panel option until readiness', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=home&delayed=1`)
    await waitFor('the mounted navigation provider is reachable', () => !!window.ui001?.navigation)
    await page.evaluate(() => window.ui001.navigate('sources/source/two', { newPanel: true, targetLaneId: 'main' }))
    await page.evaluate(() => window.ui001.ready())
    await selected('sources', 'two')
    const panels = JSON.parse((await page.locator('#panel-stack').textContent())!)
    assert.equal(panels.length, 2)
    assert.equal(panels[1].route, 'sources/source/two')
    assert.equal(panels[1].laneId, 'main')
    assert.ok(panels.every((panel: { proportion: number }) => panel.proportion > 0))
    await page.reload(); await waitFor('the mounted navigation provider is reachable after reload', () => !!window.ui001?.navigation)
    await page.evaluate(() => window.ui001.ready()); await selected('sources', 'two')
    const restored = JSON.parse((await page.locator('#panel-stack').textContent())!)
    assert.deepEqual(restored.map((panel: { route: string }) => panel.route), ['home', 'sources/source/two'])
  })
  await check('Split-panel reload and history preserve commas and numeric colon suffixes inside unavailable addresses', async () => {
    for (const route of ['knowledge/unknown,id/x', 'retired/surface:0.5']) {
      await page.goto(`${origin}?ws=workspace-a&route=home`)
      await selected('home')
      await page.evaluate(route => window.ui001.navigate(route, { newPanel: true }), route)
      await selected('unavailable')
      await waitFor('the address carries the split route', expected => new URL(location.href).searchParams.get('route') === expected, route)
      await page.reload(); await selected('unavailable')
      assert.equal((await state()).route, route)
      const restored = JSON.parse((await page.locator('#panel-stack').textContent())!)
      assert.deepEqual(restored.map((panel: { route: string }) => panel.route), ['home', route])
      await page.evaluate(() => window.ui001.navigate('sources/source/one'))
      await selected('sources', 'one'); await waitFor('the address carries the navigated route', () => new URL(location.href).searchParams.get('route') === 'sources/source/one')
      await page.goBack(); await selected('unavailable')
      assert.equal((await state()).route, route)
      await page.goForward(); await selected('sources', 'one')
    }
  })
  await check('A queued deep-link action retains query parameters and executes once after readiness', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=home&delayed=1`)
    await waitFor('the mounted navigation provider is reachable', () => !!window.ui001?.navigation)
    await waitFor('the deep-link subscription is installed', () => window.ui001.listeners() === 1)
    await page.evaluate(() => window.ui001.actionLink('new-session', { model: 'rox/fast', workdir: '/fixture/project', name: 'Linked session' }))
    assert.deepEqual(await page.evaluate(() => window.ui001.actions()), [])
    await page.evaluate(() => window.ui001.ready())
    await selected('sessions', 'created')
    const actions = await page.evaluate(() => window.ui001.actions())
    assert.deepEqual(actions.filter(row => row[0] === 'create'), [['create', 'workspace-a', { workingDirectory: '/fixture/project', model: 'rox/fast' }]])
    assert.ok(actions.some(row => row[0] === 'command' && row[2]?.name === 'Linked session'))
  })
  await check('Browser workspace history restores the workspace and its selected address together', async () => {
    await page.goto(`${origin}?ws=workspace-a&route=sources/source/one`)
    await selected('sources', 'one')
    await page.evaluate(() => window.ui001.switchWorkspace('workspace-b'))
    await waitFor('the address is the switched workspace', () => new URL(location.href).searchParams.get('ws') === 'workspace-b')
    await page.evaluate(() => window.ui001.navigate('sources/source/two'))
    await selected('sources', 'two')
    await waitFor('the address carries the navigated route', () => new URL(location.href).searchParams.get('route') === 'sources/source/two')
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
      await waitFor('the shell requests the missing workspace', expected => window.ui001.switchRequests().includes(expected), missing)
      await page.evaluate(() => window.ui001.navigate('sources/source/two'))
      await selected('sources', 'two')
      await waitFor('the rejected workspace switch falls back to the current workspace and route', () => new URL(location.href).searchParams.get('ws') === 'workspace-a'
        && new URL(location.href).searchParams.get('route') === 'sources/source/two')
      await page.evaluate(() => window.ui001.switchWorkspace('workspace-b'))
      await waitFor('the address is the switched workspace', () => new URL(location.href).searchParams.get('ws') === 'workspace-b')
      await page.goBack(); await selected('sources', 'two')
      assert.equal(new URL(page.url()).searchParams.get('ws'), 'workspace-a')
    }
  })
  await check('Unmount removes the actual deep-link subscription', async () => {
    assert.equal(await page.evaluate(() => window.ui001.listeners()), 1)
    await page.evaluate(() => window.ui001.unmount())
    assert.equal(await page.evaluate(() => window.ui001.listeners()), 0)
  })
  // A page error raised while a check was running never fails another check, and
  // the allowlisted browser notifications above are reported rather than fatal.
  const fatal = errors.filter(error => !BENIGN_PAGE_ERRORS.some(pattern => pattern.test(error.message)))
  assert.deepEqual(fatal.map(error => `${error.check ?? 'outside any check'}: ${error.message}`), [])
  console.log(JSON.stringify({ environment: 'Actual mounted NavigationProvider, PanelSlot, MainContentPanel, session-selection hooks, panel/session atoms and extracted shipped AppShell message-loading effect under production StrictMode in isolated Chromium; leaf presentation and IPC boundary fixtures; no hosted/native service acceptance', browserVersion: browser.version(), results }, null, 2))
  if (results.some(result => !result.pass)) process.exitCode = 1
} finally { await browser.close(); server.stop(); rmSync(temporary, { recursive: true, force: true }) }
