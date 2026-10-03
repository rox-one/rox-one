import { test, expect, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/ui.html')
  await expect(page.getByRole('button', { name: 'Start component tour' })).toBeVisible()
}
async function start(page: Page) {
  await page.getByRole('button', { name: 'Start component tour' }).click()
  await expect(page.locator('[data-product-tour-popover]')).toBeVisible()
}

test('UI-01/UI-03: production target registry resolves only the bound panel and retains a newer StrictMode registration', async ({ page }) => {
  await open(page)
  const result = await page.evaluate(() => {
    const api = (window as any).__productTourComponent
    const first = api.resolve('panel-a'), second = api.resolve('panel-b'), missing = api.resolve('foreign')
    const replaced = api.staleCleanup()
    return { first: first.target?.element.getAttribute('aria-label'), second: second.target?.element.getAttribute('aria-label'), missing: missing.status, token: replaced.target?.registrationToken }
  })
  expect(result).toEqual({ first: 'First panel draft', second: 'Second panel draft', missing: 'blocked', token: 'new' })
})

test('UI-05/UI-09: production mask follows measured target geometry after move and viewport resize without stealing focus', async ({ page }) => {
  await open(page)
  await page.getByRole('textbox', { name: 'First panel draft' }).fill('Retain this draft')
  await start(page)
  await page.getByRole('textbox', { name: 'First panel draft' }).focus()
  await page.evaluate(() => (window as any).__productTourComponent.move())
  await page.setViewportSize({ width: 1100, height: 800 })
  await expect.poll(async () => {
    const target = await page.getByRole('textbox', { name: 'First panel draft' }).boundingBox()
    const mask = page.locator('[data-product-tour-mask] rect')
    const hole = { x: Number(await mask.getAttribute('x')), y: Number(await mask.getAttribute('y')), width: Number(await mask.getAttribute('width')), height: Number(await mask.getAttribute('height')) }
    return Math.max(Math.abs(hole.x - (target!.x - 8)), Math.abs(hole.y - (target!.y - 8)), Math.abs(hole.width - (target!.width + 16)), Math.abs(hole.height - (target!.height + 16)))
  }).toBeLessThanOrEqual(2)
  await expect(page.getByRole('textbox', { name: 'First panel draft' })).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'First panel draft' })).toHaveValue('Retain this draft')
  const box = await page.locator('[data-product-tour-popover]').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(1100); expect(box!.y + box!.height).toBeLessThanOrEqual(800)
})

test('UI-08: a normal outside application click executes and pauses the production overlay', async ({ page }) => {
  await open(page); await start(page)
  await page.getByRole('button', { name: 'Ordinary action' }).click()
  await expect(page.getByTestId('ordinary-count')).toHaveText('1')
  await expect(page.getByTestId('pause-reason')).toHaveText('focus-lost')
  await expect(page.locator('[data-product-tour-popover]')).toHaveCount(0)
})

test('UI-07: a higher-priority native handoff hides the popup and consumes the first Escape', async ({ page }) => {
  await open(page); await start(page)
  await page.evaluate(() => (window as any).__productTourComponent.handoff())
  await expect(page.getByRole('dialog', { name: 'Native handoff fixture' })).toBeVisible()
  await expect(page.locator('[data-product-tour-popover]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Native handoff fixture' })).toHaveCount(0)
  await expect(page.locator('[data-product-tour-popover]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-product-tour-popover]')).toHaveCount(0)
})

test('UI-11: production geometry observers disconnect after the tour closes', async ({ page }) => {
  await page.addInitScript(() => {
    const active = new Set<object>()
    for (const name of ['ResizeObserver', 'MutationObserver'] as const) {
      const Original = window[name]
      ;(window as any)[name] = class extends Original {
        observe(...args: any[]) { active.add(this); return super.observe(...args as [any, any]) }
        disconnect() { active.delete(this); return super.disconnect() }
      }
    }
    ;(window as any).__activeTourObservers = () => active.size
  })
  await open(page)
  const baseline = await page.evaluate(() => (window as any).__activeTourObservers())
  await start(page)
  await expect.poll(() => page.evaluate(() => (window as any).__activeTourObservers())).toBeGreaterThan(baseline)
  await page.evaluate(() => (window as any).__productTourComponent.hide())
  await expect(page.locator('[data-product-tour-popover]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__activeTourObservers())).toBe(baseline)
})
