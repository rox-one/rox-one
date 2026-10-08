/** Run unchanged checked-in browser test bodies with Node's lifecycle on hosts
 * where Bun/Playwright graceful shutdown stalls. No production imports/assertions
 * or case timeouts are replaced. The receipt binds each bundle to exact sources.
 */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { bindOwnedBrowserTermination } from './browser-node-process.mjs'

const repository = process.cwd()
const tests = process.argv.slice(2)
if (!tests.length) throw new Error('Supply checked-in Product Learning browser test paths')
const output = resolve(repository, 'test-results/product-tour/node-browser')
await mkdir(output, { recursive: true })
const adapter = resolve(repository, 'scripts/product-tour/browser-node-adapter.mjs')
for (const relative of tests) {
  const source = resolve(repository, relative)
  if (!source.startsWith(repository + '/') || !relative.endsWith('.browser.test.ts')) throw new Error('Expected a checked-in repository browser test')
  const selectedCase = relative === 'apps/electron/src/renderer/features/product-tour/runtime/__tests__/native-file-dialog.browser.test.ts'
    ? process.env.ROX_PRODUCT_TOUR_FILE_DIALOG_CASE : undefined
  const suffix = selectedCase ? `.${createHash('sha256').update(selectedCase).digest('hex').slice(0, 12)}` : ''
  const bundle = resolve(output, basename(relative).replace('.ts', `${suffix}.mjs`))
  const sources = new Map()
  for (const path of [fileURLToPath(import.meta.url), resolve(repository, 'scripts/product-tour/browser-node-process.mjs')]) {
    sources.set(path, createHash('sha256').update(await readFile(path)).digest('hex'))
  }
  await build({ entryPoints: [source], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
    plugins: [{ name: 'native-node-test-lifecycle-only', setup(builder) {
      builder.onResolve({ filter: /^bun:test$/ }, () => ({ path: adapter }))
      builder.onLoad({ filter: /\.(?:ts|tsx|mjs|json)$/ }, async args => {
        const content = await readFile(args.path, 'utf8')
        sources.set(args.path, createHash('sha256').update(content).digest('hex'))
        // Bun's metadata aliases refer to the original source, not the evidence bundle.
        const contents = args.path.endsWith('.json') ? content
          : content.replace(/\bimport\.meta\.(?:dir|dirname)\b/g, JSON.stringify(dirname(args.path)))
            .replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(args.path).href))
        return { contents, loader: args.path.endsWith('.json') ? 'json' : args.path.endsWith('.tsx') ? 'tsx' : args.path.endsWith('.ts') ? 'ts' : 'js', resolveDir: dirname(args.path) }
      })
    } }],
  })
  const receipt = { marker: 'rox-product-tour-unchanged-browser-bodies-node-lifecycle', test: relative,
    node: process.version, adapter: createHash('sha256').update(await readFile(adapter)).digest('hex'),
    sources: Object.fromEntries([...sources].map(([path, hash]) => [path.slice(repository.length + 1), hash])),
    assertionsRewritten: false, productionImportsReplaced: false, caseTimeoutsRewritten: false, selectedCase,
    selectedCaseVerified: false }
  await writeFile(bundle + '.source.json', JSON.stringify(receipt, null, 2) + '\n')
  const env = { ...process.env, ROX_PRODUCT_TOUR_NODE_BUNDLE: bundle }
  // A nested Node runner must not inherit another runner's private IPC context.
  delete env.NODE_TEST_CONTEXT
  const child = spawn(process.execPath, ['--test', ...(selectedCase ? ['--test-isolation=none', '--test-reporter=tap'] : []), bundle], {
    cwd: repository, env, stdio: selectedCase ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    detached: !!selectedCase && process.platform !== 'win32',
  })
  const reports = ['', '']
  const drains = selectedCase ? [child.stdout, child.stderr].map((pipe, index) => new Promise(done => {
    pipe.on('data', chunk => {
      reports[index] = (reports[index] + chunk).slice(-65_536)
      const output = index === 0 ? process.stdout : process.stderr
      output.write(chunk)
    })
    pipe.once('end', done); pipe.once('error', done)
  })) : []
  const custody = selectedCase ? bindOwnedBrowserTermination(child) : undefined
  let code
  let drainTimeout
  try {
    code = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', code => done(code ?? 1)) })
    if (selectedCase) await Promise.race([Promise.all(drains), new Promise(done => { drainTimeout = setTimeout(done, 1_000) })])
    if (selectedCase && code === 0) {
      const report = reports.join('\n')
      if (!/^# tests 1$/m.test(reports[0]) || !/^# pass 1$/m.test(reports[0]) || !/^# fail 0$/m.test(reports[0])
        || !report.includes('[native-browser] file-dialog:case:start') || !report.includes('[native-browser] file-dialog:case:passed')) {
        throw new Error(`Selected file-dialog child did not execute exactly one passing case:\n${report}`)
      }
      receipt.selectedCaseVerified = true
      receipt.selectedCaseStages = [...report.matchAll(/\[native-browser\] (file-dialog:[a-z:-]+)/g)].map(match => match[1])
    }
  } finally {
    clearTimeout(drainTimeout)
    if (selectedCase) {
      await custody.terminate()
      custody.dispose()
      child.stdout.destroy(); child.stderr.destroy()
    }
  }
  for (const [path, hash] of sources) {
    if (createHash('sha256').update(await readFile(path)).digest('hex') !== hash) throw new Error(`Test source changed during execution: ${path}`)
  }
  await writeFile(bundle + '.source.json', JSON.stringify(receipt, null, 2) + '\n')
  if (code !== 0) process.exit(code)
}
