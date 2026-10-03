/** Test-only built App provenance; refuse a stale prebuilt harness after any bundled source change. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export function applicationBuildFingerprint(repository: string): string {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'apps/electron/src/renderer', 'apps/electron/src/shared', 'apps/electron/src/transport', 'apps/electron/src/preload/native-replica.ts', 'packages/core/src', 'packages/ui/src', 'packages/shared/src', 'tests/e2e/product-tour/fixtures/application', 'apps/webui/vite.config.ts', 'apps/webui/src/browser-globals.ts'], { cwd: repository })
  if (result.status !== 0) throw new Error('Owned application build source inventory unavailable')
  const hash = createHash('sha256')
  for (const file of result.stdout.toString().split('\0').filter(Boolean).sort()) {
    hash.update(file); hash.update('\0'); hash.update(readFileSync(join(repository, file))); hash.update('\0')
  }
  return hash.digest('hex')
}
export function applicationBuildReceipt(repository: string): string {
  return join(repository, 'test-results/product-tour/harness-build/source-receipt.json')
}
export function writeApplicationBuildReceipt(repository: string, fingerprint: string): void {
  writeFileSync(applicationBuildReceipt(repository), JSON.stringify({ marker: 'rox-product-tour-application-test-only', fingerprint }) + '\n')
}
export function requireApplicationBuildReceipt(repository: string): void {
  const receipt = JSON.parse(readFileSync(applicationBuildReceipt(repository), 'utf8'))
  if (receipt.marker !== 'rox-product-tour-application-test-only' || receipt.fingerprint !== applicationBuildFingerprint(repository)) throw new Error('Prebuilt owned application sources differ; rebuild the acceptance harness')
}
