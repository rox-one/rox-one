import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dir, '..')
const source = process.argv[2]
const runtime = process.argv[3]
if (!source || !runtime) throw new Error('Pass isolated merged checkout and qualified Bun executable')
const commit = (await Bun.$`git -C ${source} rev-parse HEAD`.quiet()).stdout.toString().trim()
const dir = join(root, 'docs/final-readiness/parallel-work/postmerge', commit)
mkdirSync(dir, { recursive: true })
const version = (await Bun.$`${runtime} --version`.quiet()).stdout.toString().trim()
const results: any[] = []
const configRoot = mkdtempSync(join(tmpdir(), 'rox-integration-check-'))
process.on('exit', () => rmSync(configRoot, { recursive: true, force: true }))
const check = async (name: string, command: string[], cwd = source) => {
  const started = Date.now()
  const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', env: {
    ...process.env, NO_COLOR: '1', PATH: `${dirname(runtime)}:${process.env.PATH ?? ''}`,
    ROX_CONFIG_DIR: join(configRoot, 'rox'), CRAFT_CONFIG_DIR: join(configRoot, 'craft'),
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    NODE_OPTIONS: '--max-old-space-size=4096',
    ...(name === 'built-server-lifecycle' ? { ROX_SERVER_SMOKE_ENTRY: 'dist-server-integration/index.js', ROX_SERVER_SMOKE_WEBUI_DIR: 'apps/webui/dist' } : {}),
  } })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = (stdout + stderr).replace(/[ \t]+$/gm, '').trimEnd()
  const log = `${name.replaceAll('/', '-')}.log`
  writeFileSync(join(dir, log), output ? output + '\n' : '')
  const result = { name, commit, runtime: version, command, cwd: cwd.replace(source, '<integration>'), exitCode, elapsedMs: Date.now() - started,
    diagnosticOccurrences: (output.match(/error TS\d+/g) ?? []).length, log }
  results.push(result)
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ commit, runtime: version, host: { platform: process.platform, architecture: process.arch }, results,
    limits: 'Source/frozen-install/compiler/fixture/built local server gates. Does not certify signed native artifacts, provider operations or hosted production.' }, null, 2) + '\n')
  console.log(JSON.stringify(result))
  return exitCode === 0
}
if (!await check('frozen-install', [runtime, 'install', '--frozen-lockfile'])) process.exit(1)
const manifests = ['apps', 'packages'].flatMap(g => readdirSync(join(source, g)).map(n => `${g}/${n}`).filter(p => Bun.file(join(source, p, 'package.json')).size > 0))
const queue = [...manifests]
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const p = queue.shift()!
    const m = JSON.parse(readFileSync(join(source, p, 'package.json'), 'utf8'))
    await check(p, m.scripts?.typecheck ? [runtime, 'run', 'typecheck'] : [runtime, 'run', 'tsc', '--noEmit'], join(source, p))
  }
}))
await check('ci-validation', [runtime, 'run', 'validate:ci'])
await check('durability-web-packaging', [runtime, 'test',
  'packages/server-core/src/authority/__tests__', 'packages/server-core/src/collaboration',
  'packages/server-core/src/transport/__tests__/server-lifecycle.test.ts',
  'packages/server-core/src/transport/__tests__/acknowledged-workspace.test.ts',
  'packages/server-core/src/transport/__tests__/before-response-authority.test.ts',
  'packages/shared/src/config/__tests__/config-isolation.test.ts',
  'packages/server-core/src/handlers/rpc/__tests__/native-workspace-startup.test.ts',
  'packages/server-core/src/webui', 'packages/server-core/src/bootstrap',
  'scripts/build/__tests__/electron-packaging-files.test.ts',
  'tests/lark-suite-extension/legacy-markdown-migration-fence.test.ts',
  'apps/electron/src/renderer/hooks/__tests__/useProjects-scope.test.ts',
  'packages/shared/src/projects/__tests__/roadmap-save-caller.test.ts',
  'packages/server-core/src/handlers/rpc/__tests__/roadmap-boundary-runtime.test.ts',
  'packages/server-core/src/handlers/rpc/__tests__/roadmap-model-provenance.test.ts',
])
const web = await check('web-build', [runtime, 'run', 'webui:build'])
const pi = await check('pi-subprocess-build', [runtime, 'run', 'server:build:subprocess'])
const bundle = await check('server-build', [runtime, 'build', 'packages/server/src/index.ts', '--target', 'bun', '--outdir', 'dist-server-integration', '--external', 'xlsx'])
if (web && pi && bundle) await check('built-server-lifecycle', [runtime, 'test', 'packages/server/src/__tests__/smoke.test.ts'])
const finalCommit = (await Bun.$`git -C ${source} rev-parse HEAD`.quiet()).stdout.toString().trim()
if (commit !== finalCommit) throw new Error('Source commit changed during qualification')
rmSync(configRoot, { recursive: true, force: true })
console.log(JSON.stringify({ commit, passed: results.filter(r => r.exitCode === 0).length, failed: results.filter(r => r.exitCode !== 0).map(r => r.name) }))
process.exit(results.some(r => r.exitCode !== 0) ? 1 : 0)
