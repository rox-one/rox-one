/**
 * Real, authenticated production web UI acceptance, headless and disposable.
 * Run after building apps/webui and provisioning an isolated headless server:
 * bun scripts/test/zed-appearance-web-acceptance.ts
 * No cookies, tokens, network bodies, HAR or traces are written to artifacts.
 */
import assert from 'node:assert/strict'
import { chromium, type Locator, type Page } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const baseUrl = process.env.ROX_APPEARANCE_TEST_URL ?? 'http://127.0.0.1:9199'
const tokenFile = process.env.ROX_APPEARANCE_TEST_TOKEN_FILE ?? '/tmp/rox-zed-appearance-web/token'
const artifactDir = process.env.ROX_APPEARANCE_TEST_ARTIFACTS ?? '/Users/t/Pictures/Shots/Agents/rox-zed-appearance/web'
const executablePath = process.env.ROX_APPEARANCE_TEST_CHROMIUM ?? '/Users/t/Library/Caches/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const cases = [
  { id: 'nordfox-opaque', label: 'Nordfox - opaque', os: 'light', visual: 'dark', background: '#2e3440' },
  { id: 'min-dark-blurred', label: 'Min Dark (Blurred)', os: 'light', visual: 'dark', background: '#1A1A1A' },
  { id: 'siri-light', label: 'Siri Light', os: 'dark', visual: 'light', background: '#EFF1F5' },
  { id: 'pierre', label: 'Pierre', os: 'dark', visual: 'dark', background: '' },
] as const
const routeCases = [
  { label: 'Главная', id: 'home' }, { label: 'Сессии', id: 'allSessions' },
  { label: 'Заметки', id: 'notes' }, { label: 'Задачи', id: 'tasks' },
  { label: 'Встречи', id: 'meetings' }, { label: 'Входящие', id: 'inbox' },
  { label: 'Настройки', id: 'settings/appearance' },
] as const
await mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath })
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, colorScheme: 'dark' })
let page = await context.newPage()
const pageErrors: string[] = []
const report: any = { kind: 'production-authenticated-web', baseUrl, screenshots: [], matrix: [], persistence: {}, workspacePriority: {}, material: {}, responsive: [], pageErrors,
  responsiveControls: [], screenshotReadbacks: [], themeSettling: [], startupReadiness: [], limitations: [], buildIndexSha256: createHash('sha256').update(await readFile(resolve('apps/webui/dist/index.html'))).digest('hex') }
page.on('pageerror', error => pageErrors.push(error.message))
async function waitUsable(p: Page, phase: string) {
  const started = performance.now()
  // Mounted chrome/theme attributes do not prove the startup overlay has
  // finished. Wait for the real overlay to leave; never suppress or bypass it.
  try {
    await p.waitForFunction(() => Boolean((window as any).electronAPI)
      && Boolean(document.querySelector('.chrome-topbar')) && !document.querySelector('.fixed.inset-0.z-splash'),
      undefined, { timeout: 25_000 })
  } catch (error) {
    report.startupBlocked = { phase, elapsedMs: performance.now() - started, ...await p.evaluate(() => ({
      visibility: document.visibilityState, api: Boolean((window as any).electronAPI),
      chrome: Boolean(document.querySelector('.chrome-topbar')),
      route: new URLSearchParams(location.search).get('route'),
      splashes: [...document.querySelectorAll<HTMLElement>('.z-splash')].map(element => {
        const style = getComputedStyle(element), rect = element.getBoundingClientRect()
        return { classes: element.className, position: style.position, opacity: style.opacity,
          pointerEvents: style.pointerEvents, width: rect.width, height: rect.height,
          animations: element.getAnimations().map(animation => ({ playState: animation.playState, currentTime: animation.currentTime })) }
      }),
    })).catch(() => ({ diagnosticUnavailable: true })) }
    throw error
  }
  report.startupReadiness.push({ phase, elapsedMs: performance.now() - started, splashAbsent: true })
}
async function authenticate(p: Page) {
  await p.goto(baseUrl)
  if (await p.locator('#password').count()) {
    await p.locator('#password').fill((await readFile(tokenFile, 'utf8')).trim())
    await p.locator('#submit-btn').click()
  }
  await p.waitForFunction(() => Boolean((window as any).electronAPI) && Boolean(document.querySelector('.chrome-topbar')), undefined, { timeout: 25_000 })
  await waitUsable(p, 'authenticate')
  await p.waitForTimeout(500)
  const skip = p.getByRole('button', { name: 'Пропустить', exact: true })
  if (await skip.isVisible()) await skip.click()
}
async function appearance(p: Page) {
  await waitUsable(p, 'appearance-interaction')
  await p.getByRole('button', { name: 'Настройки', exact: true }).first().click()
  await p.getByRole('button', { name: 'Внешний вид', exact: true }).last().click()
  await p.getByText('Цветовая тема', { exact: true }).waitFor()
}
async function waitAppliedTheme(p: Page, testCase: typeof cases[number], phase: string, glass = true) {
  const started = performance.now()
  // The effective ID can be published before the asynchronous preset read
  // supplies supportedModes, palette and the resulting material attributes.
  await p.waitForFunction(({ id, visual, background, glass }) => {
    const root = document.documentElement
    return root.dataset.theme === id && root.classList.contains(visual)
      && root.dataset.shellCssMaterial === (glass ? 'glass' : 'solid')
      && (!background || getComputedStyle(root).getPropertyValue('--canvas').trim().toLowerCase() === background.toLowerCase())
  }, { ...testCase, glass }, { timeout: 15_000 })
  report.themeSettling.push({ phase, theme: testCase.id, visual: testCase.visual, material: glass ? 'glass' : 'solid', elapsedMs: performance.now() - started })
}
async function selectTheme(testCase: typeof cases[number]) {
  await appearance(page)
  await page.emulateMedia({ colorScheme: testCase.os })
  await page.getByRole('radio', { name: 'Системная', exact: true }).click()
  const row = page.locator('[data-layout="settings-row"]').filter({ has: page.getByText('Цветовая тема', { exact: true }) })
  await selectMenu(row, testCase.label)
  await waitAppliedTheme(page, testCase, 'app-theme-selection')
  await page.waitForTimeout(150)
}
async function selectMenu(row: Locator, label: string) {
  await row.getByRole('button').last().click()
  const popover = page.locator('[data-slot="popover-content"]')
  if (await popover.locator('input').count()) await popover.locator('input').fill(label)
  await popover.getByRole('option', { name: label, exact: true }).click()
}
async function snapshot(p: Page) {
  await waitUsable(page, 'snapshot')
  return p.evaluate(() => {
    const root = document.documentElement
    const style = getComputedStyle(root)
    const properties = ['--canvas', '--background', '--paper', '--foreground', '--text-primary', '--text-secondary', '--text-muted',
      '--border-subtle', '--border-strong', '--surface-titlebar', '--surface-toolbar', '--surface-tab-active', '--surface-tab-inactive',
      '--radius-control', '--radius-card', '--radius-overlay', '--radius-composer', '--font-sans', '--font-mono', '--terminal-background',
      '--terminal-foreground', '--terminal-ansi-red', '--terminal-ansi-bright-red', '--terminal-ansi-dim-red']
    const elements = [...document.querySelectorAll<HTMLElement>('.chrome-topbar,.chrome-rail,[data-panel-role], [data-inspector-panel]')]
      .filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
      .map(element => {
        const computed = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const chromeRole = element.classList.contains('chrome-topbar') ? 'topbar'
          : element.classList.contains('chrome-rail') ? 'rail'
            : element.hasAttribute('data-inspector-panel') ? 'inspector' : element.className.split(' ')[0]
        return { role: element.dataset.panelRole ?? element.dataset.shellRole ?? chromeRole,
          innerChrome: (element.dataset.panelRole ?? element.dataset.shellRole) === 'chrome' && !element.classList.contains('chrome-topbar')
            && Boolean(element.parentElement?.closest('.rox-shell-pane[data-panel-role="sidebar"],.rox-shell-pane[data-panel-role="navigator"]')),
          background: computed.backgroundColor, backdrop: computed.backdropFilter, radius: computed.borderRadius,
          font: computed.fontFamily, color: computed.color, width: rect.width, height: rect.height }
      })
    return { route: new URLSearchParams(location.search).get('route'), theme: root.dataset.theme ?? 'default',
      visual: root.classList.contains('dark') ? 'dark' : 'light', dataset: { ...root.dataset },
      roles: Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property).trim()])), elements,
      styleCount: document.querySelectorAll('#craft-theme-overrides').length,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      fontFaces: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth },
      unavailableSurfaces: [...document.querySelectorAll<HTMLElement>('[data-state="unavailable"]')].map(element=>({
        testId: element.dataset.testid ?? '', code: element.dataset.errorCode ?? '', text: element.innerText.slice(0,500) })),
      unavailableMessages: [...new Set(document.body.innerText.split('\n').map(line => line.trim())
        .filter(line => /недоступно|недоступен|недоступны/i.test(line)))],
      backgroundImage: style.getPropertyValue('--background-image').trim(),
      themeWarning: document.body.innerText.includes('Предупреждение темы:') }
  })
}
async function appearanceFormBounds(p: Page) {
  return p.evaluate(() => [...document.querySelectorAll<HTMLElement>('.appearance-settings-page [data-layout="settings-row"]')]
    .map(row => {
      const pane = row.closest<HTMLElement>('[data-panel-role="content"]')
        ?? row.closest<HTMLElement>('.appearance-settings-page')!
      const rowRect = row.getBoundingClientRect()
      const paneRect = pane.getBoundingClientRect()
      // Radix may prepend a style element, so firstElementChild is not a
      // reliable viewport. Its root shares the viewport's clipping bounds.
      const scrollViewport = row.closest('[data-slot="scroll-area"]')?.getBoundingClientRect()
      const left = Math.max(0, rowRect.left, paneRect.left)
      const right = Math.min(innerWidth, rowRect.right, paneRect.right)
      return { label: row.firstElementChild?.textContent ?? '', left, right,
        controls: [...row.querySelectorAll<HTMLElement>('button,input,select')].map(control => {
          const rect = control.getBoundingClientRect()
          const top = Math.max(0, paneRect.top, scrollViewport?.top ?? 0, rect.top)
          const bottom = Math.min(innerHeight, paneRect.bottom, scrollViewport?.bottom ?? innerHeight, rect.bottom)
          const verticallyVisible = bottom > top
          const hit = verticallyVisible ? document.elementFromPoint((rect.left + rect.right) / 2, (top + bottom) / 2) : null
          return { role: control.getAttribute('role') ?? control.tagName.toLowerCase(),
            label: control.getAttribute('aria-label') ?? control.textContent ?? '',
            left: rect.left, right: rect.right, width: rect.width,
            disabled: control.hasAttribute('disabled'), clipped: rect.left < left - 1 || rect.right > right + 1,
            inert: Boolean(control.closest('[inert],[aria-hidden="true"]')),
            verticallyVisible, receivesPointer: hit === control || Boolean(hit && control.contains(hit)) }
        }) }
    }))
}
function assertAppearanceForm(rows: Awaited<ReturnType<typeof appearanceFormBounds>>) {
  let visibleEnabledControls = 0
  for (const label of ['Режим', 'Контраст', 'Цветовая тема', 'Интерфейс', 'Чат агента', 'Терминал', 'Материал окна']) {
    assert.ok(rows.some(row => row.label.startsWith(label) && row.controls.length), `mounted Appearance controls: ${label}`)
  }
  for (const row of rows) for (const control of row.controls) {
    assert.ok(control.width > 0, `nonzero form control: ${row.label} / ${control.label}`)
    assert.equal(control.clipped, false, `form control fits its row and visible content pane: ${row.label} / ${control.label}`)
    assert.equal(control.inert, false, `Appearance control is in the active accessible pane: ${row.label} / ${control.label}`)
    if (control.verticallyVisible && !control.disabled) {
      visibleEnabledControls++
      assert.equal(control.receivesPointer, true, `visible control receives pointer: ${row.label} / ${control.label}`)
    }
  }
  assert.ok(visibleEnabledControls > 0, 'Appearance has visible interactive form controls; hit-testing is not vacuous')
}
async function narrowMenus(width: number, zoom: number) {
  const themeRow = page.locator('[data-layout="settings-row"]').filter({ has: page.getByText('Цветовая тема', { exact: true }) })
  const materialRow = page.locator('[data-layout="settings-row"]').filter({ has: page.getByText('Материал окна', { exact: true }) })
  for (const [name, row] of [['theme', themeRow], ['material', materialRow]] as const) {
    const trigger = row.getByRole('button').last()
    await trigger.scrollIntoViewIfNeeded()
    await trigger.focus()
    await trigger.press('Space')
    const popover = page.locator('[data-slot="popover-content"]')
    await popover.waitFor({ state: 'visible' })
    await page.waitForTimeout(100)
    const bounds = await popover.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: innerWidth }
    })
    assert.ok(bounds.left >= 7 && bounds.right <= bounds.viewportWidth - 7, `narrow ${name} menu fits viewport collision padding`)
    if (name === 'theme') {
      await popover.locator('input').fill('Nordfox - opaque')
      await popover.getByRole('button', { name: 'Nordfox - opaque', exact: true }).click()
      assert.equal(await page.evaluate(() => (window as any).electronAPI.getColorTheme()), 'nordfox-opaque', 'narrow theme choice persists through existing API')
    } else {
      await popover.getByRole('button', { name: 'Непрозрачный', exact: true }).click()
      await page.waitForFunction(() => document.documentElement.dataset.shellCssMaterial === 'solid')
      assertSurface(await snapshot(page), cases[0], false)
      await selectMenu(row, 'Система')
      await page.waitForFunction(() => document.documentElement.dataset.shellCssMaterial === 'glass')
      assertSurface(await snapshot(page), cases[0])
    }
    // Keyboard activation and Escape restore focus to the accessible trigger.
    await trigger.focus()
    await trigger.press('Space')
    await popover.waitFor({ state: 'visible' })
    await page.waitForTimeout(100)
    await page.keyboard.press('Escape')
    await popover.waitFor({ state: 'hidden' })
    await page.waitForTimeout(100)
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'menu Escape returns focus')
    const formAfterInteraction = await appearanceFormBounds(page)
    assertAppearanceForm(formAfterInteraction)
    report.responsiveControls.push({ physicalWidth: width, zoomPercent: zoom * 100, menu: name, bounds, keyboard: 'Space/open; Escape/focus', selected: name === 'theme' ? 'nordfox-opaque' : 'system' })
  }
  await page.getByRole('radio', { name: 'Системная', exact: true }).scrollIntoViewIfNeeded()
}
function assertSurface(snapshot_: any, testCase: typeof cases[number], glass = true) {
  assert.equal(snapshot_.theme, testCase.id)
  assert.equal(snapshot_.visual, testCase.visual)
  assert.equal(snapshot_.styleCount, 1, 'singleton theme stylesheet')
  assert.equal(snapshot_.themeWarning, false, 'no stale initialization/IPC warning')
  assert.equal(snapshot_.backgroundImage, '', 'no previous scenic image')
  assert.equal(snapshot_.dataset.themeMismatch, undefined, 'no OS mismatch tint')
  if (testCase.background) assert.equal(snapshot_.roles['--canvas'].toLowerCase(), testCase.background.toLowerCase(), 'selected opaque canvas palette')
  assert.equal(snapshot_.roles['--radius-control'], '4px')
  assert.equal(snapshot_.roles['--radius-card'], '4px')
  assert.equal(snapshot_.roles['--radius-overlay'], '6px')
  assert.equal(snapshot_.roles['--font-sans'], report.initial.fontSans, 'theme switch preserves UI font')
  assert.equal(snapshot_.roles['--font-mono'], report.initial.fontMono, 'theme switch preserves monospace font')
  const chrome = snapshot_.elements.filter((value: any) => ['chrome', 'topbar', 'rail', 'inspector', 'sidebar', 'navigator'].includes(value.role))
  for (const element of chrome) {
    assert.equal(element.radius, '0px', 'flush chrome pane corners')
    if (element.innerChrome) {
      assert.equal(element.backdrop, 'none', 'inner chrome does not paint glass twice')
      assert.equal(element.background, 'rgba(0, 0, 0, 0)', 'inner chrome stays transparent')
    }
    else if (glass) assert.match(element.backdrop, /blur\(20px\)/, 'web chrome blur fallback')
    else assert.equal(element.backdrop, 'none', 'opaque/accessibility preference disables blur')
  }
  for (const element of snapshot_.elements.filter((value: any) => value.role === 'content')) {
    assert.equal(element.radius, '0px', 'flush content pane corners')
    assert.notEqual(element.background, 'rgba(0, 0, 0, 0)', 'opaque content pane')
    assert.equal(element.backdrop, 'none', 'reading pane does not blur')
  }
}
async function screenshot(name: string) {
  await waitUsable(page, 'screenshot')
  const path = resolve(artifactDir, `${name}.png`)
  const viewportBefore = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
  // This application is fixed to its viewport. A full-page capture can reset
  // external CDP metrics to Playwright's registered viewport during capture.
  await page.screenshot({ path })
  const viewportAfter = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
  assert.deepEqual(viewportAfter, viewportBefore, 'screenshot preserves the actual layout viewport and DPR')
  const form = name.startsWith('responsive-') && name.endsWith('settings-appearance') ? await appearanceFormBounds(page) : undefined
  if (form) assertAppearanceForm(form)
  report.screenshotReadbacks.push({ name, viewportBefore, viewportAfter, appearanceControls: form?.reduce((sum, row) => sum + row.controls.length, 0) })
  report.screenshots.push(path)
}
async function route(label: string, id: string) {
  if (id === 'settings/appearance') await appearance(page)
  else await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.waitForFunction(expected => (new URLSearchParams(location.search).get('route') ?? '').startsWith(expected), id)
  await page.waitForTimeout(150)
}
try {
  await authenticate(page)
  report.presets = []
  for (const testCase of cases.slice(0, 3)) {
    const source = await readFile(resolve(`apps/electron/resources/themes/${testCase.id}.json`), 'utf8')
    const expected = JSON.parse(source)
    const loaded = await page.evaluate(id => (window as any).electronAPI.loadPresetTheme(id), testCase.id)
    assert.equal(loaded.path, '', 'browser preset DTO has no host filesystem path')
    assert.deepEqual(loaded.theme, expected, 'real theme API returns the final bundled palette')
    report.presets.push({ id: testCase.id, sourceFileSha256: createHash('sha256').update(source).digest('hex'),
      apiThemeSha256: createHash('sha256').update(JSON.stringify(loaded.theme)).digest('hex') })
  }
  const fontCdp = await context.newCDPSession(page)
  await fontCdp.send('DOM.enable')
  await fontCdp.send('CSS.enable')
  const { root: domRoot } = await fontCdp.send('DOM.getDocument')
  const { nodeId: fontNode } = await fontCdp.send('DOM.querySelector', { nodeId: domRoot.nodeId, selector: '[aria-label="Главная"]' })
  report.platformFonts = fontNode ? (await fontCdp.send('CSS.getPlatformFontsForNode', { nodeId: fontNode })).fonts : []
  const initial = await snapshot(page)
  report.initial = { theme: initial.theme, visual: initial.visual,
    fontSans: initial.roles['--font-sans'], fontMono: initial.roles['--font-mono'] }
  // A previous failed run can leave the disposable workspace override set.
  // Clear it through the actual UI before testing each app-level palette.
  const boundWorkspace = await page.evaluate(async () => (await (window as any).electronAPI.getWorkspaces())[0])
  const existingOverride = await page.evaluate(id => (window as any).electronAPI.getWorkspaceColorTheme(id), boundWorkspace.id)
  if (existingOverride) {
    await appearance(page)
    const row = page.locator('[data-layout="settings-row"]').filter({ has: page.getByText(boundWorkspace.name, { exact: true }) })
    await row.getByRole('button').last().click()
    await page.locator('[data-slot="popover-content"]').getByRole('option', { name: /^Использовать по умолчанию/ }).click()
    await page.waitForFunction(async id => await (window as any).electronAPI.getWorkspaceColorTheme(id) === null, boundWorkspace.id)
  }
  report.preconditions = { workspaceOverrideBefore: existingOverride, workspaceOverrideAfter: null,
    resetThroughProductionUi: Boolean(existingOverride), profile: 'disposable isolated appearance-test' }
  for (const testCase of cases) {
    await selectTheme(testCase)
    const saved = await page.evaluate(() => (window as any).electronAPI.getColorTheme())
    assert.equal(saved, testCase.id, 'authoritative theme API saved readback')
    for (const routeCase of routeCases) {
      await route(routeCase.label, routeCase.id)
      const current = await snapshot(page)
      report.lastSnapshot = current
      assertSurface(current, testCase)
      report.matrix.push({ preset: testCase.id, os: testCase.os, requestedRoute: routeCase.id, ...current })
      await screenshot(`${testCase.id}-${routeCase.id.replace('/', '-')}`)
    }
  }
  // Same origin, same real authenticated session: config selection survives reload and a second tab.
  const selected = cases[2]
  await selectTheme(selected)
  await page.reload()
  await waitAppliedTheme(page, selected, 'app-theme-reload')
  report.persistence.reload = await snapshot(page)
  assertSurface(report.persistence.reload, selected)
  const second = await context.newPage()
  await authenticate(second)
  await waitAppliedTheme(second, selected, 'second-tab')
  report.persistence.secondTab = await snapshot(second)
  assertSurface(report.persistence.secondTab, selected)
  await selectTheme(cases[0])
  await waitAppliedTheme(second, cases[0], 'live-second-tab')
  report.persistence.liveSecondTab = await snapshot(second)
  assertSurface(report.persistence.liveSecondTab, cases[0])
  report.persistence.api = await page.evaluate(() => (window as any).electronAPI.getColorTheme())
  await second.close()

  // Workspace selection has priority over the app default through the same real UI/API.
  await appearance(page)
  const workspace = await page.evaluate(async () => (await (window as any).electronAPI.getWorkspaces())[0])
  const workspaceId = workspace.id
  const workspaceRow = page.locator('[data-layout="settings-row"]').filter({ has: page.getByText(workspace.name, { exact: true }) })
  await selectMenu(workspaceRow, cases[2].label)
  await waitAppliedTheme(page, cases[2], 'workspace-theme-selection')
  const appRow = page.locator('[data-layout="settings-row"]').filter({ has: page.getByText('Цветовая тема', { exact: true }) })
  await selectMenu(appRow, cases[1].label)
  await page.waitForFunction(async () => await (window as any).electronAPI.getColorTheme() === 'min-dark-blurred')
  report.workspacePriority.selected = await snapshot(page)
  assertSurface(report.workspacePriority.selected, cases[2])
  report.workspacePriority.api = await page.evaluate(async id => ({
    app: await (window as any).electronAPI.getColorTheme(),
    workspace: await (window as any).electronAPI.getWorkspaceColorTheme(id),
  }), workspaceId)
  assert.deepEqual(report.workspacePriority.api, { app: cases[1].id, workspace: cases[2].id })
  await screenshot('workspace-siri-over-min-app-default')
  await page.reload()
  await waitAppliedTheme(page, cases[2], 'workspace-theme-reload')
  report.workspacePriority.reload = await snapshot(page)
  assertSurface(report.workspacePriority.reload, cases[2])
  await appearance(page)
  await selectMenu(workspaceRow, 'Использовать по умолчанию (Min Dark (Blurred))')
  await waitAppliedTheme(page, cases[1], 'workspace-theme-clear')
  report.workspacePriority.cleared = await snapshot(page)
  assertSurface(report.workspacePriority.cleared, cases[1])
  assert.equal(await page.evaluate(id => (window as any).electronAPI.getWorkspaceColorTheme(id), workspaceId), null)
  await selectTheme(cases[0])

  // Explicit opacity is browser CSS state; it does not grant native material authority.
  const materialRow = page.locator('[data-layout="settings-row"]').filter({ has: page.getByText('Материал окна', { exact: true }) })
  await selectMenu(materialRow, 'Непрозрачный')
  await page.waitForFunction(() => document.documentElement.dataset.shellCssMaterial === 'solid')
  report.material.opaque = await snapshot(page)
  assertSurface(report.material.opaque, cases[0], false)
  await screenshot('material-opaque')
  await page.reload()
  await page.waitForFunction(() => document.documentElement.dataset.shellCssMaterial === 'solid' && document.documentElement.dataset.theme === 'nordfox-opaque')
  report.material.reloadOpaque = await snapshot(page)
  assertSurface(report.material.reloadOpaque, cases[0], false)
  await appearance(page)
  await selectMenu(materialRow, 'Система')
  await page.waitForFunction(() => document.documentElement.dataset.shellCssMaterial === 'glass')
  await page.getByRole('radio', { name: 'Высокий', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.contrast === 'high')
  report.material.highContrast = await snapshot(page)
  assertSurface(report.material.highContrast, cases[0], false)
  await screenshot('material-high-contrast')
  await page.getByRole('radio', { name: 'Система', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.contrast !== 'high')
  assertSurface(await snapshot(page), cases[0])

  // Responsive checks use real production deep links discovered in the route matrix.
  // Device metrics emulate browser zoom layout; they do not claim native Chromium menu zoom.
  for (const width of [1440, 375]) for (const zoom of [1, 1.25, 1.5]) {
    // Playwright must own both viewport and DPR. Mixing its default1440/1
    // context with external CDP overrides lets capture restore stale metrics.
    const responsiveContext = await browser.newContext({ viewport: { width: Math.round(width / zoom), height: Math.round(1050 / zoom) },
      deviceScaleFactor: zoom, colorScheme: 'light' })
    page = await responsiveContext.newPage()
    page.on('pageerror', error => pageErrors.push(error.message))
    await authenticate(page)
    for (const routeCase of routeCases) {
      const url = new URL(baseUrl)
      url.searchParams.set('ws', report.persistence.reload.dataset ? new URL(page.url()).searchParams.get('ws')! : '')
      url.searchParams.set('route', routeCase.id)
      await page.goto(url.toString())
      await page.waitForFunction(() => Boolean(document.querySelector('.chrome-topbar')))
      await page.waitForTimeout(100)
      if (routeCase.id === 'settings/appearance') await page.getByText('Цветовая тема', { exact: true }).waitFor()
      const current = await snapshot(page)
      report.lastSnapshot = current
      assertSurface(current, cases[0])
      assert.equal(current.viewport.width, Math.round(width / zoom), 'actual responsive layout viewport')
      assert.equal(current.viewport.dpr, zoom, 'actual emulated DPR')
      assert.equal(current.viewport.horizontalOverflow, false, 'no root horizontal overflow')
      const form = routeCase.id === 'settings/appearance' ? await appearanceFormBounds(page) : undefined
      if (form) assertAppearanceForm(form)
      report.responsive.push({ physicalWidth: width, zoomPercent: zoom * 100, ...current, appearanceForm: form })
      if (width === 375 && form) await narrowMenus(width, zoom)
      if (routeCase.id === 'home' || routeCase.id === 'settings/appearance') await screenshot(`responsive-${width}-${zoom * 100}-${routeCase.id.replace('/', '-')}`)
    }
    await responsiveContext.close()
  }
  const blocked = report.matrix.flatMap((row: any) => row.unavailableSurfaces.map((surface: any) => ({ route: row.requestedRoute, ...surface })))
  if (blocked.length) report.limitations.push({ kind: 'existing-domain-authority', surfaces: blocked })
  const messages = report.matrix.flatMap((row: any) => row.unavailableMessages.map((message: string) => ({ route: row.requestedRoute, message })))
  if (messages.length) report.limitations.push({ kind: 'visible-unavailable-status', messages })
  report.limitations.push('This route/chrome matrix does not create a real document, code attachment, session transcript or backend terminal; their persistence and syntax/ANSI output require separate accessible domain surfaces.')
  report.limitations.push('Responsive zoom checks emulate Chromium layout/DPR metrics; native browser zoom menus are not exercised.')
  assert.equal(pageErrors.length, 0, 'no uncaught rendering errors')
  report.result = 'pass'
  console.log(JSON.stringify({ result: report.result, routeThemeCases: report.matrix.length, responsiveCases: report.responsive.length,
    persistence: Object.keys(report.persistence), workspacePriority: Object.keys(report.workspacePriority), material: Object.keys(report.material),
    screenshots: report.screenshots.length, artifactDir, pageErrors, limitations: report.limitations }, null, 2))
} catch (error) {
  report.result = 'fail'
  report.failure = error instanceof Error ? error.message : String(error)
  await page.screenshot({ path: resolve(artifactDir, 'failure.png'), fullPage: true }).catch(() => {})
  // Keep the failing page alive long enough to distinguish a persistent
  // startup block from delayed animation completion. This opt-in callback
  // only reads the same browser/context; it never reloads or bypasses UI.
  if (process.env.ROX_APPEARANCE_FAILURE_READBACK === '1') {
    report.failureReadback = []
    const started = performance.now()
    for (const delayMs of [0, 500, 1000, 3000, 6000]) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      const state = await page.evaluate(async () => {
        const api = (window as any).electronAPI
        const durable = await Promise.race([
          (async () => {
            const workspaces = await api.getWorkspaces()
            const id = workspaces[0]?.id
            return { appTheme: await api.getColorTheme(), workspaceTheme: id ? await api.getWorkspaceColorTheme(id) : null }
          })().catch(error => ({ error: String(error) })),
          new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 3000)),
        ])
        return { visibility: document.visibilityState, api: Boolean(api), chrome: Boolean(document.querySelector('.chrome-topbar')),
          theme: document.documentElement.dataset.theme, visual: document.documentElement.className,
          material: document.documentElement.dataset.shellCssMaterial, route: new URLSearchParams(location.search).get('route'), durable,
          splashes: [...document.querySelectorAll<HTMLElement>('.z-splash')].map(element => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect()
            return { classes: element.className, position: style.position, opacity: style.opacity, pointerEvents: style.pointerEvents,
              width: rect.width, height: rect.height, animations: element.getAnimations().map(animation => ({ playState: animation.playState, currentTime: animation.currentTime })) }
          }) }
      }).catch(() => ({ diagnosticUnavailable: true }))
      report.failureReadback.push({ elapsedMs: performance.now() - started, ...state })
    }
    await writeFile(resolve(artifactDir, 'failure-live-readback.json'), JSON.stringify(report.failureReadback, null, 2))
  }
  console.error(JSON.stringify({ result: 'fail', error: report.failure, artifactDir, completedCases: report.matrix.length }, null, 2))
  process.exitCode = 1
} finally {
  await writeFile(resolve(artifactDir, 'acceptance.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
