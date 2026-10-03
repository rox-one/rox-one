import { after, afterEach as nodeAfterEach, before, beforeEach as nodeBeforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
const beforeAll = (run: () => Promise<void>, timeout: number) => before(run, { timeout })
const afterAll = (run: () => Promise<void>, timeout: number) => after(run, { timeout })
const beforeEach = (run: () => Promise<void>, timeout: number) => nodeBeforeEach(run, { timeout })
const afterEach = (run: () => Promise<void>, timeout: number) => nodeAfterEach(run, { timeout })
const expect = (actual: unknown) => ({ toBe(expected: unknown) { assert.equal(actual, expected) } })
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'

// Production SkillInfoPage and native form primitives. Context, backend, toast
// and unchanged presentation/menu leaves are explicit fixture seams.
const enabled = process.env.ROX_SKILL_INFO_BROWSER_TEST === '1'
let browser: Browser, context: BrowserContext, page: Page, server: Server, base: string
export const fixtureSource = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import SkillInfoPage from './apps/electron/src/renderer/pages/SkillInfoPage';
const reads=[], saves=[], deletes=[], watchers=[], toasts=[], navigations=[],listCalls=[];
let props={workspaceId:'ws-a',skillSlug:'sample',workingDirectory:'/project-a'};
window.skillInfo={props,reads,saves,deletes,toasts,navigations,listCalls};
window.electronAPI={
 getSkills(workspaceId,cwd){listCalls.push({workspaceId,cwd});return Promise.resolve([window.skillInfo.item('OMP metadata','Description','','omp')])},
 getSkillDetails(workspaceId,slug,cwd){return new Promise((resolve,reject)=>reads.push({workspaceId,slug,cwd,resolve,reject}))},
 onSkillsChanged(callback){const entry={callback,active:true};watchers.push(entry);return()=>{entry.active=false}},
 updateSkill(workspaceId,slug,values){return new Promise((resolve,reject)=>saves.push({workspaceId,slug,values,resolve,reject}))},
 deleteSkill(workspaceId,slug){return new Promise((resolve,reject)=>deletes.push({workspaceId,slug,resolve,reject}))},
};
const root=createRoot(document.getElementById('root'));
const render=()=>flushSync(()=>root.render(React.createElement(SkillInfoPage,props)));
Object.assign(window.skillInfo,{
 item(name='Canonical',description='Description',content='Instructions',source='workspace'){
  return {slug:'sample',metadata:{name,description},content,source,path:'/workspace/skills/sample'};
 },
 resolve(index,items){reads[index].resolve(items.find(item=>item.slug===reads[index].slug)??null)},
 reject(index){reads[index].reject(new Error('fixture offline'))},
 watch(workspaceId='ws-a',items=[]){watchers.filter(w=>w.active).forEach(w=>w.callback(workspaceId,items))},
 retained(index,workspaceId='ws-a'){watchers[index].callback(workspaceId,[])},
 scope(next){props={...props,...next};window.skillInfo.props=props;render()},
 saveAck(index,item){saves[index].resolve(item)}, saveReject(index){saves[index].reject(new Error('fixture write rejected'))},
 deleteAck(index){deletes[index].resolve()},
});
render();
`

const browserTest = (name: string, run: () => Promise<void>) => it(name, { timeout: 30_000 }, run)
async function waitReads(count: number) { await page.waitForFunction(count => (window as any).skillInfo.reads.length === count, count) }
async function loadItem(name = 'Canonical') {
  await waitReads(1)
  await page.evaluate(name => (window as any).skillInfo.resolve(0, [(window as any).skillInfo.item(name)]), name)
  await page.locator('input:not([disabled])').waitFor()
}

describe('current SkillInfoPage catalog/draft/save ownership', { skip: !enabled }, () => {
  beforeAll(async () => {
    const bundle = process.env.ROX_SKILL_INFO_FIXTURE_BUNDLE
    if (!bundle) throw new Error('Prebundle this exact fixture with pinned Node before launching Chromium')
    const javascript = readFileSync(bundle, 'utf8')
    server = createServer((req, res) => {
      res.writeHead(200, {'content-type':req.url === '/fixture.js' ? 'text/javascript' : 'text/html'})
      res.end(req.url === '/fixture.js' ? javascript : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = 'http://127.0.0.1:' + (server.address() as any).port
    browser = await chromium.launch({executablePath:process.env.ROX_UI001_CHROMIUM_EXECUTABLE,headless:true,args:['--disable-gpu']})
  }, 30_000)
  beforeEach(async () => {
    context = await browser.newContext(); page = await context.newPage()
    page.setDefaultTimeout(3000);page.setDefaultNavigationTimeout(30_000)
    await page.goto(base,{waitUntil:'domcontentloaded'}); await page.waitForFunction(() => !!(window as any).skillInfo)
  },30_000)
  afterEach(async () => { await context?.close() },30_000)
  afterAll(async () => {
    server?.closeAllConnections()
    const closed = server ? new Promise<void>(resolve => server.close(() => resolve())) : Promise.resolve()
    try { await browser?.close() } finally { await closed }
  },30_000)

  browserTest('watcher reads the complete same-directory catalog and preserves edited fields', async () => {
    await loadItem()
    await page.locator('input:not([disabled])').fill('Local name')
    await page.locator('textarea').nth(1).fill('Local instructions')
    await page.evaluate(() => (window as any).skillInfo.watch())
    await waitReads(2)
    expect(await page.evaluate(() => (window as any).skillInfo.reads[1].cwd)).toBe('/project-a')
    await page.evaluate(() => (window as any).skillInfo.resolve(1,[(window as any).skillInfo.item('Remote name','Remote description','Remote instructions')]))
    await page.waitForFunction(()=>document.querySelector('textarea')?.value==='Remote description')
    expect(await page.locator('input:not([disabled])').inputValue()).toBe('Local name')
    expect(await page.locator('textarea').nth(1).inputValue()).toBe('Local instructions')
  })

  browserTest('latest catalog read defeats an older pending load and deletion recreates the selected address', async () => {
    await waitReads(1)
    await page.evaluate(() => (window as any).skillInfo.watch()); await waitReads(2)
    await page.evaluate(() => (window as any).skillInfo.resolve(1,[(window as any).skillInfo.item('Latest')]))
    await page.waitForFunction(()=>document.querySelector('input:not([disabled])')?.getAttribute('value')==='Latest')
    await page.evaluate(() => (window as any).skillInfo.resolve(0,[(window as any).skillInfo.item('Old')]))
    await page.waitForTimeout(50)
    expect(await page.locator('input:not([disabled])').inputValue()).toBe('Latest')
    await page.evaluate(() => (window as any).skillInfo.watch());await waitReads(3)
    await page.evaluate(() => (window as any).skillInfo.resolve(2,[]))
    await page.getByRole('alert').waitFor();expect(await page.getByRole('alert').textContent()).toBe('skillInfo.notFound')
    await page.evaluate(() => (window as any).skillInfo.watch());await waitReads(4)
    await page.evaluate(() => (window as any).skillInfo.resolve(3,[(window as any).skillInfo.item('Recreated')]))
    await page.waitForFunction(()=>document.querySelector('input:not([disabled])')?.getAttribute('value')==='Recreated')
  })

  browserTest('workspace ABA and a retained old watcher cannot publish an old catalog', async () => {
    await waitReads(1)
    await page.evaluate(() => (window as any).skillInfo.scope({workspaceId:'ws-b',workingDirectory:'/project-b'}));await waitReads(2)
    await page.evaluate(() => (window as any).skillInfo.scope({workspaceId:'ws-a',workingDirectory:'/project-a'}));await waitReads(3)
    await page.evaluate(() => (window as any).skillInfo.resolve(2,[(window as any).skillInfo.item('Current A')]))
    await page.locator('input:not([disabled])').waitFor()
    await page.evaluate(() => { const ui=(window as any).skillInfo;ui.resolve(0,[ui.item('Former A')]);ui.retained(0) })
    await page.waitForTimeout(50)
    expect(await page.locator('input:not([disabled])').inputValue()).toBe('Current A')
    expect(await page.evaluate(() => (window as any).skillInfo.reads.length)).toBe(3)
  })

  browserTest('save acknowledgement preserves later edits and invalidates older watcher reads', async () => {
    await loadItem()
    await page.locator('input:not([disabled])').fill('Submitted')
    await page.getByRole('button',{name:'common.save'}).first().click()
    await page.waitForFunction(() => (window as any).skillInfo.saves.length === 1)
    await page.locator('input:not([disabled])').fill('Later edit')
    await page.evaluate(() => (window as any).skillInfo.watch());await waitReads(2)
    await page.evaluate(() => (window as any).skillInfo.saveAck(0,(window as any).skillInfo.item('Normalized','Normalized description','Normalized instructions')))
    await page.waitForFunction(()=>document.querySelector('textarea')?.value==='Normalized description')
    await page.evaluate(() => (window as any).skillInfo.resolve(1,[(window as any).skillInfo.item('Pre-save snapshot')]))
    await page.waitForTimeout(50)
    expect(await page.locator('input:not([disabled])').inputValue()).toBe('Later edit')
    expect(await page.locator('textarea').nth(1).inputValue()).toBe('Normalized instructions')
    expect(await page.evaluate(() => (window as any).skillInfo.saves[0].values.name)).toBe('Submitted')
  })

  browserTest('failed write retains draft and a late save from the previous directory cannot replace current content', async () => {
    await loadItem();await page.locator('input:not([disabled])').fill('Draft')
    await page.getByRole('button',{name:'common.save'}).first().click()
    await page.waitForFunction(() => (window as any).skillInfo.saves.length === 1)
    await page.evaluate(() => (window as any).skillInfo.saveReject(0))
    await page.getByRole('button',{name:'common.save'}).first().waitFor()
    expect(await page.locator('input:not([disabled])').inputValue()).toBe('Draft')
    await page.getByRole('button',{name:'common.save'}).first().click()
    await page.waitForFunction(() => (window as any).skillInfo.saves.length === 2)
    await page.evaluate(() => (window as any).skillInfo.scope({workingDirectory:'/project-b'}));await waitReads(2)
    await page.evaluate(() => (window as any).skillInfo.resolve(1,[(window as any).skillInfo.item('Project B')]))
    await page.locator('input:not([disabled])').waitFor()
    await page.evaluate(() => (window as any).skillInfo.saveAck(1,(window as any).skillInfo.item('Old directory')))
    await page.waitForTimeout(50)
    expect(await page.locator('input:not([disabled])').inputValue()).toBe('Project B')
    expect(await page.evaluate(() => (window as any).skillInfo.toasts.filter((entry: unknown[])=>entry[0]==='success').length)).toBe(0)
  })

  browserTest('project skill stays read-only after workspace-only watch payload', async () => {
    await waitReads(1)
    await page.evaluate(() => (window as any).skillInfo.resolve(0,[(window as any).skillInfo.item('Project skill','Description','Project content','project')]))
    await page.getByText('Project content').waitFor()
    await page.evaluate(() => (window as any).skillInfo.watch('ws-a',[(window as any).skillInfo.item('Workspace shadow')]))
    await waitReads(2)
    await page.evaluate(() => (window as any).skillInfo.resolve(1,[(window as any).skillInfo.item('Project skill','Description','Project content','project')]))
    expect(await page.getByRole('button',{name:'common.save'}).count()).toBe(0)
    expect(await page.locator('textarea').count()).toBe(0)
    expect(await page.getByText('Project content').textContent()).toBe('Project content')
  })
  browserTest('selected OMP Unicode body is read-only and watcher refresh uses its exact identity', async () => {
    await waitReads(1)
    expect(await page.evaluate(() => (window as any).skillInfo.reads[0].slug)).toBe('sample')
    await page.evaluate(() => { const ui=(window as any).skillInfo;ui.resolve(0,[ui.item('OMP selected','Description','日本語 🔒\nCanonical full instructions','omp')]) })
    await page.locator('pre').waitFor()
    expect(await page.locator('pre').textContent()).toBe('日本語 🔒\nCanonical full instructions')
    expect(await page.locator('input:not([disabled]),textarea').count()).toBe(0)
    expect(await page.getByRole('button',{name:'fixture AI edit'}).count()).toBe(0)
    expect(await page.getByRole('button',{name:'finder',exact:true}).count()).toBe(0)
    expect(await page.getByRole('button',{name:'delete',exact:true}).count()).toBe(0)
    expect(await page.evaluate(() => (window as any).skillInfo.listCalls.length)).toBe(0)
    await page.evaluate(() => (window as any).skillInfo.watch());await waitReads(2)
    expect(await page.evaluate(() => (window as any).skillInfo.reads[1].slug)).toBe('sample')
    await page.evaluate(() => { const ui=(window as any).skillInfo;ui.resolve(1,[ui.item('OMP selected','Description','Updated full text','omp')]) })
    await page.waitForFunction(()=>document.querySelector('pre')?.textContent==='Updated full text')
    expect(await page.evaluate(() => (window as any).skillInfo.saves.length + (window as any).skillInfo.deletes.length)).toBe(0)
  })

})
