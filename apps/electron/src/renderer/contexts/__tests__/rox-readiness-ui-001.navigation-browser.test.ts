import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'

// Mounted production NavigationProvider + real React/Jotai/history. Only backend
// data and IPC transport are fixtures; native product proof lives in the separate
// Electron test. This opt-in test never claims Windows or hosted acceptance.
const enabled = process.env.ROX_UI001_BROWSER_TEST === '1'
const root = join(import.meta.dir, '../../../../../..')
let server: Server, browser: Browser, context: BrowserContext, page: Page, base: string

async function fixtureBundle() {
  const contents = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Provider, createStore, useAtomValue } from 'jotai';
    import { NavigationProvider, useNavigation } from './apps/electron/src/renderer/contexts/NavigationContext';
    import { sessionMetaMapAtom } from './apps/electron/src/renderer/atoms/sessions';
    import { usePages } from './apps/electron/src/renderer/hooks/usePages';
    import { pagesAtom } from './apps/electron/src/renderer/atoms/pages';
    import { panelStackAtom, focusedPanelRouteAtom } from './apps/electron/src/renderer/atoms/panel-stack';
    const store = createStore();
    let ready=true, sessionsReady=true, ws='ws-a', slug='a', deepLink;
    let state, pagesChanged;
    const pageRequests=[], pageSubscriptions=[], createRequests=[], commands=[], inputs=[], messages=[], scheduled=[];
    const nativeSetTimeout=window.setTimeout;
    window.electronAPI = {
      getPages: workspaceId=>new Promise(resolve=>pageRequests.push({workspaceId,resolve})),
      onPagesChanged: callback=>{pagesChanged=callback;pageSubscriptions.push(callback);return()=>{if(pagesChanged===callback)pagesChanged=undefined}},
      listLabels: async()=>[], onLabelsChanged: ()=>()=>{},
      onDeepLinkNavigate: callback=>{ deepLink=callback; return()=>{deepLink=undefined}; },
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
      return React.createElement('output',{'data-testid':'navigation', 'data-route':route, 'data-workspace':ws, 'data-ready':String(ready)},JSON.stringify({nav:state.navigationState,panels,revision:state.navigationRevision}));
    }
    const root=createRoot(document.getElementById('root'));
    function render() { root.render(React.createElement(Provider,{store},React.createElement(NavigationProvider,{
      workspaceId:ws, workspaceSlug:slug, remoteWorkspaceId:ws==='ws-a'?'remote-a':null,
      isReady:ready,isSessionsReady:sessionsReady,onSwitchWorkspaceBySlug(next){slug=next;ws='ws-'+next;render()},
      onCreateSession:workspaceId=>new Promise(resolve=>createRequests.push({workspaceId,resolve})),
      onInputChange:(id,input)=>{inputs.push({id,input})},
    },React.createElement(Probe)))); }
    window.ui001nav={
      navigate: (route,options)=>state.navigate(route,options),
      deep: view=>deepLink({view}),
      ready(value,sessions=value){ready=value;sessionsReady=sessions;render()},
      workspace(id, nextSlug){ws=id;slug=nextSlug;render()},
      delete(id){const next=new Map(store.get(sessionMetaMapAtom));next.delete(id);store.set(sessionMetaMapAtom,next)},
      pages(){return store.get(pagesAtom)},
      resolvePages(index,rows){pageRequests[index].resolve(rows)},
      emitPages(workspace,rows){pagesChanged(workspace,rows)},
      emitOldPages(index,workspace,rows){pageSubscriptions[index](workspace,rows)},
      resizePanels(){store.set(panelStackAtom,store.get(panelStackAtom).map(panel=>({...panel,proportion:0.75})))},
      creations(){return createRequests.map(request=>({workspaceId:request.workspaceId}))},
      resolveCreate(index,id){createRequests[index].resolve({id,workspaceId:createRequests[index].workspaceId})},
      actionCalls(){return{commands,inputs,messages}},
      holdActionTimers(){window.setTimeout=(callback,delay,...args)=>delay===100?(scheduled.push(()=>callback(...args)),scheduled.length):nativeSetTimeout(callback,delay,...args)},
      timers(){return scheduled.length},
      fireActionTimers(){window.setTimeout=nativeSetTimeout;scheduled.splice(0).forEach(callback=>callback())},
      snapshot(){return{nav:state.navigationState,panels:store.get(panelStackAtom),ws,slug}},
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
    browser=await chromium.launch({executablePath:process.env.ROX_UI001_CHROMIUM_EXECUTABLE,channel:process.env.ROX_UI001_CHROMIUM_EXECUTABLE?undefined:'chrome',headless:true})
  },30000)
  beforeEach(async()=>{context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(3000)})
  afterEach(async()=>{await context?.close()},15000)
  afterAll(async()=>{await browser?.close();server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()))},15000)

  browserTest('initial missing entity never auto-selects an existing chat and survives reload',async()=>{
    await page.goto(base+'/?ws=a&route=allSessions%2Fsession%2Fdeleted')
    await routeIs('allSessions/session/deleted')
    expect((await snapshot()).nav.details.sessionId).toBe('deleted')
    await page.reload();await routeIs('allSessions/session/deleted')
    await page.evaluate(()=>(window as any).ui001nav.navigate('allSessions/session/first-b'))
    await routeIs('allSessions/session/first-b')
    expect((await snapshot()).nav.details.sessionId).toBe('first-b')
    await page.evaluate(()=>(window as any).ui001nav.navigate('allSessions/session/remote'))
    await routeIs('allSessions/session/remote')
  })

  browserTest('unknown and malformed routes preserve raw addresses on initial load/reload/deep link',async()=>{
    for(const route of ['unknown/entity','allSessions/session/%E0%A4%A','notes/note/id/extra','action/copy?text=unsafe']){
      await page.goto(base+'/?ws=a&route='+encodeURIComponent(route));await routeIs(route)
      expect((await snapshot()).nav).toMatchObject({navigator:'unavailable',route})
      await page.reload();await routeIs(route)
      expect((await snapshot()).nav.navigator).toBe('unavailable')
    }
    await page.evaluate(()=>(window as any).ui001nav.deep('other/raw%ZZ'))
    await routeIs('other/raw%ZZ')
    expect(new URL(page.url()).searchParams.get('route')).toBe('other/raw%ZZ')
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
      (window as any).ui001nav.resolveCreate(0,'late-prefill')
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
})
