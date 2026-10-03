import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'
import ts from 'typescript'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'

// Explicit opt-in: a real isolated Chromium fixture, never installed/native or hosted acceptance.
const enabled = process.env.ROX_UI001_BROWSER_TEST === '1'
const root = join(import.meta.dir, '../../../../../../..')
const evidence = join(root, 'docs/final-readiness/execution/cloud/OWNER-UI-001/verification/browser')
let server: Server, browser: Browser, context: BrowserContext, page: Page, base: string

function productionFunctions(): string {
  const source = readFileSync(process.env.ROX_UI001_MAIN_SOURCE ?? join(import.meta.dir, '../MainContentPanel.tsx'), 'utf8')
  const file = ts.createSourceFile('MainContentPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['useSelectedResourceAvailability', 'MainContentPanel'])
  return file.statements.filter((node) => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) ? names.has(node.name?.text ?? '') : ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => names.has(decl.name.getText(file))))
    .map((node) => node.getText(file).replace(/^export /, '')).join('\n')
}

function workspaceRestoreEffect() {
  const source = readFileSync(join(import.meta.dir, '../AppShell.tsx'), 'utf8')
  const file = ts.createSourceFile('AppShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let effect = ''
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'React.useLayoutEffect'
      && node.arguments[0]?.getText(file).includes('previousWorkspaceRef.current')) effect = node.arguments[0].getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!effect) throw new Error('Workspace cancellation must run in a layout effect')
  return effect
}

async function fixtureBundle() {
  if (process.env.ROX_UI001_MAIN_FIXTURE_BUNDLE) return readFileSync(process.env.ROX_UI001_MAIN_FIXTURE_BUNDLE, 'utf8')
  const dispatcher = productionFunctions()
  const contents = `
    import * as React from 'react';
    import { lazyRoutePage, RouteErrorBoundary } from './apps/electron/src/renderer/lib/route-recovery';
    import { useCallback, useEffect, useMemo, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { usePanelResize } from './apps/electron/src/renderer/hooks/usePanelResize';
    import * as storage from './apps/electron/src/renderer/lib/local-storage';
    import { loadShellLayout, commitShellLayout } from './apps/electron/src/renderer/lib/shell-layout-preferences';
    import { createStore, getDefaultStore } from 'jotai/vanilla';
    import * as guards from './apps/electron/src/shared/types';
    import { parseRouteToNavigationStateOrUnavailable as parseRouteToNavigationState, buildRouteFromNavigationState } from './apps/electron/src/shared/route-parser';
    import { inspectorPanelWidthAtom, bottomDockHeightAtom, bottomTerminalOpenAtom } from './apps/electron/src/renderer/atoms/unified-shell';
    import CloudRunSurfacePage from './apps/electron/src/renderer/pages/CloudRunSurfacePage';
    import TerminalSurfacePage from './apps/electron/src/renderer/pages/TerminalSurfacePage';
    const { isSessionsNavigation, isSourcesNavigation, isSettingsNavigation, isSkillsNavigation, isMemoryNavigation,
      isTasksNavigation, isMeetingsNavigation, isInboxNavigation, isFeedNavigation, isNotesNavigation,
      isAutomationsNavigation, isProjectsNavigation, isPagesNavigation, isBrowserNavigation, isKnowledgeNavigation,
      isDiffNavigation, isExtensionNavigation, isConnectionsNavigation, isHomeNavigation, isCloudRunNavigation,
      isTerminalNavigation, isScreenNavigation } = guards;
    const sources = [{ config: { slug: 'a', name: 'Source A', type: 'local' } }];
    let sessionRows = new Map();
    let rows = sources, workspace = 'ws-a', nav = parseRouteToNavigationState('home');
    const sourceListeners = new Set(), skillListeners = new Set(), reads = [];
    let deferredSource, deferredCloud, delaySource = false, delayCloud = false, failSource = false, failPage = false, rejectLazy = false, lazyAttempts = 0, cloudRows = ['a','b'], failCloud = false;
    window.electronAPI = {
      getSources(ws) { reads.push(['sources', ws]); if(failSource) { failSource=false; return Promise.reject(new Error('fixture transport offline')); } if (!delaySource) return Promise.resolve(rows);
        delaySource = false; return new Promise(resolve => { deferredSource = resolve }); },
      getSkills(ws, cwd) { reads.push(['skills', ws, cwd]); return Promise.resolve([]); },
      onSourcesChanged(callback) { sourceListeners.add(callback); return () => sourceListeners.delete(callback); },
      onSkillsChanged(callback) { skillListeners.add(callback); return () => skillListeners.delete(callback); },
      getCloudRunsConfig() { if (failCloud) {failCloud=false;return Promise.reject(new Error('fixture cloud offline'));} if (!delayCloud) return Promise.resolve({enabled:true}); delayCloud=false;
        return new Promise(resolve => { deferredCloud = resolve }); },
      listCloudRuns: async () => ({enabled:true, provider:'fixture', runs:cloudRows.map(id => ({
        id, name:'Run '+id, provider:'fixture', createdAt:1, status:{id, state:'done'}
      }))}), getCloudRunStatus: async () => null,
    };
    const useNavigationState = () => nav;
    const useAppShellContext = () => ({activeWorkspaceId:workspace,workspaces:[{id:workspace}],sessionStatuses:[],projects:[],loadedProjects:[],labels:[]});
    const useTranslation = () => ({ t: key => key });
    const useAtomValue = atom => atom === sessionMetaMapAtom ? sessionRows : [];
    const useSetAtom = () => () => {};
    const sessionMetaMapAtom = Symbol(), automationsAtom = Symbol(), knowledgeHomeViewAtom = Symbol(), knowledgeActiveViewIdAtom = Symbol();
    const selection = {useIsMultiSelectActive:()=>false,useSelectionCount:()=>0,useSelectedIds:()=>new Set(),useSelection:()=>({clearMultiSelect(){}})};
    const sourceSelection = selection, skillSelection = selection, automationSelection = selection;
    const Pass = props => React.createElement('section', null, props.children);
    const Panel = Pass, StoplightProvider = Pass, SendResourceToWorkspaceDialog = () => null;
    const SourceInfoPage = props => React.createElement('div', {'data-fixture-source':props.sourceSlug}, 'Address '+props.sourceSlug);
    const SkillInfoPage = () => null, MemoryScreen = () => null, ProjectsHomeInMain = () => null,
      MultiSelectPanel = () => null, CollectionBulkBar = () => null, ChatPage = props => React.createElement('div',{'data-fixture-chat':props.sessionId},'Chat '+props.sessionId), HomeFrontPage = () => null,
      SettingsOverviewPage = () => null, PageView = () => null, SessionHeatmapHost = () => null, SearchPage = () => null,
      NotesPage = () => null, ConnectionsPage = () => null, ExtraScreenHost = () => null, TasksPage = () => null,
      MeetingsPage = () => null, InboxPage = () => null, FeedPage = () => null, KnowledgeEntityPage = () => null,
      ProjectInfoPage = () => null, BrowserPanelPage = () => null,
      PagesHome = () => null, KanbanBoardContainer = () => null,
      SessionTableHost = () => null, AutomationEditor = () => null, KnowledgeDiff = () => null,
      KnowledgeHome = () => null, KnowledgeProposals = () => null;
    const getSettingsPageComponent = () => Pass, recordRecentSetting = () => {};
    ${dispatcher}
    const ExtensionSurfacePage = lazyRoutePage(async () => {
      lazyAttempts++;
      if(rejectLazy) { rejectLazy=false; throw new Error('fixture import offline'); }
      return {default: props => {
        if(failPage) throw new Error('fixture render failure');
        return React.createElement('div', {'data-extension':props.viewId}, props.viewId);
      }};
    });
    function ResizeProbe() {
      const activeWorkspaceId = workspace;
      const previousWorkspaceRef = React.useRef(null);
      const [workspaceUiStateId, setWorkspaceUiStateId] = React.useState(null);
      const [sidebarWidth, setSidebarWidth] = React.useState(320);
      const [sessionListWidth, setSessionListWidth] = React.useState(300);
      const noop = () => {};
      const setCollectionFilters = noop, DEFAULT_COLLECTION_FILTERS = {}, setSearchActive = noop,
        setSearchQuery = noop, setFocusedSidebarItemId = noop, setViewFiltersMap = noop,
        setExpandedFolders = noop, setCollapsedItems = noop;
      const sidebarResize = usePanelResize({onPreview:setSidebarWidth,onCancel:setSidebarWidth,
        onCommit:size => { setSidebarWidth(size); commitShellLayout({workspaceId:activeWorkspaceId,sidebarWidth:size}); }});
      const navigatorResize = usePanelResize({onPreview:setSessionListWidth,onCancel:setSessionListWidth,
        onCommit:size => { setSessionListWidth(size); commitShellLayout({workspaceId:activeWorkspaceId,navigatorWidth:size}); }});
      React.useLayoutEffect(${workspaceRestoreEffect()}, [activeWorkspaceId]);
      window.resizeProbe = {
        resize(delta) { sidebarResize.handleKeyAdjust(delta,{leftId:'left',rightId:'right',total:800,sizeA:sidebarWidth,minA:180,maxA:360,minB:240,maxB:620}); },
        width() { return sidebarWidth; },
        commit() { sidebarResize.handleKeyCommit(); },
      };
      return null;
    }
    const root = createRoot(document.getElementById('root'));
    const rerender = () => flushSync(() => root.render(React.createElement(React.Fragment,null,React.createElement(ResizeProbe),React.createElement(MainContentPanel, { navStateOverride:nav, panelId:'fixture' }))));
    const store = createStore(); store.sub(inspectorPanelWidthAtom,()=>{}); store.sub(bottomDockHeightAtom,()=>{});
    window.ui001 = {
      navigate(route, ws='ws-a') { workspace=ws; nav=parseRouteToNavigationState(route); rerender(); },
      emitSources(next, ws=workspace) { rows=next; sourceListeners.forEach(callback=>callback(ws, next)); },
      sourceRows: sources, reads,
      sessions(rows) {sessionRows = new Map(rows.map(row=>[row.id,row]));rerender()},
      dockOpen() {return getDefaultStore().get(bottomTerminalOpenAtom)},
      failSource() { failSource=true; },
      failPage(value) { failPage=value; }, rejectLazy() { rejectLazy=true; }, lazyAttempts() { return lazyAttempts; }, delaySource() { delaySource=true; }, resolveSource(next) { deferredSource(next); },
      cloudRows(rows) { cloudRows=rows; }, failCloud() { failCloud=true; }, delayCloud() { delayCloud=true; }, resolveCloud() { deferredCloud({enabled:true}); },
      address() { return {workspace,nav}; },
      setSize(width, height) { store.set(inspectorPanelWidthAtom,width); store.set(bottomDockHeightAtom,height); },
      sizes() { return [store.get(inspectorPanelWidthAtom),store.get(bottomDockHeightAtom)]; },
    }; rerender();
  `
  const result = await build({ stdin: {contents, loader:'tsx', resolveDir:root}, bundle:true, write:false, format:'iife', platform:'browser',
    tsconfig:join(root,'apps/electron/tsconfig.json'), plugins:[{
      name:'explicit-test-seams', setup(builder) {
        builder.onResolve({filter:/^(react-i18next|@\/contexts\/NavigationContext)$/}, args => ({path:args.path,namespace:'fixture'}));
        builder.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:args.path==='react-i18next'
          ? "export const useTranslation=()=>({t:key=>key});"
          : "export const useNavigation=()=>({navigate:route=>window.ui001.navigate(route)});",loader:'js'}));
      },
    }] })
  return result.outputFiles![0]!.text
}

const browserTest = (name: string, run: () => Promise<void>) => it(name, run, 30_000)

describe.skipIf(!enabled)('UI-001 real Chromium component and persistence fixtures', () => {
  beforeAll(async () => {
    const javascript = await fixtureBundle()
    server = createServer((request, response) => {
      if (request.url==='/fixture.js') { response.writeHead(200, {'content-type':'text/javascript'}); response.end(javascript); }
      else { response.writeHead(200, {'content-type':'text/html'}); response.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>'); }
    })
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    base = 'http://127.0.0.1:'+ (server.address() as any).port
    browser = process.env.ROX_UI001_CHROMIUM_CDP_URL
      ? await chromium.connectOverCDP(process.env.ROX_UI001_CHROMIUM_CDP_URL)
      : await chromium.launch({ executablePath: process.env.ROX_UI001_CHROMIUM_EXECUTABLE, channel: process.env.ROX_UI001_CHROMIUM_EXECUTABLE ? undefined : process.env.ROX_UI001_BROWSER_CHANNEL ?? 'chrome', headless:true, args:['--disable-gpu'] })
    mkdirSync(evidence,{recursive:true})
  }, 30_000)
  beforeEach(async () => { context=await browser.newContext(); page=await context.newPage(); page.setDefaultTimeout(2000); page.setDefaultNavigationTimeout(30_000); await page.goto(base, {waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>!!(window as any).ui001) }, 30_000)
  afterEach(async () => { await context?.close() }, 30_000)
  afterAll(async () => {
    try { await browser?.close() } finally {
      if (server) {
        server.closeAllConnections()
        await new Promise<void>(resolve=>server.close(()=>resolve()))
      }
    }
  }, 30_000)

  browserTest('selected source deletion and recreation preserve workspace and entity address', async () => {
    await page.evaluate(()=>(window as any).ui001.navigate('sources/source/a'))
    await page.locator('[data-fixture-source="a"]').waitFor()
    await page.evaluate(()=>(window as any).ui001.emitSources([]))
    await page.locator('[data-testid="route-resource-missing"]').waitFor()
    expect(await page.locator('[data-testid="route-resource-missing"] p').textContent()).toBe('sourceInfo.notFound')
    expect(await page.evaluate(()=>(window as any).ui001.address())).toMatchObject({workspace:'ws-a',nav:{navigator:'sources',details:{sourceSlug:'a'}}})
    await page.screenshot({path:join(evidence,'selected-source-missing.png')})
    await page.evaluate(()=>(window as any).ui001.emitSources((window as any).ui001.sourceRows))
    await page.locator('[data-fixture-source="a"]').waitFor()
  })

  browserTest('deletion and foreign-workspace session metadata cannot mount another chat', async () => {
    await page.evaluate(()=>{(window as any).ui001.sessions([{id:'a',workspaceId:'ws-a'},{id:'foreign',workspaceId:'ws-b'}]);(window as any).ui001.navigate('allSessions/session/a')})
    await page.locator('[data-fixture-chat="a"]').waitFor()
    await page.evaluate(()=>(window as any).ui001.sessions([{id:'foreign',workspaceId:'ws-b'}]))
    await page.locator('[data-testid="route-session-unavailable"][data-session-id="a"]').waitFor()
    expect(await page.locator('[data-fixture-chat]').count()).toBe(0)
    await page.evaluate(()=>(window as any).ui001.navigate('allSessions/session/foreign'))
    await page.locator('[data-testid="route-unavailable"]').waitFor()
    expect((await page.evaluate(()=>(window as any).ui001.address())).nav.details.sessionId).toBe('foreign')
    expect(await page.locator('[data-fixture-chat]').count()).toBe(0)
  })

  browserTest('malformed and unsupported terminal addresses show specific unavailable surfaces', async () => {
    await page.evaluate(()=>(window as any).ui001.navigate('allSessions/session/%ZZ'))
    await page.locator('[data-testid="route-unavailable"]').waitFor()
    expect(await page.locator('[data-fixture-source]').count()).toBe(0)
    await page.evaluate(()=>(window as any).ui001.navigate('terminal/missing-terminal'))
    await page.locator('[data-testid="terminal-surface-unavailable"][data-terminal-id="missing-terminal"]').waitFor()
    await page.locator('[data-terminal-surface-open-dock]').click()
    expect((await page.evaluate(()=>(window as any).ui001.address())).nav.details.id).toBe('missing-terminal')
    expect(await page.evaluate(()=>(window as any).ui001.dockOpen())).toBe(true)
  })

  browserTest('cloud-run lookup failure retries and deletion refreshes the selected address', async () => {
    await page.evaluate(()=>{(window as any).ui001.failCloud();(window as any).ui001.navigate('cloud-run/a')})
    await page.locator('[data-testid="cloud-run-surface-unavailable"]').waitFor()
    await page.locator('[data-testid="cloud-run-surface-retry"]').click()
    await page.locator('[data-cloud-run-surface="host"][data-cloud-run-id="a"]').waitFor()
    await page.evaluate(()=>{(window as any).ui001.cloudRows([]);window.dispatchEvent(new Event('focus'))})
    await page.locator('[data-testid="cloud-run-surface-not-found"][data-cloud-run-id="a"]').waitFor()
    expect((await page.evaluate(()=>(window as any).ui001.address())).nav.details.runId).toBe('a')
  })

  browserTest('retry recovers an unavailable selected source through the actual click handler', async () => {
    await page.evaluate(()=>{ (window as any).ui001.failSource(); (window as any).ui001.navigate('sources/source/a') })
    await page.locator('[data-testid="route-resource-unavailable"]').waitFor()
    await page.getByRole('button', {name:'common.retry'}).click()
    await page.locator('[data-fixture-source="a"]').waitFor()
    expect(await page.evaluate(()=>(window as any).ui001.address())).toMatchObject({workspace:'ws-a',nav:{details:{sourceSlug:'a'}}})
  })

  browserTest('late resource load cannot replace a new missing address', async () => {
    await page.evaluate(()=>{ (window as any).ui001.delaySource(); (window as any).ui001.navigate('sources/source/a') })
    await page.locator('[data-testid="route-resource-loading"]').waitFor()
    await page.evaluate(()=>(window as any).ui001.navigate('sources/source/gone'))
    await page.locator('[data-testid="route-resource-missing"]').waitFor()
    await page.evaluate(()=>(window as any).ui001.resolveSource((window as any).ui001.sourceRows))
    expect(await page.locator('[data-testid="route-resource-missing"]').getAttribute('data-route-entity')).toBe('gone')
    expect(await page.locator('[data-fixture-source="a"]').count()).toBe(0)
  })

  browserTest('cloud run switch clears previous content while the new callback is pending', async () => {
    await page.evaluate(()=>(window as any).ui001.navigate('cloud-run/a'))
    await page.locator('[data-cloud-run-surface="host"][data-cloud-run-id="a"]').waitFor()
    await page.evaluate(()=>{ (window as any).ui001.delayCloud(); (window as any).ui001.navigate('cloud-run/b') })
    await page.locator('[data-cloud-run-surface="loading"][data-cloud-run-id="b"]').waitFor()
    expect(await page.locator('[data-cloud-run-surface="host"][data-cloud-run-id="a"]').count()).toBe(0)
    await page.evaluate(()=>(window as any).ui001.resolveCloud())
    await page.locator('[data-cloud-run-surface="host"][data-cloud-run-id="b"]').waitFor()
    await page.screenshot({path:join(evidence,'cloud-run-b.png')})
  })

  browserTest('retries rejected lazy imports and keeps the selected route', async () => {
    await page.evaluate(()=>{ (window as any).ui001.rejectLazy(); (window as any).ui001.navigate('extension/plugin/view') })
    await page.locator('[data-testid="route-error"]').waitFor()
    expect(await page.evaluate(()=>(window as any).ui001.lazyAttempts())).toBe(1)
    await page.getByRole('button',{name:'common.retry'}).click()
    await page.locator('[data-extension="view"]').waitFor()
    expect(await page.evaluate(()=>(window as any).ui001.lazyAttempts())).toBe(2)
    expect(await page.evaluate(()=>(window as any).ui001.address().nav)).toMatchObject({navigator:'extension',details:{viewId:'view'}})
  })

  browserTest('retries rendering failure and a new route clears a previous error', async () => {
    await page.evaluate(()=>{ (window as any).ui001.failPage(true); (window as any).ui001.navigate('extension/plugin/view') })
    await page.locator('[data-testid="route-error"]').waitFor()
    await page.evaluate(()=>(window as any).ui001.failPage(false))
    await page.getByRole('button',{name:'common.retry'}).click()
    await page.locator('[data-extension="view"]').waitFor()
    await page.evaluate(()=>{ (window as any).ui001.failPage(true); (window as any).ui001.navigate('extension/plugin/bad') })
    await page.locator('[data-testid="route-error"]').waitFor()
    await page.evaluate(()=>(window as any).ui001.navigate('sources/source/a'))
    await page.locator('[data-fixture-source="a"]').waitFor()
    expect(await page.locator('[data-testid="route-error"]').count()).toBe(0)
  })

  browserTest('workspace switch cancels a real pending resize timer before it can persist old geometry', async () => {
    await page.evaluate(() => {
      localStorage.setItem('craft-shell-layout-v1:ws-b', JSON.stringify({schemaVersion:1,workspaceId:'ws-b',sidebarWidth:210,navigatorWidth:410,collapsedSectionIds:[]}));
      (window as any).resizeProbe.resize(20);
      (window as any).ui001.navigate('home','ws-b');
    })
    expect(await page.evaluate(()=>(window as any).resizeProbe.width())).toBe(210)
    await page.waitForTimeout(350)
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('craft-shell-layout-v1:ws-b')!).sidebarWidth)).toBe(210)
    expect(await page.evaluate(()=>localStorage.getItem('craft-shell-layout-v1:ws-a'))).toBeNull()
    await page.evaluate(()=>(window as any).resizeProbe.resize(10))
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('craft-shell-layout-v1:ws-b')!).sidebarWidth===220)
    expect(await page.evaluate(()=>(window as any).resizeProbe.width())).toBe(220)
  })

  browserTest('actual localStorage persists valid sizes across reload and other windows', async () => {
    const other=await page.context().newPage(); await other.goto(base, {waitUntil:'domcontentloaded',timeout:30_000}); await other.waitForFunction(()=>!!(window as any).ui001,undefined,{polling:100})
    try {
      await page.bringToFront()
      await page.evaluate(()=>(window as any).ui001.setSize(10_000,119.6))
      expect(await page.evaluate(()=>(window as any).ui001.sizes())).toEqual([1400,120])
      await other.bringToFront()
      await other.waitForFunction(()=>JSON.stringify((window as any).ui001.sizes())==='[1400,120]',undefined,{polling:100})
      // External headless CDP hosts can pause animation-frame polling in an
      // inactive tab. Restore its viewport before reload and poll data by time.
      await page.bringToFront()
      await page.reload({waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>!!(window as any).ui001,undefined,{polling:100})
      expect(await page.evaluate(()=>(window as any).ui001.sizes())).toEqual([1400,120])
      await page.evaluate(()=>localStorage.setItem('craft-bottom-dock-height','1e999'))
      await other.bringToFront()
      await other.waitForFunction(()=>(window as any).ui001.sizes()[1]===104,undefined,{polling:100})
      await page.bringToFront()
      await page.reload({waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>!!(window as any).ui001,undefined,{polling:100})
      expect(await page.evaluate(()=>(window as any).ui001.sizes())).toEqual([1400,104])
    } finally { await other.close() }
  })
})
