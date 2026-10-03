/** Explicit test-only reuse of an unchanged production renderer bundle. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../../..')
const buildRoot = resolve(repoRoot, 'node_modules/.cache/runtime-map-e2e-build')
const receiptPath = resolve(buildRoot, 'runtime-build-receipt.json')
function sourceFingerprint() {
  if (execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'apps', 'packages', 'tests/fixtures/runtime-map'], { cwd: repoRoot, encoding: 'utf8' }).trim()) throw new Error('Cannot reuse a renderer build with uncommitted product/fixture inputs')
  const hash = createHash('sha256')
  for (const tree of ['apps', 'packages', 'tests/fixtures/runtime-map']) hash.update(execFileSync('git', ['rev-parse', `HEAD:${tree}`], { cwd: repoRoot }))
  for (const file of ['harness.tsx', 'harness.css', 'index.html', 'browser-performance.ts', 'CatalogHarness.tsx', 'vite.config.ts']) hash.update(readFileSync(resolve(import.meta.dir, file)))
  return hash.digest('hex')
}
export function recordRendererBuild() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  writeFileSync(receiptPath, JSON.stringify({ head, sourceFingerprint: sourceFingerprint(), indexSha256: createHash('sha256').update(readFileSync(resolve(buildRoot, 'index.html'))).digest('hex') }))
}
export function verifyRendererBuild() {
  if (!existsSync(receiptPath)) throw new Error('Explicit renderer reuse requires a successful build receipt')
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  const indexSha256 = createHash('sha256').update(readFileSync(resolve(buildRoot, 'index.html'))).digest('hex')
  if (receipt.sourceFingerprint !== sourceFingerprint() || receipt.indexSha256 !== indexSha256) throw new Error('Renderer build inputs changed; rebuild before measuring')
}
