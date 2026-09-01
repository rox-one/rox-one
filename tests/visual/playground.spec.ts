import { expect, test } from '@playwright/test'

const selectedComponentId = 'screen-entity-list-empty'

test.setTimeout(90_000)

test.beforeEach(async ({ page }) => {
  const viewport = page.viewportSize()
  if (!viewport) {
    throw new Error('The visual matrix requires an explicit browser viewport.')
  }

  // The Playground page includes external font links for normal interactive use.
  // Visual baselines use the system stack below instead, so they remain offline
  // and do not vary with the availability or timing of Google Fonts.
  await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort())
  await page.route('http://localhost:8097/**', route => route.abort())

  await page.addInitScript(({ componentId, viewport }) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return

    localStorage.clear()
    localStorage.setItem('playground-selected-component', componentId)
    localStorage.setItem('playground-variants-sidebar-open', 'false')
    // Keep the story frame aligned with the browser project instead of using a
    // desktop-size canvas inside tablet and mobile browser viewports.
    localStorage.setItem('playground-preview-size', JSON.stringify(viewport))
  }, { componentId: selectedComponentId, viewport })
})

test('renders the entity-list empty screen across the visual baseline matrix', async ({ page }) => {
  const viewport = page.viewportSize()
  if (!viewport) {
    throw new Error('The visual matrix requires an explicit browser viewport.')
  }

  await page.goto('/playground.html', { waitUntil: 'commit' })
  await expect(page.getByRole('heading', { name: 'Entity List Empty Screen' })).toBeVisible({ timeout: 60_000 })

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }

      html, body, button, input, select, textarea {
        font-family: Arial, sans-serif !important;
      }
    `,
  })
  await page.evaluate(() => document.fonts.ready)

  const previewFrame = page.locator('div.relative').filter({
    has: page.locator('[data-slot="empty"]'),
  })
  // Isolate the real story from the Playground controls. The controls remain
  // part of interactive use; this fixture captures the production screen at
  // the exact desktop, tablet, or mobile browser project dimensions.
  await previewFrame.evaluate((element) => {
    document.querySelector<HTMLElement>('#root > div > header')?.style.setProperty('display', 'none', 'important')
    document.querySelector<HTMLElement>('#root > div > div > nav')?.style.setProperty('display', 'none', 'important')

    const previewArea = element.parentElement
    previewArea?.previousElementSibling?.setAttribute('style', 'display: none !important')
    previewArea?.style.setProperty('padding', '0', 'important')
    previewArea?.style.setProperty('overflow', 'visible', 'important')
    element.style.flexShrink = '0'
  })
  await expect(previewFrame).toHaveCSS('width', `${viewport.width}px`)
  await expect(previewFrame).toHaveCSS('height', `${viewport.height}px`)
  await expect(previewFrame).toHaveScreenshot('entity-list-empty-screen.png', {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  })
})
