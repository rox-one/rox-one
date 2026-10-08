import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { chromium, expect as playwrightExpect, type Browser, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../../test-utils/chromium-executable'

const repository=resolve(import.meta.dirname,'../../../../../../..')
const fixture=resolve(import.meta.dirname,'fixtures/message-actions')
const executablePath=await resolveChromiumExecutable()
const frontend='http://127.0.0.1:5198'
const backend='http://127.0.0.1:5199'
const proofDirectory=process.env.MESSAGE_ACTIONS_PROOF_DIR
const expectDOM=playwrightExpect.configure({timeout:5000})

describe.skipIf(!existsSync(executablePath))('production message actions with persisted synthetic RPC',()=>{
 let ui:ReturnType<typeof Bun.spawn>|undefined
 let api:ReturnType<typeof Bun.spawn>|undefined
 let root:string
 let browser:Browser
 let page:Page
 const errors:string[]=[]
 const stop=async()=>{ui?.kill();api?.kill();await browser?.close();await Promise.all([ui?.exited,api?.exited]);if(root)rmSync(root,{recursive:true,force:true})}
 const wait=async(url:string, owner:ReturnType<typeof Bun.spawn>)=>{const deadline=Date.now()+30000;for(;;){if(owner.exitCode!==null)throw new Error('Owned message fixture exited during startup');try{const response=await fetch(url);if(response.ok){if(url===backend&&(await response.json() as any).fixtureId!=='rox-message-actions')throw new Error('Different process owns message fixture port');if(owner.exitCode!==null)throw new Error('Owned message fixture exited during startup');return}}catch(error){if(error instanceof Error&&error.message.includes('owns message'))throw error}if(Date.now()>deadline)throw new Error(`Message acceptance fixture did not start: ${url}`);await Bun.sleep(100)}}
 beforeAll(async()=>{try{
  root=mkdtempSync(join(tmpdir(),'rox-message-browser-'))
  api=Bun.spawn([process.execPath,resolve(fixture,'backend.ts')],{cwd:repository,env:{...process.env,ROX_CONFIG_DIR:root},stdout:'ignore',stderr:'ignore'})
  ui=Bun.spawn(['node',resolve(repository,'node_modules/vite/bin/vite.js'),'--config',resolve(fixture,'vite.config.ts'),'--port','5198'],{cwd:repository,stdout:'ignore',stderr:'ignore'})
  await Promise.all([wait(frontend,ui),wait(backend,api)])
  browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']})
  const warmup=await browser.newPage();await warmup.goto(frontend);await playwrightExpect(warmup.getByTestId('user').getByRole('toolbar')).toBeVisible({timeout:30000});await warmup.close()
  if(proofDirectory)mkdirSync(proofDirectory,{recursive:true})
 }catch(error){await stop();throw error}},60000)
 beforeEach(async()=>{
  await fetch(`${backend}/rpc`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method:'reset',args:{}})})
  errors.length=0;page=await browser.newPage({viewport:{width:1050,height:950},permissions:['clipboard-read','clipboard-write']});page.on('pageerror',error=>errors.push(error.message));await page.goto(frontend)
  await expectDOM(page.getByTestId('user').getByRole('toolbar')).toBeVisible()
 },30000)
 afterEach(async()=>{try{expect(errors).toEqual([])}finally{await page?.close()}},30000)
 afterAll(stop,30000)
 const calls=()=>page.evaluate(()=>(window as any).__messageFixture.calls)
 const proof=async(name:string)=>{if(!proofDirectory)return;await page.screenshot({path:resolve(proofDirectory,`message-actions-${name}.png`),fullPage:true});writeFileSync(resolve(proofDirectory,`message-actions-${name}.json`),JSON.stringify({calls:await calls(),errors},null,2))}
 const labels=['React with heart','Copy','Quote in reply','Listen','Branch From This Message','More']
 it('shows the requested action order on both user and assistant messages, including compact mode',async()=>{
  for(const id of ['user','assistant'])expect(await page.getByTestId(id).getByRole('toolbar').getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')))).toEqual(labels)
  await page.goto(`${frontend}/?compact`);await expectDOM(page.getByTestId('assistant').getByRole('button',{name:'Branch From This Message',exact:true})).toBeVisible();await proof('order')
 },30000)
 it('likes its own message through the real annotation RPC and retains/removes the reaction after reload',async()=>{
  const heart=()=>page.getByTestId('user').getByRole('button',{name:'React with heart',exact:true})
  await heart().click();await expectDOM(heart()).toHaveAttribute('aria-pressed','true');await expectDOM(heart()).toHaveText('1')
  expect((await calls()).find((call:any)=>call.method==='addAnnotation').args.messageId).toBe('canonical-user')
  await page.reload();await expectDOM(heart()).toHaveAttribute('aria-pressed','true')
  await heart().click();await expectDOM(heart()).toHaveAttribute('aria-pressed','false');await proof('own-like')
 },30000)
 it('toggles the authenticated user’s own reaction on an assistant answer without duplicating it',async()=>{
  const heart=()=>page.getByTestId('assistant').getByRole('button',{name:'React with heart',exact:true})
  await heart().click();await expectDOM(heart()).toHaveAttribute('aria-pressed','true');await page.reload();await expectDOM(heart()).toHaveAttribute('aria-pressed','true')
  await heart().click();await expectDOM(heart()).toHaveAttribute('aria-pressed','false')
  expect((await calls()).filter((call:any)=>call.method==='addAnnotation')).toHaveLength(0)
  expect((await calls()).filter((call:any)=>call.method==='removeAnnotation')).toHaveLength(1)
 },30000)
 it('keeps likes disabled when identity fails and retries when the app gains focus',async()=>{
  await page.goto(`${frontend}/?identity-failed`)
  const heart=page.getByTestId('user').getByRole('button',{name:'React with heart',exact:true})
  await expectDOM(heart).toBeDisabled()
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expectDOM(heart).toBeEnabled();await heart.click();await expectDOM(heart).toHaveAttribute('aria-pressed','true')
  expect((await calls()).find((call:any)=>call.method==='addAnnotation').args.annotation.createdBy.id).toBe('native-message-user')
 },30000)
 it('copies, quotes and directly listens to the selected message with a visible stop control',async()=>{
  const user=page.getByTestId('user')
  await user.getByRole('button',{name:'Copy',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('My synthetic question')
  await user.getByRole('button',{name:'Quote in reply',exact:true}).click();await expectDOM(page.getByRole('textbox',{name:'Draft',exact:true})).toHaveValue('> My synthetic question')
  await user.getByRole('button',{name:'Listen',exact:true}).click();await expectDOM(user.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
  expect((await calls()).find((call:any)=>call.method==='speakVoice'&&call.args.text)?.args.text).toBe('My synthetic question')
  await user.getByRole('button',{name:'Stop',exact:true}).click();await expectDOM(user.getByRole('button',{name:'Listen',exact:true})).toBeVisible();await proof('listen')
 },30000)
 it('creates a usable own-message branch via the real creation RPC and continues the child dialogue',async()=>{
  await page.getByTestId('user').getByRole('button',{name:'Branch From This Message',exact:true}).click()
  const child=page.getByRole('region',{name:'Created branch'})
  await expectDOM(child).toContainText('Branch of canonical-user');await expectDOM(child).toContainText('My synthetic question');await expectDOM(child).not.toContainText('A synthetic reply')
  await page.getByRole('textbox',{name:'Branch follow-up'}).fill('Synthetic continuation')
  await page.getByRole('button',{name:'Send follow-up'}).click();await expectDOM(child).toContainText('Hello world');await proof('own-branch')
 },30000)
 it('forks an assistant answer with its complete earlier context',async()=>{
  await page.getByTestId('assistant').getByRole('button',{name:'Branch From This Message',exact:true}).click()
  const child=page.getByRole('region',{name:'Created branch'})
  await expectDOM(child).toContainText('Branch of assistant');await expectDOM(child).toContainText('My synthetic question');await expectDOM(child).toContainText('A synthetic reply for the same question.');await proof('assistant-branch')
 },30000)
 it('opens a side-thread prompt for the chosen user message and keeps canonical provenance',async()=>{
  await page.getByTestId('user').getByRole('button',{name:'More',exact:true}).click()
  await page.getByRole('menuitem',{name:'Start a side thread',exact:true}).hover()
  await page.getByRole('menuitem',{name:'Verify',exact:true}).click()
  const draft=await page.getByRole('textbox',{name:'Draft',exact:true}).inputValue()
  expect(draft).toContain('messageId: canonical-user');expect(draft).toContain('My synthetic question');expect(draft).toContain('Independently verify');await proof('side-thread')
 },30000)
})
