/** Native acceptance never falls back to Chromium or a component fixture. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repository = resolve(import.meta.dirname, '../..')
const evidenceDirectory = resolve(repository, 'test-results/product-tour')
mkdirSync(evidenceDirectory, { recursive: true })
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).stdout.trim()
const platform = process.platform
const available = platform === 'darwin' || platform === 'win32'
const manual = { id: 'NATIVE-03', status: 'NOT_RUN', reason: 'OS microphone permission denial requires an operator and recorded system-dialog evidence.' }
if (!available) {
  const report = {
    commitSha: sha, platform, status: 'NOT_RUN', releaseBlocking: true,
    cases: [
      { id: 'NATIVE-01', status: 'NOT_RUN', reason: 'macOS is unavailable on this host.' },
      { id: 'NATIVE-02', status: 'NOT_RUN', reason: 'Windows is unavailable on this host.' },
      manual,
    ],
  }
  writeFileSync(resolve(evidenceDirectory, 'native-readiness.json'), JSON.stringify(report, null, 2))
  console.error(JSON.stringify(report))
  process.exitCode = 2
} else if (!existsSync(resolve(repository, 'apps/electron/dist/main.cjs'))) {
  console.error('NOT_RUN: real Electron product build is absent. Build main, preload and renderer before native acceptance.')
  process.exitCode = 2
} else {
  writeFileSync(resolve(evidenceDirectory, 'native-readiness.json'), JSON.stringify({ commitSha: sha, platform, manual, status: 'PENDING_APPLICATION_RUN' }, null, 2))
  const binary = platform === 'win32' ? 'playwright.cmd' : 'playwright'
  const result = spawnSync(resolve(repository, 'node_modules/.bin', binary), ['test', '--config', 'tests/e2e/product-tour/native.config.ts'], { cwd: repository, stdio: 'inherit', shell: platform === 'win32' })
  process.exitCode = result.status ?? 1
}
