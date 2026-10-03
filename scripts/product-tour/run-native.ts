/** Native acceptance never falls back to Chromium or a component fixture. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repository = resolve(import.meta.dirname, '../..')
const evidenceDirectory = resolve(repository, 'test-results/product-tour')
mkdirSync(evidenceDirectory, { recursive: true })
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).stdout.trim()
const dirty = !!spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repository, encoding: 'utf8' }).stdout.trim()
const platform = process.platform
const available = platform === 'darwin' || platform === 'win32'
const report = {
  commitSha: sha, trackedWorktreeDirty: dirty, platform, status: 'NOT_RUN', releaseBlocking: true,
  automatedSmoke: { status: 'NOT_RUN', scope: 'Real Electron fresh setup / no automatic tour', exitCode: null as number | null },
  cases: [
    { id: 'NATIVE-01', status: 'NOT_RUN', reason: 'Full macOS Start/Pause/Resume, menu and native-dialog acceptance needs recorded platform evidence.' },
    { id: 'NATIVE-02', status: 'NOT_RUN', reason: 'Full Windows Start/Pause/Resume, Git Bash, menu and drawer acceptance needs recorded platform evidence.' },
    { id: 'NATIVE-03', status: 'NOT_RUN', reason: 'OS microphone permission denial requires an operator and recorded system-dialog evidence.' },
  ],
}
const save = () => writeFileSync(resolve(evidenceDirectory, 'native-readiness.json'), JSON.stringify(report, null, 2))
if (!available) {
  report.automatedSmoke.scope += '; macOS and Windows unavailable on this host'
  save(); console.error(JSON.stringify(report)); process.exitCode = 2
} else if (!existsSync(resolve(repository, 'apps/electron/dist/main.cjs'))) {
  report.automatedSmoke.scope += '; real product build absent'
  save(); console.error('NOT_RUN: build main, preload and renderer before native acceptance.'); process.exitCode = 2
} else {
  report.automatedSmoke.status = 'RUNNING'; save()
  // Run the installed CLI through Bun itself; avoids Windows .cmd/shell quoting.
  const result = spawnSync(process.execPath, [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'tests/e2e/product-tour/native.config.ts'], { cwd: repository, stdio: 'inherit' })
  report.automatedSmoke.exitCode = result.status ?? 1
  report.automatedSmoke.status = result.status === 0 ? 'PASS' : 'FAIL'
  // A fresh-setup smoke cannot close the broader manual platform gates.
  save(); process.exitCode = result.status ?? 1
}
