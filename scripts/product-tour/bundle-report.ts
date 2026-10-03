/** Compare actual production build artifacts; never substitutes source LOC for bundle evidence. */
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const repository = resolve(import.meta.dirname, '../..')
const baseline = process.argv[2]
if (!baseline) throw new Error('Usage: bun scripts/product-tour/bundle-report.ts BASELINE_RENDERER_DIST [CANDIDATE_RENDERER_DIST]')
const candidate = process.argv[3] ?? join(repository, 'apps/electron/dist/renderer')
function files(directory: string): string[] { return readdirSync(directory).flatMap(name => { const path = join(directory, name); return statSync(path).isDirectory() ? files(path) : [path] }) }
const forbidden = ['rox-product-tour-application-test-only', 'rox-product-tour-component-test-only', '__productTourApplication', '__productTourComponent', 'owned-product-tour-bootstrap', 'product-tour-owned-workspace']
function inspect(directory: string) {
  const paths = files(resolve(directory))
  const measure = (suffix: string) => paths.filter(path => path.endsWith(suffix)).reduce((sum, path) => { const content = readFileSync(path); return { files: sum.files + 1, rawBytes: sum.rawBytes + content.length, gzipBytes: sum.gzipBytes + gzipSync(content, { level: 9, mtime: 0 } as any).length } }, { files: 0, rawBytes: 0, gzipBytes: 0 })
  const leakedMarkers = paths.filter(path => /\.(js|html|css)$/.test(path)).flatMap(path => forbidden.filter(marker => readFileSync(path, 'utf8').includes(marker)).map(marker => ({ path, marker })))
  const artifactHash = createHash('sha256')
  for (const path of paths.filter(path => /\.(js|html|css)$/.test(path)).sort()) { artifactHash.update(path.slice(resolve(directory).length)); artifactHash.update(readFileSync(path)) }
  return { directory: resolve(directory), artifactSha256: artifactHash.digest('hex'), js: measure('.js'), css: measure('.css'), leakedMarkers }
}
const before = inspect(baseline), after = inspect(candidate)
const report = {
  caseId: 'BUILD-01', commitSha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).stdout.trim(),
  trackedWorktreeDirty: !!spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repository, encoding: 'utf8' }).stdout.trim(),
  baseline: before, candidate: after,
  delta: { jsRawBytes: after.js.rawBytes - before.js.rawBytes, jsGzipBytes: after.js.gzipBytes - before.js.gzipBytes, cssRawBytes: after.css.rawBytes - before.css.rawBytes, cssGzipBytes: after.css.gzipBytes - before.css.gzipBytes },
  status: after.leakedMarkers.length === 0 && after.js.files > 0 && before.js.files > 0 ? 'PASS' : 'FAIL',
  method: 'Sum raw file bytes and gzip level 9 bytes independently per JS/CSS file; source maps excluded. Builds must be produced separately at recorded SHAs.',
}
const output = join(repository, 'test-results/product-tour/bundle-report.json')
mkdirSync(join(repository, 'test-results/product-tour'), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
if (report.status === 'FAIL') process.exitCode = 1
