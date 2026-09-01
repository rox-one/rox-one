import { expect, test, type Page } from '@playwright/test'

type Viewport = { width: number; height: number }

interface VisualStory {
  id: (viewport: Viewport) => string
  name: (viewport: Viewport) => string
  snapshot: string
}

const visualStories: VisualStory[] = [
  {
    id: () => 'screen-entity-list-empty',
    name: () => 'Entity List Empty Screen',
    snapshot: 'entity-list-empty-screen',
  },
  {
    id: viewport => `screen-chat-display-${viewportPreset(viewport)}`,
    name: viewport => `Chat Display Screen (${viewportLabel(viewport)})`,
    snapshot: 'chat-display-screen',
  },
  {
    id: viewport => `screen-settings-navigator-${viewportPreset(viewport)}`,
    name: viewport => `Settings Navigator Screen (${viewportLabel(viewport)})`,
    snapshot: 'settings-navigator-screen',
  },
  {
    id: viewport => `screen-browser-open-design-${viewportPreset(viewport)}`,
    name: viewport => `Browser Open Design Screen (${viewportLabel(viewport)})`,
    snapshot: 'browser-frame-screen',
  },
  {
    id: viewport => `screen-planner-kanban-${viewportPreset(viewport)}`,
    name: viewport => `Planner Kanban Screen (${viewportLabel(viewport)})`,
    snapshot: 'planner-board-screen',
  },
]

test.setTimeout(90_000)

function viewportPreset({ width }: Viewport): 'desktop' | 'tablet' | 'mobile' {
  if (width >= 1_000) return 'desktop'
  if (width >= 600) return 'tablet'
  return 'mobile'
}

function viewportLabel(viewport: Viewport): string {
  const preset = viewportPreset(viewport)
  return preset.charAt(0).toUpperCase() + preset.slice(1)
}

async function configurePlayground(page: Page, storyId: string, viewport: Viewport) {
  await page.addInitScript(({ componentId, viewport }) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return

    localStorage.clear()
    localStorage.setItem('playground-selected-component', componentId)
    localStorage.setItem('playground-variants-sidebar-open', 'false')
    localStorage.setItem('playground-preview-size', JSON.stringify(viewport))
  }, { componentId: storyId, viewport })
}

test.beforeEach(async ({ page }) => {
  // The Playground page includes external font links for normal interactive use.
  // Visual baselines use the system stack and source-avatar fallback below, so
  // they remain offline and do not vary with Google resource timing.
  await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort())
  await page.route('https://www.google.com/s2/favicons**', route => route.abort())
  await page.route('http://localhost:8097/**', route => route.abort())
})

for (const story of visualStories) {
  test(`renders ${story.snapshot} across the visual baseline matrix`, async ({ page }) => {
    const viewport = page.viewportSize()
    if (!viewport) {
      throw new Error('The visual matrix requires an explicit browser viewport.')
    }

    await configurePlayground(page, story.id(viewport), viewport)
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto('/playground.html', { waitUntil: 'commit' })
    try {
      await expect(page.getByRole('heading', { name: story.name(viewport) })).toBeVisible({ timeout: 20_000 })
    } catch (error) {
      if (pageErrors.length > 0) {
        throw new Error(`Playground failed to render ${story.id(viewport)}: ${pageErrors.join(' | ')}`, { cause: error })
      }
      throw error
    }

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

    const previewFrame = page.locator(
      '#root > div > div > div.flex-1.flex.flex-col.overflow-hidden > div:last-child > div.relative',
    )
    await expect(previewFrame).toHaveCount(1)

    // Isolate the real story from the Playground controls. The controls remain
    // part of interactive use; this fixture captures the production screen at
    // the exact desktop, tablet, or mobile browser project dimensions.
    await previewFrame.evaluate((element, viewport) => {
      document.querySelector<HTMLElement>('#root > div > header')?.style.setProperty('display', 'none', 'important')
      document.querySelector<HTMLElement>('#root > div > div > nav')?.style.setProperty('display', 'none', 'important')

      const previewArea = element.parentElement
      previewArea?.previousElementSibling?.setAttribute('style', 'display: none !important')
      previewArea?.style.setProperty('padding', '0', 'important')
      previewArea?.style.setProperty('overflow', 'visible', 'important')
      element.style.flexShrink = '0'
      element.style.width = `${viewport.width}px`
      element.style.height = `${viewport.height}px`
    }, viewport)

    await expect(previewFrame).toHaveCSS('width', `${viewport.width}px`)
    await expect(previewFrame).toHaveCSS('height', `${viewport.height}px`)
    await expect(previewFrame).toHaveScreenshot(`${story.snapshot}.png`, {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    })
  })
}
