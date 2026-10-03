import {afterAll,beforeAll,describe,expect,it} from 'bun:test'
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {chromium,expect as playwrightExpect,type Browser,type Page} from 'playwright/test'
const repository=resolve(import.meta.dirname,'../../../../../../..')
const fixture=resolve(import.meta.dirname,'fixtures/panel-workspace')
const executablePath=process.env.CHROMIUM_EXECUTABLE??chromium.executablePath()
const endpoint='http://127.0.0.1:5238'
const expectDOM=playwrightExpect.configure({timeout:10000})
const preference=(page:Page,id='workspace-a')=>page.evaluate(id=>JSON.parse(localStorage.getItem('craft-panel-workspace-layout:'+id)??'null'),id)
const grid=(page:Page)=>page.locator('[data-panel-grid]')
const shape=(page:Page)=>grid(page).getAttribute('data-panel-grid')
const mode=async(page:Page,label:string)=>{await page.getByRole('button',{name:'Panel layout',exact:true}).click();await page.getByRole('menuitem',{name:new RegExp(label)}).click()}
const mounts=(page:Page)=>page.evaluate(()=>(window as any).__panelFixture.mounts as Record<string,number>)

describe.skipIf(!existsSync(executablePath))('production persistent panel container and resize',()=>{
 let server:ReturnType<typeof Bun.spawn>|undefined,browser:Browser
 const stop=async()=>{server?.kill();await browser?.close();await server?.exited}
 beforeAll(async()=>{try{server=Bun.spawn(['node',resolve(repository,'node_modules/vite/bin/vite.js'),'--config',resolve(fixture,'vite.config.ts'),'--port','5238'],{cwd:repository,stdout:'ignore',stderr:'ignore'});const deadline=Date.now()+30000;for(;;){if(server.exitCode!==null)throw Error('Panel fixture exited');try{const response=await fetch(endpoint);if(response.ok){if(!(await response.text()).includes('rox-panel-workspace-fixture'))throw Error('Foreign owner occupies fixture port');break}}catch(error){if(error instanceof Error&&error.message.includes('Foreign owner'))throw error}if(Date.now()>deadline)throw Error('Panel fixture startup timeout');await Bun.sleep(100)}browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']})}catch(error){await stop();throw error}},45000)
 afterAll(stop,30000)
 const withPage=async(run:(page:Page)=>Promise<void>)=>{const context=await browser.newContext({viewport:{width:1400,height:900},reducedMotion:'reduce'});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));try{await page.goto(endpoint);await expectDOM(grid(page)).toHaveAttribute('data-panel-grid','2x2');await run(page);expect(errors).toEqual([])}catch(error){throw Error('Production panel fixture failed; pageErrors='+JSON.stringify(errors)+'; body='+await page.locator('body').innerText(),{cause:error})}finally{await context.close()}}
 it('keeps drafts and panel identities mounted across grid, focus and compact arrangements',async()=>withPage(async page=>{
  await page.getByRole('textbox',{name:'Draft p1'}).fill('Retained first draft');await page.getByRole('textbox',{name:'Draft p2'}).fill('Retained sibling draft');await page.locator('#p1').focus();
  const initial=await mounts(page);await mode(page,'Focus');await expectDOM(page.getByRole('textbox',{name:'Draft p2'})).toHaveCount(0);expect(await page.locator('input').count()).toBe(4);
  await mode(page,'Columns');await expectDOM(grid(page)).toHaveAttribute('data-panel-grid','4x1');await expectDOM(page.getByRole('textbox',{name:'Draft p2'})).toHaveValue('Retained sibling draft');
  await mode(page,'2');await expectDOM(grid(page)).toHaveAttribute('data-panel-grid','2x2');await page.getByRole('button',{name:'Toggle compact'}).click();await expectDOM(page.locator('[data-panel-layout]')).toHaveAttribute('data-panel-layout','compact');await expectDOM(page.getByRole('textbox',{name:'Draft p1'})).toHaveValue('Retained first draft');
  await page.getByRole('button',{name:'Toggle compact'}).click();await expectDOM(page.getByRole('textbox',{name:'Draft p2'})).toHaveValue('Retained sibling draft');expect(await mounts(page)).toEqual(initial);
 }),30000)
 it('commits column and row sizes, restores them after reload and isolates workspace preferences',async()=>withPage(async page=>{
  await mode(page,'2');const x=page.locator('[data-grid-sash="x"]');const y=page.locator('[data-grid-sash="y"]');
  await x.focus();await x.press('ArrowRight');await x.press('Enter');await expectDOM.poll(async()=>Number((await preference(page))?.grids['2x2'].columns[0])).toBeGreaterThan(.5);
  await y.focus();await y.press('ArrowDown');await y.press('Enter');await expectDOM.poll(async()=>Number((await preference(page))?.grids['2x2'].rows[0])).toBeGreaterThan(.5);
  const saved=await preference(page);await page.reload();await expectDOM(grid(page)).toHaveAttribute('data-panel-grid','2x2');expect(await preference(page)).toEqual(saved);
  await page.getByRole('button',{name:'Switch workspace'}).click();await mode(page,'Columns');expect((await preference(page,'workspace-b')).mode).toBe('columns');await page.getByRole('button',{name:'Switch workspace'}).click();await expectDOM(grid(page)).toHaveAttribute('data-panel-grid','2x2');expect(await preference(page)).toEqual(saved);
 }),30000)
 it('keeps pointer preview transient and restores it on Escape before a final commit',async()=>withPage(async page=>{
  await mode(page,'2');const saved=await preference(page);const sash=page.locator('[data-grid-sash="x"]');const box=(await sash.boundingBox())!;const before=await grid(page).evaluate(element=>getComputedStyle(element).gridTemplateColumns);
  await page.mouse.move(box.x+box.width/2,box.y+Math.min(100,box.height/4));await page.mouse.down();await page.mouse.move(box.x+box.width/2+70,box.y+Math.min(100,box.height/4));await expectDOM.poll(()=>grid(page).evaluate(element=>getComputedStyle(element).gridTemplateColumns)).not.toBe(before);expect(await preference(page)).toEqual(saved);
  await page.keyboard.press('Escape');await page.mouse.up();await expectDOM.poll(()=>grid(page).evaluate(element=>getComputedStyle(element).gridTemplateColumns)).toBe(before);expect(await preference(page)).toEqual(saved);
  await page.mouse.move(box.x+box.width/2,box.y+Math.min(100,box.height/4));await page.mouse.down();await page.mouse.move(box.x+box.width/2+70,box.y+Math.min(100,box.height/4));await page.mouse.up();await expectDOM.poll(async()=>Number((await preference(page))?.grids['2x2'].columns[0])).toBeGreaterThan(.5);
 }),30000)
 it('preserves native spatial focus, while editing, dialogs and composition fence keyboard shortcuts',async()=>withPage(async page=>{
  await page.evaluate(()=>(window as any).__panelFixture.emitFocus('right'));await expectDOM(page.getByTestId('focused')).toHaveText('p2');await page.evaluate(()=>(window as any).__panelFixture.emitFocus('down'));await expectDOM(page.getByTestId('focused')).toHaveText('p4');
  const shortcut=process.platform==='darwin'?'Meta+Alt+ArrowLeft':'Control+Alt+ArrowLeft';await page.getByRole('textbox',{name:'Draft p4'}).focus();await page.keyboard.press(shortcut);await expectDOM(page.getByTestId('focused')).toHaveText('p4');
  await page.getByRole('button',{name:'Toggle dialog'}).click();await page.locator('#p4').focus();await page.keyboard.press(shortcut);await expectDOM(page.getByTestId('focused')).toHaveText('p4');await page.getByRole('button',{name:'Toggle dialog'}).click();
  await page.locator('#p4').evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,metaKey:true,ctrlKey:true,isComposing:true,bubbles:true})));await expectDOM(page.getByTestId('focused')).toHaveText('p4');await page.locator('#p4').focus();await page.keyboard.press(shortcut);await expectDOM(page.getByTestId('focused')).toHaveText('p3');
 }),30000)
 it('rejects malformed or foreign saved layout without losing usable panel geometry',async()=>withPage(async page=>{
  await page.evaluate(()=>localStorage.setItem('craft-panel-workspace-layout:workspace-a',JSON.stringify({schemaVersion:1,workspaceId:'workspace-b',mode:'grid-3',grids:{'2x2':{columns:[-1,NaN],rows:[0,0]}}})));await page.reload();await expectDOM(grid(page)).toHaveAttribute('data-panel-grid','2x2');const sizes=await page.locator('[data-panel-role="content"]').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect()));expect(sizes.every(rect=>rect.width>=320&&rect.height>=240)).toBe(true);
 }),30000)
})
