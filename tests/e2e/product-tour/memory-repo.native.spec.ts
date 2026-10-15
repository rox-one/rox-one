import { test, expect, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { bootNativeProduct } from './native-harness'

/**
 * MEMREPO-NATIVE-01 — real visual verification of the new «Память: репозиторий»
 * screen (route `memory/repo`) in the built Electron app.
 *
 * Fresh profile → the real onboarding name screen → the app's own first-run
 * default workspace (created by main at `config/workspaces/my-workspace`) →
 * real memory files written into that workspace → the screen materializes the
 * git projection on demand through the real «Собрать сейчас» (dream) RPC.
 *
 * No product code is touched; the only fixture is `memory/lessons.jsonl` +
 * `memory/context.md` inside the app's own workspace root under the owned
 * profile dir.
 */

const repository = resolve(import.meta.dirname, '../../..')
const outDir = resolve(repository, 'test-results/product-tour/memrepo')
// bootNativeProduct owns `profiles/<pid>`; the same pid addresses it here.
const profile = resolve(repository, 'test-results/product-tour/native/profiles', String(process.pid))
const screenshotPath = resolve(outDir, 'memory-repo-screen.png')
const observationsPath = resolve(outDir, 'observations.json')

const LESSONS = [
  {
    ts: '2026-10-08T09:12:00.000Z',
    rule: 'Сначала собирай проект, потом запускай тесты — иначе проверяешь устаревший бандл',
    category: 'workflow',
    scope: 'workspace',
    source: { trigger: 'explicit' },
  },
  {
    ts: '2026-10-08T10:30:00.000Z',
    rule: 'Не добавляй зависимость ради трёх строк кода — используй стандартную библиотеку',
    category: 'correction',
    scope: 'workspace',
    negative: true,
    source: { trigger: 'error' },
  },
  {
    ts: '2026-10-09T07:45:00.000Z',
    rule: 'Компоненты экрана держи без вызовов bridge — данные приходят пропсами из оболочки',
    category: 'knowledge',
    scope: 'workspace',
    source: { trigger: 'distillation' },
  },
]

const CONTEXT = `# Контекст памяти

Этот банк описывает рабочие правила проекта «Репозиторий памяти».

## Приоритеты

1. Корректность важнее скорости.
2. Тесты пишем до реализации.
`

/**
 * The renderer's real bridge global (`window.electronAPI`), typed structurally
 * for the few calls this spec makes. The app declaration lives in
 * `apps/electron/src/shared/types.ts`, outside this spec's tsconfig, so each
 * evaluate binds the well-known global once through a named cast.
 */
interface FixtureApi {
  getWindowWorkspace(): Promise<string | null>
  getWorkspaces(): Promise<Array<{ id: string; rootPath: string }>>
}

/** The workspace the shell is actually bound to (window → active id → rootPath). */
async function activeWorkspace(page: Page): Promise<{ id: string; rootPath: string }> {
  return page.evaluate(async () => {
    const holder = window as unknown as { electronAPI: FixtureApi }
    const api = holder.electronAPI
    const id = await api.getWindowWorkspace()
    const all = await api.getWorkspaces()
    const found = all.find((workspace) => workspace.id === id) ?? all[0]
    if (!found) throw new Error('no active workspace')
    return { id: found.id, rootPath: found.rootPath }
  })
}

async function seedWorkspaceMemory(rootPath: string): Promise<void> {
  await mkdir(resolve(rootPath, 'memory'), { recursive: true })
  await writeFile(
    resolve(rootPath, 'memory', 'lessons.jsonl'),
    LESSONS.map((lesson) => JSON.stringify(lesson)).join('\n') + '\n',
    'utf8',
  )
  await writeFile(resolve(rootPath, 'memory', 'context.md'), CONTEXT, 'utf8')
}

/** On-disk projection path for an ownerless workspace bank: `…/ws-<sha1(id)[:8]>/local`. */
function workspaceRepoDir(workspaceId: string): string {
  const dir = `ws-${createHash('sha1').update(workspaceId).digest('hex').slice(0, 8)}`
  return resolve(profile, 'config', 'memory', 'repos', dir, 'local')
}

/** The repository screen's tab strip is the shared `Tabs` primitive (`data-tab-item`). */
function memoryRepoTab(page: Page, id: string): Locator {
  return page.locator(`[data-tab-item="${id}"]`)
}

/** What the switcher click observed: the entry's visible label and how many entries matched. */
interface SwitcherEntry { label: string; count: number }

/**
 * Each first-run step's own advance action, in the order `useOnboarding
 * .handleContinue` reaches them: questionnaire → role → layout (only with the
 * layout-engine flag on) → Git Bash (Windows without it installed) → the
 * top-pills configurator, which is always last.
 */
function firstRunAdvanceActions(page: Page): Array<{ name: string; action: Locator }> {
  return [
    { name: 'questionnaire «Заполнить позже»', action: page.locator('[data-testid="questionnaire-skip"]') },
    { name: 'role «Пропустить»', action: page.locator('[data-testid="role-skip"]') },
    { name: 'layout «Продолжить»', action: page.getByRole('button', { name: 'Продолжить', exact: true }) },
    { name: 'git-bash «Проверить снова»', action: page.getByRole('button', { name: 'Проверить снова', exact: true }) },
    { name: 'pills «Готово»', action: page.locator('[data-onboarding-pills-continue]') },
  ]
}

/**
 * Leave every first-run step the way a user would. `App.tsx` mounts the wizard
 * INSTEAD of the ready shell, so the titlebar screen switcher cannot exist
 * until the walk finishes: that switcher is both the completion signal and the
 * navigation this spec uses next. Returns the actions taken.
 *
 * A step whose action stops advancing (Git Bash stays missing, a flagged
 * layout step fails to save) is retried a bounded number of times instead of
 * spinning forever; the caller reports the walk in its evidence.
 */
async function completeFirstRun(page: Page): Promise<string[]> {
  const switcher = page.locator('[data-all-screens-trigger]')
  const taken: string[] = []
  const clicks: Record<string, number> = {}
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline && (await switcher.count()) === 0) {
    let advanced = false
    for (const step of firstRunAdvanceActions(page)) {
      if ((clicks[step.name] ?? 0) >= 3) continue
      const button = step.action.first()
      if (!(await button.isVisible().catch(() => false))) continue
      await button.click({ timeout: 5_000 }).catch(() => {})
      clicks[step.name] = (clicks[step.name] ?? 0) + 1
      taken.push(step.name)
      advanced = true
      // Let the step settle: a click on a step that is still finishing would
      // otherwise be counted as another attempt against the same action.
      await page.waitForTimeout(1_000)
      break
    }
    if (!advanced) await page.waitForTimeout(500)
  }
  if ((await switcher.count()) === 0) {
    // The wizard exposes no step name and `PillsStep` renders no error region,
    // so a stuck walk has to ship what the user could actually see.
    const visible = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 800)
    throw new Error(`first-run wizard never reached the ready shell; actions taken: ${taken.join(' → ') || 'none'}; visible: ${visible}`)
  }
  return taken
}

/**
 * Real user gesture: open the titlebar pill's «Все экраны» menu and click the
 * `surfaceId` entry in it. The sidebar is contextual now — it renders only the
 * current screen's own navigation (`ShellSidebarNav`), never a global surface
 * list — so the pill overflow is the app's one screen switcher.
 *
 * Radix keeps the popover mounted between attempts, so an already-open menu is
 * reused instead of toggled shut; the caller polls this helper while the shell
 * settles.
 */
async function clickAllScreensDestination(page: Page, surfaceId: string): Promise<SwitcherEntry> {
  const menu = page.locator('[data-testid="all-screens-menu"]')
  if (!(await menu.isVisible().catch(() => false))) {
    await page.locator('[data-all-screens-trigger]').first().click({ timeout: 5_000 })
    await menu.waitFor({ state: 'visible', timeout: 5_000 })
  }
  const entries = menu.locator(`[data-screen-id="${surfaceId}"]`)
  const count = await entries.count()
  const target = entries.first()
  await target.waitFor({ state: 'visible', timeout: 5_000 })
  const label = ((await target.innerText()) || '').trim()
  await target.click({ timeout: 5_000 })
  return { label, count }
}

function collect(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack ?? error)))
  return { consoleErrors, pageErrors }
}

/**
 * Close any overlay that intercepts pointer events over the shell: onboarding /
 * memory-intro dialogs and Sonner notifications. Records what it had to close
 * for the report.
 */
async function dismissDialogs(page: Page, seen: string[]): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Sonner toasts live in their own top-layer (`aria-label="Notifications"`),
    // not under `role=dialog`, and their expanded panel covers the header
    // controls — a dream run whose 30 s transport timeout rejects while the run
    // keeps going server-side raises one. Dismiss it through its close button.
    const toast = page.locator('[data-sonner-toast]:visible').first()
    if ((await toast.count()) > 0) {
      seen.push(`toast: ${(((await toast.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 400))}`)
      const close = toast.locator('[data-close-button]').first()
      if ((await close.count()) > 0) await close.click({ timeout: 2_000 }).catch(() => {})
      await page.waitForTimeout(200)
      continue
    }
    const dialog = page.locator('[role="dialog"]:visible').first()
    if ((await dialog.count()) === 0) return
    seen.push(((await dialog.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 400))
    const skip = dialog.getByRole('button', { name: /Пропустить|Закрыть|Позже|Понятно|Начать|Skip|Close|Got it|Start/i }).first()
    if ((await skip.count()) > 0) await skip.click().catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(400)
  }
}

/**
 * Real first-run onboarding (the macOS name screen) walked to the ready shell
 * — the questionnaire, role and top-pills steps a fresh profile now stops on —
 * followed by a real click on the «Все экраны» switcher entry that opens the
 * repository screen. Returns the entry so the caller can assert it really was
 * the app's own visible switcher item.
 */
async function onboardAndOpenRepoViaAllScreens(page: Page, dialogs: string[], firstRun: string[] = []): Promise<SwitcherEntry> {
  const username = page.locator('#onboarding-username')
  // A freshly re-provisioned profile can still be probing its transport; the
  // app shows its own «Повторить» recovery for that, so click it like a user
  // would until the real name screen is up.
  for (let attempt = 0; attempt < 8 && await username.count() === 0; attempt += 1) {
    const retry = page.getByRole('alert').getByRole('button')
    if (await retry.count() > 0) await retry.first().click().catch(() => {})
    await page.waitForTimeout(750)
  }
  await expect(username).toBeVisible()
  const startButton = page.locator('button', { hasText: /Начать|Get started/ }).first()
  // The first-run «Начать» stays disabled until a *valid* handle is present
  // (ASCII letters/digits/underscore/dash, 4-16 chars — «Память QA» was not),
  // and while the browser-intelligence preference settles, so fill the name
  // first and only then wait for the button to leave its disabled state.
  await page.fill('#onboarding-username', 'memrepo-qa')
  await expect(startButton).toBeEnabled()
  await startButton.click()

  // The unified first-run flow continues through its own steps — «Немного о
  // вас» (the profile + permissions questionnaire), «Кто вы?» and the top-pills
  // configurator — each of which is a full-screen wizard step, not a dialog.
  // `App.tsx` mounts this wizard INSTEAD of the ready shell, so nothing the
  // spec navigates lives in the DOM until the walk finishes.
  firstRun.push(...await completeFirstRun(page))

  const screen = page.locator('[data-testid="memory-repo-screen"]')
  let clicked: SwitcherEntry = { label: '', count: 0 }
  await expect.poll(async () => {
    await dismissDialogs(page, dialogs).catch(() => {})
    clicked = await clickAllScreensDestination(page, 'memoryRepo').catch(() => clicked)
    return screen.count()
  }, { timeout: 90_000, intervals: [500, 750, 1000] }).toBeGreaterThan(0)
  await expect(screen).toBeVisible()
  await dismissDialogs(page, dialogs)
  return clicked
}

/**
 * Seed the bound workspace's own memory files, pin its bank and materialize the
 * projection through the real «Собрать сейчас» RPC. Resolves once `MEMORY.md`
 * exists on disk and the rendered tree lists it plus the lesson files.
 */
async function materializeWorkspaceBank(page: Page, dialogs: string[]): Promise<{
  workspace: { id: string; rootPath: string }
  repoDir: string
  bankBefore: string
  bankAfter: string
}> {
  const workspace = await activeWorkspace(page)
  await seedWorkspaceMemory(workspace.rootPath)
  const repoDir = workspaceRepoDir(workspace.id)

  const tree = page.locator('[data-testid="memory-repo-files-tree"]')
  await expect(tree).toBeVisible()

  await dismissDialogs(page, dialogs)
  const bankButton = page.locator('[data-testid="memory-repo-bank"]')
  const bankBefore = (await bankButton.textContent())?.trim() ?? ''
  await bankButton.click()
  const wsBank = page.locator(`[data-testid="memory-repo-bank-ws:${workspace.id}"]`)
  await expect(wsBank).toBeVisible()
  await wsBank.click()
  const bankAfter = (await bankButton.textContent())?.trim() ?? ''
  await expect(tree).toBeVisible()

  await dismissDialogs(page, dialogs)
  await page.locator('[data-testid="memory-repo-refresh"]').click()
  await expect(page.locator('[data-testid="memory-repo-dream-now"]')).toBeEnabled()
  await page.locator('[data-testid="memory-repo-dream-now"]').click()

  // Ground truth independent of the DOM: the projection's working tree.
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline && !existsSync(resolve(repoDir, 'MEMORY.md'))) {
    await page.waitForTimeout(1000)
  }

  const memoryFile = page.locator('[data-testid="memory-repo-file-MEMORY.md"]')
  await expect(memoryFile).toBeVisible({ timeout: 60_000 })
  await dismissDialogs(page, dialogs)
  await page.locator('[data-testid="memory-repo-refresh"]').click()
  await expect(memoryFile).toBeVisible()
  await expect(page.locator('[data-testid^="memory-repo-file-lessons/"]').first()).toBeVisible({ timeout: 30_000 })
  return { workspace, repoDir, bankBefore, bankAfter }
}

test('MEMREPO-NATIVE-01: «Память: репозиторий» renders and materializes real memory', async ({}, info) => {
  const product = await bootNativeProduct(diagnostics => info.attach('native-startup-diagnostics', {
    body: Buffer.from(JSON.stringify(diagnostics, null, 2)), contentType: 'application/json',
  }))
  const { page } = product
  const errors = collect(page)
  const observed: Record<string, unknown> = { profile, assertions: [] as string[], dialogs: [] as string[] }
  const dialogs = observed.dialogs as string[]
  const assertions = observed.assertions as string[]

  async function writeArtifacts(): Promise<void> {
    await mkdir(outDir, { recursive: true }).catch(() => {})
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
    observed.consoleErrors = errors.consoleErrors
    observed.environmentNoise = errors.consoleErrors.filter((text) => text.includes('electron-log'))
    observed.pageErrors = errors.pageErrors
    observed.screenshot = screenshotPath
    await writeFile(observationsPath, JSON.stringify(observed, null, 2) + '\n', 'utf8').catch(() => {})
    await info.attach('memory-repo-observations', {
      body: Buffer.from(JSON.stringify(observed, null, 2)), contentType: 'application/json',
    }).catch(() => {})
  }

  try {
    await expect(page.locator('#root')).not.toBeEmpty()

    // ── Reach the shell and the new screen by clicking the app's own switcher entry. ──
    const screen = page.locator('[data-testid="memory-repo-screen"]')
    const firstRunSteps: string[] = []
    const clickedEntry = await onboardAndOpenRepoViaAllScreens(page, dialogs, firstRunSteps)
    observed.firstRunSteps = firstRunSteps
    observed.switcherEntry = clickedEntry.label
    observed.switcherEntryCount = clickedEntry.count
    expect(clickedEntry.count).toBe(1)
    expect(clickedEntry.label).toContain('Репозиторий памяти')
    assertions.push(`first-run: left ${firstRunSteps.length} wizard step(s) to the ready shell`)
    assertions.push('switcher: the «Все экраны» entry «Репозиторий памяти» (memoryRepo) opened the screen')

    // Header + bank switcher + status + HEAD.
    await expect(page.locator('[data-testid="memory-repo-bank"]')).toBeVisible()
    await expect(page.locator('[data-testid="memory-repo-state"]')).toHaveAttribute('data-state', /./)
    observed.title = (await page.locator('[data-testid="memory-repo-screen"] span').first().textContent())?.trim() ?? null
    await expect(screen.getByText('Репозиторий памяти').first()).toBeVisible()
    assertions.push('header: «Репозиторий памяти» + bank selector + state indicator visible')

    // Four tabs.
    const tabs: Array<[string, string]> = [
      ['files', 'Файлы'],
      ['history', 'История'],
      ['dreams', 'Сны'],
      ['graph', 'Граф'],
    ]
    observed.tabs = {}
    for (const [id, label] of tabs) {
      const tab = memoryRepoTab(page, id)
      await expect(tab).toBeVisible()
      await expect(tab).toHaveText(label)
      ;(observed.tabs as Record<string, string>)[id] = (await tab.textContent())?.trim() ?? ''
    }
    assertions.push('tabs: Файлы / История / Сны / Граф with matching Russian labels')

    // ── Seed the shell's own workspace memory, then materialize on demand. ──
    const { workspace, repoDir, bankBefore, bankAfter } = await materializeWorkspaceBank(page, dialogs)
    observed.workspace = workspace
    observed.workspaceRepoDir = repoDir
    observed.bankBefore = bankBefore
    observed.bankAfter = bankAfter
    observed.materializedOnDisk = existsSync(resolve(repoDir, 'MEMORY.md'))
    observed.committed = existsSync(resolve(repoDir, '.git-rox', 'HEAD'))

    const memoryFile = page.locator('[data-testid="memory-repo-file-MEMORY.md"]')
    observed.tree = await page.locator('[data-testid="memory-repo-files-tree"] button').evaluateAll(
      (nodes) => nodes.map((node) => node.getAttribute('data-testid')),
    )
    observed.head = (await page.locator('[data-testid="memory-repo-head"]').textContent())?.trim() ?? ''
    await expect(page.locator('[data-testid="memory-repo-head"]')).toContainText(/HEAD\s+[0-9a-f]{7}/)
    assertions.push('tree after «Собрать сейчас»+refresh: MEMORY.md + lessons/** present')
    assertions.push('HEAD line shows a 7-char commit sha')

    // ── The other tabs mount without errors (route still plain `memory/repo`). ──
    await dismissDialogs(page, dialogs)
    await memoryRepoTab(page, 'history').click()
    await expect(page.locator('[data-testid="memory-repo-history-panel"]')).toBeVisible()
    await expect(page.locator('[data-testid^="memory-repo-commit-"]').first()).toBeVisible({ timeout: 30_000 })
    assertions.push('История tab: commit list renders at least one commit')

    await memoryRepoTab(page, 'dreams').click()
    await expect(page.locator('[data-testid="memory-repo-dreams-panel"]')).toBeVisible()
    observed.dreamPanel = (await page.locator('[data-testid="memory-repo-dreams-panel"]').innerText().catch(() => ''))?.replace(/\s+/g, ' ').trim().slice(0, 400) ?? null
    assertions.push('Сны tab: dreams panel renders')

    await memoryRepoTab(page, 'graph').click()
    await expect(page.locator('[data-testid="memory-repo-graph-panel"]')).toBeVisible()
    assertions.push('Граф tab: graph panel renders')

    await dismissDialogs(page, dialogs)
    await memoryRepoTab(page, 'files').click()
    await expect(memoryFile).toBeVisible()

    // ── Open a file: viewer + frontmatter/body. ──
    await dismissDialogs(page, dialogs)
    await memoryFile.click()
    await expect(page.locator('[data-testid="memory-repo-file-viewer"]')).toBeVisible()
    await expect(page.locator('[data-testid="memory-repo-file-body"]')).not.toBeEmpty()
    assertions.push('clicking MEMORY.md opens the file viewer with body content')

    // ── No uncaught renderer errors (environment noise excluded). ──
    expect(errors.pageErrors, 'no uncaught renderer errors').toEqual([])
    const hardErrors = errors.consoleErrors.filter((text) => !text.includes('electron-log'))
    expect(hardErrors, 'no hard console errors').toEqual([])
  } finally {
    await writeArtifacts()
    await product.dispose()
  }
})

const searchScreenshotPath = resolve(outDir, 'memory-repo-search.png')
const searchObservationsPath = resolve(outDir, 'search-observations.json')

/**
 * MEMREPO-NATIVE-02 — the repository ⌘K overlay on a real materialized bank.
 *
 * Its own `test()` so a flake here cannot poison the materialize smoke: the
 * overlay is opened with a real keyboard shortcut, filters the already
 * rendered tree client-side and closes on Escape.
 */
test('MEMREPO-NATIVE-02: ⌘K search finds a materialized repository file', async ({}, info) => {
  const product = await bootNativeProduct()
  const { page } = product
  const errors = collect(page)
  const observed: Record<string, unknown> = { profile, assertions: [] as string[], dialogs: [] as string[] }
  const dialogs = observed.dialogs as string[]
  const assertions = observed.assertions as string[]

  async function writeArtifacts(): Promise<void> {
    await mkdir(outDir, { recursive: true }).catch(() => {})
    await page.screenshot({ path: searchScreenshotPath, fullPage: true }).catch(() => {})
    observed.consoleErrors = errors.consoleErrors
    observed.pageErrors = errors.pageErrors
    observed.screenshot = searchScreenshotPath
    await writeFile(searchObservationsPath, JSON.stringify(observed, null, 2) + '\n', 'utf8').catch(() => {})
    await info.attach('memory-repo-search-observations', {
      body: Buffer.from(JSON.stringify(observed, null, 2)), contentType: 'application/json',
    }).catch(() => {})
  }

  try {
    await expect(page.locator('#root')).not.toBeEmpty()
    expect((await onboardAndOpenRepoViaAllScreens(page, dialogs)).label).toContain('Репозиторий памяти')
    await materializeWorkspaceBank(page, dialogs)
    await dismissDialogs(page, dialogs)
    await memoryRepoTab(page, 'files').click()

    // Real keyboard shortcut — the component's own document listener, not its
    // internal state. ⌘K first (the documented macOS shortcut); the
    // instrumented window never delivers the meta variant's `k` keydown (only
    // the bare `Meta` keydown arrives), so the probe falls back to the
    // cross-platform Ctrl+K the listener binds through `metaKey || ctrlKey`.
    const overlay = page.locator('[data-testid="memory-repo-search"]')
    await page.keyboard.press('Meta+k')
    const openedWithMeta = await overlay.waitFor({ state: 'visible', timeout: 1_500 })
      .then(() => true).catch(() => false)
    if (!openedWithMeta) await page.keyboard.press('Control+k')
    await expect(overlay).toBeVisible()
    observed.searchShortcut = openedWithMeta ? 'Meta+k' : 'Control+k'
    assertions.push(`${observed.searchShortcut} opened the repository search overlay`)

    const input = page.locator('[data-testid="memory-repo-search-input"]')
    await expect(input).toBeFocused()
    await input.fill('lessons/workflow')

    const group = page.locator('[data-testid="memory-repo-search-group-files"]')
    await expect(group).toBeVisible()
    const row = group.locator('[data-testid="memory-repo-search-result-0"]')
    await expect(row).toHaveAttribute('data-kind', 'file')
    await expect(row).toContainText('lessons/workflow')
    observed.searchRow = (await row.innerText()).replace(/\s+/g, ' ').trim()
    assertions.push('«Файлы» group lists a row matching the materialized lessons/workflow file')

    await page.keyboard.press('Escape')
    await expect(overlay).toHaveCount(0)
    assertions.push('Escape closed the overlay')

    expect(errors.pageErrors, 'no uncaught renderer errors').toEqual([])
    const hardErrors = errors.consoleErrors.filter((text) => !text.includes('electron-log'))
    expect(hardErrors, 'no hard console errors').toEqual([])
  } finally {
    await writeArtifacts()
    await product.dispose()
  }
})

const importScreenshotPath = resolve(outDir, 'memory-repo-import.png')
const importObservationsPath = resolve(outDir, 'import-observations.json')

/**
 * First lesson file of a materialized projection (repoDir/lessons/<category>/
 * <slug>--<id8>.md) as `{ relPath, absPath }` — `relPath` is the repository-
 * relative POSIX path the import preview keys on.
 */
function firstMaterializedLesson(repoDir: string): { relPath: string; absPath: string } {
  const walk = (dir: string): string | null => {
    if (!existsSync(dir)) return null
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        const nested = walk(abs)
        if (nested) return nested
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        return abs
      }
    }
    return null
  }
  const absPath = walk(resolve(repoDir, 'lessons'))
  if (!absPath) throw new Error(`no materialized lesson file under ${resolve(repoDir, 'lessons')}`)
  return { relPath: relative(repoDir, absPath).split(sep).join('/'), absPath }
}

/**
 * MEMREPO-NATIVE-03 — the repository-edit import surface on the «Память» screen.
 *
 * Its own `test()` (own fresh profile): materialize the workspace bank through
 * the real «Собрать сейчас», edit one materialized `lessons/**` file on disk the
 * way a user's text editor would (rule text gains a line, frontmatter `id` and
 * `baseHash` untouched), then re-open the memory screen so its real
 * `getMemoryRepoStatus` reports the edit. The banner must surface the pending
 * count, «Проверить» must open `ImportReviewDialog` listing that exact path with
 * its diff, and closing without applying must leave the edit untouched on disk.
 */
test('MEMREPO-NATIVE-03: an edited repository file surfaces the import banner and review dialog', async ({}, info) => {
  const product = await bootNativeProduct()
  const { page } = product
  const errors = collect(page)
  const observed: Record<string, unknown> = { profile, assertions: [] as string[], dialogs: [] as string[] }
  const dialogs = observed.dialogs as string[]
  const assertions = observed.assertions as string[]

  async function writeArtifacts(): Promise<void> {
    await mkdir(outDir, { recursive: true }).catch(() => {})
    await page.screenshot({ path: importScreenshotPath, fullPage: true }).catch(() => {})
    observed.consoleErrors = errors.consoleErrors
    observed.pageErrors = errors.pageErrors
    observed.screenshot = importScreenshotPath
    await writeFile(importObservationsPath, JSON.stringify(observed, null, 2) + '\n', 'utf8').catch(() => {})
    await info.attach('memory-repo-import-observations', {
      body: Buffer.from(JSON.stringify(observed, null, 2)), contentType: 'application/json',
    }).catch(() => {})
  }

  try {
    await expect(page.locator('#root')).not.toBeEmpty()

    // ── Reach the shell (repo screen) and materialize the workspace projection. ──
    expect((await onboardAndOpenRepoViaAllScreens(page, dialogs)).label).toContain('Репозиторий памяти')
    const { workspace, repoDir } = await materializeWorkspaceBank(page, dialogs)
    observed.workspace = workspace
    observed.workspaceRepoDir = repoDir

    // ── Edit one materialized lesson file on disk: append a rule line, keep the
    //    frontmatter (`id`, `baseHash`) so the preview classifies it as `update`. ──
    const lesson = firstMaterializedLesson(repoDir)
    const marker = 'Правка QA MEMREPO-NATIVE-03: правка правила из редактора'
    const before = readFileSync(lesson.absPath, 'utf8')
    writeFileSync(lesson.absPath, `${before.trimEnd()}\n\n${marker}\n`, 'utf8')
    observed.editedLessonPath = lesson.relPath
    observed.editOnDisk = readFileSync(lesson.absPath, 'utf8').includes(marker)
    expect(observed.editOnDisk).toBe(true)

    // ── Open the memory screen as a user would (its «Все экраны» switcher
    //    entry); mounting it triggers the real status refresh. ──
    const banner = page.locator('[data-testid="memory-repo-import-banner"]')
    let opened: SwitcherEntry = { label: '', count: 0 }
    await expect.poll(async () => {
      await dismissDialogs(page, dialogs).catch(() => {})
      opened = await clickAllScreensDestination(page, 'memory').catch(() => opened)
      return banner.count()
    }, { timeout: 60_000, intervals: [500, 750, 1000] }).toBeGreaterThan(0)
    observed.switcherEntry = opened.label
    expect(opened.label).toContain('Память')
    await expect(banner).toBeVisible()
    await expect(page.locator('[data-testid="memory-list"]')).toBeVisible()
    assertions.push('switcher: the «Все экраны» entry «Память» (memory) opened the memory screen with the import banner')

    const bannerText = ((await banner.innerText()) || '').replace(/\s+/g, ' ').trim()
    observed.bannerText = bannerText
    // The banner copy is i18n-pluralized (`memory.repo.import.banner_one/_few/_many`),
    // so a single edited file renders «1 правка … ждёт импорта», not the plural form.
    const countMatch = /(\d+)\s+(?:правок|правки|правка) в репозитории (?:ждут|ждёт) импорта/.exec(bannerText)
    expect(countMatch, `banner copy with count: ${bannerText}`).not.toBeNull()
    expect(Number(countMatch![1])).toBeGreaterThan(0)
    assertions.push(`banner: «${bannerText}» reports a non-zero pending-import count`)

    // ── «Проверить» opens the review dialog. ──
    await page.locator('[data-testid="memory-repo-import-review"]').click()
    const dialog = page.locator('[data-testid="import-review-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    observed.dialogTitle = (await dialog.locator('[data-slot="dialog-header"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    await expect(dialog.getByText('Импорт правок из репозитория', { exact: true })).toBeVisible()
    assertions.push('«Проверить» opened ImportReviewDialog «Импорт правок из репозитория»')

    const row = dialog.locator(`[data-testid="import-edit"][data-path="${lesson.relPath}"]`)
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(lesson.relPath)
    observed.editRowText = ((await row.innerText()) || '').replace(/\s+/g, ' ').trim()
    const diff = row.locator('[data-testid="import-edit-diff"]')
    await expect(diff).toBeVisible()
    await expect(diff).toContainText(marker)
    assertions.push(`dialog lists the edited file row «${lesson.relPath}» (обновление) with its diff`)

    // ── Close without applying: nothing is approved and the edit stays on disk. ──
    await dialog.getByRole('button', { name: 'Отмена' }).first().click()
    await expect(dialog).toHaveCount(0)
    expect(readFileSync(lesson.absPath, 'utf8')).toContain(marker)
    assertions.push('closed the dialog without applying: the on-disk edit is untouched')

    expect(errors.pageErrors, 'no uncaught renderer errors').toEqual([])
    const hardErrors = errors.consoleErrors.filter((text) => !text.includes('electron-log'))
    expect(hardErrors, 'no hard console errors').toEqual([])
  } finally {
    await writeArtifacts()
    await product.dispose()
  }
})