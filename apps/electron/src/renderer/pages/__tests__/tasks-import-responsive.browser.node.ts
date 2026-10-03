import { after, afterEach, before, beforeEach, describe, it as nodeIt } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
const it = (name: string, body: () => Promise<void>, options: { timeout: number }) => nodeIt(name, options, body)
const enabled = process.env.ROX_TASKS_BROWSER_TEST === '1'
let browser: Browser, context: BrowserContext, page: Page, server: Server, base: string
const payload = { version: 1, tasks: [{id:'imported', title:'Imported task', notes:'', list:'inbox', tags:[],priority:'none',evening:false,links:[],order:0,createdAt:1}],projects:[],areas:[],headings:[],audit:[] }
const upload=()=>page.getByLabel('Import', {exact:true}).setInputFiles({name:'tasks.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))})
const fixture=(fn: (ui: any)=>unknown)=>page.evaluate(fn as any)
const waitPut=()=>page.waitForFunction(()=>(window as any).tasksFixture.calls.some((call:string)=>call.startsWith('put:')))
const state=()=>page.evaluate(()=>{const ui=(window as any).tasksFixture;return{toasts:ui.toasts,calls:ui.calls,rows:ui.rows()}})
describe('actual modern Tasks import and content-width DOM', {skip:!enabled},()=>{
  before(async()=>{
    const javascript=readFileSync(process.env.ROX_TASKS_FIXTURE_BUNDLE!,'utf8'), css=readFileSync(process.env.ROX_TASKS_FIXTURE_CSS!,'utf8')
    server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/fixture.js'?'text/javascript':request.url==='/fixture.css'?'text/css':'text/html');response.end(request.url==='/fixture.js'?javascript:request.url==='/fixture.css'?css:'<!doctype html><link rel="stylesheet" href="/fixture.css"><button id="outside">Other panel</button><div id="sidebar"></div><div id="panel" style="width:1000px;height:720px"><div id="root" style="height:100%"></div></div><script src="/fixture.js"></script>')})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+(server.address() as any).port
    browser=await chromium.launch({executablePath:process.env.ROX_UI001_CHROMIUM_EXECUTABLE,headless:true,args:['--disable-gpu']})
  },{timeout:30_000})
  beforeEach(async()=>{context=await browser.newContext({viewport:{width:1440,height:900}});page=await context.newPage();page.setDefaultTimeout(5000);await page.goto(base,{waitUntil:'domcontentloaded'});await page.getByTestId('task-row-existing').waitFor()},{timeout:30_000})
  afterEach(async()=>{await context?.close()},{timeout:30_000})
  after(async()=>{server?.closeAllConnections();const closed=server?new Promise<void>(resolve=>server.close(()=>resolve())):Promise.resolve();try{await browser?.close()}catch(error){console.error('Tasks fixture Chromium teardown failed:',error);throw error}finally{await closed}},{timeout:30_000})
  it('rejects impossible ISO dates in the actual task schedule form without persisting a different day',async()=>{
    await page.getByTestId('task-row-existing').click();await page.getByTestId('task-when').click()
    const form=page.getByTestId('task-when-popover'), input=form.getByRole('textbox')
    for(const value of ['2026-02-31','2026-13-01','2026-02-00']) {
      await input.fill(value);await input.press('Enter')
      assert.equal(await form.isVisible(),true)
      assert.equal((await state()).rows.find((task:any)=>task.id==='existing').startAt,undefined)
      assert.equal((await state()).calls.some((call:string)=>call.startsWith('put:')),false)
    }
  },{timeout:30_000})
  it('accepts a leap day in the actual task schedule form and persists that exact local calendar day',async()=>{
    await page.getByTestId('task-row-existing').click();await page.getByTestId('task-when').click()
    const form=page.getByTestId('task-when-popover');await form.getByRole('textbox').fill('2028-02-29');await form.getByRole('textbox').press('Enter')
    await form.waitFor({state:'hidden'});await waitPut()
    const day=await page.evaluate(()=>{const at=(window as any).tasksFixture.rows().find((task:any)=>task.id==='existing').startAt;const d=new Date(at);return[d.getFullYear(),d.getMonth()+1,d.getDate(),d.getHours()]})
    assert.deepEqual(day,[2028,2,29,0])
  },{timeout:30_000})
  it('retains each unsubmitted link draft and kind while switching between actual task details',async()=>{
    await upload();await page.waitForFunction(()=>(window as any).tasksFixture.toasts.some((row:any)=>row[0]==='success'))
    await page.getByTestId('task-row-existing').click();await page.getByRole('tab',{name:/Links/}).click()
    const draft=page.getByRole('textbox',{name:'Linked id'})
    await page.getByRole('group',{name:'Add link'}).getByRole('button',{name:'Session',exact:true}).click();await draft.fill('Unsubmitted session A')
    await page.getByTestId('task-row-imported').click();await page.getByRole('tab',{name:/Links/}).click()
    assert.equal(await draft.inputValue(),'');await draft.fill('Unsubmitted note B')
    await page.getByTestId('task-row-existing').click();await page.getByRole('tab',{name:/Links/}).click()
    assert.equal(await draft.inputValue(),'Unsubmitted session A');assert.equal(await page.getByRole('group',{name:'Add link'}).getByRole('button',{name:'Session',exact:true}).getAttribute('aria-pressed'),'true')
    await page.getByTestId('task-row-imported').click();await page.getByRole('tab',{name:/Links/}).click()
    assert.equal(await draft.inputValue(),'Unsubmitted note B');assert.equal((await state()).rows.every((row:any)=>row.links.length===0),true)
  },{timeout:30_000})

  it('retains each task tag draft and clears only the submitted link or tag input',async()=>{
    await upload();await page.waitForFunction(()=>(window as any).tasksFixture.toasts.some((row:any)=>row[0]==='success'))
    await page.getByTestId('task-row-existing').click();await page.getByTestId('task-tag-input').fill('alpha, beta')
    await page.getByRole('tab',{name:/Links/}).click();await page.getByRole('textbox',{name:'Linked id'}).fill('note-a')
    await page.getByTestId('task-row-imported').click();await page.getByTestId('task-tag-input').fill('gamma')
    await page.getByRole('tab',{name:/Links/}).click();await page.getByRole('textbox',{name:'Linked id'}).fill('note-b')
    await page.getByTestId('task-row-existing').click();assert.equal(await page.getByTestId('task-tag-input').inputValue(),'alpha, beta')
    await page.getByTestId('task-tag-input').press('Enter');assert.equal(await page.getByTestId('task-tag-input').inputValue(),'')
    await page.getByRole('tab',{name:/Links/}).click();assert.equal(await page.getByRole('textbox',{name:'Linked id'}).inputValue(),'note-a')
    await page.getByRole('button',{name:'Add link',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Linked id'}).inputValue(),'')
    await page.getByTestId('task-row-imported').click();assert.equal(await page.getByTestId('task-tag-input').inputValue(),'gamma')
    await page.getByRole('tab',{name:/Links/}).click();assert.equal(await page.getByRole('textbox',{name:'Linked id'}).inputValue(),'note-b')
    await page.waitForFunction(()=>{const row=(window as any).tasksFixture.rows().find((row:any)=>row.id==='existing');return row.tags.length===2&&row.links.length===1})
    const a=(await state()).rows.find((row:any)=>row.id==='existing');assert.deepEqual(a.tags,['alpha','beta']);assert.deepEqual(a.links,[{kind:'note',id:'note-a'}])
  },{timeout:30_000})
  it('retires unsubmitted task drafts across actor and workspace ABA even for the same task ID',async()=>{
    await page.getByTestId('task-row-existing').click();await page.getByTestId('task-tag-input').fill('Private tag A')
    await page.getByRole('tab',{name:/Links/}).click();await page.getByRole('group',{name:'Add link'}).getByRole('button',{name:'Session',exact:true}).click();await page.getByRole('textbox',{name:'Linked id'}).fill('Private session A')
    await page.evaluate(async()=>{const ui=(window as any).tasksFixture;await ui.scope('bob','ws-b');await ui.scope('alice','ws-a')})
    await page.getByTestId('task-row-existing').click();await page.getByRole('tab',{name:'Details',exact:true}).click();assert.equal(await page.getByTestId('task-tag-input').inputValue(),'')
    await page.getByRole('tab',{name:/Links/}).click();assert.equal(await page.getByRole('textbox',{name:'Linked id'}).inputValue(),'')
    assert.equal(await page.getByRole('group',{name:'Add link'}).getByRole('button',{name:'Note',exact:true}).getAttribute('aria-pressed'),'true');assert.equal((await state()).calls.some((call:string)=>call.startsWith('put:')),false)
  },{timeout:30_000})
  it('unmount clears task form drafts instead of reviving them into a successor panel',async()=>{
    await page.getByTestId('task-row-existing').click();await page.getByRole('tab',{name:/Links/}).click();await page.getByRole('textbox',{name:'Linked id'}).fill('Retired panel draft')
    await page.evaluate(()=>{const ui=(window as any).tasksFixture;ui.unmount();ui.remount()})
    await page.getByTestId('task-row-existing').click();await page.getByRole('tab',{name:/Links/}).click();assert.equal(await page.getByRole('textbox',{name:'Linked id'}).inputValue(),'')
  },{timeout:30_000})
  it('denies an already rendered draft submission after its actor generation retires before React rerenders',async()=>{
    await page.getByTestId('task-row-existing').click();await page.getByRole('tab',{name:/Links/}).click();await page.getByRole('textbox',{name:'Linked id'}).fill('Obsolete actor draft')
    await page.evaluate(()=>{const button=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="task-detail"] button')).find(button=>button.textContent==='Add link')!;(window as any).tasksFixture.retireDraftOwner();button.click()})
    await page.waitForTimeout(80);assert.equal((await state()).calls.some((call:string)=>call.startsWith('put:')),false)
  },{timeout:30_000})

  it('keeps edits made while file.text is pending, and announces import only after the native ACK',async()=>{
    await page.evaluate(()=>{const ui=(window as any).tasksFixture;ui.holdFile=true;ui.holdPut=true})
    await upload();await page.evaluate(()=>(window as any).tasksFixture.edit('Edited during file read'))
    await page.waitForFunction(()=>(window as any).tasksFixture.rows().some((task:any)=>task.title==='Edited during file read'))
    // Wait for the ordinary edited task's ACK before starting the import. The
    // import must merge this latest task, not its earlier render closure.
    await waitPut();await page.evaluate(()=>{const ui=(window as any).tasksFixture;ui.releasePut();ui.holdPut=false;ui.releaseFile()})
    await page.waitForFunction(()=>(window as any).tasksFixture.toasts.some((row:any)=>row[0]==='success'))
    const result=await state();assert.equal(result.rows.find((task:any)=>task.id==='existing').title,'Edited during file read');assert.equal(result.rows.find((task:any)=>task.id==='imported').title,'Imported task')
  },{timeout:30_000})
  it('does not announce or cache an import when native persistence rejects it',async()=>{
    await page.evaluate(()=>(window as any).tasksFixture.denyPut=true);await upload()
    await page.waitForFunction(()=>(window as any).tasksFixture.toasts.length===1)
    const result=await state();assert.deepEqual(result.toasts.map((row:any)=>row[0]),['error']);assert.equal(result.rows.some((task:any)=>task.id==='imported'),false)
  },{timeout:30_000})
  it('requires readback after ACK and preserves unrelated edits while import commit is pending',async()=>{
    await page.evaluate(()=>(window as any).tasksFixture.holdPut=true);await upload();await waitPut()
    assert.deepEqual((await state()).toasts,[])
    await page.evaluate(()=>{const ui=(window as any).tasksFixture;ui.edit('Edited during commit');ui.holdPut=false;ui.releasePut()})
    await page.waitForFunction(()=>(window as any).tasksFixture.toasts.length===1)
    const result=await state();assert.equal(result.toasts[0][0],'success');assert.equal(result.rows.find((task:any)=>task.id==='existing').title,'Edited during commit');assert.equal(result.rows.some((task:any)=>task.id==='imported'),true)
    assert.ok(result.calls.filter((call:string)=>call.startsWith('list:')).length>=3)
  },{timeout:30_000})
  it('refuses a successful ACK with denied readback instead of displaying a false success',async()=>{
    await page.evaluate(()=>(window as any).tasksFixture.denyReadback=true);await upload()
    await page.waitForFunction(()=>(window as any).tasksFixture.toasts.length===1)
    assert.deepEqual((await state()).toasts.map((row:any)=>row[0]),['error'])
  },{timeout:30_000})
  it('file reading belongs to its captured actor and workspace, including ABA',async()=>{
    await page.evaluate(()=>(window as any).tasksFixture.holdFile=true);await upload()
    await page.evaluate(async()=>{const ui=(window as any).tasksFixture;await ui.scope('bob','ws-b');await ui.scope('alice','ws-a');ui.releaseFile()})
    await page.waitForTimeout(60);const result=await state();assert.deepEqual(result.toasts,[]);assert.equal(result.calls.some((call:string)=>call.startsWith('put:')),false);assert.equal(result.rows.some((task:any)=>task.id==='imported'),false)
  },{timeout:30_000})
  it('unmount retires pending file reads before any native write or notification',async()=>{
    await page.evaluate(()=>(window as any).tasksFixture.holdFile=true);await upload()
    await page.evaluate(()=>{const ui=(window as any).tasksFixture;ui.unmount();ui.releaseFile()});await page.waitForTimeout(60)
    const result=await state();assert.deepEqual(result.toasts,[]);assert.equal(result.calls.some((call:string)=>call.startsWith('put:')),false)
  },{timeout:30_000})
  it('uses panel content width and returns owned keyboard focus from detail to the original row',async()=>{
    await page.evaluate(()=>(window as any).tasksFixture.width(620));await page.waitForFunction(()=>document.querySelector('[data-narrow="true"]'))
    assert.equal(await page.locator('[data-mode-pane="detail"]').isVisible(),false)
    await page.getByTestId('task-row-existing').focus();await page.getByTestId('task-row-existing').click()
    await page.locator('[data-mode-pane="detail"]').waitFor();assert.equal(await page.locator('[data-mode-pane="list"]').isVisible(),false)
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-mode-pane')),'detail')
    assert.ok(await page.evaluate(()=>{const root=document.querySelector('[data-testid="tasks-page"]')!;return root.scrollWidth<=root.clientWidth}))
    await page.getByRole('button',{name:'Back to list',exact:true}).click();await page.getByTestId('task-row-existing').waitFor()
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-testid')),'task-row-existing')
  },{timeout:30_000})
  it('a narrow selected task remains inside the measured content width without horizontal overflow',async()=>{
    await page.getByTestId('task-row-existing').click()
    await page.evaluate(()=>(window as any).tasksFixture.width(620))
    await page.waitForFunction(()=>document.querySelector('[data-testid="tasks-page"]')!.getBoundingClientRect().width===620)
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
    const measured=await page.evaluate(()=>{const root=document.querySelector('[data-testid="tasks-page"]')!;return{content:root.clientWidth,total:root.scrollWidth}})
    assert.ok(measured.total<=measured.content,JSON.stringify(measured))
  },{timeout:30_000})
  it('malformed import and a failed file read refuse any native write and preserve the current store',async()=>{
    await page.getByLabel('Import',{exact:true}).setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{')})
    await page.waitForFunction(()=>(window as any).tasksFixture.toasts.length===1)
    await page.evaluate(()=>{File.prototype.text=async()=>{throw new Error('Synthetic file read refused')}})
    await upload();await page.waitForFunction(()=>(window as any).tasksFixture.toasts.length===2)
    const result=await state();assert.deepEqual(result.toasts.map((row:any)=>row[0]),['error','error']);assert.equal(result.calls.some((call:string)=>call.startsWith('put:')),false);assert.equal(result.rows[0].title,'Existing task')
  },{timeout:30_000})

  it('resize and externally selected detail do not steal focus from another panel',async()=>{
    await page.getByTestId('task-row-existing').click();await page.getByRole('button',{name:'Other panel',exact:true}).focus()
    await page.evaluate(()=>(window as any).tasksFixture.width(620));await page.waitForFunction(()=>document.querySelector('[data-narrow="true"]'))
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'outside')
  },{timeout:30_000})
  it('keeps standalone navigation reachable in a narrow panel and returns focus after Escape',async()=>{
    await page.evaluate(()=>(window as any).tasksFixture.width(620));await page.waitForFunction(()=>document.querySelector('[data-narrow="true"]'))
    await page.getByRole('button',{name:'Task lists',exact:true}).click();await page.getByRole('dialog').waitFor()
    assert.equal(await page.getByRole('dialog').getByTestId('tasks-nav-inbox').isVisible(),true)
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})
    await page.waitForFunction(()=>document.activeElement?.textContent==='Task lists')
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Task lists')
  },{timeout:30_000})
  it('retains a real contextual sidebar owner instead of creating a second narrow navigator',async()=>{
    await page.evaluate(()=>{const ui=(window as any).tasksFixture;ui.sidebar();ui.width(620)})
    await page.waitForFunction(()=>document.querySelector('[data-narrow="true"]'))
    assert.equal(await page.locator('#sidebar').getByTestId('tasks-nav-inbox').isVisible(),true)
    assert.equal(await page.getByRole('button',{name:'Task lists',exact:true}).count(),0)
    await page.locator('#sidebar').getByTestId('tasks-nav-inbox').focus()
    await page.evaluate(()=>(window as any).tasksFixture.width(600))
    assert.equal(await page.evaluate(()=>document.activeElement?.closest('#sidebar')?.id),'sidebar')
  },{timeout:30_000})
  it('an inert panel never acquires focus during a narrow detail exchange',async()=>{
    await page.getByTestId('task-row-existing').click()
    await page.evaluate(()=>{document.querySelector('[data-testid="tasks-page"]')!.setAttribute('inert','');(window as any).tasksFixture.width(620)})
    await page.getByRole('button',{name:'Other panel',exact:true}).focus()
    await page.waitForFunction(()=>document.querySelector('[data-narrow="true"]'))
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'outside')
  },{timeout:30_000})

  it("resize retires only this panel's hidden standalone navigation focus to its reachable trigger",async()=>{
    await page.getByTestId('tasks-nav-inbox').focus()
    await page.evaluate(()=>(window as any).tasksFixture.width(620))
    await page.waitForFunction(()=>document.activeElement?.textContent==='Task lists')
    assert.equal(await page.getByRole('button',{name:'Task lists',exact:true}).isVisible(),true)
  },{timeout:30_000})

  it('a wide panel keeps both list and detail and a resize moves only its hidden list focus',async()=>{
    await page.getByTestId('task-row-existing').click();assert.equal(await page.locator('[data-mode-pane="list"]').isVisible(),true);assert.equal(await page.locator('[data-mode-pane="detail"]').isVisible(),true)
    await page.getByTestId('tasks-list').focus();await page.evaluate(()=>(window as any).tasksFixture.width(620));await page.waitForFunction(()=>document.querySelector('[data-narrow="true"]'))
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-mode-pane')),'detail')
  },{timeout:30_000})
})
