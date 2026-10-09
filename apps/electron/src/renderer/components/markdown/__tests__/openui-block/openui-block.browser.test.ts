import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { chromium, expect as playwrightExpect, type Browser, type BrowserContext, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../../../test-utils/chromium-executable'

const fixture = import.meta.dirname
const repository = resolve(fixture, '../../../../../../../..')
const proofDirectory = process.env.ROX_OPENUI_PROOF_DIR ?? resolve(homedir(), 'Pictures/Shots/Agents/rox-openui-block')
const expectDOM = playwrightExpect.configure({ timeout: 30_000 })

async function browserExecutable(): Promise<string | undefined> {
  // An explicitly configured browser path is authoritative, mirroring the
  // sibling suites' `describe.skipIf(!existsSync(executablePath))` guard: the
  // unit-recovery step parks CHROMIUM_EXECUTABLE on a path that does not exist
  // to keep browser fixtures out of the unit process, so honour it strictly and
  // never bypass it with a cache lookup.
  const configured = process.env.LEARNING_CHROMIUM_PATH ?? process.env.CHROMIUM_EXECUTABLE ?? process.env.ROX_BROWSER_PATH
  if (configured !== undefined) return existsSync(configured) ? configured : undefined
  try {
    const resolved = await resolveChromiumExecutable()
    if (existsSync(resolved)) return resolved
  } catch { /* Fall back to the Playwright browser cache below. */ }
  const cache = resolve(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(cache)) return undefined
  for (const version of readdirSync(cache).filter(name => /^chromium_headless_shell-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))) {
    const executable = resolve(cache, version, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
    if (existsSync(executable)) return executable
  }
  for (const version of readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))) {
    const executable = resolve(cache, version, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(executable)) return executable
  }
  return undefined
}

async function availablePort(): Promise<number> {
  const listener = createServer()
  try {
    await new Promise<void>((resolveListen, reject) => { listener.once('error', reject); listener.listen(5197, '127.0.0.1', resolveListen) })
  } catch {
    await new Promise<void>((resolveListen, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolveListen) })
  }
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('OpenUI block fixture could not reserve a port')
  await new Promise<void>((resolveClose, reject) => listener.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

const executablePath = await browserExecutable()

/** Window API exposed by the fixture page (main.tsx); the test is its only reader. */
interface FixtureApi {
  prompts: string[]
  urls: string[]
  program: (name: string) => string
  setScenario: (program: string, isStreaming: boolean) => void
  setScope: (scope: string | undefined) => void
  unmount: () => void
  mount: () => void
}

declare global {
  interface Window { __openuiFixture: FixtureApi }
}

// A doubling reference chain (`sN = Card([sN-1, sN-1])`) whose estimated node
// count is exponential: >10k nodes with ~20 statements, so the program guard
// refuses it before the vendor parser can run.
function doublingProgram(): string {
  const lines = ['s0 = TextContent("seed", "large-heavy")']
  for (let i = 1; i <= 19; i += 1) lines.push(`s${i} = Card([s${i - 1}, s${i - 1}])`)
  lines.push('root = Card([s19])')
  return lines.join('\n')
}

// This proves the production Markdown → lazy OpenUI chunk → Renderer pipeline in
// a real browser: fence dispatch, ROX theming, action mapping, streaming
// gating, the program guard, scope isolation, error fallback and form-state
// persistence across remounts.
describe.skipIf(!executablePath)('OpenUI block integrated browser regression', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined
  let compiling: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let fixtureUrl: string
  const pageErrors: string[] = []
  let serverLog = Promise.resolve('')

  const stopResources = async () => {
    const ownedServer = server
    const ownedBuild = compiling
    server = undefined
    compiling = undefined
    const stopChild = async (child: typeof ownedServer) => {
      if (!child) return
      if (child.exitCode === null) child.kill()
      const deadline = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 2_000)
      try { await child.exited } finally { clearTimeout(deadline) }
    }
    await Promise.all([stopChild(ownedServer), stopChild(ownedBuild), browser?.close().catch(() => {})])
  }

  beforeAll(async () => {
    try {
      mkdirSync(proofDirectory, { recursive: true })
      const port = await availablePort()
      fixtureUrl = `http://127.0.0.1:${port}`
      const outputText = (stream: ReadableStream | number | undefined) => typeof stream === 'number' ? Promise.resolve('') : new Response(stream).text()
      // Production build exercises the real lazy chunk (OpenUI + recharts) and
      // the shipped CSS pipeline; a dev server would not prove either.
      compiling = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), 'build', '--config', resolve(fixture, 'vite.config.ts')], { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
      const buildLog = Promise.all([outputText(compiling.stdout), outputText(compiling.stderr)]).then(logs => logs.join('\n'))
      const buildCode = await compiling.exited
      compiling = undefined
      writeFileSync(resolve(proofDirectory, 'fixture-build.log'), await buildLog)
      if (buildCode !== 0) throw new Error(`OpenUI block fixture did not compile:\n${await buildLog}`)
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), 'preview', '--config', resolve(fixture, 'vite.config.ts'), '--port', String(port)], { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
      serverLog = Promise.all([outputText(server.stdout), outputText(server.stderr)]).then(logs => logs.join('\n'))
      const deadline = Date.now() + 30_000
      for (;;) {
        try {
          const response = await fetch(fixtureUrl)
          if (response.ok && (await response.text()).includes('ROX OpenUI block fixture')) break
        } catch { /* Only our own newly started server is awaited. */ }
        if (server.exitCode !== null || Date.now() > deadline) throw new Error(`OpenUI block fixture server did not start${server.exitCode !== null ? `: ${await serverLog}` : ''}`)
        await Bun.sleep(100)
      }
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
      writeFileSync(resolve(proofDirectory, 'fixture-environment.json'), JSON.stringify({ fixtureOnly: true, startedAt: new Date().toISOString(), browser: await browser.version(), executablePath, bunVersion: Bun.version, repository }, null, 2))
    } catch (error) {
      await stopResources()
      throw new Error(`${String(error)}\n${await serverLog}`)
    }
  }, 900_000)

  beforeEach(async () => {
    pageErrors.length = 0
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
    page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.setDefaultNavigationTimeout(30_000)
    page.on('pageerror', error => {
      // Chromium reports the benign ResizeObserver loop notifications as a
      // window ErrorEvent; recharts schedules them during layout. They are not
      // a fixture failure.
      if (!/ResizeObserver loop/.test(error.message)) pageErrors.push(error.message)
    })
  }, 45_000)
  afterEach(async () => { try { expect(pageErrors).toEqual([]) } finally { await context?.close() } }, 45_000)
  afterAll(async () => { await stopResources() }, 30_000)

  const load = async (query = '') => {
    await page.goto(`${fixtureUrl}/?${query}`)
    await expectDOM(page.getByTestId('openui-fixture')).toBeAttached()
  }
  const block = () => page.locator('[data-ca-block-type="openui"]')
  const prompts = () => page.evaluate(() => window.__openuiFixture.prompts)

  it('renders a complete OpenUI program and dispatches the button action', async () => {
    await load('program=complete')
    const openuiBlock = block()
    await expectDOM(openuiBlock.locator('[role="group"]').first()).toHaveAttribute('aria-label', 'OPENUI_LABEL')
    // Real table DOM from the renderer's column-oriented Table.
    await expectDOM(openuiBlock.locator('table')).toBeAttached()
    await expectDOM(openuiBlock.locator('th', { hasText: 'Language' })).toBeVisible()
    await expectDOM(openuiBlock.locator('td', { hasText: 'Python' })).toBeVisible()
    await expectDOM(openuiBlock.locator('td', { hasText: '15.7' })).toBeVisible()
    // Real recharts surface from the BarChart block.
    await expectDOM(openuiBlock.locator('svg.recharts-surface').first()).toBeAttached()
    // The button carries Action([@ToAssistant(...)]) and reaches onSendPrompt.
    const button = openuiBlock.getByRole('button', { name: 'Tell me more', exact: true })
    await expectDOM(button).toBeEnabled()
    await button.click()
    await page.waitForFunction(() =>
      window.__openuiFixture.prompts.some(text => text.startsWith('Tell me more about these languages')))
    expect((await prompts()).some(text => text.startsWith('Tell me more about these languages'))).toBe(true)
    await page.screenshot({ path: resolve(proofDirectory, 'openui-complete-program.png'), fullPage: true, timeout: 15_000 })
  }, 60_000)

  it('renders the error notice and code fallback for an invalid program', async () => {
    await load('program=invalid')
    const openuiBlock = block()
    await expectDOM(page.getByText('OPENUI_RENDER_ERROR')).toBeVisible()
    const fallback = openuiBlock.locator('pre')
    await expectDOM(fallback.first()).toBeAttached()
    expect(await fallback.first().textContent()).toContain('NotARealComponent')
  }, 60_000)

  it('grows a streaming program and keeps form buttons disabled', async () => {
    await load('program=stream-partial&streaming=true')
    const openuiBlock = block()
    await expectDOM(openuiBlock.getByText('Streaming form')).toBeVisible()
    const submit = openuiBlock.getByRole('button', { name: 'Submit', exact: true })
    await expectDOM(submit).toBeDisabled()
    await expectDOM(openuiBlock.getByText('Relaxed', { exact: true })).toBeVisible()
    // Grow the same program while still streaming: the newly appended field and
    // its option must appear, and the submit button must stay disabled.
    await page.evaluate(() => window.__openuiFixture.setScenario(window.__openuiFixture.program('stream-full'), true))
    await expectDOM(openuiBlock.getByText('Active', { exact: true })).toBeVisible()
    await expectDOM(openuiBlock.getByText('Notes', { exact: true })).toBeVisible()
    await expectDOM(submit).toBeDisabled()
  }, 60_000)

  it('keeps an edited form value across unmount and remount', async () => {
    await load('program=form')
    const openuiBlock = block()
    const notes = openuiBlock.getByPlaceholder('Add notes')
    await expectDOM(notes).toBeVisible()
    await notes.fill('Hello persistence')
    await expectDOM(notes).toHaveValue('Hello persistence')
    // Same content re-mounts with the same content-hash block id, so the block's
    // form-state map must rehydrate the edited value.
    await page.evaluate(() => {
      window.__openuiFixture.unmount()
      window.__openuiFixture.mount()
    })
    const remounted = block()
    const remountedNotes = remounted.getByPlaceholder('Add notes')
    await expectDOM(remountedNotes).toBeVisible()
    await expectDOM(remountedNotes).toHaveValue('Hello persistence')
  }, 60_000)

  it('submits the form action with the label and a flat field map', async () => {
    await load('program=form')
    const openuiBlock = block()
    const notes = openuiBlock.getByPlaceholder('Add notes')
    await expectDOM(notes).toBeVisible()
    await notes.fill('Window seat please')
    const submit = openuiBlock.getByRole('button', { name: 'Plan my trip', exact: true })
    await expectDOM(submit).toBeEnabled()
    await submit.click()
    await page.waitForFunction(() =>
      window.__openuiFixture.prompts.some(text => text.startsWith('Plan a trip based on my choices')))
    const captured = (await prompts()).find(text => text.startsWith('Plan a trip based on my choices'))
    expect(captured).toBeTruthy()
    const separatorIndex = captured!.indexOf('\n\n')
    expect(separatorIndex).toBeGreaterThan(0)
    expect(captured!.slice(0, separatorIndex)).toBe('Plan a trip based on my choices')
    const payload = JSON.parse(captured!.slice(separatorIndex + 2)) as Record<string, unknown>
    // Flat `{field: value}` map: no nested raw store entries ({value, componentType}).
    for (const value of Object.values(payload)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value)
    }
    expect(Object.values(payload)).toContain('Window seat please')
  }, 60_000)

  it('enables form buttons once streaming ends', async () => {
    await load('program=stream-partial&streaming=true')
    const openuiBlock = block()
    const submit = openuiBlock.getByRole('button', { name: 'Submit', exact: true })
    await expectDOM(submit).toBeDisabled()
    await page.evaluate(() => window.__openuiFixture.setScenario(window.__openuiFixture.program('stream-partial'), false))
    await expectDOM(submit).toBeEnabled()
  }, 60_000)

  it('refuses an over-budget doubling program and stays responsive', async () => {
    await load('program=complete')
    const overBudget = doublingProgram()
    const startedAt = Date.now()
    await page.evaluate((program) => window.__openuiFixture.setScenario(program, false), overBudget)
    // Guard notice + code fallback, and the vendor Renderer is never mounted.
    await expectDOM(page.getByText('OPENUI_RENDER_ERROR')).toBeVisible()
    const openuiBlock = block()
    await expectDOM(openuiBlock.locator('pre').first()).toBeAttached()
    // The main thread is not blocked by an exponential parse.
    expect(await page.evaluate(() => 6 * 7)).toBe(42)
    expect(Date.now() - startedAt).toBeLessThan(30_000)
  }, 60_000)

  it('renders the code fallback for an empty program', async () => {
    await load('program=empty')
    const openuiBlock = block()
    await expectDOM(openuiBlock.locator('pre').first()).toBeAttached()
    await expectDOM(page.getByText('OPENUI_RENDER_ERROR')).toHaveCount(0)
  }, 60_000)

  it('isolates form state across block scopes', async () => {
    await load('program=form&scope=scope-A')
    const openuiBlock = block()
    const notes = openuiBlock.getByPlaceholder('Add notes')
    await expectDOM(notes).toBeVisible()
    await notes.fill('Scoped value')
    await expectDOM(notes).toHaveValue('Scoped value')
    await page.evaluate(() => {
      window.__openuiFixture.setScope('scope-B')
      window.__openuiFixture.unmount()
      window.__openuiFixture.mount()
    })
    const remounted = block()
    const remountedNotes = remounted.getByPlaceholder('Add notes')
    await expectDOM(remountedNotes).toBeVisible()
    await expectDOM(remountedNotes).toHaveValue('')
  }, 60_000)

  it('ties the block id prop to the rendered block id and the form-state key', async () => {
    await load('program=form&scope=tie')
    const formBlock = block()
    const firstId = await formBlock.getAttribute('data-ca-block-id')
    // The block id attribute is the exact value Markdown hands the block as its
    // `blockId` prop; form state is keyed by `${blockScope ?? ''}|${blockId}`.
    expect(firstId).toMatch(/^blk-[a-z0-9]+$/)
    await formBlock.getByPlaceholder('Add notes').fill('tied to the block id')
    // Same program + scope remounts with the same id, so that key rehydrates.
    await page.evaluate(() => {
      window.__openuiFixture.unmount()
      window.__openuiFixture.mount()
    })
    const remounted = block()
    await expectDOM(remounted.getByPlaceholder('Add notes')).toHaveValue('tied to the block id')
    expect(await remounted.getAttribute('data-ca-block-id')).toBe(firstId)
    // Different content is a different id (same scope → different key → empty).
    await page.evaluate(() => window.__openuiFixture.setScenario(window.__openuiFixture.program('stream-full'), false))
    await expectDOM(block().getByText('Streaming form')).toBeVisible()
    expect(await block().getAttribute('data-ca-block-id')).not.toBe(firstId)
  }, 60_000)
})