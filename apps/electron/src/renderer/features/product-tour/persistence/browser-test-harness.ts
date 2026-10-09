import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import type { Server } from 'bun'
import type * as persistence from './index'
import type * as analytics from '../analytics'
import { resolveChromiumExecutable } from '../../../test-utils/chromium-executable'

declare global { interface Window { learningTest: typeof persistence & typeof analytics } }

/**
 * Budget for the browser-driven suites.
 *
 * Every browser case pays for context creation, navigation and Chromium
 * scheduling on top of its own assertions, so bun's 5s default is not a budget
 * — on a loaded CI runner it is the thing that fails. Repo convention is a 20s
 * floor for browser cases, tunable up to 120s via ROX_LEARNING_BROWSER_TIMEOUT_MS.
 *
 * Lifecycle hooks need a larger floor (Chromium teardown alone can run tens of
 * seconds locally), so callers can raise it via `floor`.
 */
export function learningBrowserTestBudget(floor = 20_000): number {
  return Math.min(120_000, Math.max(floor, Number(process.env.ROX_LEARNING_BROWSER_TIMEOUT_MS) || floor))
}

// Chromium's graceful shutdown is slow (tens of seconds) on some runners, so
// lifecycle hooks get their own, larger floor.
export const learningBrowserLifecycleBudget = learningBrowserTestBudget(90_000)

type LearningBrowserResources = { browser: Browser; server: Server<undefined> }

// `bun test` runs every file in one process and shares module state between
// them, so a bare singleton here is stomped the moment a sibling file's
// `afterAll` runs: analytics.test.ts closing "the" browser would tear down the
// browser progress.test.ts is still driving, and each `beforeAll` leaked the
// previous Chromium. Own the lifecycle by refcount instead — the first
// `beforeAll` builds/launches, the last `afterAll` tears down, and nothing can
// close a browser another file is still using.
let refCount = 0
let lifecycle: Promise<LearningBrowserResources> | undefined

export async function startLearningBrowserTests(): Promise<void> {
  refCount += 1
  if (!lifecycle) {
    lifecycle = launchLearningBrowser().catch(error => {
      lifecycle = undefined
      refCount = 0
      throw error
    })
  }
  await lifecycle
}

export async function stopLearningBrowserTests(): Promise<void> {
  refCount = Math.max(0, refCount - 1)
  if (refCount > 0) return
  const pending = lifecycle
  lifecycle = undefined
  const resources = await pending?.catch(() => undefined)
  await resources?.browser.close().catch(() => undefined)
  resources?.server.stop(true)
}

async function launchLearningBrowser(): Promise<LearningBrowserResources> {
  const result = await Bun.build({ entrypoints: [new URL('./browser-test-entry.ts', import.meta.url).pathname], target: 'browser', minify: false })
  if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'))
  const script = await result.outputs[0]!.text()
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new URL(request.url).pathname === '/module.js'
      ? new Response(script, { headers: { 'Content-Type': 'text/javascript' } })
      : new Response('<!doctype html><script type="module" src="/module.js"></script>', { headers: { 'Content-Type': 'text/html' } })
  } })
  const executablePath = await resolveChromiumExecutable()
  // --disable-dev-shm-usage keeps Chromium off the tiny CI-runner /dev/shm
  // (a common cause of the process dying mid-suite); the rest is standard
  // headless hardening.
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
  return { browser, server }
}

export async function inLearningBrowser<T>(run: (page: Page) => Promise<T>): Promise<T> {
  const resources = lifecycle ? await lifecycle : undefined
  if (!resources) throw new Error('Learning browser tests not started')
  const context = await resources.browser.newContext()
  const startedAt = Date.now()
  try {
    const page = await context.newPage()
    await page.goto(resources.server.url.href)
    await page.waitForFunction(() => !!window.learningTest)
    return await run(page)
  } catch (error) {
    console.error(`[learning-browser] inLearningBrowser failed after ${Date.now() - startedAt}ms`
      + ` (browser connected: ${resources.browser.isConnected()}, server: ${resources.server.url.href})`)
    throw error
  } finally { await context.close() }
}

export async function inLearningWindows<T>(run: (first: Page, second: Page) => Promise<T>): Promise<T> {
  const resources = lifecycle ? await lifecycle : undefined
  if (!resources) throw new Error('Learning browser tests not started')
  const context = await resources.browser.newContext()
  const startedAt = Date.now()
  try {
    const pages = await Promise.all([context.newPage(), context.newPage()])
    await Promise.all(pages.map(async page => {
      await page.goto(resources.server.url.href)
      await page.waitForFunction(() => !!window.learningTest)
    }))
    return await run(pages[0]!, pages[1]!)
  } catch (error) {
    console.error(`[learning-browser] inLearningWindows failed after ${Date.now() - startedAt}ms`
      + ` (browser connected: ${resources.browser.isConnected()}, server: ${resources.server.url.href})`)
    throw error
  } finally { await context.close() }
}