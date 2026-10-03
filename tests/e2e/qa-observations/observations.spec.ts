import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
const evidence = join(tmpdir(), 'opencode')
const docsEvidence = fileURLToPath(new URL('../../../docs/qa-evidence/2026-10-03/', import.meta.url))
let pageErrors: string[] = []
test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', error => { pageErrors.push(error.message); console.error('fixture page error:', error.message) })
})
test.afterEach(() => expect(pageErrors).toEqual([]))

test('OBS-001: runtime mouse and keyboard selection loads the named detail among 2216 skills', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-list-role="omp-skills"] li')).toHaveCount(2214)
  expect(await page.evaluate(() => (window as any).qa.skills.filter((s: any) => s.source === 'omp').every((s: any) => s.content === ''))).toBe(true)
  expect(await page.evaluate(() => (window as any).qa.metrics.details)).toEqual([])
  // Preserve current-main duplicate-display-name disambiguation.
  await expect(page.locator('[data-list-role="skills"] [data-skill-row]').filter({ hasText: 'Controlled skill workspace-skill' }).getByText('@workspace-skill', { exact: true })).toBeVisible()
  for (const slug of ['md-slides', 'tool-prompt-optimization']) {
    // A delivered browser mouse event, without UIA or forced dispatch.
    await page.locator('[data-list-role="omp-skills"] li').filter({ hasText: `Controlled skill ${slug}` }).locator('button[aria-pressed]').click()
    if (await page.getByTestId('route').textContent() === 'skills') {
      expect(await page.evaluate(() => (window as any).qa.metrics.clicks.length)).toBeGreaterThan(0)
      await page.screenshot({ path: `${evidence}/obs-001-baseline-delivered-click.png` })
    }
    await expect(page.getByTestId('route')).toHaveText(`skills/skill/${slug}`)
    await expect(page.getByTestId('detail').locator('pre')).toContainText(`Instructions for ${slug}`)
    await expect(page.locator('[data-list-role="omp-skills"] button[aria-pressed="true"]')).toContainText(`Controlled skill ${slug}`)
  }
  const keyboardRow = page.locator('[data-list-role="omp-skills"] li').filter({ hasText: 'Controlled skill md-slides' }).locator('button[aria-pressed]')
  await keyboardRow.focus()
  await keyboardRow.press('Enter')
  await expect(page.getByTestId('route')).toHaveText('skills/skill/md-slides')
  await keyboardRow.press('Space')
  await expect(page.getByTestId('detail').locator('pre')).toContainText('Instructions for md-slides')
  expect(await page.evaluate(() => (window as any).qa.metrics.selections)).toEqual([
    'md-slides', 'tool-prompt-optimization', 'md-slides', 'md-slides',
  ])
  await expect(page.getByTestId('detail').getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  // Current MainContentPanel reads metadata once per changed selection for its
  // availability gate. SkillInfoPage itself only fetches one selected body.
  expect(await page.evaluate(() => (window as any).qa.metrics.lists)).toBe(4)
  expect(await page.evaluate(() => (window as any).qa.metrics.details)).toEqual([
    'fixture:md-slides', 'fixture:tool-prompt-optimization', 'fixture:md-slides',
  ])
  await expect(page.getByTestId('detail').locator('pre')).toContainText('Привет, 世界 — café')
  expect(errors).toEqual([])
  console.log('OBS-001 controlled click-to-detail metrics:', await page.evaluate(() => (window as any).qa.metrics))
  await page.screenshot({ path: `${evidence}/obs-001-selected.png` })
})

test('OBS-001: export does not select; shadowed duplicates remain inactive; craft row still selects', async ({ page }) => {
  await page.goto('/')
  const row = page.locator('[data-list-role="omp-skills"] li').filter({ hasText: 'Controlled skill md-slides' })
  await row.hover()
  await row.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem').click()
  expect(await page.evaluate(() => (window as any).qa.metrics.imports)).toEqual(['md-slides'])
  await expect(page.getByTestId('route')).toHaveText('skills')
  const duplicate = page.locator('[data-list-role="omp-skills"] li').filter({ hasText: 'duplicate' })
  await duplicate.scrollIntoViewIfNeeded()
  await expect(duplicate.getByRole('button').first()).toBeDisabled()
  const workspaceRow = page.locator('[data-list-role="skills"] [data-skill-row]').filter({ hasText: 'Controlled skill workspace-skill' })
  await workspaceRow.scrollIntoViewIfNeeded()
  await workspaceRow.getByText('Repeated craft name', { exact: true }).click()
  await expect(page.getByTestId('detail').locator('textarea').last()).toHaveValue(/Instructions for workspace-skill/)
})

for (const activation of ['mouse', 'Enter', 'Space']) {
  test(`OBS-001 bulk selection exits through real MainContentPanel on runtime ${activation}`, async ({ page }) => {
    await page.goto('/')
    const craft = page.locator('[data-list-role="skills"] [data-skill-row]')
    await craft.filter({ hasText: 'workspace-skill' }).click()
    await craft.filter({ hasText: 'duplicate' }).click({ modifiers: ['Control'] })
    await expect(page.getByTestId('selection-count')).toHaveText('2')
    await expect(page.getByTestId('detail').getByRole('heading', { name: '2 skills selected' })).toBeVisible()
    if (activation === 'mouse' && process.env.ROX_QA_CAPTURE_DOCS === '1') await page.screenshot({ path: join(docsEvidence, 'skills-before.png') })
    const runtime = page.locator('[data-list-role="omp-skills"] li').filter({ hasText: 'Controlled skill md-slides' })
    // Export does not dismiss the bulk intent.
    await runtime.hover()
    await runtime.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem').click()
    await expect(page.getByTestId('selection-count')).toHaveText('2')
    const select = runtime.locator('button[aria-pressed]')
    if (activation === 'mouse') await select.click()
    else { await select.focus(); await select.press(activation) }
    await expect(page.getByTestId('route')).toHaveText('skills/skill/md-slides')
    await expect(page.getByTestId('selection-count')).toHaveText('0')
    await expect(page.getByTestId('detail').getByRole('heading', { name: '2 skills selected' })).toHaveCount(0)
    await expect(page.getByTestId('detail').locator('pre')).toContainText('Привет, 世界 — café')
    if (activation === 'mouse' && process.env.ROX_QA_CAPTURE_DOCS === '1') await page.screenshot({ path: join(docsEvidence, 'skills-after.png') })
    if (activation === 'mouse') await page.screenshot({ path: `${evidence}/obs-001-bulk-to-runtime.png` })
  })
}

test('OBS-001 selected reads handle missing/error responses and metadata-only change events', async ({ page }) => {
  await page.goto('/')
  const runtime = page.locator('[data-list-role="omp-skills"] li').filter({ hasText: 'Controlled skill md-slides' }).locator('button[aria-pressed]')
  await page.route('**/qa-rpc', async route => {
    const request = route.request().postDataJSON()
    if (request.channel === 'skills:getDetails') await route.fulfill({ json: null })
    else await route.continue()
  })
  await runtime.click()
  await expect(page.getByTestId('detail')).toContainText('Skill not found')
  await page.unroute('**/qa-rpc')
  await page.route('**/qa-rpc', async route => {
    const request = route.request().postDataJSON()
    if (request.channel === 'skills:getDetails') await route.fulfill({ status: 400, json: { error: 'synthetic-private-marker' } })
    else await route.continue()
  })
  await page.evaluate(() => (window as any).qa.emitSkillsChanged('fixture'))
  await expect(page.getByTestId('detail')).toContainText('Failed to load skill')
  await expect(page.getByTestId('detail')).not.toContainText('synthetic-private-marker')
  await page.unroute('**/qa-rpc')
  await page.evaluate(() => (window as any).qa.emitSkillsChanged('fixture'))
  await expect(page.getByTestId('detail').locator('pre')).toContainText('Привет, 世界 — café')
})

test('OBS-001 delayed prior-workspace detail cannot replace the current selection', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let oldReadStarted!: () => void
  const started = new Promise<void>(resolve => { oldReadStarted = resolve })
  await page.route('**/qa-rpc', async route => {
    const request = route.request().postDataJSON()
    if (request.channel === 'skills:getDetails' && request.workspaceId === 'fixture') {
      const response = await route.fetch()
      oldReadStarted()
      await gate
      await route.fulfill({ response })
    } else await route.continue()
  })
  await page.goto('/')
  const oldResponse = page.waitForResponse(response => {
    const request = response.request().postDataJSON()
    return request?.channel === 'skills:getDetails' && request.workspaceId === 'fixture'
  })
  await page.locator('[data-list-role="omp-skills"] li').filter({ hasText: 'Controlled skill md-slides' }).locator('button[aria-pressed]').click()
  await started
  await page.getByTestId('workspace-b').click()
  await expect(page.getByTestId('detail').locator('pre')).toContainText('Workspace B instructions')
  release()
  await (await oldResponse).finished()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect.poll(() => page.evaluate(() => (window as any).qa.metrics.details)).toEqual(['fixture:md-slides', 'fixture-b:md-slides'])
  await expect(page.getByTestId('detail').locator('pre')).toContainText('Workspace B instructions')
  await expect(page.getByTestId('detail').locator('pre')).not.toContainText('Привет')
})

for (const width of [1386, 1000]) {
  test(`OBS-002: added right panel settles in viewport and controls work at ${width}x893`, async ({ page }) => {
    await page.setViewportSize({ width, height: 893 })
    await page.goto('/?panels')
    await page.getByTestId('add-panel').click()
    await expect(page.getByTestId('panel-count')).toHaveText('2')
    const last = page.locator('[data-panel-role="content"]').last()
    // Poll geometry after smooth scrolling, rather than assuming an animation duration.
    await expect.poll(async () => last.evaluate(el => {
      const rect = el.getBoundingClientRect()
      const viewport = el.closest('.panel-scroll')!.getBoundingClientRect()
      return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1
    })).toBe(true)
    await last.getByTestId('model').click()
    await last.getByTestId('send').click()
    await page.screenshot({ path: `${evidence}/obs-002-${width}-settled.png` })
    const scroller = page.locator('[data-panel-grid-viewport]')
    await scroller.evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' as ScrollBehavior }))
    // Current-main grid layouts can fit both panels without horizontal overflow.
    // Characterize reachability, rather than imposing the old 440px flex policy.
    const overflow = await scroller.evaluate(el => el.scrollWidth > el.clientWidth + 1)
    if (overflow) expect(await last.evaluate(el => el.getBoundingClientRect().right > el.closest('.panel-scroll')!.getBoundingClientRect().right)).toBe(true)
    await scroller.evaluate(el => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' as ScrollBehavior }))
    await last.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByTestId('panel-count')).toHaveText('1')
  })
}
