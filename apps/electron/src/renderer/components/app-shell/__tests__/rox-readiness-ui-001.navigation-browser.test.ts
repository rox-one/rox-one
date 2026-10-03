import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'
import ts from 'typescript'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'

// Actual NavigationProvider, URL/history, panel/selection atoms and MainContentPanel
// callbacks in Chromium. Leaf pages and electronAPI are explicit fixture boundaries.
const enabled = process.env.ROX_UI001_BROWSER_TEST === '1'
const root = join(import.meta.dir, '../../../../../../..')
const evidence = join(root, 'docs/final-readiness/execution/cloud/OWNER-UI-001/main-integration/browser')
let server: Server, browser: Browser, context: BrowserContext, page: Page, base: string

function mainFunctions() {
  const source = readFileSync(join(import.meta.dir, '../MainContentPanel.tsx'), 'utf8')
  const file = ts.createSourceFile('MainContentPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['useSelectedResourceAvailability', 'MainContentPanel', 'lazyRoutePage', 'RouteErrorBoundary', 'RouteRecoveryContext'])
  return file.statements.filter(node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
    ? names.has(node.name?.text ?? '')
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => names.has(decl.name.getText(file))))
    .map(node => node.getText(file).replace(/^export /, '')).join('\n')
}

async function bundle() {
  const contents = `
    import * as React from 'react';
    import {useCallback,useEffect,useMemo,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Provider,atom,createStore,useAtomValue,useSetAtom} from 'jotai';
    import {NavigationProvider,useNavigation,useNavigationState} from './apps/electron/src/renderer/contexts/NavigationContext';
    import {panelStackAtom,focusedPanelIdAtom,focusedSessionIdAtom} from './apps/electron/src/renderer/atoms/panel-stack';
    import {sessionMetaMapAtom} from './apps/electron/src/renderer/atoms/sessions';
    import {useSession} from './apps/electron/src/renderer/hooks/useSession';
    import {sourceSelection,skillSelection,automationSelection} from './apps/electron/src/renderer/hooks/useEntitySelection';
    import * as guards from './apps/electron/src/shared/types';
    import {resolveViewRoute} from './apps/electron/src/shared/route-parser';
    import {isDetailNavState} from './apps/electron/src/renderer/lib/nav-helpers';
    import * as storage from './apps/electron/src/renderer/lib/local-storage';
    const {isSessionsNavigation,isSourcesNavigation,isSettingsNavigation,isSkillsNavigation,isMemoryNavigation,
      isTasksNavigation,isMeetingsNavigation,isInboxNavigation,isFeedNavigation,isNotesNavigation,
      isAutomationsNavigation,isProjectsNavigation,isPagesNavigation,isBrowserNavigation,isKnowledgeNavigation,
      isDiffNavigation,isExtensionNavigation,isConnectionsNavigation,isHomeNavigation,isCloudRunNavigation,
      isTerminalNavigation,isScreenNavigation} = guards;
    const store=createStore(), events=new Set(), labels=new Set(), sources=new Set(), skills=new Set(), calls=[];
    const records=[{id:'s1',workspaceId:'ws-a',name:'Session A'},{id:'s2',workspaceId:'ws-b',name:'Session B'}];
    store.set(sessionMetaMapAtom,new Map(records.map(x=>[x.id,x])));
    window.electronAPI={
      listLabels:async()=>[],onLabelsChanged:callback=>{labels.add(callback);return()=>labels.delete(callback)},
      getSources:async()=>[{config:{slug:'src',name:'Fixture source',type:'local'}}],
      getSkills:async()=>[{slug:'skill'}],
      onSourcesChanged:callback=>{sources.add(callback);return()=>sources.delete(callback)},
      onSkillsChanged:callback=>{skills.add(callback);return()=>skills.delete(callback)},
      onDeepLinkNavigate:callback=>{events.add(callback);return()=>events.delete(callback)},
      sessionCommand:async(...args)=>calls.push(['sessionCommand',...args]),deleteSession:async(...args)=>calls.push(['deleteSession',...args]),
    };
    let workspace='ws-a';
    const useAppShellContext=()=>({activeWorkspaceId:workspace,workspaces:[{id:workspace}],sessionStatuses:[],projects:[],loadedProjects:[],labels:[]});
    const useTranslation=()=>({t:key=>key});
    const automationsAtom=atom([]),knowledgeHomeViewAtom=atom('search'),knowledgeActiveViewIdAtom=atom(null);
    const Pass=props=>React.createElement('section',null,props.children), Panel=Pass, StoplightProvider=Pass;
    const SendResourceToWorkspaceDialog=()=>null, MultiSelectPanel=()=>null, CollectionBulkBar=()=>null;
    const leaf=name=>props=>React.createElement('div',{'data-leaf':name,'data-entity':props.sessionId||props.sourceSlug||props.skillSlug||props.noteId||props.pageSlug||props.runId||props.terminalId||props.extensionId||props.screen||''},name);
    const ChatPage=leaf('session'),SourceInfoPage=leaf('source'),SkillInfoPage=leaf('skill'),MemoryScreen=leaf('memory'),
      ProjectsHomeInMain=leaf('projects'),HomeFrontPage=leaf('home'),SettingsOverviewPage=leaf('settings'),
      PageView=leaf('page'),SessionHeatmapHost=leaf('heatmap'),SearchPage=leaf('search'),NotesPage=leaf('note'),
      ConnectionsPage=leaf('connections'),ExtraScreenHost=leaf('screen'),TasksPage=leaf('tasks'),MeetingsPage=leaf('meetings'),
      InboxPage=leaf('inbox'),FeedPage=leaf('feed'),KnowledgeEntityPage=leaf('knowledge'),ProjectInfoPage=leaf('project'),
      BrowserPanelPage=leaf('browser'),TerminalSurfacePage=leaf('terminal'),CloudRunSurfacePage=leaf('cloud-run'),
      ExtensionSurfacePage=leaf('extension'),PagesHome=leaf('pages'),KanbanBoardContainer=leaf('board'),SessionTableHost=leaf('table'),
      AutomationEditor=leaf('automation'),KnowledgeDiff=leaf('diff'),KnowledgeHome=leaf('knowledge-home'),KnowledgeProposals=leaf('proposals');
    const getSettingsPageComponent=()=>leaf('settings'),recordRecentSetting=()=>{};
    ${mainFunctions()}
    let setReady,setWorkspace;
    const createSession=async(ws,options)=>{calls.push(['createSession',ws,options]);return {id:'created',workspaceId:ws}};
    function View(){
      const nav=useNavigation(), panels=useAtomValue(panelStackAtom),focused=useAtomValue(focusedPanelIdAtom), [selected]=useSession();
      window.ui001={navigate:nav.navigate,deepLink:input=>events.forEach(callback=>callback(input)),ready:setReady,switchWorkspace:setWorkspace,
        back:nav.goBack,forward:nav.goForward,focus:id=>store.set(focusedPanelIdAtom,id),
        snapshot:()=>({state:nav.navigationState,panels:store.get(panelStackAtom),focused:store.get(focusedPanelIdAtom),session:store.get(focusedSessionIdAtom),
          selected:selected.selected,workspace,calls,search:location.search,back:nav.canGoBack,forward:nav.canGoForward,
          saved:storage.get(storage.KEYS.workspaceUrl,'',workspace),listeners:events.size,detail:isDetailNavState(nav.navigationState)})};
      return <><output data-state={nav.navigationState.navigator} data-ready={nav.isReady}/>{panels.map(entry=><div key={entry.id} data-panel={entry.id} data-focused={entry.id===focused}>
        <MainContentPanel navStateOverride={resolveViewRoute(entry.route)} isSidebarAndNavigatorHidden={false}/></div>)}</>;
    }
    function App(){
      const [ws,changeWorkspace]=useState(new URLSearchParams(location.search).get('ws')||'ws-a');
      const [ready,changeReady]=useState(!new URLSearchParams(location.search).has('wait'));
      workspace=ws;setReady=changeReady;setWorkspace=changeWorkspace;
      return <Provider store={store}><NavigationProvider workspaceId={ws} workspaceSlug={ws} isReady={ready} onSwitchWorkspaceBySlug={changeWorkspace} onCreateSession={createSession}><View/></NavigationProvider></Provider>;
    }
    createRoot(document.getElementById('app')).render(<App/>);
  `
  const result = await build({
    stdin: { contents, sourcefile: 'ui-001-navigation-fixture.tsx', resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    plugins: process.env.ROX_UI001_NAVIGATION_SOURCE ? [{
      name: 'ui001-navigation-negative-control',
      setup(builder) {
        builder.onLoad({ filter: /contexts\/NavigationContext\.tsx$/ }, args => ({
          contents: readFileSync(process.env.ROX_UI001_NAVIGATION_SOURCE!, 'utf8'),
          loader: 'tsx', resolveDir: join(args.path, '..'),
        }))
      },
    }] : [],
    tsconfig: join(root, 'apps/electron/tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  return result.outputFiles[0]!.text
}

const snapshot = () => page.evaluate(() => (window as any).ui001.snapshot())
async function open(route: string, extra: Record<string, string> = {}) {
  await page.goto(`${base}/?${new URLSearchParams({ ws: 'ws-a', route, ...extra })}`)
  await page.waitForFunction(() => Boolean((window as any).ui001))
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
async function unavailable(route: string) {
  await page.locator('[data-focused="true"] [data-testid="route-unavailable"]').waitFor({ timeout: 5000 })
  expect(await page.locator('[data-focused="true"] [data-testid="route-unavailable"]').getAttribute('data-route')).toBe(route)
  const state = await snapshot()
  expect(state.state.navigator).toBe('unavailable')
  expect(state.state.route).toBe(route)
  expect(state.session).toBeNull()
  expect(state.detail).toBe(true)
  expect(new URLSearchParams(state.search).get('route')).toBe(route)
}

describe.skipIf(!enabled)('UI-001 actual navigation in Chromium', () => {
  beforeAll(async () => {
    mkdirSync(evidence, { recursive: true })
    const script = await bundle()
    server = createServer((request, response) => {
      response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
      response.end(request.url === '/fixture.js' ? script : '<div id="app"></div><script src="/fixture.js"></script>')
    }).listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as any).port}`
    browser = await chromium.launch({ executablePath: process.env.ROX_UI001_CHROMIUM_EXECUTABLE })
  }, 60000)
  beforeEach(async () => { context = await browser.newContext(); page = await context.newPage() }, 15000)
  afterEach(async () => { await context?.close() }, 15000)
  afterAll(async () => {
    try { await browser?.close() } finally {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve())
          server.closeAllConnections()
        })
      }
    }
  }, 15000)

  it('unknown single link survives reload and never selects its nested session', async () => {
    const route = 'future/session/private?keep=1'
    await open(route)
    await unavailable(route)
    expect((await snapshot()).selected).toBeNull()
    await page.screenshot({ path: join(evidence, 'unknown-link.png') })
    await page.reload()
    await unavailable(route)
  }, 30000)

  it('malformed encoding and legacy lossy degradation retain their own unavailable surface', async () => {
    for (const route of ['notes/note/%ZZ', 'knowledge/unknown/doc', 'extension/%', 'tasks/calendar', 'connections/v2', 'allSessions/future/private']) {
      await open(route)
      await unavailable(route)
    }
  }, 30000)

  it('multi-panel restore retains valid sibling, unavailable focus and proportions across reload', async () => {
    const route = 'notes/note/%ZZ'
    await open(route, { panels: `allSessions/session/s1:0.6000,${route}:0.4000`, fi: '1' })
    await unavailable(route)
    let state = await snapshot()
    expect(state.panels.map((p: any) => [p.route, p.proportion])).toEqual([['allSessions/session/s1', 0.6], [route, 0.4]])
    expect(await page.locator('[data-leaf="session"]').count()).toBe(1)
    await page.reload()
    await unavailable(route)
    state = await snapshot()
    expect(state.panels[1].id).toBe(state.focused)
  }, 30000)

  it('actual navigate and deep-link callbacks preserve unavailable route and browser back/forward', async () => {
    await open('allSessions/session/s1')
    await page.locator('[data-leaf="session"]').waitFor()
    await page.evaluate(() => (window as any).ui001.navigate('future/view'))
    await unavailable('future/view')
    await page.evaluate(() => (window as any).ui001.deepLink({ view: 'notes/note/%ZZ' }))
    await unavailable('notes/note/%ZZ')
    await page.evaluate(() => (window as any).ui001.back())
    await unavailable('future/view')
    await page.evaluate(() => (window as any).ui001.back())
    await page.locator('[data-focused="true"] [data-leaf="session"]').waitFor()
    expect((await snapshot()).session).toBe('s1')
    await page.evaluate(() => (window as any).ui001.forward())
    await unavailable('future/view')
  }, 30000)

  it('stored action address cannot execute, while explicit action callback still runs once', async () => {
    await open('action/delete-session/s1')
    await unavailable('action/delete-session/s1')
    expect((await snapshot()).calls).toEqual([])
    await page.reload()
    await unavailable('action/delete-session/s1')
    expect((await snapshot()).calls).toEqual([])
    await page.evaluate(() => (window as any).ui001.deepLink({ action: 'delete-session', actionParams: { id: 's1' } }))
    expect((await snapshot()).calls).toEqual([['deleteSession', 's1']])
  }, 30000)

  it('explicit navigation preserves spelling only after session workspace validation', async () => {
    await open('allSessions/session/s1')
    for (const invalidId of ['missing', 's2']) {
      await page.evaluate(id => (window as any).ui001.navigate(`allSessions/session/${id}?keep=1`, { skipAutoSelect: true }), invalidId)
      await page.waitForFunction(() => !(window as any).ui001.snapshot().state.details)
      const state = await snapshot()
      expect(state.session).toBeNull()
      expect(new URLSearchParams(state.search).get('route')).toBe('allSessions')
      expect(await page.locator(`[data-entity="${invalidId}"]`).count()).toBe(0)
    }
    await page.evaluate(() => (window as any).ui001.navigate('allSessions/session/s1?keep=1'))
    expect(new URLSearchParams((await snapshot()).search).get('route')).toBe('allSessions/session/s1?keep=1')
    await page.evaluate(() => (window as any).ui001.deepLink({ view: 'allSessions/session/s2?keep=1' }))
    await page.waitForFunction(() => (window as any).ui001.snapshot().session === 's1')
    expect(new URLSearchParams((await snapshot()).search).get('route')).toBe('allSessions/session/s1')
    expect(await page.locator('[data-entity="s2"]').count()).toBe(0)
  }, 30000)

  it('pending search replay retains query and new-panel options', async () => {
    await open('allSessions/session/s1', { wait: '1' })
    await page.evaluate(() => (window as any).ui001.navigate('search?q=two%20words', { newPanel: true }))
    await page.evaluate(() => (window as any).ui001.ready(true))
    await page.locator('[data-leaf="search"]').waitFor()
    const state = await snapshot()
    expect(state.state).toEqual({ navigator: 'search', query: 'two words' })
    expect(state.panels.map((p: any) => p.route)).toEqual(['allSessions/session/s1', 'search?q=two%20words'])
    expect(new URLSearchParams(state.search).get('route')).toBe('search?q=two%20words')
  }, 30000)

  it('latest pending unknown address wins without selecting a previous valid session', async () => {
    await open('allSessions/session/s1', { wait: '1' })
    await page.evaluate(() => (window as any).ui001.navigate('allSessions/session/s1'))
    await page.evaluate(() => (window as any).ui001.navigate('future/session/private'))
    await page.evaluate(() => (window as any).ui001.ready(true))
    await unavailable('future/session/private')
    expect((await snapshot()).listeners).toBe(1)
  }, 30000)

  it('workspace restoration and history keep each workspace address', async () => {
    await open('future/workspace-a')
    await unavailable('future/workspace-a')
    await page.evaluate(() => (window as any).ui001.switchWorkspace('ws-b'))
    await page.waitForFunction(() => (window as any).ui001.snapshot().workspace === 'ws-b')
    await page.evaluate(() => (window as any).ui001.navigate('future/workspace-b'))
    await unavailable('future/workspace-b')
    await page.evaluate(() => (window as any).ui001.switchWorkspace('ws-a'))
    await unavailable('future/workspace-a')
    await page.evaluate(() => (window as any).ui001.back())
    await unavailable('future/workspace-b')
    expect((await snapshot()).workspace).toBe('ws-b')
  }, 30000)
})
