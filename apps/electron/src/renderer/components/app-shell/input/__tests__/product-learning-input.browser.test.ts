import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { build } from 'esbuild'
import { chromium, type Browser } from '@playwright/test'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { resolveChromiumExecutable } from '../../../../test-utils/chromium-executable'

let browser: Browser, server: ReturnType<typeof Bun.serve>
const repository = resolve(import.meta.dir, '../../../../../../../..')
const executablePath = await resolveChromiumExecutable()

describe.skipIf(!existsSync(executablePath))('production learning input registrations and native handoff', () => {
beforeAll(async () => {
  const result = await build({ entryPoints: [resolve(import.meta.dir, 'fixtures/product-learning-input/main.tsx')], bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', outdir: 'unused-test-output', define: { 'import.meta.env.IS_WEBUI': 'true', 'import.meta.env.DEV': 'false', 'import.meta.glob': 'window.__fixtureThemeGlob', 'process.env.NODE_ENV': '"development"' }, tsconfig: resolve(repository, 'apps/electron/tsconfig.json'), loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' }, plugins: [{ name: 'isolated-copy-and-assets', setup(builder) {
    builder.onResolve({ filter: /^@rox\/shared\/identity$/ }, () => ({ path: resolve(repository, 'packages/shared/src/identity/terms.ts') }))
    builder.onResolve({ filter: /^react-i18next$/ }, () => ({ path: 'fixture-i18n', namespace: 'fixture' }))
    builder.onLoad({ filter: /^fixture-i18n$/, namespace: 'fixture' }, () => ({ contents: "const t=key=>key; export const useTranslation=()=>({t,i18n:{language:'en',resolvedLanguage:'en'}}); export const Trans=({children,i18nKey})=>children??i18nKey;", loader: 'js' }))
    builder.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'asset' }))
    builder.onLoad({ filter: /.*/, namespace: 'asset' }, () => ({ contents: "export default 'about:blank'", loader: 'js' }))
    builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'text' }))
  } }] })
  const script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new URL(request.url).pathname === '/fixture.js' ? new Response(script, { headers: { 'content-type': 'text/javascript' } }) : new Response('<html><head><style>body{margin:100px}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.invisible{visibility:hidden}.flex{display:flex}.flex-col{flex-direction:column}button{min-width:40px;min-height:24px}.input-container{width:600px}[data-slot="drawer-content"]{position:fixed;left:0;right:0;bottom:0;max-height:70vh;overflow:auto;background:white}[data-slot="drawer-overlay"]{position:fixed;inset:0;background:#0002}.input-toolbar-btn{display:inline-block}</style></head><body><div id="root"></div><script>window.__fixtureThemeGlob=()=>({})</script><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'content-type': 'text/html' } })
  } })
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
}, 40_000)
afterAll(async () => { await browser?.close(); server?.stop(true) }, 20_000)

for (const compact of [false, true]) {
  for (const kind of ['permission', 'admin_approval']) test(`native ${kind} ${compact ? 'compact' : 'desktop'} has one visible scoped request and action target`, async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
    page.on('pageerror', error => console.error(error.message))
    try {
      await page.goto(server.url.href)
      await page.waitForFunction(() => !!(window as any).learningInput)
      await page.evaluate(({ compact, kind }) => (window as any).learningInput.mount(compact, kind), { compact, kind })
      await page.waitForFunction(() => (window as any).learningInput.mounted)
      await page.waitForTimeout(350)
      const result = await page.evaluate(() => ['permission.request', 'permission.actions'].map(id => (window as any).learningInput.resolve(id)))
      const expected = { status: 'ready', reason: null, variant: compact ? 'compact' : 'regular', count: 1 }
      expect(result).toEqual([expected, expected])
      expect(await page.evaluate(() => (window as any).learningInput.inspect().responses)).toEqual([])
      await page.getByRole('button', { name: kind === 'permission' ? 'chat.deny' : 'Cancel', exact: true }).last().click()
      expect(await page.evaluate(() => (window as any).learningInput.inspect().responses)).toEqual([kind === 'permission' ? { type: 'permission', allowed: false, alwaysAllow: false } : { type: 'admin_approval', approved: false }])
    } finally { await page.close() }
  }, 20_000)

  test(`native model picker ${compact ? 'compact' : 'desktop'} owns handoff before evidence and advances only after close`, async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
    page.on('pageerror', error => console.error(error.message))
    try {
      await page.goto(server.url.href)
      await page.evaluate(compact => (window as any).learningInput.mount(compact, 'models'), compact)
      await page.waitForFunction(() => (window as any).learningInput.mounted)
      await page.evaluate(() => (window as any).learningInput.openModel())
      await page.locator('[data-fixture-model-trigger]').click()
      await page.waitForFunction(() => (window as any).learningInput.signals.length > 0)
      const result = await page.evaluate(() => (window as any).learningInput.inspect())
      expect(result.signals).toHaveLength(1)
      expect(result.signals[0].nativeLayers).toBeGreaterThan(0)
      expect(result.signals[0].phaseBeforeSignal).toBe('handed-off')
      expect(result.stepId).toBe('models.picker')
      expect(result.effects.some((effect: any) => effect.type === 'RESOLVE_VIEW' && effect.routeKey === 'settings-ai')).toBe(false)
      expect(result.selections).toEqual([])
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => (window as any).learningInput.inspect().nativeLayers === 0)
      const closed = await page.evaluate(() => (window as any).learningInput.inspect())
      expect(closed.stepId).toBe('models.settings')
      expect(closed.effects.some((effect: any) => effect.type === 'RESOLVE_VIEW' && effect.routeKey === 'settings-ai')).toBe(true)
      expect(closed.selections).toEqual([])
    } finally { await page.close() }
  }, 20_000)

  test(`native model picker ${compact ? 'compact' : 'desktop'} retains the user-open binding if the attempt changes before mounting`, async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
    page.on('pageerror', error => console.error(error.message))
    try {
      await page.goto(server.url.href)
      await page.evaluate(compact => { (window as any).learningInput.mount(compact, 'models') }, compact)
      await page.waitForFunction(() => (window as any).learningInput.mounted)
      await page.evaluate(() => { (window as any).learningInput.rotateOnCapture = true; (window as any).learningInput.openModel() })
      await page.locator('[data-fixture-model-trigger]').click()
      await page.waitForFunction(() => (window as any).learningInput.signals.length > 0)
      const result = await page.evaluate(() => (window as any).learningInput.inspect())
      expect(result.signals[0].signal.binding.runToken).toBe('run-a')
      expect(result.stepId).toBe('models.picker')
      expect(result.effects.some((effect: any) => effect.type === 'RESOLVE_VIEW' && effect.routeKey === 'settings-ai')).toBe(false)
    } finally { await page.close() }
  }, 20_000)
}

})
