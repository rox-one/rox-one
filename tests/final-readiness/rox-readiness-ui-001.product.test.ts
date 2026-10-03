import { describe, expect, test } from 'bun:test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtemp, mkdir, readFile, writeFile, stat, symlink, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dir, '../..')
const enabled = process.env.ROX_UI_001_PRODUCT_E2E === '1'
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const redactLog = (value: string) => value
  .replace(/([?&](?:token|access_token|refresh_token)=)[^\s&"']+/gi, '$1[REDACTED]')
  .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
  .replace(/((?:"|')?(?:[A-Za-z_]*token|apiKey|api_key)(?:"|')?\s*[:=]\s*(?:"|')?)[^\s,"']+/gi, '$1[REDACTED]')
  .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')

type Seed = { profile: string; workspaceId: string; workspaceSlug: string; workspaceRoot: string; noteRoot: string;
  sessionA: string; sessionB: string; projectSlug: string; pageSlug: string; sourceSlug: string; skillSlug: string; noteId: string; runtime: unknown[] }

describe.skipIf(!enabled)('UI-001 actual Electron → NavigationProvider → RPC → canonical storage', () => {
  test('links, history, reload, selected deletion, resize, modal focus and native restart', async () => {
    const evidence = process.env.ROX_UI_001_EVIDENCE_DIR ?? join(root, 'docs/final-readiness/execution/cloud/OWNER-UI-001/native-e2e', `rox-readiness-ui-001-${Date.now()}`)
    await mkdir(evidence, { recursive: true })
    const profile = await mkdtemp(join(root, 'work', 'rox-readiness-ui-001-'))
    const bunPath = process.env.ROX_UI_001_BUN ?? process.execPath
    const executablePath = process.env.ROX_UI_001_ELECTRON ?? join(root, 'work/electron-39.2.7/Electron.app/Contents/MacOS/Electron')
    const bin = join(profile, 'bin'); await mkdir(bin)
    for (const [name, path] of [['bun', bunPath], ['node', '/opt/homebrew/bin/node'], ['sh', '/bin/sh'],
      ['env', '/usr/bin/env'], ['git', '/usr/bin/git'], ['uname', '/usr/bin/uname'], ['which', '/usr/bin/which']]) {
      await symlink(path!, join(bin, name!))
    }
    // The real shell loader runs a real bash login shell with startup files
    // disabled, while HOME remains the host HOME. No host shell credentials
    // enter the process and `security` is absent from its executable inventory.
    const isolatedShell = join(bin, 'isolated-shell')
    await writeFile(isolatedShell, '#!/bin/sh\nexport PATH=' + "'" + bin.replaceAll("'", "'\\''") + "'" + '\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o700 })
    // Explicit executablePath suppresses Playwright's normal unpackaged-app
    // loader. Preserve its documented loader ordering through an owned launch
    // wrapper while executing the exact cached Electron binary.
    const electronLauncher = join(bin, 'electron-launcher')
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    const electronPidPath = join(profile, 'electron.pid')
    await writeFile(electronLauncher, '#!/bin/sh\nprintf "%s\\n" "$$" > ' + quote(electronPidPath) + '\nexec ' + quote(executablePath) + ' -r '
      + quote(join(root, 'node_modules/playwright-core/lib/server/electron/loader.js')) + ' "$@"\n', { mode: 0o700 })
    const environment = { HOME: process.env.HOME!, USER: process.env.USER ?? 'ui001', TMPDIR: process.env.TMPDIR ?? '/tmp',
      LANG: 'ru_RU.UTF-8', PATH: bin, SHELL: isolatedShell, ROX_CONFIG_DIR: profile, CRAFT_CONFIG_DIR: profile,
      ROX_USER_DATA_DIR: join(profile, 'chromium'), CRAFT_USER_DATA_DIR: join(profile, 'chromium'),
      ROX_INSTANCE_NUMBER: '96', CRAFT_INSTANCE_NUMBER: '96', ROX_APP_NAME: 'ROX UI-001 acceptance',
      ROX_SKIP_PROTOCOL_REGISTRATION: '1', NODE_ENV: 'test' }
    // Keep the host HOME unchanged. ROX config and Chromium are owned roots.
    const seedChild = Bun.spawn([bunPath, join(import.meta.dir, 'rox-readiness-ui-001.seed.ts')],
      { cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe' })
    const seedOutput = await new Response(seedChild.stdout).text()
    const seedLog = await new Response(seedChild.stderr).text()
    await writeFile(join(evidence, 'rox-readiness-ui-001.seed.log'), redactLog(seedLog))
    if (await seedChild.exited !== 0) throw new Error(`Canonical disposable seed failed: ${seedLog}`)
    const seed: Seed = JSON.parse(seedOutput.trim().split('\n').at(-1)!)
    await writeFile(join(evidence, 'rox-readiness-ui-001.seed.json'), JSON.stringify(seed, null, 2))
    const git = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: root, stdout: 'pipe' })
    const inputRevision = (await new Response(git.stdout).text()).trim(); await git.exited
    const sourcePaths = ['apps/electron/src/main/index.ts', 'apps/electron/src/shared/route-parser.ts',
      'apps/electron/src/renderer/contexts/NavigationContext.tsx', 'apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx',
      'apps/electron/src/renderer/components/app-shell/AppShell.tsx', 'apps/electron/src/renderer/atoms/unified-shell.ts']
    const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha256(await readFile(join(root, path)))])))
    const buildPaths = ['apps/electron/dist/main.cjs', 'apps/electron/dist/bootstrap-preload.cjs', 'apps/electron/dist/renderer/index.html',
      ...(await readdir(join(root, 'apps/electron/dist/renderer/assets'))).filter(path => /\.(?:js|css)$/.test(path)).sort()
        .map(path => 'apps/electron/dist/renderer/assets/' + path)]
    const buildHashes = Object.fromEntries(await Promise.all(buildPaths.map(async path => [path, sha256(await readFile(join(root, path)))])))
    const buildReceipts = await Promise.all(['main', 'renderer'].map(async kind => {
      try { return JSON.parse(await readFile(join(root, `work/rox-readiness-ui-001-build-${kind}.json`), 'utf8')) }
      catch { return null }
    }))
    const qualifiedBuild = buildReceipts.every(receipt => receipt?.inputRevision === inputRevision)
      && buildReceipts[0]?.sourceManifestSha256 === buildReceipts[1]?.sourceManifestSha256
    const russian = JSON.parse(await readFile(join(root, 'packages/shared/src/i18n/locales/ru.json'), 'utf8'))
    const observations: Record<string, unknown> = { inputRevision, sourceHashes, buildHashes, profile,
      driver: { versions: process.versions, executablePath: process.execPath, canonicalSeedBunPath: bunPath },
      electronExecutableSha256: sha256(await readFile(executablePath)),
      buildProvenanceQualified: qualifiedBuild, buildReceipts,
      buildQualifier: qualifiedBuild ? 'frozen source manifest checked before and after main/renderer builds'
        : 'provisional product replay; current source snapshot does not bind the earlier generated build',
      acceptanceLevel: 'actual local macOS Electron with shipped RPC and disposable canonical backend',
      fullDoDClosed: false, platformLimits: ['Windows 10/11 DPI and native acceptance not run', 'Hosted web ingress/transport acceptance not run'],
      protocolRegistration: 'explicit test-only guard; OS protocol registration itself not exercised',
      environmentIsolation: { homePreserved: environment.HOME === process.env.HOME, credentialsInherited: false,
        realLoginShellWithoutStartupFiles: true, executableInventory: ['bun', 'node', 'sh', 'env', 'git', 'uname', 'which'],
        keychainCliAvailable: false } }
    const screenshots: unknown[] = []
    const errors: string[] = []
    const logs: string[] = []
    const stages: unknown[] = []
    let app: ElectronApplication | null = null
    let launchCompleted = false
    let page: Page
    const stage = (name: string) => { observations.stage = name; stages.push({ name, at: new Date().toISOString() }); console.log(`UI-001 native stage: ${name}`) }
    const closeNative = async () => {
      if (!app) return
      const closing = app
      const normal = await Promise.race([closing.close().then(() => true).catch(() => false),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 20_000))])
      if (!normal) {
        observations.quitRecovery = 'normal quit exceeded 20s after state save; owned process terminated'
        closing.process().kill('SIGKILL')
      }
      app = null
    }
    const capture = async (name: string) => {
      const path = join(evidence, `rox-readiness-ui-001.${name}.png`)
      const bytes = await page.screenshot({ path })
      screenshots.push({ name, path, sha256: sha256(bytes) })
      await writeFile(join(evidence, `rox-readiness-ui-001.${name}.txt`), await page.locator('body').innerText())
    }
    const route = () => page.evaluate(() => new URL(location.href).searchParams.get('route'))
    const navigate = async (target: string) => {
      await page.evaluate(target => window.dispatchEvent(new CustomEvent('rox-navigate', { detail: { route: target } })), target)
      await page.waitForFunction(target => new URL(location.href).searchParams.get('route') === target, target)
      expect(await route()).toBe(target)
    }
    const ready = async () => {
      await page.waitForLoadState('domcontentloaded')
      await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 40_000 })
      await page.waitForFunction(() => !!document.querySelector('#onboarding-username')
        || !!document.querySelector('[data-shell-role="chrome"]'), null, { timeout: 40_000 })
      const name = page.locator('#onboarding-username')
      if (await name.isVisible()) {
        await name.fill('UI-001 acceptance')
        await page.getByRole('button', { name: /^(Начать|Get started|Start)$/i }).click()
        await name.waitFor({ state: 'hidden', timeout: 30_000 })
      }
      await page.waitForFunction(() => window.electronAPI.isChannelAvailable('sessions:get'), null, { timeout: 40_000 })
      const skip = page.getByRole('button', { name: 'Пропустить', exact: true })
      if (await skip.isVisible()) await skip.click()
      await page.locator('[data-shell-role="chrome"]').first().waitFor({ timeout: 40_000 })
    }
    const launch = async () => {
      launchCompleted = false
      app = await _electron.launch({ executablePath: electronLauncher, args: ['--disable-gpu', join(root, 'apps/electron')], env: environment, timeout: 120_000 })
      launchCompleted = true
      app.process().stderr?.on('data', bytes => logs.push(String(bytes)))
      app.process().stdout?.on('data', bytes => logs.push(String(bytes)))
      page = await app.firstWindow()
      page.on('pageerror', error => errors.push(error.message))
      await ready()
      observations.runtime = await app.evaluate(() => ({ versions: process.versions, platform: process.platform, arch: process.arch, executablePath: process.execPath }))
    }
    const direct = async (target: string) => {
      const url = new URL(page.url()); url.searchParams.set('route', target); url.searchParams.set('ws', seed.workspaceSlug)
      url.searchParams.delete('panels'); url.searchParams.delete('fi')
      await page.goto(url.toString())
      await ready(); await page.waitForFunction(target => new URL(location.href).searchParams.get('route') === target, target)
    }
    const missing = async (expectedRoute: string) => {
      const [, type, entity] = expectedRoute.split('/')
      if (type === 'source' || type === 'skill') {
        const surface = page.getByTestId('route-resource-missing'); await surface.waitFor({ timeout: 30_000 })
        expect(await surface.getAttribute('data-route-resource')).toBe(type)
        expect(await surface.getAttribute('data-route-entity')).toBe(entity)
      } else if (type === 'session') {
        const surface = page.getByTestId('route-session-missing'); await surface.waitFor({ timeout: 30_000 })
        expect(await surface.getAttribute('data-route-entity')).toBe(entity)
      } else if (type === 'note') await page.getByTestId('route-note-missing').waitFor({ timeout: 30_000 })
      else if (type === 'project') await page.getByText(russian['projectInfo.notFound'], { exact: true }).waitFor({ timeout: 30_000 })
      else if (type === 'page') await page.getByText(russian['pages.notFound'], { exact: true }).waitFor({ timeout: 30_000 })
      else if (type === 'item') {
        const surface = page.getByTestId('extra-screen-item-unavailable'); await surface.waitFor({ timeout: 30_000 })
        expect(await surface.getAttribute('data-item-id')).toBe(entity)
      } else await page.getByTestId('route-unavailable').waitFor({ timeout: 30_000 })
      expect(await route()).toBe(expectedRoute)
      expect(await page.locator('body').innerText()).not.toContain('Что-то пошло не так')
    }
    try {
      stage('boot-native-product'); await launch(); await capture('boot')
      const initial = await page.evaluate(async seed => ({ workspace: await window.electronAPI.getWindowWorkspace(),
        sources: (await window.electronAPI.getSources(seed.workspaceId)).map(source => source.config.slug),
        enabledSources: (await window.electronAPI.getSources(seed.workspaceId)).filter(source => source.config.enabled).map(source => source.config.slug),
        skills: (await window.electronAPI.getSkills(seed.workspaceId, seed.workspaceRoot)).map(skill => skill.slug),
        project: await window.electronAPI.getProject(seed.workspaceId, seed.projectSlug),
        page: await window.electronAPI.getPage(seed.workspaceId, seed.pageSlug), note: await window.electronAPI.readNote(seed.workspaceId, seed.noteId) }), seed)
      expect(initial.workspace).toBe(seed.workspaceId); expect(initial.sources).toContain(seed.sourceSlug); expect(initial.skills).toContain(seed.skillSlug)
      expect(initial.enabledSources).toEqual([])
      expect(initial.project?.config.slug).toBe(seed.projectSlug); expect(initial.page?.config.slug).toBe(seed.pageSlug)
      expect(initial.note.content).toContain('UI001 canonical note body')
      observations.canonicalReadbacks = { workspace: initial.workspace, sourcePresent: true, skillPresent: true,
        projectSlug: initial.project?.config.slug, pageSlug: initial.page?.config.slug, noteSourceHash: sha256(initial.note.content) }

      stage('native-open-url-callback')
      const nativeDeepLink = `rox://workspace/${seed.workspaceId}/allSessions/session/${seed.sessionA}`
      const ingressInvoked = await app!.evaluate(({ app }, url) => {
        let prevented = false
        app.emit('open-url', { preventDefault: () => { prevented = true } }, url)
        return prevented
      }, nativeDeepLink)
      expect(ingressInvoked).toBe(true)
      await page.waitForFunction(target => new URL(location.href).searchParams.get('route') === target, `allSessions/session/${seed.sessionA}`)
      const searchQuery = 'UI001 native query'
      await app!.evaluate(({ app }, input) => app.emit('open-url', { preventDefault() {} },
        `rox://workspace/${input.workspaceId}/search?q=${encodeURIComponent(input.query)}`), { workspaceId: seed.workspaceId, query: searchQuery })
      await page.waitForFunction(target => new URL(location.href).searchParams.get('route') === target,
        'search?' + new URLSearchParams({ q: searchQuery }).toString())
      await page.waitForFunction(query => [...document.querySelectorAll('input')].some(input => input.value === query), searchQuery)
      observations.nativeIngress = { registeredOpenUrlCallbackInvoked: true, canonicalSessionSelected: true,
        searchQueryPreservedThroughMainTransportAndRenderer: true, osProtocolDispatchExercised: false }
      await capture('native-open-url-query')

      stage('session-direct-reload-history')
      const sessionARoute = `allSessions/session/${seed.sessionA}`
      const sessionBRoute = `allSessions/session/${seed.sessionB}`
      await navigate(sessionARoute); await page.getByText('UI001 session A', { exact: true }).first().waitFor()
      await direct(sessionBRoute); await page.getByText('UI001 session B', { exact: true }).first().waitFor()
      await page.reload(); await ready(); expect(await route()).toBe(sessionBRoute)
      await capture('session-direct-reload')

      stage('source-project-history')
      const sourceRoute = `sources/source/${seed.sourceSlug}`
      const projectRoute = `projects/project/${seed.projectSlug}`
      await navigate(sourceRoute); await page.getByText('UI001 local source', { exact: true }).first().waitFor()
      await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected), seed.workspaceRoot)
      await navigate(projectRoute); await page.getByText('UI001 project', { exact: true }).first().waitFor()
      await page.getByText('UI001 canonical project description', { exact: true }).first().waitFor()
      await page.evaluate(() => history.back()); await page.waitForFunction(target => new URL(location.href).searchParams.get('route') === target, sourceRoute)
      await page.getByText('UI001 local source', { exact: true }).first().waitFor()
      await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected), seed.workspaceRoot)
      await page.evaluate(() => history.forward()); await page.waitForFunction(target => new URL(location.href).searchParams.get('route') === target, projectRoute)
      await page.getByText('UI001 project', { exact: true }).first().waitFor(); await capture('history-forward-project')

      stage('canonical-detail-hosts')
      await direct(`skills/skill/${seed.skillSlug}`); await page.getByText('UI001 canonical skill body.', { exact: false }).first().waitFor()
      await direct(`notes/note/${seed.noteId}`); await page.getByText('UI001 canonical note body.', { exact: false }).first().waitFor()
      await direct(`pages/page/${seed.pageSlug}`); await page.getByText('UI001 page', { exact: true }).first().waitFor()
      await page.frameLocator('iframe[title="UI001 page"]').getByText('UI001 canonical page body', { exact: true }).waitFor()
      await capture('canonical-page')

      stage('unavailable-capability-routes')
      for (const [target, selector] of [
        ['terminal/ui001-absent-terminal', '[data-testid="terminal-surface-unavailable"]'],
        ['browser/ui001-absent-browser', '[data-testid="browser-surface-missing"], [data-testid="browser-surface-unavailable"]'],
        ['cloud-run/ui001-absent-run', '[data-testid="cloud-run-surface-not-found"], [data-testid="cloud-run-surface-unavailable"]'],
        ['knowledge/block/ui001-absent-block', '[data-testid="knowledge-entity-unavailable"]'],
        ['extension/ui001-absent-extension/ui001-absent-view', '[data-testid="extension-surface-unavailable"]'],
      ]) {
        await direct(target!); await page.locator(selector!).waitFor({ timeout: 30_000 })
        expect(await route()).toBe(target!); await capture(target!.split('/')[0]! + '-unavailable')
      }
      for (const screen of ['dossier', 'radar', 'decisions', 'agents', 'focus']) {
        const target = `${screen}/item/ui001-absent-item`
        await direct(target); await missing(target); await capture(`${screen}-missing`)
      }
      observations.unsupportedTargets = { terminal: 'unavailable with requested ID retained', cloudRun: 'missing/unavailable without provider calls',
        knowledge: 'missing/unavailable without configured provider', extension: 'missing installed ID', extraScreens: 'five missing selected IDs' }

      stage('geometry-resize-and-modal')
      await navigate(sessionARoute)
      const sashes = page.getByRole('separator')
      await sashes.first().waitFor()
      const sash = sashes.first(); const valueBefore = Number(await sash.getAttribute('aria-valuenow'))
      await sash.focus(); await sash.press('ArrowLeft'); await sash.press('Enter')
      const valueAfter = Number(await sash.getAttribute('aria-valuenow'))
      expect(valueAfter).toBeLessThan(valueBefore)
      const preferences = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.includes('shell-layout') || key === 'craft-sidebar-width' || key === 'craft-session-list-width')))
      await page.reload(); await ready(); expect(Number(await page.getByRole('separator').first().getAttribute('aria-valuenow'))).toBe(valueAfter)
      const box = await page.getByRole('separator').first().boundingBox(); expect(box).not.toBeNull()
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down()
      await page.mouse.move(box!.x + box!.width / 2 + 12, box!.y + box!.height / 2); await page.mouse.up()
      const pointerValue = Number(await page.getByRole('separator').first().getAttribute('aria-valuenow'))
      expect(pointerValue).toBeGreaterThan(valueAfter)
      observations.geometry = { valueBefore, valueAfter, pointerValue, persisted: preferences }
      await capture('geometry-persisted')

      // The shipped title menu opens the real Radix rename modal; the draft is
      // cancelled so no provider operation or unrelated persistence is needed.
      const titleButton = page.getByRole('button', { name: 'UI001 session A', exact: true }).last()
      await titleButton.click()
      await page.getByRole('menuitem', { name: /Переименовать|Rename/i }).first().click()
      const dialog = page.getByRole('dialog'); await dialog.waitFor()
      const focusedInDialog = () => page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))
      expect(await focusedInDialog()).toBe(true)
      await page.keyboard.press('Tab'); expect(await focusedInDialog()).toBe(true)
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800))
      await page.waitForTimeout(150)
      expect(await focusedInDialog()).toBe(true)
      const modalBounds = await dialog.boundingBox(); expect(modalBounds).not.toBeNull()
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(modalBounds!.x).toBeGreaterThanOrEqual(0); expect(modalBounds!.y).toBeGreaterThanOrEqual(0)
      expect(modalBounds!.x + modalBounds!.width).toBeLessThanOrEqual(viewport.width)
      expect(modalBounds!.y + modalBounds!.height).toBeLessThanOrEqual(viewport.height)
      await capture('modal-after-native-resize'); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
      observations.modal = { openedThroughShippedMenu: true, trappedFocus: true, usableAfterNativeResize: true, cancelledWithoutSaving: true }

      stage('zoom-layout-usable')
      const zoom = []
      for (const factor of [1, 1.5, 2]) {
        await app!.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(factor), factor)
        await page.waitForTimeout(150)
        const bounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio,
          handles: [...document.querySelectorAll('[role="separator"]')].map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }) }))
        if (bounds.width >= 768) expect(bounds.handles.length).toBeGreaterThan(0)
        expect(bounds.handles.every(handle => handle.width > 0 && handle.height > 0)).toBe(true)
        zoom.push({ factor, ...bounds }); await capture(`zoom-${factor}`)
      }
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1))
      observations.zoom = zoom

      stage('live-source-deletion')
      await navigate(sourceRoute)
      await page.evaluate(seed => window.electronAPI.deleteSource(seed.workspaceId, seed.sourceSlug), seed)
      expect(await page.evaluate(async seed => (await window.electronAPI.getSources(seed.workspaceId)).some(source => source.config.slug === seed.sourceSlug), seed)).toBe(false)
      await missing(sourceRoute); await capture('source-deleted'); await page.reload(); await ready(); await missing(sourceRoute)
      await page.getByTestId('route-resource-retry').click(); await missing(sourceRoute)

      stage('live-skill-deletion')
      const skillRoute = `skills/skill/${seed.skillSlug}`
      await navigate(skillRoute)
      await page.evaluate(seed => window.electronAPI.deleteSkill(seed.workspaceId, seed.skillSlug), seed)
      expect(await page.evaluate(async seed => (await window.electronAPI.getSkills(seed.workspaceId, seed.workspaceRoot)).some(skill => skill.slug === seed.skillSlug), seed)).toBe(false)
      await missing(skillRoute); await capture('skill-deleted')
      await page.getByTestId('route-resource-retry').click(); await missing(skillRoute)
      await page.reload(); await ready(); await missing(skillRoute)

      stage('live-project-deletion')
      await navigate(projectRoute)
      await page.evaluate(seed => window.electronAPI.deleteProject(seed.workspaceId, seed.projectSlug), seed)
      expect(await page.evaluate(seed => window.electronAPI.getProject(seed.workspaceId, seed.projectSlug), seed)).toBeNull()
      await missing(projectRoute); await capture('project-deleted')
      await page.reload(); await ready(); await missing(projectRoute)

      stage('live-page-deletion')
      const pageRoute = `pages/page/${seed.pageSlug}`
      await navigate(pageRoute)
      const pageDeleteReceipt = await page.evaluate(seed => window.electronAPI.deletePage(seed.workspaceId, seed.pageSlug), seed)
      expect(await page.evaluate(seed => window.electronAPI.getPage(seed.workspaceId, seed.pageSlug), seed)).toBeNull()
      await missing(pageRoute); observations.pageDeleteReceipt = pageDeleteReceipt; await capture('page-deleted')
      await page.reload(); await ready(); await missing(pageRoute)

      stage('live-note-deletion')
      const noteRoute = `notes/note/${seed.noteId}`
      await navigate(noteRoute)
      const noteDeleteReceipt = await page.evaluate(seed => window.electronAPI.deleteNote(seed.workspaceId, seed.noteId), seed)
      expect(noteDeleteReceipt).toBe(true)
      expect(await stat(join(seed.noteRoot, seed.noteId + '.md')).then(() => true).catch(() => false)).toBe(false)
      await missing(noteRoute); observations.noteDeleteReceipt = noteDeleteReceipt; await capture('note-deleted')
      await page.getByTestId('route-note-missing').getByRole('button', { name: russian['common.retry'], exact: true }).click()
      await missing(noteRoute); await page.reload(); await ready(); await missing(noteRoute)

      stage('live-session-deletion-and-native-restart')
      await navigate(sessionBRoute)
      await page.evaluate(seed => window.electronAPI.deleteSession(seed.sessionB), seed)
      await missing(sessionBRoute); await capture('session-deleted')
      await closeNative(); await launch()
      expect(await route()).toBe(sessionBRoute); await missing(sessionBRoute); await capture('native-restart-deleted-session')

      stage('unknown-raw-link-unavailable')
      await direct('not-a-supported-ui001-route')
      await page.getByTestId('route-unavailable').waitFor(); expect(await route()).toBe('not-a-supported-ui001-route')
      await capture('unknown-link-unavailable')
      if (qualifiedBuild) {
        const frozenHashes: Record<string, string> = buildReceipts[0].sourceHashes
        for (const [path, hash] of Object.entries(frozenHashes)) expect(sha256(await readFile(join(root, path)))).toBe(hash)
      }
      observations.status = 'passed'; observations.errors = errors; expect(errors).toEqual([])
    } catch (error) {
      observations.status = 'failed'; observations.error = error instanceof Error ? error.message : String(error)
      if (app && page!) await capture('failure').catch(() => {})
      throw error
    } finally {
      await closeNative()
      observations.stages = stages; observations.screenshots = screenshots; observations.errors = errors
      await writeFile(join(evidence, 'rox-readiness-ui-001.result.json'), JSON.stringify(observations, null, 2))
      await writeFile(join(evidence, 'rox-readiness-ui-001.native.log'), redactLog(logs.join('')))
      if (!launchCompleted) {
        const pid = Number(await readFile(electronPidPath, 'utf8').catch(() => ''))
        if (Number.isInteger(pid) && pid > 1) {
          try { process.kill(pid, 'SIGTERM') } catch {}
          await new Promise(resolve => setTimeout(resolve, 500))
          try { process.kill(pid, 'SIGKILL') } catch {}
        }
      }
      console.log(`UI-001 native evidence: ${evidence}`)
    }
  }, 600_000)
})
