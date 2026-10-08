import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import type * as persistence from './index'
import type * as analytics from '../analytics'
import { resolveChromiumExecutable } from '../../../test-utils/chromium-executable'

declare global { interface Window { learningTest: typeof persistence & typeof analytics } }
let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined
export async function startLearningBrowserTests() {
  const result = await Bun.build({ entrypoints: [new URL('./browser-test-entry.ts', import.meta.url).pathname], target: 'browser', minify: false })
  if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'))
  const script = await result.outputs[0]!.text()
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new URL(request.url).pathname === '/module.js'
      ? new Response(script, { headers: { 'Content-Type': 'text/javascript' } })
      : new Response('<!doctype html><script type="module" src="/module.js"></script>', { headers: { 'Content-Type': 'text/html' } })
  } })
  const executablePath = await resolveChromiumExecutable()
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
}
export async function stopLearningBrowserTests() { await browser?.close(); server?.stop(true) }
export async function inLearningBrowser<T>(run: (page: Page) => Promise<T>): Promise<T> {
  if (!browser || !server) throw new Error('Learning browser tests not started')
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(server.url.href)
    await page.waitForFunction(() => !!window.learningTest)
    return await run(page)
  } finally { await context.close() }
}
export async function inLearningWindows<T>(run: (first: Page, second: Page) => Promise<T>): Promise<T> {
  if (!browser || !server) throw new Error('Learning browser tests not started')
  const context = await browser.newContext()
  try {
    const pages = await Promise.all([context.newPage(), context.newPage()])
    await Promise.all(pages.map(async page => {
      await page.goto(server!.url.href)
      await page.waitForFunction(() => !!window.learningTest)
    }))
    return await run(pages[0]!, pages[1]!)
  } finally { await context.close() }
}
