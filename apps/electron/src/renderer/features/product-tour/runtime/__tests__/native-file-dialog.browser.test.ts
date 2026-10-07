import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser, type Page } from '@playwright/test'
import { build, version as esbuildVersion } from 'esbuild'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import { noteNativeBrowserStage as stage, runNativeBrowserProcess } from '../../adapters/work/meetings-automations/native-browser-process'
import { adoptVerifiedRendererArtifact, bindRendererControls, createFreshRendererDirectory, fileDigest, loadOrBuildRendererArtifact, verifyRendererArtifact } from '../../../../../../../../scripts/product-tour/native-renderer-artifact.mjs'

const isolatedCase = process.env.ROX_PRODUCT_TOUR_FILE_DIALOG_CASE
let registeredCase = false
let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined
const root = resolve(import.meta.dir, '../../../../../../../..')
let rendererDirectory: string | undefined
let adoptedManifestDigest: string | undefined
let rendererArtifact: Awaited<ReturnType<typeof loadOrBuildRendererArtifact>> | undefined
let rendererReceipt: { path: string; sources: Map<string, string>; virtualInputs: string[] } | undefined
beforeAll(async () => {
  if (!isolatedCase) { rendererDirectory = await createFreshRendererDirectory(); return }
  stage('file-dialog:bundle:start')
  rendererArtifact = await loadOrBuildRendererArtifact(process.env.ROX_PRODUCT_TOUR_FILE_DIALOG_RENDERER_DIRECTORY,
    process.env.ROX_PRODUCT_TOUR_FILE_DIALOG_RENDERER_DIGEST, async () => {
      stage('file-dialog:themes:start')
      const themesDirectory = resolve(root, 'apps/electron/resources/themes')
      const themes: Record<string, unknown> = {}
      const themeFiles: string[] = []
      for (const name of new Bun.Glob('*.json').scanSync({ cwd: themesDirectory })) {
        const path = resolve(themesDirectory, name)
        themes[`../../../resources/themes/${name}`] = await Bun.file(path).json()
        themeFiles.push(path)
      }
      stage('file-dialog:themes:ready')
      stage('file-dialog:renderer-build:start')
      const bundle = await build({ absWorkingDir: root, entryPoints: [resolve(import.meta.dir, 'fixtures/native-file-dialog.browser.tsx')], tsconfig: resolve(root, 'apps/electron/tsconfig.json'), bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, outdir: 'native-file-dialog-browser', jsx: 'automatic', loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, plugins: [
        { name: 'worker-ui-package', setup(build) { build.onResolve({ filter: /^@rox\/ui$/ }, () => ({ path: resolve(root, 'packages/ui/src/index.ts') })) } },
        { name: 'production-renderer-node-boundary', setup(build) { build.onResolve({ filter: /^node:/ }, () => ({ path: resolve(root, 'apps/electron/src/renderer/shims/node-stub.ts') })) } },
        { name: 'production-theme-inventory', setup(build) { build.onLoad({ filter: /\/context\/ThemeContext\.tsx$/ }, async args => ({ contents: (await Bun.file(args.path).text()).replace(/import\.meta\.glob\([^)]*\)/, JSON.stringify(themes)), loader: 'tsx', resolveDir: dirname(args.path) })) } },
        { name: 'unused-preview-worker-url', setup(build) { build.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'unused-preview-worker' })); build.onLoad({ filter: /.*/, namespace: 'unused-preview-worker' }, () => ({ contents: "export default 'about:blank'", loader: 'js' })) } },
      ] })
      stage('file-dialog:renderer-build:ready')
      const nativeStyles = await Bun.file(resolve(root, 'packages/ui/src/styles/index.css')).text()
      const spinnerLayout = nativeStyles.match(/\.spinner \{[^}]*\}/)?.[0]
      if (!spinnerLayout) throw new Error('Expected production Spinner layout')
      stage('file-dialog:source-hash:start')
      const inputs = Object.keys(bundle.metafile!.inputs)
      const virtualInputs = inputs.filter(path => path.startsWith('unused-preview-worker:'))
      const paths = new Set([...inputs.filter(path => !virtualInputs.includes(path)).map(path => resolve(root, path)),
        ...themeFiles, resolve(root, 'packages/ui/src/styles/index.css')])
      const sources = new Map<string, string>()
      for (const path of paths) sources.set(path, await fileDigest(path))
      const absentControls = await bindRendererControls(sources, [fileURLToPath(import.meta.url),
        resolve(root, 'apps/electron/tsconfig.json'), resolve(root, 'tsconfig.json'), resolve(root, 'tsconfig.base.json'),
        resolve(root, 'bun.lock'), resolve(root, 'package.json'),
        resolve(root, 'scripts/product-tour/native-renderer-artifact.mjs'),
        resolve(root, 'scripts/product-tour/run-browser-node.mjs'), resolve(root, 'scripts/product-tour/browser-node-adapter.mjs'),
        resolve(root, 'scripts/product-tour/browser-node-process.mjs'),
        resolve(root, 'apps/electron/src/renderer/features/product-tour/adapters/work/meetings-automations/native-browser-process.ts')])
      stage('file-dialog:source-hash:ready')
      return { script: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text, spinnerLayout,
        sources, absentControls, virtualInputs, inventories: [{ directory: themesDirectory, names: themeFiles.map(path => basename(path)).sort() }], esbuildVersion }
  })
  stage(`file-dialog:artifact:${rendererArtifact.buildKind}`)
  if (process.env.ROX_PRODUCT_TOUR_NODE_BUNDLE) {
    rendererReceipt = { path: `${process.env.ROX_PRODUCT_TOUR_NODE_BUNDLE}.renderer-source.json`,
      sources: rendererArtifact.sources, virtualInputs: rendererArtifact.virtualInputs }
    await writeFile(rendererReceipt.path, JSON.stringify({ test: fileURLToPath(import.meta.url), selectedCase: isolatedCase,
      sources: Object.fromEntries(rendererReceipt.sources), virtualInputs: rendererReceipt.virtualInputs,
      artifact: { buildKind: rendererArtifact.buildKind, manifestDigest: rendererArtifact.manifestDigest,
        outputDigest: rendererArtifact.outputDigest, esbuildVersion: rendererArtifact.esbuildVersion,
        inventories: rendererArtifact.inventories, absentControls: rendererArtifact.absentControls }, verifiedAfterCase: false }, null, 2) + '\n')
  }
  const { script, spinnerLayout } = rendererArtifact
  stage('file-dialog:bundle:ready')
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) { return new URL(request.url).pathname === '/script.js' ? new Response(script, { headers: { 'Content-Type': 'text/javascript' } }) : new Response(`<!doctype html><style>${spinnerLayout}svg{width:20px;height:20px}main>div{min-height:50px}button{min-width:30px;min-height:24px}</style><div id="root"></div><script type="module" src="/script.js"></script>`, { headers: { 'Content-Type': 'text/html' } }) } })
  stage('file-dialog:browser:launch')
  browser = await chromium.launch({ executablePath: process.env.LEARNING_CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] })
  stage('file-dialog:browser:ready')
}, 30_000)
afterAll(async () => {
  if (!isolatedCase) { if (rendererDirectory) await rm(rendererDirectory, { recursive: true, force: true }); return }
  await browser?.close(); server?.stop(true)
  if (rendererArtifact) {
    stage('file-dialog:verify-after-case:start')
    await verifyRendererArtifact(rendererArtifact)
    stage('file-dialog:verify-after-case:ready')
  }
  if (rendererReceipt && rendererArtifact) {
    await writeFile(rendererReceipt.path, JSON.stringify({ test: fileURLToPath(import.meta.url), selectedCase: isolatedCase,
      sources: Object.fromEntries(rendererReceipt.sources), virtualInputs: rendererReceipt.virtualInputs,
      artifact: { buildKind: rendererArtifact.buildKind, manifestDigest: rendererArtifact.manifestDigest,
        outputDigest: rendererArtifact.outputDigest, esbuildVersion: rendererArtifact.esbuildVersion,
        inventories: rendererArtifact.inventories, absentControls: rendererArtifact.absentControls }, verifiedAfterCase: true }, null, 2) + '\n')
  }
})
function browserTest(name: string, operation: () => Promise<void>) {
  if (isolatedCase && isolatedCase !== name) return
  if (isolatedCase) registeredCase = true
  test(name, async () => {
    if (isolatedCase) { stage('file-dialog:case:start'); await operation(); stage('file-dialog:case:passed'); return }
    expect(await runNativeBrowserProcess(['node', resolve(root, 'scripts/product-tour/run-browser-node.mjs'), 'apps/electron/src/renderer/features/product-tour/runtime/__tests__/native-file-dialog.browser.test.ts'], { label: name, env: { ...process.env, ROX_PRODUCT_TOUR_FILE_DIALOG_CASE: name,
      ROX_PRODUCT_TOUR_FILE_DIALOG_RENDERER_DIRECTORY: rendererDirectory,
      ROX_PRODUCT_TOUR_FILE_DIALOG_RENDERER_DIGEST: adoptedManifestDigest }, deadlineMs: 35_000 })).toBe(0)
    const suffix = createHash('sha256').update(name).digest('hex').slice(0, 12)
    const receipt = JSON.parse(await readFile(resolve(root, `test-results/product-tour/node-browser/native-file-dialog.browser.test.${suffix}.mjs.renderer-source.json`), 'utf8'))
    if (receipt.selectedCase !== name || receipt.verifiedAfterCase !== true) throw new Error('Selected child did not verify its renderer after the actual case')
    const manifestDigest = await adoptVerifiedRendererArtifact(rendererDirectory!, receipt.artifact)
    if (adoptedManifestDigest && manifestDigest !== adoptedManifestDigest) throw new Error('Renderer manifest changed between child verification and parent adoption')
    adoptedManifestDigest = manifestDigest
  }, isolatedCase ? 30_000 : 40_000)
}
async function setup() {
  const page = await browser!.newPage({ viewport: { width: 1200, height: 900 } })
  page.setDefaultTimeout(5_000)
  page.on('pageerror', error => console.error('File-dialog fixture error:', error.message))
  await page.goto(server!.url.href)
  await page.waitForFunction(() => (window as any).nativeFileDialog?.controller?.ready)
  await page.evaluate(() => (window as any).nativeFileDialog.controller.start('OBT-05'))
  await page.waitForSelector('[data-product-tour-step="attachments.add"]')
  return page
}
async function openDialog(page: Page) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: en['chat.attachFiles'], exact: true }).click()
  const dialog = await chooser
  // Allow the production zero-layer effect to run before the native prompt blurs.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return dialog
}
async function eventually(read: () => Promise<boolean>) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) { if (await read()) return; await Bun.sleep(25) }
  expect(await read()).toBe(true)
}
browserTest('native file picker survives a render and blur, and actual file reading durably supplies attachment evidence', async () => {
  const page = await setup()
  try {
    const chooser = await openDialog(page)
    expect(await page.evaluate(() => (window as any).nativeFileDialog.controller.state.phase)).toBe('handed-off')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    expect(await page.evaluate(() => (window as any).nativeFileDialog.controller.state.phase)).toBe('handed-off')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await chooser.setFiles({ name: 'material.txt', mimeType: 'text/plain', buffer: Buffer.from('private material') })
    await eventually(() => page.evaluate(async () => (await (window as any).nativeFileDialog.read()).value?.steps['attachments.add']?.observedAt !== undefined))
    await page.waitForSelector('[data-product-tour-step="attachments.review"]')
    expect(await page.evaluate(() => (window as any).nativeFileDialog.layers())).toEqual([])
    expect(await page.evaluate(() => (window as any).nativeFileDialog.attachmentWrites.at(-1).names)).toEqual(['material.txt'])
    expect(await page.evaluate(async () => JSON.stringify(await (window as any).nativeFileDialog.read()))).not.toContain('private material')
  } finally { await page.close() }
})
browserTest('native picker cancellation clears only its layer and ordinary blur still pauses', async () => {
  const page = await setup()
  try {
    await openDialog(page)
    await page.evaluate(() => (window as any).nativeFileDialog.addPeerLayer())
    await page.locator('input[type="file"]').dispatchEvent('cancel')
    await eventually(() => page.evaluate(() => JSON.stringify((window as any).nativeFileDialog.layers()) === JSON.stringify(['unrelated-native-layer'])))
    await page.evaluate(() => (window as any).nativeFileDialog.removePeerLayer())
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(async () => (await (window as any).nativeFileDialog.read()).value?.steps['attachments.add']?.observedAt)).toBeUndefined()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForFunction(() => (window as any).nativeFileDialog.controller.state.phase === 'paused')
    expect(await page.evaluate(() => (window as any).nativeFileDialog.controller.state.attempt.reason)).toBe('focus-lost')
  } finally { await page.close() }
})
browserTest('old native file reads cannot close a replacement picker or add attachment evidence to a new scope', async () => {
  const page = await setup()
  try {
    await page.evaluate(() => { (window as any).nativeFileDialog.holdReads = true })
    const oldChooser = await openDialog(page)
    await oldChooser.setFiles({ name: 'old.txt', mimeType: 'text/plain', buffer: Buffer.from('old private material') })
    await page.waitForFunction(() => (window as any).nativeFileDialog.thumbnails.length === 1)
    await page.evaluate(() => (window as any).nativeFileDialog.switchScope('workspace-b', 'session-b'))
    await page.waitForFunction(() => (window as any).nativeFileDialog.controller.ready)
    await page.evaluate(() => (window as any).nativeFileDialog.controller.start('OBT-05'))
    try { await page.waitForSelector('[data-product-tour-step="attachments.add"]') } catch (error) { console.error('Successor diagnostic', await page.evaluate(() => ({ phase: (window as any).nativeFileDialog.controller.state.phase, attempt: (window as any).nativeFileDialog.controller.state.attempt, ready: (window as any).nativeFileDialog.controller.ready, capabilities: (window as any).nativeFileDialog.controller.capabilities, layers: (window as any).nativeFileDialog.layers() }))); throw error }
    await openDialog(page)
    const replacement = await page.evaluate(() => (window as any).nativeFileDialog.layers())
    expect(replacement.length).toBeGreaterThan(0)
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'visible' })
    await page.evaluate(() => (window as any).nativeFileDialog.releaseRead())
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'hidden' })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(() => (window as any).nativeFileDialog.layers())).toEqual(replacement)
    expect(await page.evaluate(() => (window as any).nativeFileDialog.controller.state.phase)).toBe('handed-off')
    expect(await page.evaluate(async () => (await (window as any).nativeFileDialog.read()).value?.steps['attachments.add']?.observedAt)).toBeUndefined()
    expect(await page.evaluate(() => (window as any).nativeFileDialog.attachmentWrites.filter((write: any) => write.sessionId === 'session-b').flatMap((write: any) => write.names))).not.toContain('old.txt')
    await page.locator('input[type="file"]').dispatchEvent('cancel')
    await eventually(() => page.evaluate(() => (window as any).nativeFileDialog.layers().length === 0))
  } finally { await page.close() }
})

browserTest('a stale native close cannot retire a replacement picker in the same tour attempt', async () => {
  const page = await setup()
  try {
    await openDialog(page)
    const run = await page.evaluate(() => (window as any).nativeFileDialog.controller.state.attempt.binding.runToken)
    await page.locator('input[type="file"]').dispatchEvent('cancel')
    await openDialog(page)
    const replacement = await page.evaluate(() => (window as any).nativeFileDialog.layers())
    await page.evaluate(() => (window as any).nativeFileDialog.closeCallbacks[0]())
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(() => (window as any).nativeFileDialog.layers())).toEqual(replacement)
    expect(await page.evaluate(() => (window as any).nativeFileDialog.controller.state.attempt.binding.runToken)).toBe(run)
    expect(await page.evaluate(() => (window as any).nativeFileDialog.controller.state.phase)).toBe('handed-off')
    await page.locator('input[type="file"]').dispatchEvent('cancel')
  } finally { await page.close() }
})
browserTest('selection retires the prompt before reading so ordinary blur pauses, while the valid native file still attaches', async () => {
  const page = await setup()
  try {
    await page.evaluate(() => { (window as any).nativeFileDialog.holdReads = true })
    const chooser = await openDialog(page)
    await chooser.setFiles({ name: 'material.txt', mimeType: 'text/plain', buffer: Buffer.from('private material') })
    await page.waitForFunction(() => (window as any).nativeFileDialog.thumbnails.length === 1)
    expect(await page.evaluate(() => (window as any).nativeFileDialog.layers())).toEqual([])
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForFunction(() => (window as any).nativeFileDialog.controller.state.phase === 'paused')
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'visible' })
    await page.evaluate(() => (window as any).nativeFileDialog.releaseRead())
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'hidden' })
    await eventually(() => page.evaluate(() => (window as any).nativeFileDialog.attachmentWrites.at(-1)?.names.includes('material.txt') ?? false))
    expect(await page.evaluate(() => (window as any).nativeFileDialog.controller.state.phase)).toBe('paused')
    expect(await page.evaluate(async () => (await (window as any).nativeFileDialog.read()).value?.steps['attachments.add']?.observedAt)).toBeUndefined()
  } finally { await page.close() }
})
browserTest('a valid same-session native read survives tour replay without supplying evidence to the new attempt', async () => {
  const page = await setup()
  try {
    await page.evaluate(() => { (window as any).nativeFileDialog.holdReads = true })
    const chooser = await openDialog(page)
    await chooser.setFiles({ name: 'material.txt', mimeType: 'text/plain', buffer: Buffer.from('private material') })
    await page.waitForFunction(() => (window as any).nativeFileDialog.thumbnails.length === 1)
    const run = await page.evaluate(() => (window as any).nativeFileDialog.controller.state.attempt.binding.runToken)
    await page.evaluate(() => (window as any).nativeFileDialog.controller.start('OBT-05', 'replay'))
    await page.waitForSelector('[data-product-tour-step="attachments.add"]')
    expect(await page.evaluate(() => (window as any).nativeFileDialog.controller.state.attempt.binding.runToken)).not.toBe(run)
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'visible' })
    await page.evaluate(() => (window as any).nativeFileDialog.releaseRead())
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'hidden' })
    await eventually(() => page.evaluate(() => (window as any).nativeFileDialog.attachmentWrites.at(-1)?.names.includes('material.txt') ?? false))
    expect(await page.evaluate(async () => (await (window as any).nativeFileDialog.read()).value?.steps['attachments.add']?.observedAt)).toBeUndefined()
    expect(await page.evaluate(() => (window as any).nativeFileDialog.controller.state.attempt.stepId)).toBe('attachments.add')
  } finally { await page.close() }
})
browserTest('empty native selection and component unmount both retire the owned prompt', async () => {
  const page = await setup()
  try {
    await openDialog(page)
    await page.locator('input[type="file"]').dispatchEvent('change')
    await eventually(() => page.evaluate(() => (window as any).nativeFileDialog.layers().length === 0))
    await openDialog(page)
    await page.evaluate(() => { (window as any).nativeFileDialog.mounted = false; (window as any).nativeFileDialog.render() })
    await eventually(() => page.evaluate(() => (window as any).nativeFileDialog.layers().length === 0))
    expect(await page.evaluate(async () => (await (window as any).nativeFileDialog.read()).value?.steps['attachments.add']?.observedAt)).toBeUndefined()
  } finally { await page.close() }
})


browserTest('a delayed native close after selection cannot cancel the valid same-session file read', async () => {
  const page = await setup()
  try {
    await page.evaluate(() => { (window as any).nativeFileDialog.holdReads = true })
    const chooser = await openDialog(page)
    await chooser.setFiles({ name: 'material.txt', mimeType: 'text/plain', buffer: Buffer.from('private material') })
    await page.waitForFunction(() => (window as any).nativeFileDialog.thumbnails.length === 1)
    expect(await page.evaluate(() => (window as any).nativeFileDialog.layers())).toEqual([])
    await page.evaluate(() => (window as any).nativeFileDialog.closeCallbacks[0]())
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'visible' })
    await page.evaluate(() => (window as any).nativeFileDialog.releaseRead())
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'hidden' })
    await eventually(() => page.evaluate(() => (window as any).nativeFileDialog.attachmentWrites.at(-1)?.names.includes('material.txt') ?? false))
    await eventually(() => page.evaluate(async () => (await (window as any).nativeFileDialog.read()).value?.steps['attachments.add']?.observedAt !== undefined))
  } finally { await page.close() }
})


browserTest('a scope change immediately after the real native read cannot persist its attachment through the successor session callback', async () => {
  const page = await setup()
  try {
    await page.evaluate(() => { (window as any).nativeFileDialog.holdReads = true; (window as any).nativeFileDialog.switchAfterRead = true })
    const chooser = await openDialog(page)
    await chooser.setFiles({ name: 'old.txt', mimeType: 'text/plain', buffer: Buffer.from('old private material') })
    await page.waitForFunction(() => (window as any).nativeFileDialog.thumbnails.length === 1)
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'visible' })
    await page.evaluate(() => (window as any).nativeFileDialog.releaseRead())
    await page.waitForFunction(() => (window as any).nativeFileDialog.scopeSwitchDone && (window as any).nativeFileDialog.controller.ready)
    await page.getByRole('status', { name: en['common.loading'], exact: true }).waitFor({ state: 'hidden' })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(() => (window as any).nativeFileDialog.attachmentWrites.filter((write: any) => write.sessionId === 'session-b').flatMap((write: any) => write.names))).not.toContain('old.txt')
    expect(await page.evaluate(async () => (await (window as any).nativeFileDialog.read()).value?.steps['attachments.add']?.observedAt)).toBeUndefined()
  } finally { await page.close() }
})


browserTest('native file attachment still works with learning disabled and cannot manufacture tour evidence', async () => {
  const page = await setup()
  try {
    await page.evaluate(() => (window as any).nativeFileDialog.controller.setEnabled(false))
    await page.waitForFunction(() => !(window as any).nativeFileDialog.controller.enabled)
    const chooser = await openDialog(page)
    await chooser.setFiles({ name: 'material.txt', mimeType: 'text/plain', buffer: Buffer.from('private material') })
    await eventually(() => page.evaluate(() => (window as any).nativeFileDialog.attachmentWrites.at(-1)?.names.includes('material.txt') ?? false))
    expect(await page.evaluate(() => (window as any).nativeFileDialog.layers())).toEqual([])
    expect(await page.evaluate(async () => (await (window as any).nativeFileDialog.read()).value?.steps['attachments.add']?.observedAt)).toBeUndefined()
  } finally { await page.close() }
})

if (isolatedCase && !registeredCase) throw new Error(`Unknown native file dialog case: ${isolatedCase}`)
