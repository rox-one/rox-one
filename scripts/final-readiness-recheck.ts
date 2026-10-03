import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
const root = resolve(import.meta.dir, '..')
const source = process.argv[2]
if (!source) throw new Error('Pass the isolated candidate checkout path')
const dir = join(root, 'docs/final-readiness/evidence')
const commit = (await Bun.$`git -C ${source} rev-parse HEAD`.quiet()).stdout.toString().trim()
const manifests = ['apps', 'packages'].flatMap(group => readdirSync(join(source, group)).map(name => `${group}/${name}`).filter(p => Bun.file(join(source, p, 'package.json')).size > 0))
const prior = join(dir, 'candidate-recheck.json')
const builtLifecycleOnly = process.argv.includes('--built-lifecycle')
const runtimeArg = process.argv.indexOf('--runtime')
const runtime = runtimeArg >= 0 ? process.argv[runtimeArg + 1] : 'bun'
const runtimeVersion = (await Bun.$`${runtime} --version`.quiet()).stdout.toString().trim()
const suffix = runtimeArg >= 0 ? `-bun${runtimeVersion.replaceAll('.', '')}` : ''
const serverOut = runtimeArg >= 0 ? `dist-server-bun${runtimeVersion.replaceAll('.', '')}` : 'dist-server'
const results: any[] = builtLifecycleOnly ? JSON.parse(readFileSync(prior, 'utf8')).results : []
const check = async (name: string, command: string[], cwd = source) => {
  const start = Date.now()
  command = [command[0] === 'bun' ? runtime : command[0], ...command.slice(1)]
  const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1', ...(runtimeArg >= 0 ? { PATH: `${dirname(runtime)}:${process.env.PATH ?? ''}` } : {}), ...(name === 'built-server-lifecycle' ? { ROX_SERVER_SMOKE_ENTRY: `${serverOut}/index.js`, ROX_SERVER_SMOKE_WEBUI_DIR: 'apps/webui/dist' } : {}) } })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  const output = stdout + stderr
  const log = `candidate-${name.replaceAll('/', '-')}${suffix}.log`
  const normalizedOutput = output.replace(/[ \t]+$/gm, '').trimEnd()
  writeFileSync(join(dir, log), normalizedOutput ? normalizedOutput + '\n' : '')
  const result = { name: name + suffix, commit, runtimeVersion, command, cwd: cwd.replace(source, '<candidate>'), exitCode, elapsedMs: Date.now() - start, diagnosticOccurrences: (output.match(/error TS\d+/g) ?? []).length, log }
  results.push(result)
  writeFileSync(join(dir, 'candidate-recheck.json'), JSON.stringify({ commit, host: { platform: process.platform, architecture: process.arch, bun: Bun.version }, results, limits: 'Independent clean checkout. Source/unit and compiler results do not establish native signed artifacts, provider accounts or hosted deployment acceptance.' }, null, 2) + '\n')
  console.log(JSON.stringify(result))
}
if (builtLifecycleOnly) {
  await check('pi-subprocess-build', ['bun', 'run', 'server:build:subprocess'])
  await check('server-build', ['bun', 'build', 'packages/server/src/index.ts', '--target', 'bun', '--outdir', serverOut, '--external', 'xlsx'])
  if (results.slice(-2).every(r => r.exitCode === 0)) await check('built-server-lifecycle', ['bun', 'test', 'packages/server/src/__tests__/smoke.test.ts'])
  process.exit(results.slice(-3).some(r => r.exitCode !== 0) ? 1 : 0)
}
const queues = [...manifests]
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queues.length) {
    const p = queues.shift()!
    const manifest = JSON.parse(readFileSync(join(source, p, 'package.json'), 'utf8'))
    const cmd = manifest.scripts?.typecheck ? ['bun', 'run', 'typecheck'] : ['bun', 'run', 'tsc', '--noEmit']
    await check(p, cmd, join(source, p))
  }
}))
await check('root-typecheck', ['bun', 'run', 'typecheck:all'])
await check('durability-and-lifecycle-tests', ['bun', 'test', 'packages/server-core/src/authority/__tests__', 'packages/server-core/src/collaboration', 'packages/server-core/src/transport/__tests__/server-lifecycle.test.ts', 'packages/server-core/src/transport/__tests__/acknowledged-workspace.test.ts', 'packages/server-core/src/transport/__tests__/before-response-authority.test.ts', 'packages/shared/src/config/__tests__/config-isolation.test.ts', 'packages/server-core/src/handlers/rpc/__tests__/native-workspace-startup.test.ts'])
await check('web-transport-tests', ['bun', 'test', 'packages/server-core/src/webui', 'packages/server-core/src/bootstrap'])
await check('web-build', ['bun', 'run', 'webui:build'])
