import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser } from '@playwright/test'
let browser: Browser, server: ReturnType<typeof Bun.serve>
beforeAll(async () => {
 const built = await Bun.build({ entrypoints: [new URL('./fixtures/responsive-tools/main.tsx', import.meta.url).pathname], target: 'browser', tsconfig: new URL('../../../../../../tsconfig.json', import.meta.url).pathname })
 if (!built.success) throw new Error(built.logs.map(String).join('\n'))
 const script = await built.outputs[0]!.text()
 server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) { return new URL(request.url).pathname === '/main.js' ? new Response(script, { headers: { 'content-type': 'text/javascript' } }) : new Response('<!doctype html><html><head><style>body{margin:0;font-family:sans-serif}.fixture-owner{width:360px;padding:12px;display:flex;flex-direction:column;gap:8px}.fixture-owner[hidden]{display:none}button,input,textarea{font:inherit}button{min-height:28px}[role=dialog]{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:20px;width:320px;background:white;border:1px solid black;z-index:100}.sash-box{height:100px;position:relative;margin-left:80px}.sash-box>div{height:100px}.sash-box [role=separator]{position:absolute;top:0;left:0;width:12px;height:100px;background:#aaa}</style></head><body><div id=root></div><script type=module src=/main.js></script></body></html>', { headers: { 'content-type': 'text/html' } }) } })
 browser = await chromium.launch({ executablePath: process.env.ROX_BROWSER_PATH ?? process.env.CHROMIUM_EXECUTABLE, headless: true })
}, 60_000)
afterAll(async () => { await browser?.close(); server?.stop(true) }, 30_000)
async function pageFixture() { const page = await browser.newPage({ viewport: { width: 700, height: 700 } }); await page.goto(server.url.href); await page.waitForFunction(() => !!(window as any).notesTools); return page }

test('real narrow tool open/edit/Escape traps focus and restores the actual clicked control without losing mounted document draft', async () => {
 const page = await pageFixture()
 try {
  await page.getByRole('textbox', { name: 'Document draft' }).fill('Unsaved retained text')
  await page.getByRole('button', { name: 'Comments', exact: true }).click()
  await page.getByRole('dialog', { name: 'Comments' }).waitFor()
  await page.getByRole('textbox', { name: 'Comment draft' }).fill('Unsent comment')
  await page.keyboard.press('Tab'); expect(await page.locator('[role=dialog]').evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' })
  expect(await page.getByRole('button', { name: 'Comments', exact: true }).evaluate(el => el === document.activeElement)).toBe(true)
  expect(await page.getByRole('textbox', { name: 'Document draft' }).inputValue()).toBe('Unsaved retained text')
  expect(await page.evaluate(() => localStorage.getItem('notes:rails:v1'))).toBeNull()
 } finally { await page.close() }
}, 30_000)
for (const operation of ['hide','inert','scope','note'] as const) test(`real owner ${operation} revokes controlled sheet and never focuses a hidden/inert owner`, async () => {
 const page = await pageFixture()
 try {
  await page.getByRole('button', { name: 'Contents', exact: true }).click(); await page.getByRole('dialog', { name: 'Contents' }).waitFor()
  await page.evaluate(operation => (window as any).notesTools[operation](), operation); await page.getByRole('dialog').waitFor({ state: 'hidden' })
  if (operation === 'hide' || operation === 'inert') expect(await page.evaluate(() => !!document.activeElement?.closest('[hidden],[inert]'))).toBe(false)
 } finally { await page.close() }
}, 30_000)

test('real sash keyboard/IME bounds use persisted140–480 and pointer cancel/unmount removes its lease', async () => {
 const page = await pageFixture()
 try {
  const sash = page.getByRole('separator', { name: 'Resize contents' }); await sash.focus(); await page.keyboard.press('End')
  expect(await page.getByTestId('width').textContent()).toBe('480'); expect(await sash.getAttribute('aria-valuemax')).toBe('480')
  await sash.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', isComposing: true, bubbles: true })))
  expect(await page.getByTestId('width').textContent()).toBe('480')
  await page.keyboard.press('Home'); expect(await page.getByTestId('width').textContent()).toBe('140')
  const baseline = await page.evaluate(() => (window as any).notesTools.listeners())
  const box = await sash.boundingBox(); if (!box) throw new Error('Actual rendered sash has no layout')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2); await page.mouse.up()
  expect(Number(await page.getByTestId('width').textContent())).toBeGreaterThan(140); expect(await page.evaluate(() => (window as any).notesTools.listeners())).toBe(baseline)
  await sash.focus(); await page.keyboard.press('Home')
  await sash.dispatchEvent('pointerdown', { button: 2, pointerId: 7, clientX: 80 }); expect(await page.evaluate(() => (window as any).notesTools.listeners())).toBe(baseline)
  await sash.dispatchEvent('pointerdown', { button: 0, pointerId: 7, clientX: 80 }); expect(await page.evaluate(() => (window as any).notesTools.listeners())).toBe(baseline + 5)
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: 200 }))); expect(await page.getByTestId('width').textContent()).toBe('140')
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 200 }))); expect(await page.getByTestId('width').textContent()).toBe('260')
  await page.keyboard.press('Escape'); expect(await page.getByTestId('width').textContent()).toBe('140'); expect(await page.evaluate(() => (window as any).notesTools.listeners())).toBe(baseline)
  await sash.dispatchEvent('pointerdown', { button: 0, pointerId: 9, clientX: 80 }); await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9 }))); expect(await page.evaluate(() => (window as any).notesTools.listeners())).toBe(baseline)
  await sash.dispatchEvent('pointerdown', { button: 0, pointerId: 10, clientX: 80 }); await page.evaluate(() => (window as any).notesTools.unmount()); expect(await page.evaluate(() => (window as any).notesTools.listeners())).toBe(baseline)
 } finally { await page.close() }
}, 30_000)
