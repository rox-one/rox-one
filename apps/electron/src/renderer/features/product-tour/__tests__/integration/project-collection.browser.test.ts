import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { runNativeBrowserProcess } from '../../adapters/work/meetings-automations/native-browser-process'
import { resolveChromiumExecutable } from '../../../../test-utils/chromium-executable'

const root = resolve(import.meta.dir, '../../../../../../../..')
const isolatedCase = process.env.ROX_PRODUCT_TOUR_PROJECT_COLLECTION_CASE
let browser: Browser
let server: ReturnType<typeof Bun.serve>
beforeAll(async () => {
  if (!isolatedCase) return
  const compiled = process.env.ROX_PROJECT_COLLECTION_BASELINE_BUNDLE ? null : await build({
    entryPoints: [resolve(import.meta.dir, 'fixtures/project-collection.browser.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: resolve(root, 'apps/electron/tsconfig.json'),
    loader: { '.css': 'empty', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
    plugins: [{ name: 'readonly-component-bootstrap', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.path.endsWith('?url')) return { path: 'asset', namespace: 'test-only' }
        if (['@/contexts/NavigationContext', 'react-i18next', '@/actions/useHotkeyLabel', '@/context/AppShellContext', '@/lib/navigate',
          '@/context/ThemeContext', '@rox/shared/projects', '@rox/core/rox2', '@/components/projects/SharedProjectProjection', '@/components/app-shell/PanelHeader', '@/lib/personal-tasks', '@/pages/ProjectRoadmapPage'].includes(args.path)
          || args.path === './ProjectRoadmapPage') return { path: args.path, namespace: 'test-only' }
        return null
      })
      builder.onLoad({ filter: /.*/, namespace: 'test-only' }, args => {
        const common = `import * as React from 'react';const f=new Proxy({},{get:(_,key)=>window.projectCollectionTest[key]});`
        const contents = args.path === '@/contexts/NavigationContext' ? `${common}export const useNavigation=()=>React.useSyncExternalStore(f.subscribe,()=>f.navigation);export const useNavigationState=()=>useNavigation().navigationState;export const isSessionsNavigation=n=>n?.navigator==='sessions';`
          : args.path === 'react-i18next' ? `const t=key=>key;const i18n={language:'en'};export const useTranslation=()=>({t,i18n});`
          : args.path === '@/actions/useHotkeyLabel' ? `export const useHotkeyLabel=()=>null;`
          : args.path === '@/context/AppShellContext' ? `${common}export const useActiveWorkspace=()=>({id:f.workspaceId,name:'Owned readonly bootstrap'});export const useAppShellContext=()=>({onCreateSession:()=>{throw new Error('Unexpected write')},onOpenFile:()=>{}});`
          : args.path === '@/lib/navigate' ? `${common}export {routes} from '${resolve(root, 'apps/electron/src/shared/routes.ts')}';export const navigate=route=>f.navigate(route);`
          : args.path === '@/context/ThemeContext' ? `export const useTheme=()=>({isDark:false});`
          : args.path === '@rox/shared/projects' ? `export const calculateOkrCycle=()=>{throw new Error('Unexpected OKR calculation in empty readonly bootstrap')};export const createOkrCycle=()=>{throw new Error('Unexpected OKR write')};`
          : args.path === '@rox/core/rox2' ? `export {isClaimableLive} from '${resolve(root,'packages/core/src/rox2/platform-contract.ts')}';export {soupProjectActResult,soupProjectListResult,soupProjectReadResult} from '${resolve(root,'packages/core/src/rox2/soup-native-actions.ts')}';`
          : args.path === '@/components/projects/SharedProjectProjection' ? `${common}export const SharedProjectsSection=()=>null;export const SharedProjectDetails=()=>null;`
          : args.path === '@/components/app-shell/PanelHeader' ? `${common}export const PanelHeader=props=><header>{props.title}{props.actions}</header>;`
          : args.path === '@/lib/personal-tasks' ? `import {PersonalTaskStore} from '${resolve(root, 'packages/core/src/tasks/personal/index.ts')}';export const loadPersonalTaskStore=()=>new PersonalTaskStore();export const persistPersonalTaskStore=()=>{throw new Error('Unexpected write')};export const subscribePersonalTasks=()=>()=>{};export const tasksForWorkspaceProject=()=>[];`
          : args.path === 'asset' ? `export default 'about:blank';`
          : `${common}export default function ReadonlyRoadmap(){return null}`
        return { contents, loader: 'tsx', resolveDir: root }
      })
    } }],
  })
  const script = compiled?.outputFiles[0]!.text ?? await readFile(process.env.ROX_PROJECT_COLLECTION_BASELINE_BUNDLE!, 'utf8')
  if (process.env.ROX_PROJECT_COLLECTION_SAVE_BUNDLE) await Bun.write(process.env.ROX_PROJECT_COLLECTION_SAVE_BUNDLE, script)
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new URL(request.url).pathname === '/script.js' ? new Response(script, { headers: { 'Content-Type': 'application/javascript' } })
      : new Response('<!doctype html><html><head><style>svg{width:16px;height:16px}.pt-6{padding-top:24px}button{padding:6px}header{padding:10px}h2{margin:8px 0}[data-product-tour-popover]{background:white;border:1px solid black;width:240px;padding:12px}</style></head><body><div id="root"></div><script src="/script.js"></script></body></html>', {headers:{'Content-Type':'text/html'}})
  } })
  browser = await chromium.launch({ executablePath: await resolveChromiumExecutable(), args: ['--no-sandbox'] })
}, 30_000)
afterAll(async () => { await browser?.close(); server?.stop(true) })
function browserTest(name: string, operation: (page: Page) => Promise<void>) {
  if (isolatedCase && isolatedCase !== name) return
  test(name, async () => {
    if (!isolatedCase) {
      expect(await runNativeBrowserProcess([process.execPath, 'test', fileURLToPath(import.meta.url)], {
        label: name, env: { ...process.env, ROX_PRODUCT_TOUR_PROJECT_COLLECTION_CASE: name }, deadlineMs: 35_000,
      })).toBe(0)
      return
    }
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
    page.setDefaultTimeout(6000)
    page.on('pageerror', error => console.error('Project/collection fixture error:', error.message))
    try { await page.goto(server.url.href); await page.waitForFunction(() => (window as any).projectCollectionTest?.controller?.ready); await operation(page) }
    catch(error) { console.error('Provider state:', JSON.stringify(await page.evaluate(()=> {const f=(window as any).projectCollectionTest;return {phase:f?.controller?.state.phase,attempt:f?.controller?.state.attempt,evidence:f?.controller?.state.attemptEvidence,capability:f?.controller?.capabilities['projects.available'],body:document.body.innerText}}))); throw error }
    finally { await page.close() }
  }, isolatedCase ? 30_000 : 40_000)
}
const state = (page: Page) => page.evaluate(() => (window as any).projectCollectionTest.controller.state)
async function startProject(page: Page, empty = false) {
  await page.evaluate(async empty => { const f = (window as any).projectCollectionTest; await f.reset('projects', empty); return f.controller.start('OBT-14') }, empty)
  await page.waitForFunction(() => (window as any).projectCollectionTest.controller.state.attempt?.stepId === 'project.open')
}
async function startWorkflow(page: Page) {
  await page.evaluate(async () => { const f = (window as any).projectCollectionTest; await f.reset('workflow'); return f.controller.start('OBT-13') })
  await page.waitForSelector('[data-product-tour-step="workflow.status"]')
  await page.getByRole('button', { name: 'Seed prior status' }).click()
  await page.waitForSelector('[data-product-tour-step="workflow.label"]')
  await page.getByRole('button', { name: 'Seed prior label' }).click()
  await page.waitForSelector('[data-product-tour-step="workflow.board"]')
}
browserTest('T-PROJECT-OPEN list rows never complete opening', async page => {
  await startProject(page)
  await page.waitForSelector('[data-product-tour-step="project.open"]')
  expect((await state(page)).attemptEvidence['project.open']?.level).toBeUndefined()
})
browserTest('T-PROJECT-OPEN an empty API-ready list retains the ordinary create path', async page => {
  await startProject(page, true)
  await page.waitForSelector('[data-product-tour-step="project.open"]')
  expect((await state(page)).phase).not.toBe('blocked')
  await page.getByRole('button', { name: 'projectsList.addProject', exact: true }).click()
  expect((await state(page)).attemptEvidence['project.open']?.level).toBeUndefined()
})
browserTest('T-PROJECT-OPEN pending detail remains eligible and evidence requires the actually rendered native detail', async page => {
  await startProject(page)
  await page.waitForSelector('[data-product-tour-step="project.open"]')
  await page.evaluate(() => { (window as any).projectCollectionTest.loadingProject = true })
  await page.getByText('Actually opened project', { exact: true }).first().click()
  await page.waitForFunction(() => !!(window as any).projectCollectionTest.resolveProject)
  expect((await state(page)).phase).not.toBe('blocked')
  expect((await state(page)).attemptEvidence['project.open']?.level).toBeUndefined()
  await page.evaluate(() => (window as any).projectCollectionTest.resolveProject())
  await page.waitForSelector('h2:has-text("Actually opened project")')
  await page.waitForFunction(() => (window as any).projectCollectionTest.controller.state.attemptEvidence['project.open']?.level === 'observed')
  expect((await state(page)).attempt?.stepId).toBe('project.open')
})
browserTest('T-WORKFLOW-BOARD original session attempt survives list-to-board host replacement and emits mounted evidence once', async page => {
  await startWorkflow(page)
  const binding = (await state(page)).attempt.binding
  const captureCount = await page.evaluate(()=> (window as any).projectCollectionTest.viewCaptures.length)
  await page.getByRole('button', { name: 'collection.view.cycleNext', exact: true }).click()
  await page.waitForSelector('[data-actual-collection-view="board"]')
  await page.waitForFunction(() => (window as any).projectCollectionTest.controller.state.attemptEvidence['workflow.board']?.level === 'observed')
  expect((await state(page)).attempt.binding).toEqual(binding)
  await page.waitForSelector('[data-product-tour-step="workflow.board"]')
  const proof = await page.evaluate(index => { const f=(window as any).projectCollectionTest; const target=f.registeredViews.findLast((target:any)=>target.element.isConnected); return { original:f.viewCaptures[index], events:f.viewSignals, targetContext:target?.context, view:target?.element.closest('[data-actual-collection-view]')?.dataset.actualCollectionView } }, captureCount)
  expect(proof.events).toHaveLength(1)
  expect(proof.events[0].operationToken).toBe(proof.original.operationToken)
  expect(proof.events[0].binding).toEqual(binding)
  expect(proof.view).toBe('board')
  expect(proof.targetContext.sessionId).toBeUndefined()
  expect((await state(page)).phase).not.toBe('paused')
  await page.evaluate(() => (window as any).projectCollectionTest.render())
  expect((await state(page)).attemptEvidence['workflow.board']?.level).toBe('observed')
})
browserTest('T-WORKFLOW-BOARD unmatched manual view navigation pauses without emitting a destination success', async page => {
  await startWorkflow(page)
  await page.evaluate(() => (window as any).projectCollectionTest.navigate('table'))
  await page.waitForFunction(() => (window as any).projectCollectionTest.controller.state.phase === 'paused')
  expect((await state(page)).attemptEvidence['workflow.board']?.level).toBeUndefined()
})
browserTest('T-WORKFLOW-BOARD a paused request cannot complete a replay', async page => {
  await startWorkflow(page)
  await page.evaluate(() => { (window as any).projectCollectionTest.replaceImmediately = false })
  await page.getByRole('button', { name: 'collection.view.cycleNext', exact: true }).click()
  expect((await state(page)).attemptEvidence['workflow.board']?.level).toBeUndefined()
  await page.evaluate(() => (window as any).projectCollectionTest.controller.pause())
  await startWorkflow(page)
  await page.evaluate(() => (window as any).projectCollectionTest.navigate('board'))
  await page.waitForFunction(() => (window as any).projectCollectionTest.controller.state.phase === 'paused')
  expect((await state(page)).attemptEvidence['workflow.board']?.level).toBeUndefined()
})


browserTest('Projects readiness preserves empty successful reads, genuine denial and foreign projection rejection without tour requery', async page => {
  await startProject(page, true)
  const reads = await page.evaluate(()=> (window as any).projectCollectionTest.reads)
  await page.evaluate(()=> (window as any).projectCollectionTest.controller.pause())
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.reads)).toBe(reads)
  await page.evaluate(async()=>{const f=(window as any).projectCollectionTest; f.denyProjects=true; await f.refreshProjects()})
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state==='unavailable')
  await page.evaluate(()=>{const f=(window as any).projectCollectionTest; for(const callback of f.projectListeners)callback('foreign-workspace',[])})
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state)).toBe('unavailable')
  await page.evaluate(()=>{const f=(window as any).projectCollectionTest; for(const callback of f.projectListeners)callback(f.workspaceId,[])})
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state==='ready')
  expect((await state(page)).attemptEvidence['project.open']?.level).toBeUndefined()
})
browserTest('Empty project badges retain reader readiness but an absent assignment writer remains unavailable', async page => {
  await page.evaluate(()=>{const f=(window as any).projectCollectionTest; f.kind='badges'; f.render()})
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state==='ready')
  await page.evaluate(()=>{const f=(window as any).projectCollectionTest; f.projectWriter=false; f.render()})
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state==='unavailable')
  await page.evaluate(()=> (window as any).projectCollectionTest.refreshProjects())
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state)).toBe('unavailable')
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.writes)).toBe(0)
  await page.evaluate(()=>{const f=(window as any).projectCollectionTest; f.projectWriter=true; f.render()})
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state==='ready')
})
for(const mode of ['table','heatmap'] as const) browserTest(`T-WORKFLOW-BOARD actual ${mode} destination keeps original session custody and a no-op selection emits no additional success`, async page => {
  await startWorkflow(page)
  const binding=(await state(page)).attempt.binding
  const openMenu=()=>page.getByRole('button',{name:'collection.view.list / collection.view.board / collection.view.table / collection.view.heatmap',exact:true}).click()
  await openMenu()
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.state.phase==='handed-off')
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.nativeLayers().layers.length)).toBe(1)
  await page.getByRole('option',{name:`collection.view.${mode}`,exact:true}).click()
  await page.waitForSelector(`[data-actual-collection-view="${mode}"]`)
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.state.attemptEvidence['workflow.board']?.level==='observed')
  expect((await state(page)).attempt.binding).toEqual(binding)
  await page.waitForSelector('[data-product-tour-step="workflow.board"]')
  await openMenu()
  await page.getByRole('option',{name:`collection.view.${mode}`,exact:true}).click()
  await page.waitForSelector('[data-product-tour-step="workflow.board"]')
  expect((await state(page)).phase).not.toBe('paused')
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.viewSignals.length)).toBe(1)
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.nativeLayers().layers.length)).toBe(0)
  await openMenu()
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.state.phase==='handed-off')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-product-tour-step="workflow.board"]')
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.nativeLayers().layers.length)).toBe(0)
})
for(const obstruction of ['cover','clip'] as const) browserTest(`T-WORKFLOW-BOARD ${obstruction} prevents mounted-view success`, async page => {
  await startWorkflow(page)
  await page.evaluate(obstruction=>{const f=(window as any).projectCollectionTest; if(obstruction==='cover')f.coverDestination=true;else f.clipDestination=true},obstruction)
  await page.getByRole('button',{name:'collection.view.cycleNext',exact:true}).click()
  await page.waitForSelector('[data-actual-collection-view="board"]',{state:'attached'})
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
  expect((await state(page)).attemptEvidence['workflow.board']?.level).toBeUndefined()
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.viewSignals.length)).toBe(0)
})

browserTest('T-WORKFLOW-BOARD a captured request never authorizes a foreign selected session', async page => {
  await startWorkflow(page)
  await page.evaluate(()=>{(window as any).projectCollectionTest.replaceImmediately=false})
  await page.getByRole('button',{name:'collection.view.cycleNext',exact:true}).click()
  await page.evaluate(()=> (window as any).projectCollectionTest.navigate('board/session/foreign-session'))
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.state.phase==='paused')
  expect((await state(page)).attempt.binding.sessionId).toBe('session-a')
  expect((await state(page)).attemptEvidence['workflow.board']?.level).toBeUndefined()
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.viewSignals.length)).toBe(0)
})

browserTest('A failed owned project detail cannot be masked by successful list refresh, and leaving it restores reader readiness', async page => {
  await startProject(page)
  await page.waitForSelector('[data-product-tour-step="project.open"]')
  await page.evaluate(()=>{(window as any).projectCollectionTest.denyDetail=true})
  await page.getByText('Actually opened project',{exact:true}).first().click()
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state==='unavailable')
  await page.evaluate(()=> (window as any).projectCollectionTest.refreshProjects())
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state)).toBe('unavailable')
  expect((await state(page)).attemptEvidence['project.open']?.level).toBeUndefined()
  await page.evaluate(()=> (window as any).projectCollectionTest.navigate('projects'))
  await page.waitForFunction(()=> (window as any).projectCollectionTest.controller.capabilities['projects.available'].state==='ready')
})

browserTest('Disabled learning keeps the actual collection menu usable without tour-native layer registration or evidence', async page => {
  await startWorkflow(page)
  await page.evaluate(()=> (window as any).projectCollectionTest.controller.setEnabled(false))
  await page.waitForFunction(()=> !(window as any).projectCollectionTest.controller.enabled)
  await page.getByRole('button',{name:'collection.view.list / collection.view.board / collection.view.table / collection.view.heatmap',exact:true}).click()
  await page.waitForSelector('[role="listbox"]')
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.nativeLayers().layers.length)).toBe(0)
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.nativeLayers().modals.length)).toBe(0)
  await page.getByRole('option',{name:'collection.view.table',exact:true}).click()
  await page.waitForSelector('[data-actual-collection-view="table"]')
  expect(await page.evaluate(()=> (window as any).projectCollectionTest.viewSignals.length)).toBe(0)
})
