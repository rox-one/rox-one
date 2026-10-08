import {afterAll,beforeAll,describe,expect,it} from 'bun:test'
import {existsSync,mkdirSync,statSync} from 'node:fs'
import {resolve} from 'node:path'
import {chromium,expect as playwrightExpect,type Browser,type Page} from 'playwright/test'
const repository=resolve(import.meta.dirname,'../../../../../../..'),fixture=resolve(import.meta.dirname,'fixtures/learning-screen'),evidenceDir=resolve(repository,'work/learning-visual-evidence'),endpoint='http://127.0.0.1:5357'
const executablePath=process.env.CHROMIUM_EXECUTABLE??chromium.executablePath(),timeout=Math.min(150000,Math.max(60000,Number(process.env.ROX_LEARNING_SCREEN_BROWSER_TIMEOUT_MS)||60000))
const check=playwrightExpect.configure({timeout:15000}),shots=['01-initial.png','02-interaction.png','03-error.png','04-retry.png']
const activeElement=(page:Page)=>page.evaluate(()=>{const element=document.activeElement as HTMLElement|null;return {tag:element?.tagName??'',testid:element?.getAttribute('data-testid')??null,focused:Boolean(element&&element!==document.body)}})
const learningCalls=(page:Page):Promise<Array<{method:string;args:unknown[]}>>=>page.evaluate(()=>{
  const target=window as Window&{__learningCalls?:Array<{method:string;args:unknown[]}>}
  return target.__learningCalls??[]
})
const methodCalls=(page:Page,method:string)=>learningCalls(page).then(list=>list.filter(entry=>entry.method===method))
const setFailList=(page:Page,fail:boolean)=>page.evaluate(value=>{
  const target=window as Window&{__learningFailList?:boolean}
  target.__learningFailList=value
},fail)
describe.skipIf(!existsSync(executablePath))('production LearningScreen over the stubbed learning bridge',()=>{
 let server:Bun.Subprocess<'ignore','ignore','ignore'>|undefined,browser:Browser
 const stop=async()=>{server?.kill('SIGKILL');if(browser)await browser.close().catch(()=>{});await server?.exited}
 beforeAll(async()=>{try{server=Bun.spawn(['node',resolve(repository,'node_modules/vite/bin/vite.js'),'--config',resolve(fixture,'vite.config.ts'),'--port','5357'],{cwd:repository,stdout:'ignore',stderr:'ignore'});const deadline=Date.now()+30000;for(;;){if(server.exitCode!==null)throw Error('LearningScreen fixture exited');try{const response=await fetch(endpoint);if(response.ok){if(!(await response.text()).includes('rox-learning-screen-fixture'))throw Error('Foreign owner occupies fixture port');break}}catch(error){if(error instanceof Error&&error.message.includes('Foreign owner'))throw error}if(Date.now()>deadline)throw Error('LearningScreen fixture startup timeout');/* Integration test: polling the real vite HTTP server needs the platform clock; fake timers cannot advance a child process. */await Bun.sleep(100)}browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--rox-learning-screen-fixture']})}catch(error){await stop();throw error}},45000)
 afterAll(stop,timeout)
 const withPage=async(run:(page:Page)=>Promise<void>,initScript?:string)=>{const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));if(initScript)await page.addInitScript(initScript);try{await page.goto(endpoint,{waitUntil:'domcontentloaded',timeout});await check(page.getByTestId('learning-screen')).toBeVisible();await run(page);expect(errors).toEqual([])}catch(error){throw Error('Production LearningScreen fixture failed; pageErrors='+JSON.stringify(errors)+'; body='+await page.locator('body').innerText(),{cause:error})}finally{await context.close()}}
 it('initial render shows the dashboard and the stubbed candidate content',()=>withPage(async page=>{
  await check(page.getByTestId('learning-dashboard')).toBeVisible()
  await check(page.getByText('Self-improvement dashboard')).toBeVisible()
  await check(page.getByText('Observation recorded from stub session')).toBeVisible()
  await page.getByTestId('learning-view-candidates').click()
  await check(page.getByTestId('learning-row').first()).toBeVisible()
  expect(await page.getByTestId('learning-row').count()).toBe(3)
  await check(page.getByText('Prefer bun add over editing package.json by hand')).toBeVisible()
  await check(page.getByText('Never run destructive git clean inside shared checkouts')).toBeVisible()
  await check(page.getByTestId('learning-row-confidence').first()).toContainText('82%')
  expect((await methodCalls(page,'listLearningCandidates'))[0]?.args).toEqual(['fixture-workspace'])
  expect((await methodCalls(page,'getLearningStats'))[0]?.args).toEqual(['fixture-workspace'])
  expect((await methodCalls(page,'getLearningTimeline'))[0]?.args).toEqual(['fixture-workspace',200])
  expect((await methodCalls(page,'getLearningPolicy'))[0]?.args).toEqual(['fixture-workspace'])
 }),timeout)
 it('approve, rollback and revalidate call the bridge and the UI reflects the result',()=>withPage(async page=>{
  await page.getByTestId('learning-view-candidates').click()
  await page.locator('[data-candidate-id="cand-skill-1"]').click()
  await check(page.getByTestId('learning-detail')).toBeVisible()
  await page.getByTestId('learning-approve').click()
  await check(page.getByTestId('learning-confirm')).toBeVisible()
  await page.getByTestId('learning-confirm').click()
  await check.poll(()=>methodCalls(page,'approveLearningCandidate')).not.toHaveLength(0)
  expect((await methodCalls(page,'approveLearningCandidate'))[0]?.args).toEqual(['fixture-workspace','cand-skill-1'])
  await check(page.getByTestId('learning-result')).toContainText('Candidate promoted')
  await check(page.getByTestId('learning-mutations')).toContainText('bun-add-first')
  await page.getByTestId('learning-rollback').click()
  await check(page.getByTestId('learning-confirm')).toBeVisible()
  await page.getByTestId('learning-confirm').click()
  await check.poll(()=>methodCalls(page,'rollbackLearningCandidate')).not.toHaveLength(0)
  expect((await methodCalls(page,'rollbackLearningCandidate'))[0]?.args).toEqual(['fixture-workspace','cand-skill-1'])
  await check(page.getByTestId('learning-result')).toContainText('Changes reverted')
  await page.getByTestId('learning-revalidate').click()
  await check.poll(()=>methodCalls(page,'revalidateLearningCandidate')).not.toHaveLength(0)
  expect((await methodCalls(page,'revalidateLearningCandidate'))[0]?.args).toEqual(['fixture-workspace','cand-skill-1'])
 }),timeout)
 it('a rejected load renders the real error affordance and retry resolves back to rows',()=>withPage(async page=>{
  await page.getByTestId('learning-view-candidates').click()
  await check(page.getByTestId('learning-load-error')).toBeVisible()
  await check(page.getByTestId('learning-load-error')).toContainText('Could not load learning data')
  expect(await page.getByTestId('learning-row').count()).toBe(0)
  const before=(await methodCalls(page,'listLearningCandidates')).length
  await setFailList(page,false)
  await page.getByRole('button',{name:'Retry',exact:true}).click()
  await check(page.getByTestId('learning-row').first()).toBeVisible()
  await check.poll(async()=>(await methodCalls(page,'listLearningCandidates')).length).toBeGreaterThan(before)
  expect(await page.getByTestId('learning-load-error').count()).toBe(0)
 },'window.__learningFailList = true'),timeout)
 it('Tab reaches an interactive control and a candidate card exposes its hover affordance',()=>withPage(async page=>{
  await page.keyboard.press('Tab')
  const focused=await activeElement(page)
  expect(focused.tag).toBe('BUTTON')
  expect(focused.focused).toBe(true)
  expect(focused.testid).toBe('learning-view-dashboard')
  await page.getByTestId('learning-view-candidates').click()
  await check(page.getByTestId('learning-row').first()).toBeVisible()
  const row=page.locator('[data-candidate-id="cand-skill-1"]')
  await page.mouse.move(4,4)
  const rest=await row.evaluate(element=>getComputedStyle(element).backgroundColor)
  await row.hover()
  await check.poll(()=>row.evaluate(element=>getComputedStyle(element).backgroundColor)).not.toBe(rest)
  expect(await row.evaluate(element=>getComputedStyle(element).cursor)).toBe('pointer')
  expect(await row.evaluate(element=>element.matches(':hover'))).toBe(true)
 }),timeout)
 it('captures full-page evidence for initial, interaction, error and retry states',async()=>{
  mkdirSync(evidenceDir,{recursive:true})
  await withPage(async page=>{
   await check(page.getByTestId('learning-dashboard')).toBeVisible()
   await page.waitForTimeout(200)
   await page.screenshot({path:resolve(evidenceDir,'01-initial.png'),fullPage:true})
   await page.getByTestId('learning-view-candidates').click()
   await check(page.getByTestId('learning-row').first()).toBeVisible()
   await page.locator('[data-candidate-id="cand-skill-1"]').click()
   await check(page.getByTestId('learning-detail')).toBeVisible()
   await page.getByTestId('learning-approve').click()
   await check(page.getByTestId('learning-confirm')).toBeVisible()
   await page.getByTestId('learning-confirm').click()
   await check(page.getByTestId('learning-result')).toContainText('Candidate promoted')
   await page.screenshot({path:resolve(evidenceDir,'02-interaction.png'),fullPage:true})
  })
  await withPage(async page=>{
   await page.getByTestId('learning-view-candidates').click()
   await check(page.getByTestId('learning-load-error')).toBeVisible()
   await page.screenshot({path:resolve(evidenceDir,'03-error.png'),fullPage:true})
   await setFailList(page,false)
   await page.getByRole('button',{name:'Retry',exact:true}).click()
   await check(page.getByTestId('learning-row').first()).toBeVisible()
   await page.screenshot({path:resolve(evidenceDir,'04-retry.png'),fullPage:true})
  },'window.__learningFailList = true')
  for(const name of shots)expect(statSync(resolve(evidenceDir,name)).size).toBeGreaterThan(0)
 },timeout)
})