import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { resolveChromiumExecutable } from '../../../../../test-utils/chromium-executable'

// Real renderer components and DOM; the native transport is an isolated explicit fixture.
// This is component evidence, not a macOS microphone or full App acceptance claim.
const root = resolve(import.meta.dir, '../../../../../../../../..')
let server: Server, browser: Browser, base: string
const stubs: Record<string, string> = {
  'react-i18next': `export const useTranslation=()=>({t:(key,options)=>key,i18n:{language:'en',resolvedLanguage:'en'}});`,
  '@/contexts/NavigationContext': `export const useNavigation=()=>({navigateToSession:()=>{}});`,
  '@/lib/navigate': `export const routes={view:{meetings:id=>id,connections:()=>null,automations:()=>null}}; export const navigate=id=>window.fixture.select(id);`,
  '@rox/shared/i18n': `export const getAppLocale=()=> 'en';`,
  '@/lib/meetings/recorder': `export const meetingsApi=()=>window.electronAPI.meetingsLocal;
    export const useRecorder=()=>({status:'idle',meetingId:null}); export const recordedMs=()=>0;
    export const clearRecorderError=()=>{}; export const startRecording=async()=>{window.fixture.mutations.push('record');return {ok:false,code:'fixture'}};
    export const pauseRecording=()=>window.fixture.mutations.push('pause'); export const resumeRecording=()=>window.fixture.mutations.push('resume');
    export const stopRecording=()=>window.fixture.mutations.push('stop');`,
  '@/lib/meetings/auto-extraction': `export const extractionBusy=()=>false; export const startMeetingExtraction=async()=>window.fixture.mutations.push('extract');`,
  '@/lib/extra-screens/storage': `export const newLocalId=()=> 'fixture-id'; export const subscribeWorkspaceJson=()=>()=>{};`,
  '@/lib/extra-screens/personal-task-bridge': `const refuse=async()=>{window.fixture.mutations.push('task');throw new Error('Unexpected task mutation in read-only native surface fixture')}; export const createPersonalTask=refuse; export const createPersonalTaskConfirmed=refuse;`,
  'decisions-store': `export const DECISIONS_NS='fixture'; export const loadDecisions=()=>({decisions:[],candidates:[],extractions:[]}); export const saveDecisions=()=>window.fixture.mutations.push('decision'); export const removeDecisionLessons=async()=>{}; export const syncDecisionLessons=async()=>[];`,
  'AutomationsListPanel': `import * as React from 'react'; export const AutomationSwitch=({checked,onToggle,label})=><button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onToggle}>switch</button>;`,
  sonner: `export const toast={error(){},success(){}};`,
}

async function bundle() {
  const contents = `
    import * as React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import MeetingsPage from './apps/electron/src/renderer/pages/MeetingsPage';
    import {buildSummaryPrompt} from './apps/electron/src/renderer/pages/meetings/local-meetings-model';
    import {AutomationEditor} from './apps/electron/src/renderer/components/automations/AutomationEditor';
    import {TourRuntimeContext,TourPanelScope} from './apps/electron/src/renderer/features/product-tour/runtime/hooks';
    const emptyMeeting={schema:1,id:'meeting-a',title:'Native fixture meeting',workspaceId:'ws-a',createdAt:1,updatedAt:10,durationMs:0,status:'ready',source:'none',participants:[],notes:'',audio:null,transcript:{status:'none',progress:0},summary:null,actions:[],documents:[]};
    const automation={id:'automation-a',event:'SchedulerTick',matcherIndex:0,name:'Native automation',summary:'',enabled:false,cron:'0 9 * * *',timezone:'Europe/Moscow',permissionMode:'safe',actions:[{type:'prompt',prompt:'Native stored prompt'}],revision:'native-revision'};
    const f=window.fixture={workspaceId:'ws-a',panelId:'panel-a',surface:'meetings',selectedId:null,enabled:true,runToken:null,meeting:emptyMeeting,mutations:[],events:[],accepted:[],capabilities:{},targets:{},delayTranscript:false};
    let deferredTranscript;
    const api={
      list:async()=>[f.meeting],engine:async()=>({ready:false,missing:[],engine:null,binary:null,model:null,modelPath:null,ffmpeg:null}),onChanged:()=>()=>{},
      readAudio:async()=>null,readTranscript:()=>f.delayTranscript?new Promise(resolve=>{deferredTranscript=resolve}):Promise.resolve(null),
      update:async()=>{f.mutations.push('meeting-update');return f.meeting},create:async()=>{f.mutations.push('meeting-create');return f.meeting},
      importAudio:async()=>{f.mutations.push('import');return null},micAccess:async()=>{f.mutations.push('mic');return 'denied'},recStart:async()=>{f.mutations.push('recStart');return {ok:false,code:'denied'}}
    };
    window.electronAPI={meetingsLocal:api,listLlmConnections:async()=>[],onAutomationsChanged:()=>()=>{},
      updateAutomation:async()=>{f.mutations.push('save');return {}},testAutomation:async()=>{f.mutations.push('run');return {actions:[{success:true}]}},
      duplicateAutomation:async()=>{f.mutations.push('duplicate');return null}};
    const runtime={enabled:true,capture(scope){return f.runToken?{binding:{...scope,clientProfileId:'fixture',runToken:f.runToken},operationToken:crypto.randomUUID(),at:Date.now()}:null},
      emit(signal){f.events.push(signal);if(signal.binding.runToken===f.runToken&&signal.binding.workspaceId===f.workspaceId&&signal.binding.panelId===f.panelId&&signal.binding.entityId===f.selectedId)f.accepted.push(signal)},
      register(target){f.targets[target.id]=target;return()=>{if(f.targets[target.id]?.registrationToken===target.registrationToken)delete f.targets[target.id]}},
      setCapability(scope,id,value){const record={scope,value};f.capabilities[id]=record;return()=>{if(f.capabilities[id]===record)delete f.capabilities[id]}}};
    const root=createRoot(document.getElementById('root'));
    f.render=()=>flushSync(()=>root.render(<React.StrictMode><TourRuntimeContext.Provider value={f.enabled?runtime:null}><TourPanelScope workspaceId={f.workspaceId} panelId={f.panelId} entityId={f.selectedId??undefined}>{f.surface==='meetings'?<MeetingsPage key={f.workspaceId} workspaceId={f.workspaceId} selectedId={f.selectedId}/>:<AutomationEditor automation={automation} workspaceId={f.workspaceId}/>}</TourPanelScope></TourRuntimeContext.Provider></React.StrictMode>));
    f.select=id=>{f.selectedId=id??null;f.render()};
    f.start=token=>{f.runToken=token??'run-a';f.render()};
    f.previewProfile=()=>buildSummaryPrompt({title:f.meeting.title,participants:[],segments:[],language:'en',recipeId:'client',slash:'/client'});
    f.finishTranscript=()=>deferredTranscript?.({engine:'fixture',model:'fixture',language:'en',createdAt:10,elapsedMs:1,revision:1,segments:[{id:'segment-a',startMs:0,endMs:1000,text:'Private fixture transcript'}]});
    f.mount=(surface,mode)=>{f.surface=surface;f.selectedId=surface==='automation'?'automation-a':mode==='empty'?null:'meeting-a';
      f.meeting=mode==='summary'?{...emptyMeeting,summary:{text:'Private native summary',generated:false,updatedAt:10}}:mode==='action'?{...emptyMeeting,actions:[{id:'action-a',text:'Existing native action',done:false,createdAt:1}]}:mode==='transcript'?{...emptyMeeting,audio:{file:'fixture.webm',mimeType:'audio/webm',bytes:100},transcript:{status:'done',progress:1,segments:1,revision:1,finishedAt:10}}:emptyMeeting;
      f.delayTranscript=mode==='transcript';f.render()};
    f.inspect=()=>({mutations:f.mutations,events:f.events,accepted:f.accepted,capabilities:f.capabilities,
      targets:Object.fromEntries(Object.entries(f.targets).map(([id,t])=>[id,{context:t.context,testId:t.element.dataset.testid,role:t.element.getAttribute('role'),connected:t.element.isConnected}]))});
    f.unmount=()=>flushSync(()=>root.unmount());
  `
  return (await build({ stdin: { contents, resolveDir: root, sourcefile: 'a11-native-ui-fixture.tsx', loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: resolve(root, 'apps/electron/tsconfig.json'),
    plugins: [{ name: 'isolated-native-transport', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.path === '@/context/AppShellContext' || args.path === '@/lib/extra-screens/personal-task-bridge') {
          return { path: resolve(import.meta.dir, 'native-boundaries.fixture.ts') }
        }
        // The real pure recipe/planning modules avoid the barrel's host-only artifact I/O.
        // Keep native components and planning logic intact; only narrow their import entry.
        if (args.path === '@rox/shared/meeting-agents') {
          return { path: resolve(root, 'packages/shared/src/meeting-agents',
            args.importer.endsWith('/LocalMeetingDetail.tsx') ? 'recipes.ts' : 'planning.ts') }
        }
        const name = stubs[args.path] ? args.path : args.path.endsWith('/decisions-store') ? 'decisions-store'
          : args.path.endsWith('/AutomationsListPanel') ? 'AutomationsListPanel' : null
        return name ? { path: name, namespace: 'fixture' } : null
      })
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path]!, loader: 'tsx', resolveDir: root }))
      builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'text' }))
    } }],
  })).outputFiles[0]!.text
}

beforeAll(async () => {
  const source = await bundle()
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/fixture.js' ? 'application/javascript' : 'text/html')
    res.end(req.url === '/fixture.js' ? source : '<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutable(), args: ['--no-sandbox'] })
}, 30_000)

afterAll(async () => { await browser?.close(); server?.close() }, 30_000)

async function fixture(surface: 'meetings' | 'automation', mode = 'empty') {
  const page = await browser.newPage()
  await page.goto(base)
  await page.evaluate(([surface, mode]) => (window as any).fixture.mount(surface, mode), [surface, mode])
  await page.waitForFunction(() => (window as any).fixture.capabilities['meetings.available']?.value.state === 'ready'
    || (window as any).fixture.capabilities['automations.available']?.value.state === 'ready')
  return page
}
const inspect = (page: Page) => page.evaluate(() => (window as any).fixture.inspect())

describe('A11 rendered native surfaces', () => {
  it('DOMAIN-18/T-MEETINGS-LIST: Start/replay stays read-only; no artifact remains pending', async () => {
    const page = await fixture('meetings')
    for (const token of ['run-a', 'run-b']) await page.evaluate(token => (window as any).fixture.start(token), token)
    const state = await inspect(page)
    expect(state.targets['meetings.list'].testId).toBe('meetings-list')
    expect(state.targets['meetings.list'].connected).toBe(true)
    expect(state.capabilities['meeting.artifact-present'].value).toEqual({ state: 'pending', reason: 'missing-entity' })
    expect(state.targets['meetings.artifacts']).toBeUndefined()
    expect(state.events).toEqual([])
    expect(state.mutations).toEqual([])
    await page.close()
  })

  it('T-MEETINGS-RESULT: opening loaded native content emits observed evidence only', async () => {
    const page = await fixture('meetings', 'summary')
    expect((await inspect(page)).events).toEqual([])
    await page.evaluate(() => (window as any).fixture.start())
    await page.getByRole('tab', { name: 'meetings.local.tab.overview' }).click()
    const state = await inspect(page)
    expect(state.targets['meetings.artifacts'].testId).toBe('meeting-summary')
    expect(state.accepted).toHaveLength(1)
    expect(state.accepted[0].name).toBe('meeting.artifact-opened')
    expect(state.accepted[0].level).toBe('observed')
    expect(JSON.stringify(state.events)).not.toContain('Private native summary')
    expect(await page.getByTestId('meeting-analysis-profile').locator('option').count()).toBe(5)
    // Execute the latest production view model and actual planner in Chromium.
    expect(await page.evaluate(() => (window as any).fixture.previewProfile()))
      .toContain('Role perspectives: rox.meeting.analyst, rox.meeting.scribe.')
    await page.getByRole('tab', { name: 'meetings.local.tab.actions' }).click()
    expect((await inspect(page)).events).toHaveLength(1)
    expect((await inspect(page)).mutations).toEqual([])
    await page.close()
  })

  it('T-MEETINGS-RESULT: a mounted native action conversion stays idle on Start and replay', async () => {
    const page = await fixture('meetings', 'action')
    await page.evaluate(() => (window as any).fixture.start('run-a'))
    expect((await inspect(page)).events).toEqual([])
    expect((await inspect(page)).mutations).toEqual([])
    await page.getByRole('tab', { name: 'meetings.local.tab.actions' }).click()
    expect(await page.getByTestId('meeting-action-to-task').isVisible()).toBe(true)
    const opened = await inspect(page)
    expect(opened.accepted).toHaveLength(1)
    expect(opened.accepted[0].name).toBe('meeting.artifact-opened')
    expect(opened.accepted[0].level).toBe('observed')
    for (const token of ['run-b', 'run-c']) await page.evaluate(token => (window as any).fixture.start(token), token)
    expect((await inspect(page)).events).toHaveLength(1)
    expect((await inspect(page)).mutations).toEqual([])
    await page.close()
  })

  it('T-MEETINGS-RESULT: a delayed native load cannot finish a replay or another panel', async () => {
    const page = await fixture('meetings', 'transcript')
    await page.evaluate(() => (window as any).fixture.start('run-old'))
    await page.getByRole('tab', { name: 'meetings.local.tab.transcript' }).click()
    expect((await inspect(page)).events).toEqual([])
    await page.evaluate(() => { (window as any).fixture.start('run-new'); (window as any).fixture.finishTranscript() })
    await page.getByTestId('meeting-transcript').waitFor()
    await page.waitForFunction(() => (window as any).fixture.events.length === 1)
    const state = await inspect(page)
    expect(state.events[0].binding.runToken).toBe('run-old')
    expect(state.accepted).toEqual([])
    expect(state.mutations).toEqual([])
    await page.close()
  })

  it('T-MEETINGS-RESULT: changing the panel rejects a pending artifact load', async () => {
    const page = await fixture('meetings', 'transcript')
    await page.evaluate(() => (window as any).fixture.start())
    await page.getByRole('tab', { name: 'meetings.local.tab.transcript' }).click()
    await page.evaluate(() => { const f = (window as any).fixture; f.panelId = 'foreign-panel'; f.render(); f.finishTranscript() })
    await page.getByTestId('meeting-transcript').waitFor()
    const state = await inspect(page)
    expect(state.events).toEqual([])
    expect(state.accepted).toEqual([])
    expect(state.targets['meetings.artifacts'].context.panelId).toBe('foreign-panel')
    await page.close()
  })

  it('DOMAIN-19/T-AUTOMATION-TRIGGER/ACTION/CONTROL: real section refs and schedule stay read-only', async () => {
    const page = await fixture('automation')
    await page.evaluate(() => (window as any).fixture.start())
    const state = await inspect(page)
    expect(state.targets['automation.trigger'].testId).toBe('automation-step-when')
    expect(state.targets['automation.action'].testId).toBe('automation-step-do')
    expect(state.targets['automation.controls'].connected).toBe(true)
    expect(state.capabilities['automation.entity-present'].value).toEqual({ state: 'ready' })
    expect(await page.locator('select').filter({ has: page.locator('option[value="Europe/Moscow"]') }).inputValue()).toBe('Europe/Moscow')
    expect(await page.locator('.rox-autom-note').filter({ hasText: 'automations.nextRuns' }).count()).toBe(1)
    expect(state.events).toEqual([])
    expect(state.mutations).toEqual([])
    // An explicit Save remains a native save; it does not become a run or tour success.
    await page.getByTestId('automation-prompt').fill('User changed native prompt')
    await page.getByTestId('automation-save').click()
    expect((await inspect(page)).mutations).toEqual(['save'])
    expect((await inspect(page)).events).toEqual([])
    await page.getByTestId('automation-run-now').click()
    expect((await inspect(page)).mutations).toContain('run')
    expect((await inspect(page)).events).toEqual([])
    await page.close()
  })

  it('flag-off and unmount clean target/capability registrations', async () => {
    const page = await fixture('meetings', 'summary')
    await page.evaluate(() => { (window as any).fixture.enabled = false; (window as any).fixture.render() })
    const state = await inspect(page)
    expect(state.targets).toEqual({})
    expect(state.capabilities).toEqual({})
    expect(state.mutations).toEqual([])
    await page.evaluate(() => (window as any).fixture.unmount())
    expect((await inspect(page)).targets).toEqual({})
    await page.close()
  })

  it('T-AUTOMATION-TRIGGER/ACTION/CONTROL: a foreign selection cannot relabel the native entity', async () => {
    const page = await fixture('automation')
    await page.evaluate(() => { const f = (window as any).fixture; f.selectedId = 'foreign-automation'; f.render() })
    const state = await inspect(page)
    for (const id of ['automation.trigger', 'automation.action', 'automation.controls']) {
      expect(state.targets[id].context.entityId).toBe('automation-a')
    }
    expect(state.capabilities['automation.entity-present'].value).toEqual({ state: 'pending', reason: 'missing-entity' })
    expect(state.events).toEqual([])
    expect(state.mutations).toEqual([])
    await page.close()
  })
})
