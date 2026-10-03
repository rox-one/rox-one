import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { launchOwnedFixtureBrowser } from '../../components/app-shell/__tests__/rox-readiness-ui-001.browser-owner'

// Mounted production NavigationProvider + real React/Jotai/history. Only backend
// data and IPC transport are fixtures; native product proof lives in the separate
// Electron test. This opt-in test never claims Windows or hosted acceptance.
const enabled = process.env.ROX_UI001_BROWSER_TEST === '1'
const root = join(import.meta.dir, '../../../../../..')
let server: Server, browser: Browser, context: BrowserContext, page: Page, base: string
let closeBrowser: (() => Promise<void>) | undefined

async function fixtureBundle() {
  // A separately bundled immutable fixture and external CDP endpoint keep
  // this lane runnable when the Bun test host cannot spawn child processes.
  if (process.env.ROX_UI001_NAV_FIXTURE_BUNDLE) return readFileSync(process.env.ROX_UI001_NAV_FIXTURE_BUNDLE, 'utf8')
  const contents = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Provider, createStore, useAtomValue } from 'jotai';
    import { NavigationProvider, useNavigation } from './apps/electron/src/renderer/contexts/NavigationContext';
    import { sessionMetaMapAtom } from './apps/electron/src/renderer/atoms/sessions';
    import { usePages } from './apps/electron/src/renderer/hooks/usePages';
    import { pagesAtom } from './apps/electron/src/renderer/atoms/pages';
    import { panelStackAtom, focusedPanelIdAtom, focusedPanelRouteAtom } from './apps/electron/src/renderer/atoms/panel-stack';
    const store = createStore();
    let ready=true, sessionsReady=true, ws='ws-a', slug='a', remote='remote-a', deepLink;
    let state, pagesChanged, switchMode='ok'; const switches=[];
    const pageRequests=[], pageSubscriptions=[], deepSubscriptions=[], createRequests=[], commands=[], inputs=[], messages=[], scheduled=[];
    const nativeSetTimeout=window.setTimeout;
    window.electronAPI = {
      getPages: workspaceId=>new Promise(resolve=>pageRequests.push({workspaceId,resolve})),
      onPagesChanged: callback=>{pagesChanged=callback;pageSubscriptions.push(callback);return()=>{if(pagesChanged===callback)pagesChanged=undefined}},
      listLabels: async()=>[], onLabelsChanged: ()=>()=>{},
      onDeepLinkNavigate: callback=>{ deepLink=callback; deepSubscriptions.push({callback,workspaceId:ws,remoteWorkspaceId:remote}); return()=>{deepLink=undefined}; },
      sessionCommand: async(id,command)=>{commands.push({id,command})},
      sendMessage: async(id,input)=>{messages.push({id,input})},
    };
    const rows = [{id:'first-a',workspaceId:'ws-a',lastMessageAt:2}, {id:'first-b',workspaceId:'ws-b',lastMessageAt:3},
      {id:'remote',workspaceId:'remote-a',lastMessageAt:1}];
    store.set(sessionMetaMapAtom,new Map(rows.map(row=>[row.id,row])));
    function Probe() {
      state=useNavigation();
      usePages(ws);
      const panels=useAtomValue(panelStackAtom), route=useAtomValue(focusedPanelRouteAtom);
      return React.createElement('output',{'data-testid':'navigation', 'data-route':route, 'data-workspace':ws, 'data-ready':String(ready), 'data-sessions-ready':String(sessionsReady)},JSON.stringify({nav:state.navigationState,panels,revision:state.navigationRevision}));
    }
    const root=createRoot(document.getElementById('root'));
    // Production callback identities can stay stable across a remote-only owner
    // change. Recreating them in render would mask a missing effect dependency.
    const onSwitchWorkspaceBySlug=next=>{if(switchMode==='missing')return false;if(switchMode==='reject')return Promise.reject(new Error('fixture switch rejected'));if(switchMode==='hold')return new Promise((resolve,reject)=>switches.push({next,resolve,reject}));slug=next;ws='ws-'+next;remote=ws==='ws-a'?'remote-a':null;render();return true};
    const onCreateSession=workspaceId=>new Promise(resolve=>createRequests.push({workspaceId,resolve}));
    const onInputChange=(id,input)=>{inputs.push({id,input})};
    function render() { const tree=React.createElement(Provider,{store},React.createElement(NavigationProvider,{
      workspaceId:ws, workspaceSlug:slug, remoteWorkspaceId:remote,
      isReady:ready,isSessionsReady:sessionsReady,onSwitchWorkspaceBySlug,onCreateSession,onInputChange,
    },React.createElement(Probe)));root.render(new URLSearchParams(location.search).get('strict')==='1'?React.createElement(React.StrictMode,null,tree):tree); }
    window.ui001nav={
      navigate: (route,options)=>state.navigate(route,options),
      deep: view=>deepLink({view}),
      deepPayload: payload=>deepLink(payload),
      deepRetained: (index,payload)=>deepSubscriptions[index].callback(payload),
      deepListeners: ()=>deepSubscriptions.map((entry,index)=>({index,workspaceId:entry.workspaceId,remoteWorkspaceId:entry.remoteWorkspaceId})),
      ready(value,sessions=value){ready=value;sessionsReady=sessions;render()},
      workspace(id, nextSlug){ws=id;slug=nextSlug;remote=ws==='ws-a'?'remote-a':null;render()},
      remote(value){remote=value;render()},
      delete(id){const next=new Map(store.get(sessionMetaMapAtom));next.delete(id);store.set(sessionMetaMapAtom,next)},
      publishSession(id){const next=new Map(store.get(sessionMetaMapAtom));next.set(id,{id,workspaceId:ws,lastMessageAt:10});store.set(sessionMetaMapAtom,next)},
      pages(){return store.get(pagesAtom)},
      resolvePages(index,rows){pageRequests[index].resolve(rows)},
      emitPages(workspace,rows){pagesChanged(workspace,rows)},
      emitOldPages(index,workspace,rows){pageSubscriptions[index](workspace,rows)},
      resizePanels(){store.set(panelStackAtom,store.get(panelStackAtom).map(panel=>({...panel,proportion:0.75})))},
      focus(index){store.set(focusedPanelIdAtom,store.get(panelStackAtom)[index].id)},
      creations(){return createRequests.map(request=>({workspaceId:request.workspaceId}))},
      resolveCreate(index,id){createRequests[index].resolve({id,workspaceId:createRequests[index].workspaceId})},
      actionCalls(){return{commands,inputs,messages}},
      holdActionTimers(){window.setTimeout=(callback,delay,...args)=>delay===100?(scheduled.push(()=>callback(...args)),scheduled.length):nativeSetTimeout(callback,delay,...args)},
      timers(){return scheduled.length},
      fireActionTimers(){window.setTimeout=nativeSetTimeout;scheduled.splice(0).forEach(callback=>callback())},
      snapshot(){return{nav:state.navigationState,panels:store.get(panelStackAtom),ws,slug}},
      switchMode(value){switchMode=value}, resolveSwitch(index, result){switches[index].resolve(result)},
      rejectSwitch(index){switches[index].reject(new Error('fixture switch rejected'))},
      pendingSwitches(){return switches.map(({next})=>({next}))},
      pop(search){history.pushState({seq:0},'',search);window.dispatchEvent(new PopStateEvent('popstate',{state:{seq:0}}))},
    };
    const params=new URLSearchParams(location.search);
    if(params.get('notReady')){ready=false;sessionsReady=false}
    render();
  `
  const result = await build({stdin:{contents,loader:'tsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',tsconfig:join(root,'apps/electron/tsconfig.json')})
  return result.outputFiles![0]!.text
}

async function snapshot() { return page.evaluate(()=>(window as any).ui001nav.snapshot()) }
async function routeIs(route: string) { await page.waitForFunction(route=>document.querySelector('output')?.getAttribute('data-route')===route,route) }

async function popCurrentWorkspacePanels(route: string) {
  await page.evaluate(route=>{
    const ui=(window as any).ui001nav
    const panels=ui.snapshot().panels.map((panel: {route: string, proportion: number},index: number)=>({
      route:index===1?route:panel.route,proportion:panel.proportion,
    }))
    const params=new URLSearchParams({ws:'a',route,panels:'v2:'+JSON.stringify(panels),fi:'1'})
    ui.pop('?'+params.toString())
  },route)
}

async function focusedHistorySwitchFailure(outcome: 'false' | 'reject') {
  await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa');await routeIs('notes/note/a')
  await page.evaluate(()=>(window as any).ui001nav.navigate('home',{newPanel:true}));await routeIs('home')
  await page.evaluate(()=>{
    const ui=(window as any).ui001nav
    ui.switchMode('hold');ui.pop('?ws=gone&route=notes%2Fnote%2Fforeign')
  })
  await page.waitForFunction(()=>(window as any).ui001nav.pendingSwitches().length===1)
  await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('notes/note/a')
  await page.evaluate(outcome=>{
    const ui=(window as any).ui001nav
    if(outcome==='reject')ui.rejectSwitch(0)
    else ui.resolveSwitch(0,false)
  },outcome)
  await page.waitForTimeout(100)
  // Current unknown-workspace ownership intentionally retains the requested
  // address. Recovery uses a real local history request, never a normal
  // navigate() call that would independently clear the stuck switch flag.
  expect(new URL(page.url()).searchParams.get('ws')).toBe('gone')
  const current=await snapshot()
  expect(current.ws).toBe('ws-a')
  expect(current.nav.navigator).toBe('unavailable')
  expect(current.panels.map((panel: {route: string})=>panel.route)).toEqual(['notes/note/a','home'])
  await popCurrentWorkspacePanels('home');await routeIs('home')
  await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('notes/note/a')
  await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='notes/note/a')
  expect(new URL(page.url()).searchParams.get('ws')).toBe('a')
}

const browserTest = (name: string, run: () => Promise<void>) => it(name, run, 30_000)

describe.skipIf(!enabled)('UI-001 mounted NavigationProvider raw URL/readiness/history',()=>{
  beforeAll(async()=>{
    const javascript=await fixtureBundle()
    server=createServer((request,response)=>{
      response.writeHead(200,{'content-type':request.url==='/fixture.js'?'text/javascript':'text/html'})
      response.end(request.url==='/fixture.js'?javascript:'<!doctype html><div id="root"></div><script src="/fixture.js"></script>')
    })
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    base='http://127.0.0.1:'+(server.address() as any).port
    if (process.env.ROX_UI001_CHROMIUM_CDP_URL) {
      browser=await chromium.connectOverCDP(process.env.ROX_UI001_CHROMIUM_CDP_URL)
      closeBrowser=()=>browser.close()
    } else {
      const owned=await launchOwnedFixtureBrowser({executablePath:process.env.ROX_UI001_CHROMIUM_EXECUTABLE,headless:true,args:['--disable-gpu']})
      browser=owned.browser;closeBrowser=owned.close
    }
  },30000)
  beforeEach(async()=>{context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(3000)})
  afterEach(async()=>{await context?.close()},15000)
  afterAll(async()=>{try{await closeBrowser?.()}finally{server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()))}},15000)

  browserTest('initial missing entity never auto-selects an existing chat and survives reload',async()=>{
    await page.goto(base+'/?ws=a&route=allSessions%2Fsession%2Fdeleted')
    await routeIs('allSessions/session/deleted')
    expect((await snapshot()).nav.details.sessionId).toBe('deleted')
    await page.reload();await routeIs('allSessions/session/deleted')
    await page.evaluate(()=>(window as any).ui001nav.navigate('allSessions/session/first-b'))
    await routeIs('allSessions/session/first-b')
    expect((await snapshot()).nav).toMatchObject({ navigator: 'unavailable', route: 'allSessions/session/first-b' })
    await page.evaluate(()=>(window as any).ui001nav.navigate('allSessions/session/remote'))
    await routeIs('allSessions/session/remote')
  })

  browserTest('unknown and malformed routes preserve raw addresses on initial load/reload/deep link',async()=>{
    for(const route of ['unknown/entity','allSessions/session/%E0%A4%A','action/copy?text=unsafe']){
      await page.goto(base+'/?ws=a&route='+encodeURIComponent(route));await routeIs(route)
      expect((await snapshot()).nav).toMatchObject({navigator:'unavailable',route})
      await page.reload();await routeIs(route)
      expect((await snapshot()).nav.navigator).toBe('unavailable')
    }
    await page.evaluate(()=>(window as any).ui001nav.deep('other/raw%ZZ'))
    await routeIs('other/raw%ZZ')
    expect(new URL(page.url()).searchParams.get('route')).toBe('other/raw%ZZ')
  })

  browserTest('nested note IDs retain their complete identity through reload and deep link',async()=>{
    const route='notes/note/id/extra'
    await page.goto(base+'/?ws=a&route='+encodeURIComponent(route));await routeIs(route)
    expect((await snapshot()).nav.details.noteId).toBe('id/extra')
    await page.reload();await routeIs(route)
    expect((await snapshot()).nav.details.noteId).toBe('id/extra')
    await page.evaluate(()=>(window as any).ui001nav.deep('notes/note/folder/other'))
    await routeIs('notes/note/folder/other')
    expect((await snapshot()).nav.details.noteId).toBe('folder/other')
  })

  browserTest('legacy known-root incomplete shapes remain unavailable through auto-selection effects',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    for(const route of ['knowledge/unknown/doc','knowledge/document','doc','allSessions/session']){
      await page.evaluate(route=>(window as any).ui001nav.navigate(route),route);await routeIs(route)
      await page.waitForTimeout(100)
      expect((await snapshot()).nav).toMatchObject({navigator:'unavailable',route})
      expect(new URL(page.url()).searchParams.get('route')).toBe(route)
    }
  })

  browserTest('raw commas, colon suffixes and malformed escapes round-trip within a multi-panel URL',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    const raw='unknown/a,b:0.25?x=%ZZ&nested=one%2Ftwo'
    await page.evaluate(route=>(window as any).ui001nav.navigate(route,{newPanel:true}),raw);await routeIs(raw)
    expect((await snapshot()).panels.map((panel:any)=>panel.route)).toEqual(['home',raw])
    expect(new URL(page.url()).searchParams.get('panels')).toStartWith('v2:')
    await page.reload();await routeIs(raw)
    expect((await snapshot()).panels.map((panel:any)=>panel.route)).toEqual(['home',raw])
    expect((await snapshot()).nav).toMatchObject({navigator:'unavailable',route:raw})
  })

  browserTest('queued nested/encoded raw view and new-panel option are replayed after readiness',async()=>{
    await page.goto(base+'/?ws=a&route=home&notReady=1')
    await page.waitForFunction(()=>!!(window as any).ui001nav)
    await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/a%2Fb',{newPanel:true}))
    await page.evaluate(()=>(window as any).ui001nav.ready(true))
    await routeIs('notes/note/a%2Fb')
    expect((await snapshot()).nav.details.noteId).toBe('a/b')
    expect((await snapshot()).panels.map((p:any)=>p.route)).toEqual(['home','notes/note/a%2Fb'])
  })

  browserTest('queued malformed view survives a session-readiness-only race',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.ready(true,false))
    await page.evaluate(()=>(window as any).ui001nav.navigate('settings/missing'))
    expect((await snapshot()).nav.navigator).toBe('home')
    await page.evaluate(()=>(window as any).ui001nav.ready(true,true));await routeIs('settings/missing')
    expect((await snapshot()).nav.navigator).toBe('unavailable')
  })

  browserTest('actual back/forward, deletion and workspace restoration preserve explicit selection',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.navigate('allSessions/session/first-a'));await routeIs('allSessions/session/first-a')
    await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/note-a'));await routeIs('notes/note/note-a')
    await page.goBack();await routeIs('allSessions/session/first-a')
    await page.evaluate(()=>(window as any).ui001nav.delete('first-a'))
    expect((await snapshot()).nav.details.sessionId).toBe('first-a')
    await page.goForward();await routeIs('notes/note/note-a')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'));await routeIs('allSessions/session/first-b')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-a','a'));await routeIs('notes/note/note-a')
  })

  browserTest('missing or rejected workspace history targets retain unavailable address until explicit local recovery',async()=>{
    await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa');await routeIs('notes/note/a')
    for (const mode of ['missing','reject']) {
      await page.evaluate(mode=>{(window as any).ui001nav.switchMode(mode);(window as any).ui001nav.pop('?ws=gone&route=notes%2Fnote%2Fforeign')},mode)
      await page.waitForFunction(()=>JSON.parse(document.querySelector('output')!.textContent!).nav.navigator==='unavailable')
      expect(new URL(page.url()).searchParams.get('ws')).toBe('gone')
      expect((await snapshot()).ws).toBe('ws-a')
      expect((await snapshot()).nav.navigator).toBe('unavailable')
      await page.evaluate(()=>(window as any).ui001nav.navigate('home'));await routeIs('home')
      await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='home')
      await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/a'));await routeIs('notes/note/a')
    }
  })

  browserTest('pending workspace history keeps its target during resize and late failure cannot overwrite a newer intent',async()=>{
    await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa');await routeIs('notes/note/a')
    await page.evaluate(()=>{(window as any).ui001nav.switchMode('hold');(window as any).ui001nav.pop('?ws=gone&route=notes%2Fnote%2Fforeign');(window as any).ui001nav.resizePanels()})
    await page.waitForTimeout(100)
    expect(new URL(page.url()).searchParams.get('ws')).toBe('gone')
    await page.evaluate(()=>(window as any).ui001nav.navigate('home'));await routeIs('home')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='home')
    await page.evaluate(()=>(window as any).ui001nav.resolveSwitch(0,false))
    await page.waitForTimeout(100)
    expect(new URL(page.url()).searchParams.get('route')).toBe('home')
    expect((await snapshot()).ws).toBe('ws-a')
  })

  browserTest('history-switch regression: false reply after focus-only change releases suppression',async()=>{
    await focusedHistorySwitchFailure('false')
  })

  browserTest('history-switch regression: rejected reply after focus-only change releases suppression',async()=>{
    await focusedHistorySwitchFailure('reject')
  })

  browserTest('history-switch regression: older failure cannot release a newer workspace switch',async()=>{
    await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa');await routeIs('notes/note/a')
    await page.evaluate(()=>{
      const ui=(window as any).ui001nav
      ui.switchMode('hold');ui.pop('?ws=old&route=notes%2Fnote%2Fold-target')
      ui.pop('?ws=newer&route=notes%2Fnote%2Fnew-target')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.pendingSwitches().length===2)
    await page.evaluate(()=>(window as any).ui001nav.rejectSwitch(0))
    await page.waitForTimeout(100)
    expect(new URL(page.url()).searchParams.get('ws')).toBe('newer')
    expect(new URL(page.url()).searchParams.get('route')).toBe('notes/note/new-target')
    expect((await snapshot()).nav.navigator).toBe('unavailable')
    await page.evaluate(()=>(window as any).ui001nav.resolveSwitch(1,false))
    await page.waitForTimeout(100)
    expect(new URL(page.url()).searchParams.get('ws')).toBe('newer')
    expect(new URL(page.url()).searchParams.get('route')).toBe('notes/note/new-target')
    await page.evaluate(()=>(window as any).ui001nav.navigate('home'));await routeIs('home')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='home')
  })

  browserTest('history-switch regression: same-workspace popstate supersedes a pending foreign switch',async()=>{
    await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa');await routeIs('notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.navigate('home',{newPanel:true}));await routeIs('home')
    await page.evaluate(()=>{
      const ui=(window as any).ui001nav
      ui.switchMode('hold');ui.pop('?ws=gone&route=notes%2Fnote%2Fforeign')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.pendingSwitches().length===1)
    await popCurrentWorkspacePanels('notes/note/current')
    await routeIs('notes/note/current')
    await page.evaluate(()=>(window as any).ui001nav.resolveSwitch(0,false))
    await page.waitForTimeout(100)
    expect(new URL(page.url()).searchParams.get('route')).toBe('notes/note/current')
    // Focus must update the browser URL after reconciliation, without a normal
    // navigate() call masking a stuck pending-workspace flag.
    await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('notes/note/a')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='notes/note/a')
    expect(new URL(page.url()).searchParams.get('ws')).toBe('a')
    expect((await snapshot()).panels.map((panel: {route: string})=>panel.route)).toEqual(['notes/note/a','notes/note/current'])
    await page.evaluate(()=>(window as any).ui001nav.focus(1));await routeIs('notes/note/current')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='notes/note/current')
  })

  browserTest('history-switch regression: metadata-blocked same-workspace history retains its newer target',async()=>{
    await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa');await routeIs('notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.navigate('home',{newPanel:true}));await routeIs('home')
    await page.evaluate(()=>{
      const ui=(window as any).ui001nav
      ui.switchMode('hold');ui.pop('?ws=gone&route=notes%2Fnote%2Fforeign')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.pendingSwitches().length===1)
    await page.evaluate(()=>(window as any).ui001nav.ready(true,false))
    await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-sessions-ready')==='false')
    const target='notes/note/current?keep=a%2Fb&next=%3F'
    await popCurrentWorkspacePanels(target)
    await page.evaluate(()=>(window as any).ui001nav.resolveSwitch(0,false))
    await page.waitForTimeout(100)
    expect(new URL(page.url()).searchParams.get('ws')).toBe('a')
    expect(new URL(page.url()).searchParams.get('route')).toBe(target)
    expect((await snapshot()).panels.map((panel: {route: string})=>panel.route)).toEqual(['notes/note/a','home'])
    await page.evaluate(()=>(window as any).ui001nav.ready(true,true));await routeIs(target)
    expect((await snapshot()).nav.details.noteId).toBe('current')
    expect(new URL(page.url()).searchParams.get('route')).toBe(target)
    await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('notes/note/a')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.focus(1));await routeIs(target)
    await page.waitForFunction(route=>new URL(location.href).searchParams.get('route')===route,target)
  })

  browserTest('history-switch regression: remote-only owner rotation still releases a failed workspace switch',async()=>{
    await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa');await routeIs('notes/note/a')
    await page.evaluate(()=>{
      const ui=(window as any).ui001nav
      ui.switchMode('hold');ui.pop('?ws=gone&route=notes%2Fnote%2Fforeign')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.pendingSwitches().length===1)
    await page.evaluate(()=>(window as any).ui001nav.remote('remote-new'))
    await page.waitForFunction(()=>(window as any).ui001nav.deepListeners().at(-1)?.remoteWorkspaceId==='remote-new')
    await page.evaluate(()=>(window as any).ui001nav.resolveSwitch(0,false))
    await page.waitForTimeout(100)
    expect(new URL(page.url()).searchParams.get('ws')).toBe('gone')
    expect(new URL(page.url()).searchParams.get('route')).toBe('notes/note/foreign')
    expect((await snapshot()).ws).toBe('ws-a')
    expect((await snapshot()).nav.navigator).toBe('unavailable')
    await page.evaluate(()=>(window as any).ui001nav.navigate('home'));await routeIs('home')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='home')
  })

  browserTest('history-switch regression: workspace ABA cannot revive a failed switch over blocked current history',async()=>{
    await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa');await routeIs('notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.navigate('home',{newPanel:true}));await routeIs('home')
    await page.evaluate(()=>{
      const ui=(window as any).ui001nav
      ui.switchMode('hold');ui.pop('?ws=gone&route=notes%2Fnote%2Fforeign')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.pendingSwitches().length===1)
    await page.evaluate(()=>(window as any).ui001nav.ready(true,false))
    await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-sessions-ready')==='false')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'))
    await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-workspace')==='ws-b')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-a','a'))
    await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-workspace')==='ws-a')
    const target='notes/note/current-after-aba?keep=a%2Fb'
    await popCurrentWorkspacePanels(target)
    await page.evaluate(()=>(window as any).ui001nav.resolveSwitch(0,false))
    await page.waitForTimeout(100)
    expect(new URL(page.url()).searchParams.get('ws')).toBe('a')
    expect(new URL(page.url()).searchParams.get('route')).toBe(target)
    await page.evaluate(()=>(window as any).ui001nav.ready(true,true));await routeIs(target)
    expect((await snapshot()).ws).toBe('ws-a')
    expect((await snapshot()).nav.details.noteId).toBe('current-after-aba')
    await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('notes/note/a')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.focus(1));await routeIs(target)
    await page.waitForFunction(route=>new URL(location.href).searchParams.get('route')===route,target)
  })

  browserTest('actual StrictMode mount releases restoration without losing later focus history',async()=>{
    await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa&strict=1');await routeIs('notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.navigate('home',{newPanel:true}));await routeIs('home')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='home')
    await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('notes/note/a')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='notes/note/a')
    await page.goBack();await routeIs('home')
    expect((await snapshot()).panels.map((panel:{route:string})=>panel.route)).toEqual(['notes/note/a','home'])
  })

  browserTest('actual StrictMode mount preserves a pending foreign history request through focus and late refusal',async()=>{
    await page.goto(base+'/?ws=a&route=notes%2Fnote%2Fa&strict=1');await routeIs('notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.navigate('home',{newPanel:true}));await routeIs('home')
    await page.evaluate(()=>{const ui=(window as any).ui001nav;ui.switchMode('hold');ui.pop('?ws=gone&route=notes%2Fnote%2Fforeign&strict=1')})
    await page.waitForFunction(()=>(window as any).ui001nav.pendingSwitches().length===1)
    await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.resolveSwitch(0,false));await page.waitForTimeout(100)
    expect(new URL(page.url()).searchParams.get('ws')).toBe('gone')
    expect((await snapshot()).nav.navigator).toBe('unavailable')
    await popCurrentWorkspacePanels('home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('notes/note/a')
    await page.waitForFunction(()=>new URL(location.href).searchParams.get('route')==='notes/note/a')
  })

  browserTest('canonical page broadcasts beat stale list replies and former workspace replies are ignored',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.emitPages('ws-a',[{id:'page-a',config:{slug:'same'}}]))
    expect(await page.evaluate(()=>(window as any).ui001nav.pages())).toHaveLength(1)
    await page.evaluate(()=>(window as any).ui001nav.emitPages('ws-a',[]))
    await page.evaluate(()=>(window as any).ui001nav.resolvePages(0,[{id:'stale-a'}]))
    expect(await page.evaluate(()=>(window as any).ui001nav.pages())).toEqual([])
    await page.evaluate(()=>(window as any).ui001nav.emitPages('other-workspace',[]))
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'));await routeIs('allSessions/session/first-b')
    expect(await page.evaluate(()=>(window as any).ui001nav.pages())).toEqual([])
    await page.evaluate(()=>(window as any).ui001nav.resolvePages(2,[{id:'page-b'}]))
    await page.waitForFunction(()=>(window as any).ui001nav.pages()[0]?.id==='page-b')
    await page.evaluate(()=>(window as any).ui001nav.resolvePages(1,[{id:'late-a'}]))
    expect(await page.evaluate(()=>(window as any).ui001nav.pages())).toEqual([{id:'page-b'}])
  })

  browserTest('popstate received before metadata readiness is reconciled when readiness returns',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.ready(true,false))
    await page.evaluate(()=>(window as any).ui001nav.pop('?ws=a&route=invalid%2Fretained'))
    await page.evaluate(()=>(window as any).ui001nav.ready(true,true));await routeIs('invalid/retained')
    expect((await snapshot()).nav.navigator).toBe('unavailable')
  })

  browserTest('queued page broadcast from the former A owner cannot publish after A to B to A',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'));await routeIs('allSessions/session/first-b')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-a','a'));await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.emitPages('ws-a',[{id:'current-a'}]))
    await page.evaluate(()=>(window as any).ui001nav.emitOldPages(0,'ws-a',[{id:'old-a'}]))
    expect(await page.evaluate(()=>(window as any).ui001nav.pages())).toEqual([{id:'current-a'}])
  })

  browserTest('blocked popstate retains its exact target through an actual panel resize',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/current'));await routeIs('notes/note/current')
    await page.evaluate(()=>(window as any).ui001nav.ready(false,true))
    await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-ready')==='false')
    await page.evaluate(()=>(window as any).ui001nav.pop('?ws=a&route=invalid%2Fretained'))
    await page.evaluate(()=>(window as any).ui001nav.resizePanels())
    await page.waitForFunction(()=>JSON.parse(document.querySelector('output')!.textContent!).panels[0].proportion===0.75)
    expect(new URL(page.url()).searchParams.get('route')).toBe('invalid/retained')
    expect((await snapshot()).panels[0].route).toBe('notes/note/current')
    await page.evaluate(()=>(window as any).ui001nav.ready(true,true));await routeIs('invalid/retained')
    expect((await snapshot()).nav).toMatchObject({navigator:'unavailable',route:'invalid/retained'})
  })

  browserTest('workspace restoration waits for full readiness and resize cannot overwrite stored selection',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/a'));await routeIs('notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'));await routeIs('allSessions/session/first-b')
    await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/b'));await routeIs('notes/note/b')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-a','a'));await routeIs('notes/note/a')
    await page.evaluate(()=>(window as any).ui001nav.ready(false,true))
    await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-ready')==='false')
    const previousUrl=page.url()
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'))
    await page.waitForFunction(()=>document.querySelector('output')?.getAttribute('data-workspace')==='ws-b')
    await page.evaluate(()=>(window as any).ui001nav.resizePanels())
    await page.waitForFunction(()=>JSON.parse(document.querySelector('output')!.textContent!).panels[0].proportion===0.75)
    expect((await snapshot()).panels[0].route).toBe('notes/note/a')
    expect(page.url()).toBe(previousUrl)
    await page.evaluate(()=>(window as any).ui001nav.ready(true,true));await routeIs('notes/note/b')
    expect(new URL(page.url()).searchParams.get('ws')).toBe('b')
    expect(new URL(page.url()).searchParams.get('route')).toBe('notes/note/b')
  })

  browserTest('late create replies from former A ownership cannot navigate, prefill or send after A to B to A',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>{
      void (window as any).ui001nav.navigate('action/new-session?input=prefill&name=late-name')
      void (window as any).ui001nav.navigate('action/new-session?input=send&send=true')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===2)
    expect(await page.evaluate(()=>(window as any).ui001nav.creations())).toEqual([{workspaceId:'ws-a'},{workspaceId:'ws-a'}])
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'));await routeIs('allSessions/session/first-b')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-a','a'));await routeIs('home')
    await page.evaluate(()=>{
      (window as any).ui001nav.resolveCreate(0,'late-prefill');
      (window as any).ui001nav.resolveCreate(1,'late-send')
    })
    await page.waitForTimeout(200)
    expect((await snapshot()).panels.map((panel:any)=>panel.route)).toEqual(['home'])
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[],messages:[]})
  })

  browserTest('already scheduled input and send callbacks retain the original committed owner',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>{
      (window as any).ui001nav.holdActionTimers()
      void (window as any).ui001nav.navigate('action/new-session?input=prefill')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'created-prefill'))
    await page.waitForFunction(()=>(window as any).ui001nav.timers()===1)
    await routeIs('allSessions/session/created-prefill')
    await page.evaluate(()=>{void (window as any).ui001nav.navigate('action/new-session?input=send&send=true')})
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===2)
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(1,'created-send'))
    await page.waitForFunction(()=>(window as any).ui001nav.timers()===2)
    await routeIs('allSessions/session/created-send')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'));await routeIs('allSessions/session/first-b')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-a','a'));await routeIs('allSessions/session/created-send')
    await page.evaluate(()=>(window as any).ui001nav.fireActionTimers())
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[],messages:[]})
  })

  browserTest('new navigation in the same workspace cancels an older deferred create response',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>{void (window as any).ui001nav.navigate('action/new-session?name=old&input=old&send=true')})
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/newer'));await routeIs('notes/note/newer')
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'old-create'))
    await page.waitForTimeout(150)
    expect((await snapshot()).panels.map((panel:any)=>panel.route)).toEqual(['notes/note/newer'])
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[],messages:[]})
  })

  browserTest('actual same-workspace Back cancels an older deferred create response',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/older'));await routeIs('notes/note/older')
    await page.evaluate(()=>{void (window as any).ui001nav.navigate('action/new-session?input=old&send=true')})
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    await page.goBack();await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'old-after-back'))
    await page.waitForTimeout(150)
    expect((await snapshot()).panels.map((panel:any)=>panel.route)).toEqual(['home'])
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[],messages:[]})
  })

  browserTest('focusing another existing panel cancels the former panel deferred create response',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/owner',{newPanel:true}));await routeIs('notes/note/owner')
    await page.evaluate(()=>{void (window as any).ui001nav.navigate('action/new-session?input=old&send=true')})
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'old-after-focus'))
    await page.waitForTimeout(150)
    expect((await snapshot()).panels.map((panel:any)=>panel.route)).toEqual(['home','notes/note/owner'])
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[],messages:[]})
  })

  browserTest('focus away and back cannot regain an old deferred-create continuation',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.navigate('notes/note/owner',{newPanel:true}));await routeIs('notes/note/owner')
    await page.evaluate(()=>{void (window as any).ui001nav.navigate('action/new-session?input=old&send=true')})
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    await page.evaluate(()=>(window as any).ui001nav.focus(0));await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.focus(1));await routeIs('notes/note/owner')
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'old-after-focus-cycle'))
    await page.waitForTimeout(150)
    expect((await snapshot()).panels.map((panel:any)=>panel.route)).toEqual(['home','notes/note/owner'])
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[],messages:[]})
  })

  browserTest('the current new-panel create retains its own committed focus and delayed prefill',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>{
      (window as any).ui001nav.holdActionTimers()
      void (window as any).ui001nav.navigate('action/new-session?input=new-panel',{newPanel:true})
    })
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'created-new-panel'))
    await page.waitForFunction(()=>(window as any).ui001nav.timers()===1)
    await routeIs('allSessions/session/created-new-panel')
    expect((await snapshot()).panels.map((panel:any)=>panel.route)).toEqual(['home','allSessions/session/created-new-panel'])
    await page.evaluate(()=>(window as any).ui001nav.fireActionTimers())
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[{id:'created-new-panel',input:'new-panel'}],messages:[]})
  })

  browserTest('current create actions still navigate, rename, prefill and send using actual callbacks',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>{
      (window as any).ui001nav.holdActionTimers()
      void (window as any).ui001nav.navigate('action/new-session?name=renamed&input=prefill')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'current-prefill'))
    await page.waitForFunction(()=>(window as any).ui001nav.timers()===1)
    await routeIs('allSessions/session/current-prefill')
    await page.evaluate(()=>(window as any).ui001nav.fireActionTimers())
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({
      commands:[{id:'current-prefill',command:{type:'rename',name:'renamed'}}],inputs:[{id:'current-prefill',input:'prefill'}],messages:[],
    })
    await page.evaluate(()=>{
      (window as any).ui001nav.holdActionTimers()
      void (window as any).ui001nav.navigate('action/new-session?input=send&send=true')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===2)
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(1,'current-send'))
    await page.waitForFunction(()=>(window as any).ui001nav.timers()===1)
    await routeIs('allSessions/session/current-send')
    await page.evaluate(()=>(window as any).ui001nav.fireActionTimers())
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toMatchObject({messages:[{id:'current-send',input:'send'}]})
  })

  browserTest('session-created metadata cannot steal a pending list-route new-chat action and its prefill',async()=>{
    await page.goto(base+'/?ws=a&route=allSessions%2Fsession%2Ffirst-a');await routeIs('allSessions/session/first-a')
    await page.evaluate(()=>(window as any).ui001nav.navigate('allSessions',{skipAutoSelect:true}));await routeIs('allSessions')
    await page.evaluate(()=>{
      (window as any).ui001nav.holdActionTimers()
      void (window as any).ui001nav.navigate('action/new-chat?input=from-list')
    })
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    await page.evaluate(()=>(window as any).ui001nav.publishSession('created-list'))
    await page.waitForTimeout(100)
    expect((await snapshot()).panels[0].route).toBe('allSessions')
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'created-list'))
    await page.waitForFunction(()=>(window as any).ui001nav.timers()===1)
    await routeIs('allSessions/session/created-list')
    await page.evaluate(()=>(window as any).ui001nav.fireActionTimers())
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[{id:'created-list',input:'from-list'}],messages:[]})
  })

  browserTest('retained deep-link listener cannot create or send in a former workspace',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'));await routeIs('allSessions/session/first-b')
    await page.waitForFunction(()=>(window as any).ui001nav.deepListeners().at(-1)?.workspaceId==='ws-b')
    const formerB=await page.evaluate(()=>(window as any).ui001nav.deepListeners().at(-1).index)
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-a','a'));await routeIs('home')
    await page.evaluate(index=>(window as any).ui001nav.deepRetained(index,{action:'new-session',actionParams:{input:'stale-b',send:'true'}}),formerB)
    await page.waitForTimeout(100)
    expect((await snapshot()).panels[0].route).toBe('home')
    expect(await page.evaluate(()=>(window as any).ui001nav.creations())).toEqual([])
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[],messages:[]})
  })

  browserTest('retained deep-link listeners stay disposed after workspace ABA and same-workspace readiness reinstall',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    const formerA=await page.evaluate(()=>(window as any).ui001nav.deepListeners().at(-1).index)
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-b','b'));await routeIs('allSessions/session/first-b')
    await page.evaluate(()=>(window as any).ui001nav.workspace('ws-a','a'));await routeIs('home')
    await page.evaluate(index=>(window as any).ui001nav.deepRetained(index,{view:'notes/note/stale-a'}),formerA)
    await page.waitForTimeout(100)
    expect((await snapshot()).panels[0].route).toBe('home')
    const before=await page.evaluate(()=>(window as any).ui001nav.deepListeners().at(-1).index)
    await page.evaluate(()=>(window as any).ui001nav.ready(true,false))
    await page.waitForFunction(index=>(window as any).ui001nav.deepListeners().at(-1).index>index,before)
    await page.evaluate(()=>(window as any).ui001nav.ready(true,true))
    await page.waitForFunction(index=>(window as any).ui001nav.deepListeners().at(-1).index>index+1,before)
    await page.evaluate(index=>(window as any).ui001nav.deepRetained(index,{view:'notes/note/stale-same-owner'}),before)
    await page.waitForTimeout(100)
    expect((await snapshot()).panels[0].route).toBe('home')
    expect(await page.evaluate(()=>(window as any).ui001nav.creations())).toEqual([])
  })

  browserTest('current deep-link listener retains raw query views and executes current action parameters',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    const raw='unknown/leaf?x=%ZZ&nested=a%2Fb'
    await page.evaluate(view=>(window as any).ui001nav.deepPayload({view}),raw);await routeIs(raw)
    expect((await snapshot()).nav).toMatchObject({navigator:'unavailable',route:raw})
    expect(new URL(page.url()).searchParams.get('route')).toBe(raw)
    await page.evaluate(()=>{
      (window as any).ui001nav.holdActionTimers()
      ;(window as any).ui001nav.deepPayload({action:'new-chat',actionParams:{name:'deep name',input:'hello &/%ZZ'}})
    })
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    expect(await page.evaluate(()=>(window as any).ui001nav.creations())).toEqual([{workspaceId:'ws-a'}])
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'current-deep'))
    await page.waitForFunction(()=>(window as any).ui001nav.timers()===1)
    await routeIs('allSessions/session/current-deep')
    await page.evaluate(()=>(window as any).ui001nav.fireActionTimers())
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({
      commands:[{id:'current-deep',command:{type:'rename',name:'deep name'}}],inputs:[{id:'current-deep',input:'hello &/%ZZ'}],messages:[],
    })
  })

  browserTest('remote-only ownership rotation installs a current deep-link listener with stable callbacks',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    const initial=await page.evaluate(()=>(window as any).ui001nav.deepListeners().at(-1).index)
    await page.evaluate(()=>(window as any).ui001nav.remote(null))
    await page.waitForFunction(index=>{
      const current=(window as any).ui001nav.deepListeners().at(-1)
      return current.index>index&&current.workspaceId==='ws-a'&&current.remoteWorkspaceId===null
    },initial)
    await page.evaluate(()=>(window as any).ui001nav.deep('notes/note/current-local-owner'))
    await routeIs('notes/note/current-local-owner')
    const local=await page.evaluate(()=>(window as any).ui001nav.deepListeners().at(-1).index)
    await page.evaluate(()=>(window as any).ui001nav.remote('remote-new'))
    await page.waitForFunction(index=>{
      const current=(window as any).ui001nav.deepListeners().at(-1)
      return current.index>index&&current.workspaceId==='ws-a'&&current.remoteWorkspaceId==='remote-new'
    },local)
    await page.evaluate(()=>{
      (window as any).ui001nav.holdActionTimers()
      ;(window as any).ui001nav.deepPayload({action:'new-chat',actionParams:{input:'current-remote-owner'}})
    })
    await page.waitForFunction(()=>(window as any).ui001nav.creations().length===1)
    expect(await page.evaluate(()=>(window as any).ui001nav.creations())).toEqual([{workspaceId:'ws-a'}])
    await page.evaluate(()=>(window as any).ui001nav.resolveCreate(0,'created-remote-owner'))
    await page.waitForFunction(()=>(window as any).ui001nav.timers()===1)
    await routeIs('allSessions/session/created-remote-owner')
    await page.evaluate(()=>(window as any).ui001nav.fireActionTimers())
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[{id:'created-remote-owner',input:'current-remote-owner'}],messages:[]})
  })

  browserTest('retained remote-owner listeners cannot navigate create or send after remote-only ABA',async()=>{
    await page.goto(base+'/?ws=a&route=home');await routeIs('home')
    const former=await page.evaluate(()=>(window as any).ui001nav.deepListeners().at(-1).index)
    await page.evaluate(()=>(window as any).ui001nav.remote('remote-new'))
    await page.waitForFunction(index=>(window as any).ui001nav.deepListeners().at(-1).index>index,former)
    const intervening=await page.evaluate(()=>(window as any).ui001nav.deepListeners().at(-1).index)
    await page.evaluate(()=>(window as any).ui001nav.remote('remote-a'))
    await page.waitForFunction(index=>(window as any).ui001nav.deepListeners().at(-1).index>index,intervening)
    await page.evaluate(({former,intervening})=>{
      for(const index of [former,intervening]){
        (window as any).ui001nav.deepRetained(index,{view:'notes/note/stale-remote-owner'})
        ;(window as any).ui001nav.deepRetained(index,{action:'new-session',actionParams:{input:'stale-remote-owner',send:'true'}})
      }
    },{former,intervening})
    await page.waitForTimeout(100)
    expect((await snapshot()).panels[0].route).toBe('home')
    expect(await page.evaluate(()=>(window as any).ui001nav.creations())).toEqual([])
    expect(await page.evaluate(()=>(window as any).ui001nav.actionCalls())).toEqual({commands:[],inputs:[],messages:[]})
    await page.evaluate(()=>(window as any).ui001nav.deep('notes/note/current-after-remote-aba'))
    await routeIs('notes/note/current-after-remote-aba')
  })

})
