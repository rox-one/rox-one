import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { build, type PluginBuild } from 'esbuild'
import ts from 'typescript'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { launchOwnedFixtureBrowser } from './rox-readiness-ui-001.browser-owner'

// Actual NavigationProvider, URL/history, panel/selection atoms and MainContentPanel
// callbacks in Chromium. Leaf pages and electronAPI are explicit fixture boundaries.
const enabled = process.env.ROX_UI001_BROWSER_TEST === '1'
const root = join(import.meta.dir, '../../../../../../..')
const evidence = join(root, 'docs/final-readiness/execution/cloud/OWNER-UI-001/main-integration/browser')
let server: ReturnType<typeof Bun.serve>, browser: Browser, context: BrowserContext, page: Page, base: string
let closeBrowser: (() => Promise<void>) | undefined

function mainFunctions() {
  const source = readFileSync(join(import.meta.dir, '../MainContentPanel.tsx'), 'utf8')
  const file = ts.createSourceFile('MainContentPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['useSelectedResourceAvailability', 'MainContentPanel', 'lazyRoutePage', 'RouteErrorBoundary', 'RouteRecoveryContext'])
  return file.statements.filter(node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
    ? names.has(node.name?.text ?? '')
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => names.has(decl.name.getText(file))))
    .map(node => node.getText(file).replace(/^export /, '')).join('\n')
}


// Extract the actual shell slot/width/resize conditions; chrome leaves are fixtures.
function shellNavigatorExpressions() {
  const source = readFileSync(process.env.ROX_UI001_SHELL_SOURCE ?? join(import.meta.dir, '../AppShell.tsx'), 'utf8')
  const file = ts.createSourceFile('AppShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['isBoardView', 'isPagesView', 'isTasksView', 'isMeetingsView', 'isMemoryView', 'isProjectsView', 'isModeScreenView', 'hideModuleMiddleNav'])
  const declarations: string[] = []
  let hidden = '', width = '', resize = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && names.has(node.name.getText(file))) declarations.push(`const ${node.getText(file)};`)
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
      const expression = node.initializer.expression
      if (node.name.getText(file) === 'navigatorSlot' && expression && ts.isConditionalExpression(expression)) hidden = expression.condition.getText(file)
      if (node.name.getText(file) === 'navigatorWidth' && expression) width = expression.getText(file)
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'ResizeHandle'
      && node.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText(file) === 'controlsId' && property.initializer?.getText(file) === '"shell-navigator"')) {
      let parent: ts.Node = node.parent
      while (!ts.isJsxExpression(parent) && parent.parent) parent = parent.parent
      if (ts.isJsxExpression(parent) && parent.expression && ts.isBinaryExpression(parent.expression)) resize = parent.expression.left.getText(file)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (declarations.length !== names.size || !hidden || !width || !resize) throw new Error('Actual AppShell navigator conditions were not found')
  return `function ShellNavigatorProbe(){
    const navState=useNavigationState(), isAutoCompact=window.innerWidth<768, sessionListWidth=300, effectiveSidebarAndNavigatorHidden=false;
    ${declarations.join('\n')}
    return <>{!(${hidden})&&<aside data-shell-navigator style={{width:${width}}}>All Sessions</aside>}
      {(${resize})&&<button data-shell-navigator-resize role="separator"/>}</>;
  }`
}

// Execute the actual desktop title callback and shared model. Strip chrome,
// keyboard controls, mode/extra-screen registrations and title-loading transport
// remain explicit fixture seams. Core service titles use the actual registry.
function desktopTabTitleExpressions() {
  const source = readFileSync(process.env.ROX_UI001_TABS_SOURCE ?? join(root, 'apps/electron/src/renderer/platform/SurfaceTabs.tsx'), 'utf8')
  const file = ts.createSourceFile('SurfaceTabs.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map<string, string>()
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ['routeTitleKeys', 'resolveRouteTitle'].includes(node.name.getText(file))) {
      declarations.set(node.name.getText(file), `const ${node.getText(file)};`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (declarations.size !== 2) throw new Error('Actual desktop route title callback was not found')
  return `function DesktopTabsProbe(){
    const entries=useAtomValue(panelStackAtom),focusedPanelId=useAtomValue(focusedPanelIdAtom),{t}=useTranslation();
    ${declarations.get('routeTitleKeys')} ${declarations.get('resolveRouteTitle')}
    const tabs=buildSurfaceTabViews({entries,focusedPanelId,resolveRouteTitle,resolveSessionTitle:id=>id,
      labels:{untitled:'surfaceTabs.untitled',browser:'surfaceTabs.browser',panel:'surfaceTabs.panel',source:'surfaceTabs.source',
        settings:'surfaceTabs.settings',skills:'surfaceTabs.skills',knowledge:'knowledge.nav.title',knowledgeDiff:'knowledge.proposals.title',home:'nav.home'}});
    return <div>{tabs.map(tab=><span key={tab.panelId} data-desktop-panel-id={tab.panelId} data-focused-tab={tab.focused}>{tab.title}</span>)}</div>;
  }`
}

async function bundle() {
  const contents = `
    import * as React from 'react';
    import {lazyRoutePage,RouteErrorBoundary} from './apps/electron/src/renderer/lib/route-recovery';
    import {useCallback,useEffect,useMemo,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Provider,atom,createStore,useAtomValue,useSetAtom} from 'jotai';
    import {NavigationProvider,useNavigation,useNavigationState} from './apps/electron/src/renderer/contexts/NavigationContext';
    import {CompactWorkspaceMenu} from './apps/electron/src/renderer/components/app-shell/CompactWorkspaceMenu';
    import {APP_NAV_DESTINATIONS} from './apps/electron/src/renderer/components/app-shell/nav-destinations';
    import {buildSurfaceTabViews} from './apps/electron/src/renderer/platform/surface-tab-model';
    import {panelStackAtom,focusedPanelIdAtom,focusedSessionIdAtom} from './apps/electron/src/renderer/atoms/panel-stack';
    import {sessionMetaMapAtom} from './apps/electron/src/renderer/atoms/sessions';
    import {useSession} from './apps/electron/src/renderer/hooks/useSession';
    import {sourceSelection,skillSelection,automationSelection} from './apps/electron/src/renderer/hooks/useEntitySelection';
    import * as guards from './apps/electron/src/shared/types';
    import {resolveViewRoute,buildRouteFromNavigationState} from './apps/electron/src/shared/route-parser';
    import {isDetailNavState} from './apps/electron/src/renderer/lib/nav-helpers';
    import {isCollectionCanvasView} from './apps/electron/src/renderer/components/app-shell/collection/collection-view-cycle';
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
    const EXTRA_SCREENS=[],getModeRegistry=()=>({list:()=>[]});
    const automationsAtom=atom([]),knowledgeHomeViewAtom=atom('search'),knowledgeActiveViewIdAtom=atom(null);
    const Pass=props=>React.createElement('section',null,props.children), Panel=Pass, StoplightProvider=Pass;
    // Product-tour instrumentation is a declared fixture seam; real navigation
    // and content recovery callbacks above remain the production implementation.
    const TourPanelScope=Pass, navigationEntity=()=>({}), UnavailableAutomationTour=()=>null;
    const SendResourceToWorkspaceDialog=()=>null, MultiSelectPanel=()=>null, CollectionBulkBar=()=>null;
    const leaf=name=>props=>React.createElement('div',{'data-leaf':name,'data-entity':props.sessionId||props.sourceSlug||props.skillSlug||props.noteId||props.pageSlug||props.runId||props.terminalId||props.extensionId||props.screen||''},name);
    const ChatPage=leaf('session'),SourceInfoPage=leaf('source'),SkillInfoPage=leaf('skill'),
      SkillsCatalogPage=leaf('skills-catalog'),IntegrationsCatalogPage=leaf('integrations-catalog'),MemoryScreen=leaf('memory'),
      ProjectsHomeInMain=leaf('projects'),HomeFrontPage=leaf('home'),SettingsOverviewPage=leaf('settings'),
      PageView=leaf('page'),SessionHeatmapHost=leaf('heatmap'),SearchPage=leaf('search'),NotesPage=leaf('note'),
      ConnectionsPage=leaf('connections'),ExtraScreenHost=leaf('screen'),TasksPage=leaf('tasks'),MeetingsPage=leaf('meetings'),
      InboxPage=leaf('inbox'),FeedPage=leaf('feed'),KnowledgeEntityPage=leaf('knowledge'),ProjectInfoPage=leaf('project'),
      BrowserPanelPage=leaf('browser'),TerminalSurfacePage=leaf('terminal'),CloudRunSurfacePage=leaf('cloud-run'),
      ExtensionSurfacePage=leaf('extension'),PagesHome=leaf('pages'),KanbanBoardContainer=leaf('board'),SessionTableHost=leaf('table'),
      AutomationEditor=leaf('automation'),KnowledgeDiff=leaf('diff'),KnowledgeHome=leaf('knowledge-home'),KnowledgeProposals=leaf('proposals');
    const getSettingsPageComponent=()=>leaf('settings'),recordRecentSetting=()=>{};
    ${mainFunctions()}
    ${shellNavigatorExpressions()}
    ${desktopTabTitleExpressions()}
    let setReady,setWorkspace;
    const requestWorkspaceBySlug=slug=>{setWorkspace(slug);return true};
    const createSession=async(ws,options)=>{calls.push(['createSession',ws,options]);return {id:'created',workspaceId:ws}};
    function View(){
      const nav=useNavigation(), panels=useAtomValue(panelStackAtom),focused=useAtomValue(focusedPanelIdAtom), [selected]=useSession();
      window.ui001={navigate:nav.navigate,deepLink:input=>events.forEach(callback=>callback(input)),ready:setReady,switchWorkspace:setWorkspace,
        back:nav.goBack,forward:nav.goForward,focus:id=>store.set(focusedPanelIdAtom,id),
        snapshot:()=>({state:nav.navigationState,panels:store.get(panelStackAtom),focused:store.get(focusedPanelIdAtom),session:store.get(focusedSessionIdAtom),
          selected:selected.selected,workspace,calls,search:location.search,back:nav.canGoBack,forward:nav.canGoForward,
          saved:storage.get(storage.KEYS.workspaceUrl,'',workspace),lastSelected:storage.get(storage.KEYS.lastSelectedSessionId,null,workspace),listeners:events.size,detail:isDetailNavState(nav.navigationState)})};
      return <><ShellNavigatorProbe/><DesktopTabsProbe/><CompactWorkspaceMenu onOpenBrowser={()=>calls.push(['openBrowser'])}/><output data-state={nav.navigationState.navigator} data-ready={nav.isReady}/>{panels.map(entry=><div key={entry.id} data-panel={entry.id} data-focused={entry.id===focused}>
        <MainContentPanel navStateOverride={resolveViewRoute(entry.route)} isSidebarAndNavigatorHidden={false}/></div>)}</>;
    }
    function App(){
      const [ws,changeWorkspace]=useState(new URLSearchParams(location.search).get('ws')||'ws-a');
      const [ready,changeReady]=useState(!new URLSearchParams(location.search).has('wait'));
      workspace=ws;setReady=changeReady;setWorkspace=changeWorkspace;
      return <Provider store={store}><NavigationProvider workspaceId={ws} workspaceSlug={ws} isReady={ready} onSwitchWorkspaceBySlug={requestWorkspaceBySlug} onCreateSession={createSession}><View/></NavigationProvider></Provider>;
    }
    createRoot(document.getElementById('app')).render(<App/>);
  `
  const result = await build({
    stdin: { contents, sourcefile: 'ui-001-navigation-fixture.tsx', resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    // This fixture exercises menu behavior; product font/layout acceptance is separate.
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'ui001-inert-asset-urls',
      setup(builder: PluginBuild) {
        builder.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'ui001-asset' }))
        builder.onLoad({ filter: /.*/, namespace: 'ui001-asset' }, () => ({ contents: 'export default "about:blank"', loader: 'js' }))
      },
    }, ...(process.env.ROX_UI001_NAVIGATION_SOURCE ? [{
      name: 'ui001-navigation-negative-control',
      setup(builder: PluginBuild) {
        builder.onLoad({ filter: /contexts\/NavigationContext\.tsx$/ }, args => ({
          contents: readFileSync(process.env.ROX_UI001_NAVIGATION_SOURCE!, 'utf8'),
          loader: 'tsx', resolveDir: join(args.path, '..'),
        }))
      },
    }] : [])],
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
    server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      fetch(request) {
        const isScript = new URL(request.url).pathname === '/fixture.js'
        return new Response(isScript ? script : '<div id="app"></div><script src="/fixture.js"></script>', {
          headers: { 'Content-Type': isScript ? 'text/javascript' : 'text/html' },
        })
      },
    })
    base = `http://127.0.0.1:${server.port}`
    const owned = await launchOwnedFixtureBrowser({ executablePath: process.env.ROX_UI001_CHROMIUM_EXECUTABLE, args: ['--disable-gpu'] })
    browser = owned.browser
    closeBrowser = owned.close
  }, 60000)
  beforeEach(async () => { context = await browser.newContext(); page = await context.newPage() }, 15000)
  afterEach(async () => { await context?.close() }, 15000)
  afterAll(async () => {
    try { await closeBrowser?.() } finally { await server?.stop(true) }
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

  it('mixed zero and positive restored weights allocate usable panels across compatible transports and reload', async () => {
    for (const panels of ['[["tasks",0],["notes",1]]', 'json:[{"route":"tasks","proportion":0},{"route":"notes","proportion":1}]', 'tasks:0,notes:1']) {
      await open('tasks', {panels, fi:'1'})
      await page.locator('[data-focused="true"] [data-leaf="note"]').waitFor()
      expect((await snapshot()).panels.map((panel: {route: string; proportion: number}) => [panel.route,panel.proportion])).toEqual([['tasks',0.5],['notes',0.5]])
      expect(await page.locator('[data-leaf="tasks"]').count()).toBe(1)
      await page.reload()
      await page.locator('[data-focused="true"] [data-leaf="note"]').waitFor()
      expect((await snapshot()).panels.map((panel: {route: string; proportion: number}) => [panel.route,panel.proportion])).toEqual([['tasks',0.5],['notes',0.5]])
    }
  }, 30000)

  it('JSON-valid legacy bracket addresses remain unavailable across initial restore, history and reload', async () => {
    for (const route of ['["future"]', '[1]', '[["future"]]']) {
      await open('tasks', {panels:route})
      await unavailable(route)
      expect((await snapshot()).panels).toHaveLength(1)
      await page.reload(); await unavailable(route)
      await page.evaluate(() => (window as any).ui001.navigate('home'))
      await page.evaluate(() => history.back())
      await unavailable(route)
      await open('tasks', {panels:`${route},tasks`,fi:'0'})
      await unavailable(route)
      expect((await snapshot()).panels.map((panel: {route: string; proportion: number}) => [panel.route,panel.proportion])).toEqual([[route,0.5],['tasks',0.5]])
      await page.reload(); await unavailable(route)
      expect(await page.locator('[data-leaf="tasks"]').count()).toBe(1)
    }
  },30000)

  it('legacy bracket-prefixed unknown panels keep their sibling and proportions after reload', async () => {
    for (const route of ['[future]', '[[future]]']) {
      await open(route, { panels: `${route}:0.6000,tasks:0.4000`, fi: '0' })
      await unavailable(route)
      expect((await snapshot()).panels.map((p: any) => [p.route, p.proportion])).toEqual([[route, 0.6], ['tasks', 0.4]])
      await page.reload()
      await unavailable(route)
      expect((await snapshot()).panels.map((p: any) => [p.route, p.proportion])).toEqual([[route, 0.6], ['tasks', 0.4]])
    }
  }, 30000)

  for (const panels of ['v2:[]', 'v2:[', '[]', '[', '']) {
    it(`invalid panel data ${JSON.stringify(panels)} without a route restores the workspace default`, async () => {
      const search = '?' + new URLSearchParams({ ws: 'ws-a', panels })
      await page.goto(base + '/' + search)
      await page.waitForFunction(() => (window as any).ui001?.snapshot().panels[0]?.route === 'allSessions/session/s1', undefined, { timeout: 5000 })
      expect((await snapshot()).panels.map((p: any) => p.route)).toEqual(['allSessions/session/s1'])
      await page.evaluate(() => (window as any).ui001.navigate('future/stale-no-route'))
      await unavailable('future/stale-no-route')
      await page.evaluate(search => {
        history.pushState(null, '', search)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, search)
      await page.waitForFunction(() => (window as any).ui001.snapshot().panels[0]?.route === 'allSessions/session/s1', undefined, { timeout: 5000 })
      expect((await snapshot()).panels.map((p: any) => p.route)).toEqual(['allSessions/session/s1'])
      await page.reload()
      await page.waitForFunction(() => (window as any).ui001?.snapshot().panels[0]?.route === 'allSessions/session/s1')
      expect(new URLSearchParams((await snapshot()).search).get('route')).toBe('allSessions/session/s1')
    }, 30000)
  }

  for (const panels of ['[]', ' [] ', ',,', '[', 'v2:[1]', 'v2:[["tasks"]]', '  ']) {
    it(`empty or invalid panel list ${JSON.stringify(panels)} restores the focused address during history and reload`, async () => {
      await open('future/stale-before-empty')
      await unavailable('future/stale-before-empty')
      await page.evaluate(panels => {
        const url = new URL(location.href)
        url.searchParams.set('route', 'tasks?view=calendar')
        url.searchParams.set('panels', panels)
        history.pushState(null, '', url)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, panels)
      await page.waitForFunction(() => (window as any).ui001.snapshot().state.navigator === 'tasks', undefined, { timeout: 5000 })
      expect((await snapshot()).panels.map((panel: any) => panel.route)).toEqual(['tasks?view=calendar'])
      await page.reload()
      await page.waitForFunction(() => Boolean((window as any).ui001))
      expect((await snapshot()).panels.map((panel: any) => panel.route)).toEqual(['tasks?view=calendar'])
      await page.evaluate(() => (window as any).ui001.navigate('future/stale-before-empty'))
      await unavailable('future/stale-before-empty')
    }, 30000)
  }

  it('known routes with empty separators resolve their surface and query through navigation and reload', async () => {
    const route = 'tasks///?keep=separator'
    const canonicalRoute = 'tasks?keep=separator'
    await open(route)
    await page.waitForFunction(() => (window as any).ui001.snapshot().state.navigator === 'tasks', undefined, { timeout: 5000 })
    expect((await snapshot()).panels.map((panel: any) => panel.route)).toEqual([canonicalRoute])
    expect(new URLSearchParams((await snapshot()).search).get('route')).toBe(canonicalRoute)
    await page.reload()
    await page.waitForFunction(() => Boolean((window as any).ui001))
    expect((await snapshot()).panels.map((panel: any) => panel.route)).toEqual([canonicalRoute])
    await page.evaluate(() => (window as any).ui001.navigate('notes//note/n1/'))
    await page.waitForFunction(() => (window as any).ui001.snapshot().state.navigator === 'notes', undefined, { timeout: 5000 })
    expect((await snapshot()).panels.map((panel: any) => panel.route)).toEqual(['notes//note/n1/'])
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

  it('missing or foreign session links retain their requested address without selecting or mounting another chat', async () => {
    await open('allSessions/session/s1')
    for (const id of ['missing', 's2']) {
      await page.evaluate(() => (window as any).ui001.navigate('allSessions/session/s1'))
      await page.locator('[data-focused="true"] [data-leaf="session"][data-entity="s1"]').waitFor()
      await page.evaluate(id => (window as any).ui001.navigate(`allSessions/session/${id}?keep=1`, { skipAutoSelect: true }), id)
      const missing = id === 'missing'
      const surface = page.locator(`[data-focused="true"] [data-testid="${missing ? 'route-session-unavailable' : 'route-unavailable'}"]`)
      await surface.waitFor()
      const state = await snapshot()
      if (missing) {
        expect(state.state.details.sessionId).toBe(id)
        expect(await surface.getAttribute('data-session-id')).toBe(id)
      } else {
        expect(state.state).toMatchObject({navigator:'unavailable',route:`allSessions/session/${id}?keep=1`,reason:'workspace-mismatch'})
      }
      expect(state.selected).toBe('s1')
      expect(state.lastSelected).toBe('s1')
      expect(new URLSearchParams(state.search).get('route')).toBe(`allSessions/session/${id}?keep=1`)
      expect(await page.locator('[data-focused="true"] [data-leaf="session"]').count()).toBe(0)
      await page.reload()
      await surface.waitFor()
      expect(new URLSearchParams((await snapshot()).search).get('route')).toBe(`allSessions/session/${id}?keep=1`)
    }
    await page.evaluate(() => (window as any).ui001.navigate('allSessions/session/s1?keep=1'))
    expect(new URLSearchParams((await snapshot()).search).get('route')).toBe('allSessions/session/s1?keep=1')
    await page.evaluate(() => (window as any).ui001.deepLink({ view: 'allSessions/session/s2?keep=1' }))
    await page.locator('[data-focused="true"] [data-testid="route-unavailable"]').waitFor()
    expect(new URLSearchParams((await snapshot()).search).get('route')).toBe('allSessions/session/s2?keep=1')
    expect(await page.locator('[data-focused="true"] [data-leaf="session"]').count()).toBe(0)
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

  it('additional query parameters survive list auto-selection, navigation, history and reload', async () => {
    const routes = ['tasks?view=calendar', 'search?q=ok&mode=future', 'allSessions?keep=a%2Cb']
    const expected = ['tasks?view=calendar', 'search?q=ok&mode=future', 'allSessions/session/s1?keep=a%2Cb']
    for (let i = 0; i < routes.length; i++) {
      await open(routes[i])
      expect((await snapshot()).panels[0].route).toBe(expected[i])
      await page.reload()
      await page.waitForFunction(() => Boolean((window as any).ui001))
      expect((await snapshot()).panels[0].route).toBe(expected[i])
    }
    await page.evaluate(() => (window as any).ui001.navigate('search?q=ok&mode=future'))
    expect(new URLSearchParams((await snapshot()).search).get('route')).toBe(expected[1])
    await page.evaluate(() => (window as any).ui001.back())
    await page.waitForFunction(() => (window as any).ui001.snapshot().panels[0].route === 'allSessions/session/s1?keep=a%2Cb')
  }, 30000)

  it('literal commas, percent encoding and unknown addresses retain separate panels after reload', async () => {
    await open('allSessions/session/s1')
    const route = 'notes/note/foo,bar?keep=one,two'
    await page.evaluate(route => (window as any).ui001.navigate(route, { newPanel: true }), route)
    let state = await snapshot()
    expect(state.panels.map((p: any) => p.route)).toEqual(['allSessions/session/s1', route])
    await page.reload()
    await page.waitForFunction(() => Boolean((window as any).ui001))
    state = await snapshot()
    expect(state.panels.map((p: any) => p.route)).toEqual(['allSessions/session/s1', route])
    expect(state.panels[1].id).toBe(state.focused)
    expect(state.state.details.noteId).toBe('foo,bar')
    const unknown = 'future/comma,percent%2Ccolon:part?keep=a,b'
    await page.evaluate(route => (window as any).ui001.navigate(route, { newPanel: true }), unknown)
    await unavailable(unknown)
    await page.reload()
    await unavailable(unknown)
    expect((await snapshot()).panels.map((p: any) => p.route)).toEqual(['allSessions/session/s1', route, unknown])
  }, 30000)

  it('compact menu labels unavailable panels consistently and Sessions opens its own service', async () => {
    await page.setViewportSize({ width: 360, height: 640 })
    await open('knowledge/unknown/doc')
    await unavailable('knowledge/unknown/doc')
    await page.locator('[data-compact-workspace-menu]').click()
    const entry = page.locator('[data-compact-panel-id]')
    expect(await entry.count()).toBe(1)
    expect(await entry.textContent()).toBe('common.unavailable')
    await page.locator('[data-service-id="sessions"]').click()
    await page.waitForFunction(() => (window as any).ui001.snapshot().session === 's1')
    expect((await snapshot()).panels[0].route).toBe('allSessions/session/s1')
  }, 30000)

  it('desktop tab labels match unavailable panels through reload and Back', async () => {
    await open('tasks/calendar')
    await unavailable('tasks/calendar')
    const title = page.locator('[data-focused-tab="true"]')
    expect(await title.textContent()).toBe('common.unavailable')
    await page.reload()
    await unavailable('tasks/calendar')
    expect(await title.textContent()).toBe('common.unavailable')
    await page.evaluate(() => (window as any).ui001.navigate('tasks'))
    await page.waitForFunction(() => (window as any).ui001.snapshot().panels[0].route === 'tasks')
    expect(await title.textContent()).toBe('sidebar.tasks')
    await page.evaluate(() => (window as any).ui001.back())
    await unavailable('tasks/calendar')
    expect(await title.textContent()).toBe('common.unavailable')
  }, 30000)

  it('desktop unavailable links remove the unrelated navigator and resize boundary', async () => {
    for (const width of [960, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await open('knowledge/unknown/doc')
      await unavailable('knowledge/unknown/doc')
      expect(await page.locator('[data-shell-navigator]').count()).toBe(0)
      expect(await page.locator('[data-shell-navigator-resize]').count()).toBe(0)
      await page.evaluate(() => (window as any).ui001.navigate('allSessions'))
      await page.waitForFunction(() => (window as any).ui001.snapshot().session === 's1')
      expect(await page.locator('[data-shell-navigator]').count()).toBe(1)
      expect(await page.locator('[data-shell-navigator]').evaluate(element => element.getBoundingClientRect().width)).toBe(300)
      expect(await page.locator('[data-shell-navigator-resize]').count()).toBe(1)
      await page.evaluate(() => (window as any).ui001.back())
      await unavailable('knowledge/unknown/doc')
      expect(await page.locator('[data-shell-navigator]').count()).toBe(0)
      expect(await page.locator('[data-shell-navigator-resize]').count()).toBe(0)
    }
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
