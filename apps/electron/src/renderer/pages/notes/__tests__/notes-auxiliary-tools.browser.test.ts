import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser } from '@playwright/test'
let browser: Browser, server: ReturnType<typeof Bun.serve>
beforeAll(async () => {
 const built = await Bun.build({ entrypoints: [new URL('./fixtures/auxiliary-tools/main.tsx', import.meta.url).pathname], target: 'browser', tsconfig: new URL('../../../../../../tsconfig.json', import.meta.url).pathname })
 if (!built.success) throw new Error(built.logs.map(String).join('\n'))
 const script = await built.outputs[0]!.text()
 server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) { return new URL(request.url).pathname === '/main.js' ? new Response(script, { headers: { 'content-type': 'text/javascript' } }) : new Response('<!doctype html><html><head><style>body{margin:0;font-family:sans-serif}.fixture-owner{width:360px;padding:12px;display:flex;flex-direction:column;gap:8px}.fixture-owner[hidden]{display:none}button,input,textarea{font:inherit}button{min-height:28px}[role=dialog]{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:20px;width:320px;background:white;border:1px solid black;z-index:100}.sash-box{height:100px;position:relative;margin-left:80px}.sash-box>div{height:100px}.sash-box [role=separator]{position:absolute;top:0;left:0;width:12px;height:100px;background:#aaa}</style></head><body><div id=root></div><script type=module src=/main.js></script></body></html>', { headers: { 'content-type': 'text/html' } }) } })
 browser = await chromium.launch({ executablePath: process.env.ROX_BROWSER_PATH ?? process.env.CHROMIUM_EXECUTABLE, headless: true })
}, 60_000)
afterAll(async () => { await browser?.close(); server?.stop(true) }, 30_000)
async function pageFixture() { const page = await browser.newPage({ viewport: { width: 700, height: 700 } }); page.on('pageerror',error=>console.error('Fixture pageerror:',error.message)); await page.goto(server.url.href); await page.waitForFunction(() => !!(window as any).auxiliary); return page }

test('actual narrow Inspector edits use current owner, Escape returns focus and leaves document/draft/preferences intact',async()=>{
 const page=await pageFixture();try{
 await page.getByRole('textbox',{name:'Document draft'}).fill('Retained unsaved document')
 await page.getByRole('button',{name:'Inspector',exact:true}).click();await page.getByRole('dialog',{name:'Inspector'}).waitFor()
 await page.getByPlaceholder('Tags draft').fill('Edited unsent tags');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})
 expect(await page.getByRole('button',{name:'Inspector',exact:true}).evaluate(el=>el===document.activeElement)).toBe(true)
 expect(await page.getByRole('textbox',{name:'Document draft'}).inputValue()).toBe('Retained unsaved document')
 expect(await page.evaluate(()=>localStorage.getItem('notes:inspector-collapsed'))).toBeNull()
 await page.getByRole('button',{name:'Inspector',exact:true}).click();expect(await page.getByPlaceholder('Tags draft').inputValue()).toBe('Edited unsent tags')
 }finally{await page.close()}
},30_000)

test('actual contextual session opens narrow, edits its current prompt owner, expands without closing and Escape preserves draft',async()=>{
 const page=await pageFixture();try{
 await page.getByRole('button',{name:'Open note chat'}).click();await page.getByRole('dialog',{name:'Note chat'}).waitFor()
 await page.getByPlaceholder('Chat draft').fill('Captured unsent session prompt')
 await page.evaluate(()=>(window as any).auxiliary.wide());await page.getByRole('dialog').waitFor({state:'hidden'});expect(await page.evaluate(()=>(window as any).auxiliary.closes())).toBe(0)
 expect(await page.getByPlaceholder('Chat draft').inputValue()).toBe('Captured unsent session prompt')
 await page.evaluate(()=>(window as any).auxiliary.narrow());await page.getByRole('dialog',{name:'Note chat'}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})
 expect(await page.evaluate(()=>(window as any).auxiliary.closes())).toBe(1)
 await page.getByRole('button',{name:'Open note chat'}).click();expect(await page.getByPlaceholder('Chat draft').inputValue()).toBe('Captured unsent session prompt')
 }finally{await page.close()}
},30_000)
for(const operation of ['scope','note','hide','inert'] as const)test(`actual narrow Inspector ${operation} closes and never restores focus to unavailable owner`,async()=>{
 const page=await pageFixture();try{await page.getByRole('button',{name:'Inspector',exact:true}).click();await page.getByRole('dialog',{name:'Inspector'}).waitFor();await page.evaluate(operation=>(window as any).auxiliary[operation](),operation);await page.getByRole('dialog').waitFor({state:'hidden'});if(operation==='hide'||operation==='inert')expect(await page.evaluate(()=>!!document.activeElement?.closest('[hidden],[inert]'))).toBe(false)}finally{await page.close()}
},30_000)
