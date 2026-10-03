import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { routes } from '../../../apps/electron/src/shared/routes'

const server = 'http://127.0.0.1:4177'
const ru = JSON.parse(readFileSync(new URL('../../../packages/shared/src/i18n/locales/ru.json', import.meta.url), 'utf8')) as Record<string, string>
const copy = (key: string) => ru[key]!
const skills = ['Fixture code review', 'Fixture design review', 'Fixture planning', 'Fixture workspace note']
async function openCatalog(page: Page, mode: 'skills' | 'integrations', options: { theme?: 'light' | 'dark'; sourceList?: boolean } = {}) {
  await page.goto(`/?catalog=${mode}&theme=${options.theme ?? 'light'}${options.sourceList ? '&sourceList=1' : ''}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId(`${mode}-catalog`)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^|\\s)${options.theme ?? 'light'}(?:\\s|$)`))
}
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${server}/reset`, { data: {} })).ok()).toBe(true)
  expect((await request.post(`${server}/catalog/reset`, { data: {} })).ok()).toBe(true)
})

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 1440, 1920]) {
    test(`production catalogs ${theme} ${width}: actual rows, unknown metadata and bounded layout`, async ({ page, request }, info) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.setViewportSize({ width, height: width === 1280 ? 800 : width === 1920 ? 1080 : 900 })
      const snapshot = await (await request.get(`${server}/catalog/snapshot`)).json()
      expect(snapshot.skills.map((skill: { metadata: { name: string } }) => skill.metadata.name).sort()).toEqual([...skills].sort())
      expect(snapshot.sources).toHaveLength(5)
      expect(snapshot.usage).toEqual({})
      expect(snapshot.connections).toEqual([])
      await openCatalog(page, 'skills', { theme })
      await expect(page.getByTestId('catalog-skill-row')).toHaveCount(4)
      await expect(page.getByTestId('catalog-skill-pack')).toHaveCount(2)
      for (const row of await page.getByTestId('catalog-skill-row').all()) {
        await expect(row.getByRole('cell').nth(3)).toHaveText('—')
        await expect(row.getByRole('cell').nth(4)).toHaveText('—')
        await expect(row.getByRole('cell').nth(5)).toHaveText('—')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.getByTestId('catalog-main-content').screenshot({ path: info.outputPath(`skills-${theme}-${width}.png`) })
      await openCatalog(page, 'integrations', { theme })
      await expect(page.getByTestId('catalog-integration-card')).toHaveCount(5)
      await expect(page.locator('[data-source-id="custom-source"]')).toHaveAttribute('data-connection-status', 'untested')
      await expect(page.locator('[data-source-id="github-source"]')).toHaveAttribute('data-connection-status', 'failed')
      await expect(page.locator('[data-source-id="notion-source"]')).toHaveAttribute('data-connection-status', 'needs_auth')
      await expect(page.locator('[data-source-id="local-stdio"]')).toHaveAttribute('data-connection-status', 'local_disabled')
      // The local file adapter has no remote auth handshake. Its computed state
      // is separate from the fixture's revoked/failed/untested remote sources.
      await expect(page.locator('[data-source-id="folder"]')).toHaveAttribute('data-connection-status', 'connected')
      expect(await page.getByTestId('catalog-integration-card').evaluateAll(cards => cards.every(card => {
        const bounds = card.getBoundingClientRect()
        return bounds.x >= 0 && bounds.right <= window.innerWidth && card.scrollWidth <= card.clientWidth
      }))).toBe(true)
      await page.getByTestId('catalog-main-content').screenshot({ path: info.outputPath(`integrations-${theme}-${width}.png`) })
      const stats = await (await request.get(`${server}/stats`)).json()
      expect(stats.providerRequests).toBe(0)
      expect(stats.runtimeStarts).toBe(0)
      expect(errors).toEqual([])
    })
  }
}

test('skills: keyboard search/category/scope, dependencies, navigation and real selection atoms', async ({ page }, info) => {
  await openCatalog(page, 'skills')
  const search = page.getByRole('searchbox', { name: copy('capabilityCatalog.searchSkills') })
  await search.focus()
  await search.pressSequentially('Fixture code')
  await expect(page.getByTestId('catalog-skill-row')).toHaveCount(1)
  await search.press('Tab')
  const category = page.getByRole('combobox', { name: copy('capabilityCatalog.category') })
  await expect(category).toBeFocused()
  await category.press('Home'); await category.press('ArrowDown'); await category.press('ArrowDown'); await category.press('Enter')
  await expect(category).toHaveValue('code')
  await expect(page.getByTestId('catalog-skill-row')).toHaveCount(1)
  const name = page.getByRole('button', { name: /^Fixture code review/ })
  await name.focus(); await name.press('Enter')
  await expect(page.getByTestId('catalog-navigation-route')).toHaveText(routes.view.skills('requesting-code-review'))
  await search.fill(''); await category.selectOption('all')
  const scope = page.getByRole('combobox', { name: copy('capabilityCatalog.scope') })
  await scope.selectOption('omp')
  await expect(page.getByTestId('catalog-skill-row')).toHaveCount(0)
  await expect(page.getByText(copy('capabilityCatalog.noResults'))).toBeVisible()
  await scope.selectOption('workspace')
  await expect(page.getByTestId('catalog-skill-row')).toHaveCount(4)
  const details = page.getByRole('button', { name: copy('capabilityCatalog.showDetails').replace('{{name}}', 'Fixture workspace note') })
  await details.focus(); await details.press('Enter')
  await expect(details).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText(`${copy('capabilityCatalog.dependencies')}: custom-source`, { exact: true })).toBeVisible()
  const usage = page.getByRole('button', { name: copy('capabilityCatalog.columns.usage'), exact: true })
  await usage.focus(); await usage.press('Space')
  await expect(page.getByRole('columnheader').filter({ has: usage })).toHaveAttribute('aria-sort', 'descending')
  for (const name of ['Fixture code review', 'Fixture design review']) {
    const checkbox = page.getByRole('checkbox', { name: copy('capabilityCatalog.selectResource').replace('{{name}}', name) })
    await checkbox.focus(); await checkbox.press('Space')
  }
  await expect(page.getByTestId('catalog-selection-count')).toHaveText('2')
  await expect(page.getByTestId('catalog-selection-ids')).toHaveText('["design-critique","requesting-code-review"]')
  await expect(page.getByRole('heading', { name: 'Выбрано 2 навыка', exact: true })).toBeVisible()
  await page.getByTestId('catalog-main-content').screenshot({ path: info.outputPath('skills-keyboard-multiselect.png') })
})

test('integrations: intersected category/type/search filters preserve unknown providers and recorded states', async ({ page }) => {
  await openCatalog(page, 'integrations')
  const category = page.getByRole('navigation', { name: copy('capabilityCatalog.category') })
  const type = page.getByRole('combobox', { name: copy('capabilityCatalog.technicalType') })
  await category.getByRole('button', { name: new RegExp(`^${copy('capabilityCatalog.categories.other')}`) }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('catalog-integration-card')).toHaveCount(2)
  await expect(page.locator('[data-source-id="custom-source"]')).toBeVisible()
  await type.focus(); await type.press('Home'); await type.press('ArrowDown'); await type.press('ArrowDown'); await type.press('Enter')
  await expect(type).toHaveValue('api')
  await expect(page.getByTestId('catalog-integration-card')).toHaveCount(1)
  const search = page.getByRole('searchbox', { name: copy('capabilityCatalog.searchIntegrations') })
  await search.focus(); await search.pressSequentially('custom-warehouse')
  await expect(page.locator('[data-source-id="custom-source"]')).toBeVisible()
  await page.locator('[data-source-id="custom-source"]').getByRole('button', { name: copy('capabilityCatalog.details'), exact: true }).press('Enter')
  await expect(page.getByTestId('catalog-navigation-route')).toHaveText(routes.view.sources({ sourceSlug: 'custom-source' }))
  await search.fill(''); await type.selectOption('all')
  await category.getByRole('button', { name: copy('capabilityCatalog.all'), exact: true }).click()
  await category.getByRole('button', { name: copy('capabilityCatalog.status.connected'), exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('catalog-integration-card')).toHaveCount(1)
  await expect(page.locator('[data-source-id="folder"]')).toBeVisible()
  await expect(page.locator('[data-source-id="notion-source"]')).toHaveCount(0)
  await category.getByRole('button', { name: copy('capabilityCatalog.all'), exact: true }).click()
  await category.getByRole('button', { name: new RegExp(`^${copy('capabilityCatalog.categories.code')}`) }).click()
  await type.selectOption('api')
  await expect(page.locator('[data-source-id="github-source"]')).toBeVisible()
  await type.selectOption('mcp')
  await expect(page.getByTestId('catalog-integration-card')).toHaveCount(0)
})

test('source navigator: existing modifier selection, Escape and arrow navigation remain functional', async ({ page }, info) => {
  await openCatalog(page, 'integrations', { theme: 'dark', sourceList: true })
  const navigator = page.getByTestId('catalog-source-navigator')
  const custom = navigator.locator('#item-custom-source')
  const github = navigator.locator('#item-github-source')
  await custom.click()
  await expect(page.getByTestId('catalog-selection-count')).toHaveText('1')
  await github.click({ modifiers: ['Control'] })
  await expect(page.getByTestId('catalog-selection-count')).toHaveText('2')
  await expect(page.getByRole('heading', { name: 'Выбрано 2 источника', exact: true })).toBeVisible()
  await page.getByTestId('catalog-production-surfaces').screenshot({ path: info.outputPath('sources-existing-multiselect-dark.png') })
  await custom.focus(); await custom.press('Escape')
  await expect(page.getByTestId('integrations-catalog')).toBeVisible()
  await expect(page.getByTestId('catalog-selection-count')).toHaveText('1')
  await custom.focus(); await custom.press('ArrowDown')
  await expect(page.getByTestId('catalog-navigation-route')).toHaveText(routes.view.sources({ sourceSlug: 'github-source' }))
  await expect(github).toBeFocused()
})

test('pack toggle persists through the real installer and readback, retaining the other pack', async ({ page, request }, info) => {
  await openCatalog(page, 'skills')
  const pack = page.getByTestId('catalog-skill-pack').filter({ has: page.getByRole('heading', { name: 'superpowers', exact: true }) })
  await pack.getByRole('button', { name: copy('capabilityCatalog.disablePack').replace('{{name}}', 'superpowers') }).click()
  await expect(pack.getByRole('button', { name: copy('capabilityCatalog.enablePack').replace('{{name}}', 'superpowers') })).toBeVisible()
  await expect(page.getByTestId('catalog-skill-row')).toHaveCount(2)
  let readback = await (await request.get(`${server}/catalog/snapshot`)).json()
  expect(readback.packs.find((item: { slug: string }) => item.slug === 'superpowers').disabled).toBe(true)
  expect(readback.packs.find((item: { slug: string }) => item.slug === 'impeccable').disabled).toBe(false)
  expect(readback.skills.map((item: { slug: string }) => item.slug).sort()).toEqual(['design-critique', 'workspace-note'])
  await pack.getByRole('button', { name: copy('capabilityCatalog.enablePack').replace('{{name}}', 'superpowers') }).click()
  await expect(page.getByTestId('catalog-skill-row')).toHaveCount(4)
  readback = await (await request.get(`${server}/catalog/snapshot`)).json()
  const restored = readback.packs.find((item: { slug: string }) => item.slug === 'superpowers')
  expect(restored.disabled).toBe(false)
  expect(restored.installed.sort()).toEqual(['requesting-code-review', 'writing-plans'])
  await page.getByTestId('catalog-main-content').screenshot({ path: info.outputPath('skills-pack-readback.png') })
})
