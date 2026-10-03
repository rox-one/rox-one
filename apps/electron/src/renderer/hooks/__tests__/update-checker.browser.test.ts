import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect as expectDOM, type Browser, type Page } from 'playwright/test'

const repository=resolve(import.meta.dirname,'../../../../../..')
const fixture=resolve(import.meta.dirname,'fixtures/update-checker')
const executablePath='/usr/bin/chromium'
const url='http://127.0.0.1:5322'
const proofDirectory=process.env.UPDATE_CHECKER_PROOF_DIR
type Fixture={calls:string[];initial(version:string):void;dismissal():void;available(version:string):void;idle():void;progress(value:number):void;cleanup():{availabilityCleanup:number;progressCleanup:number}}

describe.skipIf(!existsSync(executablePath))('production optional update checker failure and lifecycle in Chromium',()=>{
  let server:ReturnType<typeof Bun.spawn>|undefined,browser:Browser,page:Page
  const errors:string[]=[]
  beforeAll(async()=>{
    server=Bun.spawn(['node',resolve(repository,'node_modules/vite/bin/vite.js'),'--config',resolve(fixture,'vite.config.ts'),'--port','5322'],{cwd:repository,stdout:'ignore',stderr:'ignore'})
    const deadline=Date.now()+30000
    for(;;){if(server.exitCode!==null)throw new Error('Owned update fixture exited');try{if((await fetch(url)).ok)break}catch{}if(Date.now()>deadline)throw new Error('Update fixture startup timeout');await Bun.sleep(100)}
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']})
    if(proofDirectory)mkdirSync(proofDirectory,{recursive:true})
  },40000)
  beforeEach(async()=>{errors.length=0;page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message))})
  afterEach(async()=>{try{expect(errors).toEqual([])}finally{await page?.close()}})
  afterAll(async()=>{server?.kill();await browser?.close();await server?.exited})
  const open=async(mode:string)=>{await page.goto(url+'/?mode='+mode);await expectDOM(page.getByTestId('ready')).toBeVisible()}
  const notify=(version:string)=>page.evaluate(version=>(window as unknown as{__updateFixture:Fixture}).__updateFixture.available(version),version)
  it('keeps denied startup optional and unavailable without an unhandled rejection or ready claim',async()=>{
    await open('deny');await expectDOM(page.getByTestId('state')).toHaveText('Unavailable');await page.waitForTimeout(120)
    await expectDOM(page.locator('[data-sonner-toast]')).toHaveCount(0)
    if(proofDirectory)writeFileSync(resolve(proofDirectory,'denied.json'),JSON.stringify({text:await page.getByTestId('state').innerText(),pageErrors:errors},null,2))
  },15000)
  it('a late initial response cannot overwrite a newer availability event',async()=>{
    await open('deferred');await notify('3.0.0');await expectDOM(page.getByTestId('state')).toContainText('3.0.0')
    await page.evaluate(()=>(window as unknown as{__updateFixture:Fixture}).__updateFixture.initial('2.0.0'));await page.waitForTimeout(100)
    await expectDOM(page.getByTestId('state')).toContainText('3.0.0');await expectDOM(page.locator('[data-sonner-toast]')).toContainText('3.0.0')
    await expectDOM(page.locator('[data-sonner-toast]')).not.toContainText('2.0.0')
  },15000)
  it('a denied dismissal lookup cannot produce a toast or an unhandled event rejection',async()=>{
    await open('dismiss-deny');await expectDOM(page.getByTestId('state')).toContainText('2.0.0');await notify('3.0.0');await page.waitForTimeout(120)
    await expectDOM(page.locator('[data-sonner-toast]')).toHaveCount(0)
  },15000)
  it('a newer unavailable event invalidates a pending ready notification',async()=>{
    await open('dismiss-held');await expectDOM.poll(()=>page.evaluate(()=>(window as unknown as{__updateFixture:Fixture}).__updateFixture.calls.includes('getDismissedUpdateVersion'))).toBe(true)
    await page.evaluate(()=>(window as unknown as{__updateFixture:Fixture}).__updateFixture.idle());await page.evaluate(()=>(window as unknown as{__updateFixture:Fixture}).__updateFixture.dismissal());await page.waitForTimeout(100)
    await expectDOM(page.getByTestId('state')).toContainText('"available":false');await expectDOM(page.locator('[data-sonner-toast]')).toHaveCount(0)
  },15000)
  it('unmount removes both subscriptions and fences a pending ready lookup',async()=>{
    await open('dismiss-held');await expectDOM(page.getByTestId('state')).toContainText('2.0.0');await page.getByRole('button',{name:'Unmount',exact:true}).click()
    await page.evaluate(()=>(window as unknown as{__updateFixture:Fixture}).__updateFixture.dismissal());await page.waitForTimeout(100)
    expect(await page.evaluate(()=>(window as unknown as{__updateFixture:Fixture}).__updateFixture.cleanup())).toEqual({availabilityCleanup:1,progressCleanup:1})
    await expectDOM(page.locator('[data-sonner-toast]')).toHaveCount(0)
  },15000)
  it('dismissing the real ready toast tolerates denied persistence',async()=>{
    await open('ready');await expectDOM(page.locator('[data-sonner-toast]')).toBeVisible()
    await page.locator('[data-sonner-toast] [data-close-button]').click();await expectDOM.poll(()=>page.evaluate(()=>(window as unknown as{__updateFixture:Fixture}).__updateFixture.calls.includes('dismissUpdate'))).toBe(true)
    await page.waitForTimeout(100)
    if(proofDirectory)writeFileSync(resolve(proofDirectory,'dismiss-denied.json'),JSON.stringify({calls:await page.evaluate(()=>(window as unknown as{__updateFixture:Fixture}).__updateFixture.calls),pageErrors:errors},null,2))
  },15000)
})
