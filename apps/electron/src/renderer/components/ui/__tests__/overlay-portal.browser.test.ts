import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from '@playwright/test'

/**
 * UI-A1 review4 (browser): a Dialog or Drawer opened from inside a fullscreen
 * overlay (FullscreenOverlayBase, --z-fullscreen 350, above scrim 200 /
 * modal 210) portals into the overlay's root and paints above the overlay;
 * focus stays trapped in it and Escape closes only the topmost layer. Outside
 * an overlay the same Dialog portals to <body>.
 *
 * Run: ROX_OVERLAY_PORTAL_BROWSER_TEST=1 [ROX_TEST_CHROMIUM=/path/to/chrome] bun test <this file>
 */
const enabled = process.env.ROX_OVERLAY_PORTAL_BROWSER_TEST === '1'
const repoRoot = join(import.meta.dir, '../../../../../../..')
let server: Server | undefined
let browser: Browser | undefined
let base: string

// Real layer values from tokens/z.css plus the handful of utilities the fixture needs.
function fixtureCss() {
  const z = readFileSync(join(repoRoot, 'packages/ui/src/styles/tokens/z.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const root = z.slice(z.indexOf(':root {'), z.indexOf('}', z.indexOf(':root {')) + 1)
  const layers = [...root.matchAll(/--z-([\w-]+):\s*\d+;/g)].map((m) => m[1])
  return [
    root,
    ...layers.map((l) => `.z-${l}{z-index:var(--z-${l})}`),
    '.fixed{position:fixed}.absolute{position:absolute}.inset-0{inset:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}',
    'body{margin:0;font:13px sans-serif}',
  ].join('\n')
}

describe.skipIf(!enabled)('dialogs and drawers opened inside a fullscreen overlay', () => {
  beforeAll(async () => {
    const result = await build({ stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { FullscreenOverlayBase } from './packages/ui/src/components/overlay/FullscreenOverlayBase';
      import { Dialog, DialogContent, DialogTitle, DialogDescription } from './apps/electron/src/renderer/components/ui/dialog';
      import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from './packages/ui/src/components/ui/drawer';
      const h = React.createElement;
      const box = { top: '30%', left: '30%', width: '40%', height: '40%', background: 'white', padding: 0 };
      function Probe({ name }) {
        const [dialog, setDialog] = React.useState(false);
        const [drawer, setDrawer] = React.useState(false);
        return h('div', null,
          h('button', { 'data-testid': name + '-open-dialog', onClick: () => setDialog(true) }, 'Open dialog'),
          h('button', { 'data-testid': name + '-open-drawer', onClick: () => setDrawer(true) }, 'Open drawer'),
          h(Dialog, { open: dialog, onOpenChange: setDialog },
            h(DialogContent, { 'data-testid': name + '-dialog', style: box, showCloseButton: false },
              h(DialogTitle, null, 'Dialog'), h(DialogDescription, null, 'd'),
              h('input', { 'data-testid': name + '-dialog-a' }), h('input', { 'data-testid': name + '-dialog-b' }))),
          h(Drawer, { open: drawer, onOpenChange: setDrawer, direction: 'bottom' },
            h(DrawerContent, { 'data-testid': name + '-drawer', style: { left: 0, right: 0, bottom: 0, height: '40%', background: 'white' } },
              h(DrawerTitle, null, 'Drawer'), h(DrawerDescription, null, 'd'),
              h('input', { 'data-testid': name + '-drawer-a' }))));
      }
      function Harness() {
        const [overlay, setOverlay] = React.useState(true);
        window.overlayOpen = () => overlay;
        return h(React.Fragment, null,
          h(Probe, { name: 'page' }),
          h(FullscreenOverlayBase, { isOpen: overlay, onClose: () => setOverlay(false), accessibleTitle: 'Overlay' },
            h('div', { 'data-testid': 'overlay-content', style: { height: '100vh' } }, h(Probe, { name: 'ov' }))));
      }
      createRoot(document.getElementById('root')).render(h(Harness));
    `, loader: 'tsx', resolveDir: repoRoot }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"development"' }, tsconfig: join(repoRoot, 'apps/electron/tsconfig.json') })
    const javascript = result.outputFiles[0]!.text
    const css = fixtureCss()
    server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': request.url === '/fixture.js' ? 'text/javascript' : 'text/html' })
      response.end(request.url === '/fixture.js' ? javascript : `<!doctype html><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`)
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    browser = await chromium.launch({ headless: true, executablePath: process.env.ROX_TEST_CHROMIUM ?? process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    server?.closeAllConnections()
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  })

  // Whether `sel` is painted on top at its centre (paint order), and where it lives.
  const probe = (page: Page, sel: string) => page.evaluate((sel) => {
    const el = document.querySelector(`[data-testid="${sel}"]`) as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    // Radix sets pointer-events:none on layers under the topmost modal, and
    // elementFromPoint skips those; force hit-testing to follow paint order.
    const force = document.createElement('style')
    force.textContent = '*{pointer-events:auto!important}'
    document.head.appendChild(force)
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const corner = document.elementFromPoint(2, 2)
    force.remove()
    return {
      inOverlayRoot: !!el.closest('[data-slot="overlay-portal-root"]'),
      hitsSelf: !!hit && el.contains(hit),
      // Outside the surface, its own scrim (not the overlay) is on top.
      cornerHitsScrim: !!corner?.closest('[data-slot="dialog-overlay"], [data-slot="drawer-overlay"]'),
      focusInside: el.contains(document.activeElement),
    }
  }, sel)

  async function open(page: Page) {
    await page.goto(base)
    await page.getByTestId('overlay-content').waitFor()
  }

  for (const kind of ['dialog', 'drawer'] as const) {
    it(`a ${kind} opened inside the overlay portals into it, paints above it, traps focus and closes alone on Escape`, async () => {
      const page = await browser!.newPage({ viewport: { width: 900, height: 700 } })
      try {
        await open(page)
        await page.getByTestId(`ov-open-${kind}`).click()
        await page.getByTestId(`ov-${kind}`).waitFor()
        await page.waitForTimeout(600) // vaul/radix enter animation
        const state = await probe(page, `ov-${kind}`)
        expect(state).toMatchObject({ inOverlayRoot: true, hitsSelf: true, cornerHitsScrim: true })
        // Focus trap: Tab cycles inside the topmost layer.
        await page.getByTestId(`ov-${kind}-a`).focus()
        for (let i = 0; i < 4; i++) await page.keyboard.press('Tab')
        expect((await probe(page, `ov-${kind}`))!.focusInside).toBe(true)
        // Escape closes the inner layer only; the overlay stays open.
        await page.keyboard.press('Escape')
        await page.getByTestId(`ov-${kind}`).waitFor({ state: 'detached' })
        expect(await page.evaluate(() => (window as unknown as { overlayOpen: () => boolean }).overlayOpen())).toBe(true)
        expect(await page.getByTestId('overlay-content').isVisible()).toBe(true)
        // A second Escape closes the overlay itself.
        await page.keyboard.press('Escape')
        await page.getByTestId('overlay-content').waitFor({ state: 'detached' })
      } finally {
        await page.close()
      }
    }, 30_000)
  }

  it('outside an overlay the same Dialog portals to <body>', async () => {
    const page = await browser!.newPage({ viewport: { width: 900, height: 700 } })
    try {
      await open(page)
      await page.keyboard.press('Escape') // close the overlay first
      await page.getByTestId('overlay-content').waitFor({ state: 'detached' })
      await page.getByTestId('page-open-dialog').click()
      await page.getByTestId('page-dialog').waitFor()
      const parent = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="page-dialog"]')!
        return { inOverlayRoot: !!el.closest('[data-slot="overlay-portal-root"]'), underBody: el.closest('#root') === null && document.body.contains(el) }
      })
      expect(parent).toEqual({ inOverlayRoot: false, underBody: true })
    } finally {
      await page.close()
    }
  }, 30_000)
})
