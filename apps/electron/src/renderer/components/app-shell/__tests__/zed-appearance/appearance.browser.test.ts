import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { chromium, expect as playwrightExpect, type Browser, type BrowserContext, type Page } from 'playwright/test'
import { resolveChromiumExecutable } from '../../../../test-utils/chromium-executable'

const fixture = import.meta.dirname
const repository = resolve(fixture, '../../../../../../../..')
const proofDirectory = process.env.ROX_APPEARANCE_PROOF_DIR ?? resolve(homedir(), 'Pictures/Shots/Agents/rox-zed-appearance/fixtures')
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
    await new Promise<void>((resolveListen, reject) => { listener.once('error', reject); listener.listen(5189, '127.0.0.1', resolveListen) })
  } catch {
    await new Promise<void>((resolveListen, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolveListen) })
  }
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('Appearance fixture could not reserve a port')
  await new Promise<void>((resolveClose, reject) => listener.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

const executablePath = await browserExecutable()

// This proves production renderer behavior under browser CSS and synthetic
// transport. Native vibrancy/GPU/compositor paint and real config-server
// readback require their separate application acceptance runs.
describe.skipIf(!executablePath)('Zed appearance integrated browser regression', () => {
  let server: ReturnType<typeof Bun.spawn> | undefined
  let compiling: ReturnType<typeof Bun.spawn> | undefined
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let fixtureUrl: string
  const pageErrors: string[] = []
  let serverLog = Promise.resolve('')
  let runEvidence: Record<string, unknown> | undefined
  const evidenceSources = [
    'apps/electron/src/renderer/index.css',
    'apps/electron/vite.config.ts',
    'apps/electron/src/renderer/context/ThemeContext.tsx',
    'packages/shared/src/config/theme.ts',
    'apps/electron/src/renderer/hooks/useShellAppearance.ts',
    'apps/electron/src/renderer/lib/web-chrome-preference.ts',
    'apps/electron/src/renderer/components/app-shell/PanelResizeSash.tsx',
    'apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx',
    'apps/electron/src/renderer/components/app-shell/TerminalPanel.tsx',
    'apps/electron/src/renderer/components/session-inspector/InspectorTerminal.tsx',
    'packages/ui/src/context/ShikiThemeContext.tsx',
    'packages/ui/src/components/markdown/CodeBlock.tsx',
    ...['main.tsx', 'bootstrap.ts', 'vite.config.ts', 'appearance.browser.test.ts'].map(name => `apps/electron/src/renderer/components/app-shell/__tests__/zed-appearance/${name}`),
    ...['nordfox-opaque', 'min-dark-blurred', 'siri-light'].map(id => `apps/electron/resources/themes/${id}.json`),
  ]
  const sourceHashes = () => Object.fromEntries(evidenceSources.map(path => [path, createHash('sha256').update(readFileSync(resolve(repository, path))).digest('hex')]))

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
    // All handles refer to processes started by this fixture. Close in parallel
    // so a preview-server shutdown cannot wait on a browser still holding HTTP
    // sockets; bounded termination never targets another task's process.
    await Promise.all([stopChild(ownedServer), stopChild(ownedBuild), browser?.close().catch(() => {})])
  }

  beforeAll(async () => {
    try {
      mkdirSync(proofDirectory, { recursive: true })
      const initialSourceSha256 = sourceHashes()
      const port = await availablePort()
      fixtureUrl = `http://127.0.0.1:${port}`
      const outputText = (stream: ReadableStream | number | undefined) => typeof stream === 'number' ? Promise.resolve('') : new Response(stream).text()
      // Exercise final optimized CSS. A dev server can preserve a standard
      // backdrop declaration that the production optimizer later removes.
      compiling = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), 'build', '--config', resolve(fixture, 'vite.config.ts')], { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
      const buildLog = Promise.all([outputText(compiling.stdout), outputText(compiling.stderr)]).then(logs => logs.join('\n'))
      const buildCode = await compiling.exited
      compiling = undefined
      writeFileSync(resolve(proofDirectory, 'fixture-build.log'), await buildLog)
      if (buildCode !== 0) throw new Error(`Production appearance fixture did not compile:\n${await buildLog}`)
      server = Bun.spawn(['node', resolve(repository, 'node_modules/vite/bin/vite.js'), 'preview', '--config', resolve(fixture, 'vite.config.ts'), '--port', String(port)], { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
      serverLog = Promise.all([outputText(server.stdout), outputText(server.stderr)]).then(logs => logs.join('\n'))
      const deadline = Date.now() + 30_000
      for (;;) {
        try {
          const response = await fetch(fixtureUrl)
          if (response.ok && (await response.text()).includes('ROX appearance regression fixture')) break
        } catch { /* Only our own newly started server is awaited. */ }
        if (server.exitCode !== null || Date.now() > deadline) throw new Error(`Appearance fixture server did not start${server.exitCode !== null ? `: ${await serverLog}` : ''}`)
        await Bun.sleep(100)
      }
      // Launch the owned browser directly: `launchServer` + `connect` never
      // completes its websocket under the CI Bun (1.3.14), while `launch` is the
      // path every other browser fixture here uses.
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
      mkdirSync(proofDirectory, { recursive: true })
      const compiledAssets = resolve(repository, 'node_modules/.vite-zed-appearance/compiled-fixture/assets')
      const compiledCssSha256 = Object.fromEntries(readdirSync(compiledAssets).filter(name => name.endsWith('.css')).map(name => [name, createHash('sha256').update(readFileSync(resolve(compiledAssets, name))).digest('hex')]))
      runEvidence = { fixtureOnly: true, cssPipeline: 'production-build', nativeCompositor: false, serverTransport: 'synthetic', startedAt: new Date().toISOString(), browser: await browser.version(), executablePath, bunVersion: Bun.version, repository, compiledCssSha256, sourceSha256: initialSourceSha256 }
      writeFileSync(resolve(proofDirectory, 'fixture-environment.json'), JSON.stringify(runEvidence, null, 2))
      const warmup = await browser.newPage({ viewport: { width: 1720, height: 900 } })
      const startupErrors: string[] = []
      let runtimeError: Error | undefined
      warmup.on('pageerror', error => { runtimeError = error; startupErrors.push(error.message) })
      warmup.on('console', message => { if (message.type() === 'error') startupErrors.push(message.text()) })
      await warmup.goto(fixtureUrl)
      try {
        const warmupDeadline = Date.now() + 60_000
        while (!await warmup.getByTestId('composer').locator('.input-container').isVisible()) {
          if (runtimeError) throw runtimeError
          if (Date.now() > warmupDeadline) throw new Error('Production composer did not mount before the fixture warmup deadline')
          await Bun.sleep(100)
        }
      } catch (error) {
        await warmup.screenshot({ path: resolve(proofDirectory, 'startup-failure.png'), fullPage: true, timeout: 15_000 })
        throw new Error(`${String(error)}\nBrowser startup errors: ${startupErrors.join('\n')}`)
      }
      await warmup.close()
    } catch (error) {
      await stopResources()
      throw new Error(`${String(error)}\n${await serverLog}`)
    }
  }, 900_000)

  beforeEach(async () => {
    pageErrors.length = 0
    context = await browser.newContext({ viewport: { width: 1720, height: 900 }, colorScheme: 'light' })
    page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.setDefaultNavigationTimeout(30_000)
    page.on('pageerror', error => pageErrors.push(error.message))
  }, 45_000)
  afterEach(async () => { try { expect(pageErrors).toEqual([]) } finally { await context?.close() } }, 45_000)
  afterAll(async () => {
    try {
      if (runEvidence) {
        const finalSources = sourceHashes()
        const sourcesUnchangedDuringRun = JSON.stringify(runEvidence.sourceSha256) === JSON.stringify(finalSources)
        writeFileSync(resolve(proofDirectory, 'fixture-environment.json'), JSON.stringify({ ...runEvidence, endedAt: new Date().toISOString(), sourcesUnchangedDuringRun, finalSourceSha256: finalSources }, null, 2))
        expect(sourcesUnchangedDuringRun).toBe(true)
      }
    } finally { await stopResources() }
  }, 300_000)

  const load = async (query = '') => {
    await page.goto(`${fixtureUrl}/?${query}`)
    await expectDOM(page.getByTestId('theme-state')).not.toContainText('none')
    await expectDOM(page.getByTestId('composer').locator('.input-container')).toBeVisible()
  }
  const themeState = () => page.evaluate(() => (window as any).__zedAppearanceFixture.theme)
  const transportCalls = () => page.evaluate(() => (window as any).__zedAppearanceFixture.calls)
  const computed = async () => page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    const rgba = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data] }
    const selectors = {
      root: 'html', body: 'body', app: '#root', row: '[data-testid="panel-row"]',
      topbar: '[data-testid="topbar"]', sidebar: '[data-testid="sidebar"]', sidebarInner: '[data-testid="sidebar-inner"]', navigator: '[data-testid="navigator"]', navigatorInner: '[data-testid="navigator-inner"]', inspector: '[data-testid="inspector"]', strip: '[data-testid="strip"]',
      work: '[data-testid="work-panel"]', second: '[data-testid="second-panel"]', sash: '[data-sash-pair]',
      dock: '[data-terminal-panel]', cell: '[data-terminal-cell]', terminal: '.rox-inspector-terminal', dockHeader: '[data-terminal-panel] > .h-6',
      control: '[data-testid="control"]', card: '[data-testid="card"] > div', composer: '.input-container', code: '[data-testid="code"] > div',
    }
    const result = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
      const element = document.querySelector(selector) as HTMLElement
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return [key, {
        radius: style.borderRadius, background: style.backgroundColor, rgba: rgba(style.backgroundColor), color: style.color,
        backdrop: style.backdropFilter, shadow: style.boxShadow, gap: style.gap,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        margins: [style.marginLeft, style.marginRight], border: [style.borderLeftWidth, style.borderRightWidth], verticalBorder: [style.borderTopWidth, style.borderBottomWidth], position: style.position,
        font: style.fontFamily, fontSize: style.fontSize,
        rect: { left: rect.left, right: rect.right, width: rect.width, top: rect.top, bottom: rect.bottom, height: rect.height },
      }]
    }))
    return { ...result, attrs: { runtime: document.documentElement.dataset.shellRuntime, material: document.documentElement.dataset.shellMaterial, cssMaterial: document.documentElement.dataset.shellCssMaterial, layer: document.documentElement.dataset.material, texture: document.documentElement.dataset.materialTexture, mode: document.documentElement.className, mismatch: document.documentElement.dataset.themeMismatch }, media: { coarse: matchMedia('(pointer: coarse)').matches, reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches, moreContrast: matchMedia('(prefers-contrast: more)').matches, forcedColors: matchMedia('(forced-colors: active)').matches } } as any
  })
  const cssVar = (name: string) => page.evaluate(variable => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(), name)
  // Sample the fixed floating/reading surfaces (chat zone, composer, popover).
  // The fixture DOM has no chat zone, so an element carrying the production
  // marker is constructed inside the fixture root when the selector is absent;
  // the construct is removed before returning so later assertions are unaffected.
  const materialSurface = (spec: { selector?: string; className?: string; attribute?: [string, string] }) => page.evaluate((input) => {
    const root = document.getElementById('root')!
    const existing = input.selector ? document.querySelector<HTMLElement>(input.selector) : null
    const element = existing ?? document.createElement('div')
    if (!existing) {
      if (input.className) element.className = input.className
      if (input.attribute) element.setAttribute(input.attribute[0], input.attribute[1])
      root.appendChild(element)
    }
    const style = getComputedStyle(element)
    // Live CSSStyleDeclaration: materialize every value while the probe is
    // still attached, because a detached node reports empty strings.
    const background = style.backgroundColor
    const backdrop = style.backdropFilter
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = background
    context.fillRect(0, 0, 1, 1)
    const rgba = [...context.getImageData(0, 0, 1, 1).data]
    if (!existing) element.remove()
    return { background, rgba, backdrop, constructed: !existing }
  }, spec)
  const seam = (styles: any, hit: number) => {
    expect(styles.row.gap).toBe('0px')
    expect(styles.row.padding).toEqual(['0px', '0px', '0px', '0px'])
    expect(styles.sash.rect.width).toBe(hit)
    expect(styles.sash.margins).toEqual([`${-hit / 2}px`, `${-hit / 2}px`])
    expect(styles.work.rect.right).toBeCloseTo(styles.second.rect.left, 1)
    expect(styles.work.rect.width + styles.second.rect.width).toBeCloseTo(styles.row.rect.width, 1)
    expect(styles.sash.rect.left + hit / 2).toBeCloseTo(styles.work.rect.right, 1)
    // Only the second pane owns this ordinary one-pixel divider.
    expect(styles.work.border[1]).toBe('0px')
    expect(styles.second.border[0]).toBe('1px')
  }
  const terminalSeam = (styles: any) => {
    // The terminal is the last cell of the first column: it closes flush with
    // the stack bottom, carries only its own ordinary top divider and takes
    // half of the column height instead of a full-width dock band.
    expect(styles.dock.verticalBorder[0]).toBe('1px')
    expect(styles.dock.rect.width).toBeCloseTo(styles.work.rect.width, 1)
    expect(styles.dock.rect.width).toBeLessThan(styles.row.rect.width * 0.75)
    expect(styles.cell.rect.bottom).toBeCloseTo(styles.row.rect.bottom, 1)
    expect(styles.dock.rect.bottom).toBeCloseTo(styles.cell.rect.bottom, 1)
    expect(styles.dock.rect.top).toBeCloseTo(styles.work.rect.bottom, 1)
    expect(styles.cell.rect.height).toBeCloseTo(styles.work.rect.height, 0)
    expect(styles.dockHeader.rect.height).toBeGreaterThan(0)
    // Header dimensions scale with the existing font density and must stay
    // stable: the transcript starts directly after the header row.
    expect(styles.dockHeader.rect.bottom).toBeCloseTo(styles.terminal.rect.top, 1)
    expect(styles.dock.radius).toBe('0px')
    expect(styles.dock.shadow).toBe('none')
    expect(styles.dock.rgba[3]).toBe(255)
    expect(styles.terminal.rgba[3]).toBe(255)
    expect(styles.dock.backdrop).toBe('none')
  }
  const proof = async (name: string) => {
    await page.screenshot({ path: resolve(proofDirectory, `${name}.png`), fullPage: true, timeout: 15_000 })
    writeFileSync(resolve(proofDirectory, `${name}.json`), JSON.stringify({ fixtureOnly: true, url: page.url(), theme: await themeState(), styles: await computed(), transportCalls: await transportCalls(), pageErrors }, null, 2))
  }
  const emulateFeature = async (name: string, value: string) => {
    const session = await context.newCDPSession(page)
    await session.send('Emulation.setEmulatedMedia', { features: [{ name, value }] })
    // Keep the session alive. Chromium clears CDP media overrides on detach.
  }

  it.each([
    ['nordfox-opaque', 'light', 'dark', [46, 52, 64, 255], 'rgb(144, 157, 173)', 'rgb(163, 190, 140)'],
    ['min-dark-blurred', 'light', 'dark', [26, 26, 26, 255], 'rgb(136, 136, 136)', 'rgb(121, 184, 255)'],
    ['siri-light', 'dark', 'light', [239, 241, 245, 255], 'rgb(106, 110, 120)', 'rgb(39, 127, 43)'],
  ] as const)('renders %s with its own palette on %s OS, opaque work and glass chrome', async (id, os, mode, canvas, commentColor, ansiGreen) => {
    await page.emulateMedia({ colorScheme: os })
    await load(`theme=${id}`)
    await expectDOM(page.getByTestId('theme-state')).toContainText(`${id} · ${mode} · ipc`)
    const commentLine = page.getByTestId('code').locator('.shiki .line').first()
    await expectDOM(commentLine).toHaveText('// Theme regression')
    const comment = commentLine.locator('span').filter({ hasText: 'Theme regression' }).first()
    expect(await comment.evaluate(element => getComputedStyle(element).color)).toBe(commentColor)
    const styles = await computed()
    expect((await themeState()).systemPreference).toBe(os)
    expect(styles.attrs).toMatchObject({ runtime: 'web', material: 'solid' })
    expect(styles.attrs.mode.split(' ')).toContain(mode)
    expect(styles.attrs.mismatch).toBeUndefined()
    for (const key of ['root', 'work', 'second', 'code', 'dock', 'terminal']) expect(styles[key].rgba).toEqual([...canvas])
    if (id === 'min-dark-blurred') {
      // Blurred presets auto-activate the Zed-parity glass: body/#root clear so
      // the shell glass shows, while every reading/work surface stays opaque.
      expect(styles.attrs.layer).toBe('on')
      expect(styles.body.rgba[3]).toBe(0)
      expect(styles.app.rgba[3]).toBe(0)
    } else {
      expect(styles.body.rgba).toEqual([...canvas])
      expect(styles.app.rgba).toEqual([...canvas])
    }
    for (const key of ['work', 'second', 'sidebar', 'navigator', 'inspector', 'topbar', 'dock']) expect(styles[key].radius).toBe('0px')
    // The adopted radius scale maps controls, cards, the composer and code
    // blocks to --radius-md (8px); only shell panes stay flush.
    for (const key of ['control', 'card', 'composer', 'code']) expect(styles[key].radius).toBe('8px')
    for (const key of ['topbar', 'sidebar', 'navigator', 'inspector', 'strip']) {
      expect(styles[key].rgba[3]).toBeGreaterThan(0)
      expect(styles[key].rgba[3]).toBeLessThan(255)
      expect(styles[key].backdrop).toContain('blur(20px)')
    }
    for (const key of ['sidebarInner', 'navigatorInner']) {
      expect(styles[key].rgba[3]).toBe(0)
      expect(styles[key].backdrop).toBe('none')
    }
    await page.getByTestId('toggle-compact-navigator').click()
    const compact = await computed()
    expect(compact.navigatorInner.rgba[3]).toBe(0)
    expect(compact.navigatorInner.backdrop).toBe('none')
    expect(compact.navigator.rgba).toEqual(styles.navigator.rgba)
    expect(compact.navigator.backdrop).toBe(styles.navigator.backdrop)
    expect(styles.work.backdrop).toBe('none')
    expect(styles.work.shadow).toBe('none')
    seam(styles, 8)
    terminalSeam(styles)
    const terminalInput = page.locator('.rox-inspector-terminal').getByRole('textbox', { name: 'Command', exact: true })
    await terminalInput.fill('fixture ANSI only')
    await terminalInput.press('Enter')
    const ansiOutput = page.locator('.rox-inspector-terminal pre span').filter({ hasText: 'fixture ANSI output' })
    await expectDOM(ansiOutput).toBeVisible()
    expect(await ansiOutput.evaluate(element => getComputedStyle(element).color)).toBe(ansiGreen)
    expect((await transportCalls()).filter((call: any) => call.method === 'runShellCommand')).toEqual([{ method: 'runShellCommand', value: { command: 'fixture ANSI only' } }])
    await page.getByTestId('open-popover').click()
    await expectDOM(page.getByTestId('popover')).toBeVisible()
    // Popovers and dialogs resolve their radius through --radius-md on the
    // adopted scale.
    expect(await page.getByTestId('popover').evaluate(element => getComputedStyle(element).borderRadius)).toBe('8px')
    // Use real overlay controls for these appearance snapshots. Global overlay
    // Escape routing belongs to the complete application acceptance surface.
    await page.getByTestId('open-popover').click()
    await expectDOM(page.getByTestId('popover')).toBeHidden()
    await page.getByTestId('open-dialog').click()
    await expectDOM(page.getByTestId('dialog')).toBeVisible()
    expect(await page.getByTestId('dialog').evaluate(element => getComputedStyle(element).borderRadius)).toBe('8px')
    await page.getByTestId('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expectDOM(page.getByTestId('dialog')).toBeHidden()
    await proof(`palette-${id}-${os}-os`)
  }, 45_000)

  it('keeps fine-pointer hit area out of layout while dragging, cancelling and using keyboard', async () => {
    await load()
    const initial = await computed()
    seam(initial, 8)
    const sash = page.locator('[data-sash-pair]')
    const box = await sash.boundingBox()
    if (!box) throw new Error('Production sash has no bounds')
    await page.mouse.move(box.x + box.width / 2, box.y + 100)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + 100, { steps: 8 })
    await page.mouse.up()
    await expectDOM(sash).not.toHaveClass(/shell-sash-active/)
    const dragged = await computed()
    // Pointer events use device-coordinate rounding while the single divider
    // consumes one CSS pixel; allow at most one pixel of resulting rounding.
    expect(Math.abs(dragged.work.rect.width - initial.work.rect.width - 80)).toBeLessThan(1)
    seam(dragged, 8)
    const nextBox = await sash.boundingBox()
    await page.mouse.move(nextBox!.x + nextBox!.width / 2, nextBox!.y + 100)
    await page.mouse.down()
    await page.mouse.move(nextBox!.x + nextBox!.width / 2 - 60, nextBox!.y + 100)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect((await computed()).work.rect.width).toBeCloseTo(dragged.work.rect.width, 1)
    await sash.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    const keyboard = await computed()
    expect(keyboard.work.rect.width).toBeLessThan(dragged.work.rect.width)
    seam(keyboard, 8)
    await sash.press('Shift+ArrowRight')
    await sash.press('Escape')
    expect((await computed()).work.rect.width).toBeCloseTo(keyboard.work.rect.width, 1)
    await sash.dblclick()
    const reset = await computed()
    expect(reset.work.rect.width).toBeCloseTo(reset.second.rect.width, 1)
    expect(await page.evaluate(() => ({ cursor: document.body.style.cursor, selection: document.body.style.userSelect }))).toEqual({ cursor: '', selection: '' })
    await proof('resize-fine-pointer')
  }, 45_000)

  it('uses a 24px coarse-pointer hit area with zero flow gap and working touch capture', async () => {
    await context.close()
    context = await browser.newContext({ viewport: { width: 1720, height: 900 }, hasTouch: true, colorScheme: 'light' })
    page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.setDefaultNavigationTimeout(30_000)
    page.on('pageerror', error => pageErrors.push(error.message))
    await load()
    const initial = await computed()
    expect(initial.media.coarse).toBe(true)
    seam(initial, 24)
    terminalSeam(initial)
    const bounds = await page.locator('[data-sash-pair]').boundingBox()
    const session = await context.newCDPSession(page)
    const touch = (x: number) => [{ x, y: bounds!.y + 100 }]
    const origin = bounds!.x + bounds!.width / 2
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(origin) })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(origin + 40) })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
    await expectDOM(page.locator('[data-sash-pair]')).not.toHaveClass(/shell-sash-active/)
    const changed = await computed()
    expect(changed.work.rect.width).toBeGreaterThan(initial.work.rect.width)
    seam(changed, 24)
    await proof('resize-coarse-pointer')
  }, 45_000)

  it('keeps the terminal cell at half of the first column while its panel sash resizes', async () => {
    await load()
    const initial = await computed()
    terminalSeam(initial)
    const sash = page.locator('[data-sash-pair]')
    const box = await sash.boundingBox()
    if (!box) throw new Error('Production sash has no bounds')
    await page.mouse.move(box.x + box.width / 2, box.y + 100)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + 100, { steps: 8 })
    await page.mouse.up()
    const dragged = await computed()
    // The cell width follows the panel column; its height stays half of the
    // column (the row height) and the header never changes size.
    expect(dragged.work.rect.width).toBeGreaterThan(initial.work.rect.width + 100)
    expect(dragged.dock.rect.width).toBeCloseTo(dragged.work.rect.width, 1)
    expect(dragged.dock.rect.height).toBeCloseTo(initial.dock.rect.height, 0)
    expect(dragged.dockHeader.rect.height).toBe(initial.dockHeader.rect.height)
    seam(dragged, 8)
    terminalSeam(dragged)
    await proof('terminal-panel-cell')
  }, 45_000)

  it('unmounts the terminal cell and lets the panel fill the column when it is hidden', async () => {
    await load()
    terminalSeam(await computed())
    await page.locator('[data-terminal-panel]').getByRole('button', { name: 'Hide inspector', exact: true }).click()
    await expectDOM(page.locator('[data-terminal-panel]')).toHaveCount(0)
    await expectDOM(page.locator('[data-terminal-cell]')).toHaveCount(0)
    const work = await page.locator('[data-testid="work-panel"]').boundingBox()
    const row = await page.locator('[data-testid="panel-row"]').boundingBox()
    expect(work!.height).toBeCloseTo(row!.height, 1)
    await page.screenshot({ path: resolve(proofDirectory, 'terminal-panel-closed.png'), fullPage: true, timeout: 15_000 })
    await load()
    terminalSeam(await computed())
  }, 45_000)

  it('preview cancellation restores the saved palette and selection survives reload without changing fonts', async () => {
    await load()
    const original = await computed()
    await page.getByTestId('preview-siri').click()
    await expectDOM(page.getByTestId('theme-state')).toContainText('siri-light · light · ipc')
    const comment = page.getByTestId('code').locator('.shiki .line').first().locator('span').filter({ hasText: 'Theme regression' }).first()
    await expectDOM(comment).toHaveCSS('color', 'rgb(106, 110, 120)')
    expect((await themeState()).effectiveColorThemeSource).toBe('preview')
    expect(await transportCalls()).toEqual([])
    await page.getByTestId('cancel-preview').click()
    await expectDOM(page.getByTestId('theme-state')).toContainText('nordfox-opaque · dark · ipc')
    await expectDOM(comment).toHaveCSS('color', 'rgb(144, 157, 173)')
    expect((await computed()).work.rgba).toEqual(original.work.rgba)
    await page.getByTestId('choose-min-dark-blurred').click()
    await expectDOM(page.getByTestId('theme-state')).toContainText('min-dark-blurred · dark · ipc')
    await expectDOM(comment).toHaveCSS('color', 'rgb(136, 136, 136)')
    expect((await transportCalls()).map((call: any) => call.method)).toEqual(['setColorTheme', 'broadcastThemePreferences'])
    const selected = await computed()
    expect([selected.work.font, selected.work.fontSize]).toEqual([original.work.font, original.work.fontSize])
    await page.reload()
    await expectDOM(page.getByTestId('theme-state')).toContainText('min-dark-blurred · dark · ipc')
    await expectDOM(comment).toHaveCSS('color', 'rgb(136, 136, 136)')
    expect((await computed()).work.rgba).toEqual(selected.work.rgba)
    await proof('selection-reload')
  }, 45_000)

  it('a rejected theme write keeps the last saved palette and does not broadcast success', async () => {
    await load()
    const initial = await computed()
    await page.evaluate(() => (window as any).__zedAppearanceFixture.rejectSave(true))
    await page.getByTestId('choose-siri-light').click()
    await playwrightExpect.poll(async () => (await themeState()).themeLoadError).toBe('THEME_SAVE_FAILED')
    expect((await themeState()).colorTheme).toBe('nordfox-opaque')
    expect((await computed()).work.rgba).toEqual(initial.work.rgba)
    expect((await transportCalls()).map((call: any) => call.method)).toEqual(['setColorTheme'])
    await page.reload()
    await expectDOM(page.getByTestId('theme-state')).toContainText('nordfox-opaque · dark · ipc')
  }, 45_000)

  it('loads the bundled selected palette when preset transport is absent', async () => {
    await load('theme=siri-light&presetTransport=absent')
    await expectDOM(page.getByTestId('theme-state')).toContainText('siri-light · light · fallback')
    expect((await computed()).work.rgba).toEqual([239, 241, 245, 255])
    expect((await themeState()).themeLoadError).toContain('unavailable')
    await proof('preset-transport-fallback')
  }, 45_000)

  it('a live preference supersedes an older pending configuration read', async () => {
    await load('deferred=config')
    await page.evaluate(() => (window as any).__zedAppearanceFixture.emitThemePreference('siri-light'))
    await expectDOM(page.getByTestId('theme-state')).toContainText('siri-light · light · ipc')
    await page.evaluate(() => (window as any).__zedAppearanceFixture.resolveConfig('min-dark-blurred'))
    await page.waitForTimeout(100)
    expect((await themeState()).colorTheme).toBe('siri-light')
    expect((await computed()).work.rgba).toEqual([239, 241, 245, 255])
  }, 45_000)

  it('live app overrides supersede an older pending override read', async () => {
    await load('deferred=app')
    await page.evaluate(() => (window as any).__zedAppearanceFixture.emitAppTheme({ background: '#101112', foreground: '#eeeeee' }))
    await playwrightExpect.poll(async () => (await computed()).work.rgba).toEqual([16, 17, 18, 255])
    await page.evaluate(() => (window as any).__zedAppearanceFixture.resolveApp({ background: '#aabbcc' }))
    await page.waitForTimeout(100)
    expect((await computed()).work.rgba).toEqual([16, 17, 18, 255])
  }, 45_000)

  it('an acknowledged workspace selection supersedes its pending initial read', async () => {
    await load('deferred=workspace')
    expect(await page.evaluate(() => (window as any).__zedAppearanceFixture.selectWorkspaceTheme('siri-light'))).toBe(true)
    await expectDOM(page.getByTestId('theme-state')).toContainText('siri-light · light · ipc')
    expect((await themeState()).effectiveColorThemeSource).toBe('workspace')
    await page.evaluate(() => (window as any).__zedAppearanceFixture.resolveWorkspace('min-dark-blurred'))
    await page.waitForTimeout(100)
    expect((await themeState()).effectiveColorTheme).toBe('siri-light')
    expect((await computed()).work.rgba).toEqual([239, 241, 245, 255])
  }, 45_000)

  it('a missing custom preset removes stale previously injected palette CSS', async () => {
    await load()
    const original = await computed()
    await page.evaluate(() => (window as any).__zedAppearanceFixture.selectTheme('fixture-missing-custom-preset'))
    await playwrightExpect.poll(async () => (await themeState()).themeResolvedFrom).toBe('none')
    expect((await themeState()).themeLoadError).toContain('not returned')
    expect(await page.locator('#craft-theme-overrides').textContent()).not.toContain('#2e3440')
    expect((await computed()).work.rgba).not.toEqual(original.work.rgba)
    expect((await computed()).work.rgba[3]).toBe(255)
  }, 45_000)

  it.each(['prefers-reduced-transparency', 'prefers-contrast', 'forced-colors'])('turns browser chrome solid for %s while retaining opaque work', async (feature) => {
    await emulateFeature(feature, feature === 'prefers-contrast' ? 'more' : feature === 'forced-colors' ? 'active' : 'reduce')
    await load()
    const styles = await computed()
    const key = feature === 'prefers-contrast' ? 'moreContrast' : feature === 'forced-colors' ? 'forcedColors' : 'reducedTransparency'
    expect(styles.media[key]).toBe(true)
    for (const surface of ['topbar', 'sidebar', 'inspector', 'strip', 'work']) {
      expect(styles[surface].rgba[3]).toBe(255)
      expect(styles[surface].backdrop).toBe('none')
    }
    await proof(`browser-solid-${feature}`)
  }, 45_000)

  it('an explicit high-contrast preference turns chrome solid', async () => {
    await load()
    await page.getByTestId('control').click()
    await expectDOM(page.locator('html')).toHaveAttribute('data-contrast', 'high')
    const styles = await computed()
    for (const surface of ['topbar', 'sidebar', 'inspector', 'strip']) {
      expect(styles[surface].rgba[3]).toBe(255)
      expect(styles[surface].backdrop).toBe('none')
    }
  }, 45_000)

  it('production browser settings persist opaque/off choices and synchronize a second tab', async () => {
    await load()
    const settings = page.getByTestId('shell-settings')
    const toggle = settings.getByRole('switch', { name: 'Enable Zen Shell', exact: true })
    await expectDOM(toggle).toBeChecked()
    const second = await context.newPage()
    try {
      await second.goto(fixtureUrl)
      await expectDOM(second.locator('html')).toHaveAttribute('data-shell-css-material', 'glass')
      await page.bringToFront()
      await settings.getByRole('button', { name: 'Window material System', exact: true }).click()
      await page.locator('[data-slot="popover-content"]').getByRole('option', { name: 'Opaque', exact: true }).click()
      await expectDOM(page.locator('html')).toHaveAttribute('data-shell-css-material', 'solid')
      await second.bringToFront()
      await expectDOM(second.locator('html')).toHaveAttribute('data-shell-css-material', 'solid')
      await page.bringToFront()
      expect((await computed()).topbar.rgba[3]).toBe(255)
      expect(await transportCalls()).toEqual([])
      await page.reload()
      await expectDOM(page.locator('html')).toHaveAttribute('data-shell-css-material', 'solid')
      await settings.getByRole('button', { name: 'Window material Opaque', exact: true }).click()
      await page.locator('[data-slot="popover-content"]').getByRole('option', { name: 'Glass', exact: true }).click()
      await expectDOM(page.locator('html')).toHaveAttribute('data-shell-css-material', 'glass')
      await second.bringToFront()
      await expectDOM(second.locator('html')).toHaveAttribute('data-shell-css-material', 'glass')
      await page.bringToFront()
      await toggle.uncheck()
      await expectDOM(page.locator('html')).toHaveAttribute('data-shell-css-material', 'solid')
      await second.bringToFront()
      await expectDOM(second.locator('html')).toHaveAttribute('data-shell-css-material', 'solid')
      await page.bringToFront()
      await page.reload()
      await expectDOM(toggle).not.toBeChecked()
      expect((await computed()).topbar.rgba[3]).toBe(255)
      await proof('browser-settings-persistence')
    } finally { await second.close() }
  }, 90_000)

  it('browser storage failure retains the committed chrome preference and explains the failure', async () => {
    await load()
    const initial = await computed()
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function(key: string, value: string) {
        if (key === 'rox-web-chrome-material-v1') throw new Error('synthetic storage denial')
        return original.call(this, key, value)
      }
    })
    await page.getByTestId('shell-settings').getByRole('switch', { name: 'Enable Zen Shell', exact: true }).click()
    await expectDOM(page.getByTestId('shell-settings').getByRole('alert')).toBeVisible()
    await expectDOM(page.getByTestId('shell-settings').getByRole('switch', { name: 'Enable Zen Shell', exact: true })).toBeChecked()
    expect((await computed()).topbar.rgba).toEqual(initial.topbar.rgba)
    await expectDOM(page.locator('html')).toHaveAttribute('data-shell-css-material', 'glass')
  }, 45_000)

  it('browser settings reject a silently ignored persistence write after readback', async () => {
    await load()
    const initial = await computed()
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function(key: string, value: string) {
        if (key === 'rox-web-chrome-material-v1') return
        return original.call(this, key, value)
      }
    })
    const settings = page.getByTestId('shell-settings')
    await settings.getByRole('switch', { name: 'Enable Zen Shell', exact: true }).click()
    await expectDOM(settings.getByRole('alert')).toBeVisible()
    await expectDOM(settings.getByRole('switch', { name: 'Enable Zen Shell', exact: true })).toBeChecked()
    expect((await computed()).topbar.rgba).toEqual(initial.topbar.rgba)
    await expectDOM(page.locator('html')).toHaveAttribute('data-shell-css-material', 'glass')
    expect(await page.evaluate(() => localStorage.getItem('rox-web-chrome-material-v1'))).toBeNull()
  }, 45_000)

  it.each(['gpu-failure', 'no-healthy-paint', 'reduce-transparency', 'high-contrast', 'user-opaque', 'zen-disabled', 'unavailable'])('honors a synthetic desktop %s fallback without letting browser capability override it', async (fallback) => {
    await load(`runtime=electron&snapshot=${fallback}`)
    await expectDOM(page.locator('html')).toHaveAttribute('data-shell-runtime', 'electron')
    await expectDOM(page.locator('html')).toHaveAttribute('data-shell-material', 'solid')
    const styles = await computed()
    for (const surface of ['topbar', 'sidebar', 'inspector', 'strip', 'work']) {
      expect(styles[surface].rgba[3]).toBe(255)
      expect(styles[surface].backdrop).toBe('none')
    }
  }, 45_000)

  it('a live desktop fallback overrides earlier acknowledged glass and retains the palette', async () => {
    await load('runtime=electron')
    await expectDOM(page.locator('html')).toHaveAttribute('data-shell-material', 'vibrancy')
    const initial = await computed()
    expect(initial.topbar.rgba[3]).toBeLessThan(255)
    expect(initial.work.rgba[3]).toBe(255)
    await page.evaluate(() => (window as any).__zedAppearanceFixture.emitShell('gpu-failure'))
    await expectDOM(page.locator('html')).toHaveAttribute('data-shell-material', 'solid')
    const fallback = await computed()
    expect(fallback.topbar.rgba[3]).toBe(255)
    expect(fallback.topbar.backdrop).toBe('none')
    expect(fallback.work.rgba).toEqual(initial.work.rgba)
    await proof('desktop-policy-fallback-synthetic')
  }, 45_000)

  describe('configurable material layer', () => {
    it('applies an enabled material override through data attributes, tokens and browser glass', async () => {
      await load('material=on')
      const html = page.locator('html')
      await expectDOM(html).toHaveAttribute('data-material', 'on')
      await expectDOM(html).toHaveAttribute('data-material-texture', 'grain')
      // ThemeContext injects the per-surface tokens the material CSS consumes.
      expect(await cssVar('--material-blur-topbar')).toBe('30px')
      expect(await cssVar('--material-opacity-topbar')).toBe('50%')
      expect(await cssVar('--material-texture-kind')).toBe('grain')
      const styles = await computed()
      expect(styles.attrs.layer).toBe('on')
      expect(styles.attrs.texture).toBe('grain')
      // --material-opacity-topbar: 50% halves the opaque titlebar tint.
      expect(styles.topbar.rgba[3] / 255).toBeCloseTo(0.5, 1)
      expect(styles.topbar.backdrop).toContain('blur(30px)')
      await proof('material-enabled')
    }, 45_000)

    it('auto-activates Zed-parity glass for a blurred preset with no override', async () => {
      await load('theme=min-dark-blurred')
      const html = page.locator('html')
      await expectDOM(html).toHaveAttribute('data-material', 'on')
      await expectDOM(html).toHaveAttribute('data-blurred', 'true')
      // The preset's declared surface hints drive the tier alphas.
      expect(await cssVar('--material-opacity-topbar')).toBe('84%')
      expect(await cssVar('--material-opacity-navigator')).toBe('82%')
      expect(await cssVar('--material-opacity-chat')).toBe('55%')
      const styles = await computed()
      expect(styles.attrs.layer).toBe('on')
      // Note: theme.json stays clean — the activation is renderer-only.
      expect(styles.work.rgba[3]).toBe(255)
      expect(styles.body.rgba[3]).toBe(0)
    }, 45_000)

    it('keeps the static chrome when the material override is absent', async () => {
      await load()
      const styles = await computed()
      expect(styles.attrs.layer).toBeUndefined()
      expect(styles.attrs.texture).toBeUndefined()
      // No app override means ThemeContext injects no --material-* tokens, so
      // the shipped 20px/84% fallbacks stay in charge instead of the 30px/50%
      // material override.
      expect(await cssVar('--material-blur-topbar')).toBe('20px')
      expect(styles.topbar.rgba[3]).toBeGreaterThan(0)
      expect(styles.topbar.rgba[3]).toBeLessThan(255)
      expect(styles.topbar.backdrop).toContain('blur(20px)')
    }, 45_000)

    it.each([
      ['prefers-reduced-transparency', 'reduce'],
      ['prefers-contrast', 'more'],
    ] as const)('forces the material override solid under %s', async (feature, value) => {
      await emulateFeature(feature, value)
      await load('material=on')
      const styles = await computed()
      expect(styles.attrs.layer).toBeUndefined()
      expect(styles.topbar.rgba[3]).toBe(255)
      expect(styles.topbar.backdrop).toBe('none')
    }, 45_000)

    it('tints the chat zone, composer and popover flat surfaces with browser glass', async () => {
      await load('material=on')
      await expectDOM(page.locator('html')).toHaveAttribute('data-shell-runtime', 'web')
      // The chat zone and popover sample are absent from the fixture DOM, so a
      // marked element is constructed inside #root; the composer is real.
      const chat = await materialSurface({ attribute: ['data-focus-zone', 'chat'] })
      const composer = await materialSurface({ selector: '.input-container' })
      const popover = await materialSurface({ className: 'popover-styled' })
      expect(chat.constructed).toBe(true)
      expect(popover.constructed).toBe(true)
      expect(composer.constructed).toBe(false)
      // Each surface stays translucent (0 < alpha < 255) and, on the browser
      // runtime, composites the configured CSS blur. The composer deliberately
      // carries tint only: the chat zone is the single blur owner, so no nested
      // backdrop-filter re-samples the same pixels.
      for (const [surface, label] of [[chat, 'chat'], [popover, 'popover']] as const) {
        expect(surface.rgba[3], label).toBeGreaterThan(0)
        expect(surface.rgba[3], label).toBeLessThan(255)
        expect(surface.backdrop, label).toContain('blur(')
      }
      expect(composer.rgba[3]).toBeGreaterThan(0)
      expect(composer.rgba[3]).toBeLessThan(255)
      expect(composer.backdrop).toBe('none')
      // The translucency comes from the shipped per-surface opacity tokens.
      expect(chat.rgba[3] / 255).toBeCloseTo(Number.parseFloat(await cssVar('--material-opacity-chat')) / 100, 1)
      expect(composer.rgba[3] / 255).toBeCloseTo(Number.parseFloat(await cssVar('--material-opacity-composer')) / 100, 1)
      expect(popover.rgba[3] / 255).toBeCloseTo(Number.parseFloat(await cssVar('--material-opacity-popover')) / 100, 1)
    }, 45_000)

    it('keeps the material layers non-interactive and behind the chrome stack', async () => {
      await load('material=on')
      const chromeZ = Number(await cssVar('--z-chrome'))
      expect(chromeZ).toBeGreaterThan(0)
      const layers = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.material-layer')).map(element => {
        const style = getComputedStyle(element)
        return {
          pointerEvents: style.pointerEvents, position: style.position, zIndex: style.zIndex,
          ariaHidden: element.getAttribute('aria-hidden'), bodyLevel: element.parentElement === document.body,
        }
      }))
      expect(layers.length).toBeGreaterThan(0)
      for (const layer of layers) {
        // The fixed backdrop layers never become hit targets...
        expect(layer.pointerEvents).toBe('none')
        expect(layer.ariaHidden).toBe('true')
        // ...and paint under the chrome stack as body-level fixed backdrops.
        expect(layer.position).toBe('fixed')
        expect(layer.bodyLevel).toBe(true)
        expect(Number(layer.zIndex)).toBeLessThan(chromeZ)
      }
    }, 45_000)
  })
})
