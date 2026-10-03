/** Run unchanged checked-in browser test bodies with Node's lifecycle on hosts
 * where Bun/Playwright graceful shutdown stalls. No production imports/assertions
 * or case timeouts are replaced. The receipt binds each bundle to exact sources.
 */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const repository = process.cwd()
const tests = process.argv.slice(2)
if (!tests.length) throw new Error('Supply checked-in Product Learning browser test paths')
const output = resolve(repository, 'test-results/product-tour/node-browser')
await mkdir(output, { recursive: true })
const adapter = resolve(repository, 'scripts/product-tour/browser-node-adapter.mjs')
for (const relative of tests) {
  const source = resolve(repository, relative)
  if (!source.startsWith(repository + '/') || !relative.endsWith('.browser.test.ts')) throw new Error('Expected a checked-in repository browser test')
  const bundle = resolve(output, basename(relative).replace('.ts', '.mjs'))
  const sources = new Map()
  await build({ entryPoints: [source], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
    plugins: [{ name: 'native-node-test-lifecycle-only', setup(builder) {
      builder.onResolve({ filter: /^bun:test$/ }, () => ({ path: adapter }))
      builder.onLoad({ filter: /\.(?:ts|tsx|mjs)$/ }, async args => {
        const content = await readFile(args.path, 'utf8')
        sources.set(args.path, createHash('sha256').update(content).digest('hex'))
        // Bun's metadata aliases refer to the original source, not the evidence bundle.
        const contents = content.replace(/\bimport\.meta\.(?:dir|dirname)\b/g, JSON.stringify(dirname(args.path)))
          .replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(args.path).href))
        return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : args.path.endsWith('.ts') ? 'ts' : 'js', resolveDir: dirname(args.path) }
      })
    } }],
  })
  const receipt = { marker: 'rox-product-tour-unchanged-browser-bodies-node-lifecycle', test: relative,
    node: process.version, adapter: createHash('sha256').update(await readFile(adapter)).digest('hex'),
    sources: Object.fromEntries([...sources].map(([path, hash]) => [path.slice(repository.length + 1), hash])),
    assertionsRewritten: false, productionImportsReplaced: false, caseTimeoutsRewritten: false }
  await writeFile(bundle + '.source.json', JSON.stringify(receipt, null, 2) + '\n')
  const child = spawn(process.execPath, ['--test', bundle], { cwd: repository, env: { ...process.env, ROX_PRODUCT_TOUR_NODE_BUNDLE: bundle }, stdio: 'inherit' })
  const code = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', code => done(code ?? 1)) })
  for (const [path, hash] of sources) {
    if (createHash('sha256').update(await readFile(path)).digest('hex') !== hash) throw new Error(`Test source changed during execution: ${path}`)
  }
  if (code !== 0) process.exit(code)
}
