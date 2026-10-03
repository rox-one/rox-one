/** Exercise the actual Docker manifest COPY layer and .dockerignore without
 * installing dependencies, starting application services, or sending secrets.
 * The intentionally missing-manifest control must fail in BuildKit itself.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dir, '..')
const dockerfile = readFileSync(join(root, 'Dockerfile.server'), 'utf8')
const cachedCopies = dockerfile.split(/\nRUN bun install --frozen-lockfile\b/)[0]
  .split('\n').filter(line => line.startsWith('COPY '))
if (!cachedCopies.length) throw new Error('No manifest COPY layer found before frozen install')
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
if (tracked.status !== 0) throw new Error('Cannot enumerate tracked workspace manifests')
const workspaceManifests = tracked.stdout.split('\0')
  .filter(path => /^(?:apps|packages)\/[^/]+\/package\.json$/.test(path))
const workspaces = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces as string[]
const isMember = (path: string) => {
  const directory = dirname(path)
  const matches = (pattern: string) => new RegExp('^' + pattern.split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$').test(directory)
  return workspaces.some(pattern => !pattern.startsWith('!') && matches(pattern)) &&
    !workspaces.some(pattern => pattern.startsWith('!') && matches(pattern.slice(1)))
}
const expected = ['package.json', 'bun.lock', 'bunfig.toml', ...workspaceManifests.filter(isMember)]
const fixture = mkdtempSync(join(tmpdir(), 'rox-server-context-'))
const context = join(fixture, 'context')
mkdirSync(context)
function put(path: string, bytes: string | Buffer) {
  mkdirSync(dirname(join(context, path)), { recursive: true })
  writeFileSync(join(context, path), bytes)
}
for (const path of expected) put(path, readFileSync(join(root, path)))
put('.dockerignore', readFileSync(join(root, '.dockerignore')))
put('Dockerfile', 'FROM scratch\nWORKDIR /cached\n' + cachedCopies.join('\n') + '\nCOPY . /context/\n')
for (const path of ['.env', '.env.local', 'apps/webui/.env.production', '.codegraph/private.json',
  '.craft-agent/credentials.json', '.rox/private.json', '.omp/auth.json', 'node_modules/private.txt',
  'apps/webui/node_modules/private.txt', 'packages/pi-agent-server/dist/stale.js', 'dist/stale.js']) put(path, 'synthetic-private-marker')
put('apps/electron/resources/config-defaults.json', '{"fixture":true}')
const results: any[] = []
function build(label: string) {
  const destination = join(fixture, label)
  const result = spawnSync('docker', ['buildx', 'build', '--progress=plain',
    '--output', 'type=local,dest=' + destination, context], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
  results.push({ label, exit: result.status, error: result.error?.message,
    stdout: result.stdout, stderr: result.stderr })
  return { destination, result }
}
try {
  const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length)
  if (baseline) {
    if (!/^[a-f0-9]{40}$/.test(baseline)) throw new Error('Baseline must be an exact Git revision')
    const original = spawnSync('git', ['show', baseline + ':Dockerfile.server'], { cwd: root, encoding: 'utf8' })
    if (original.status !== 0) throw new Error('Baseline Dockerfile is unavailable')
    const originalCopies = original.stdout.split(/\nRUN bun install --frozen-lockfile\b/)[0]
      .split('\n').filter(line => line.startsWith('COPY '))
    put('Dockerfile', 'FROM scratch\nWORKDIR /cached\n' + originalCopies.join('\n') + '\n')
    const broken = build('original-missing-docs-site')
    if (broken.result.status === 0 || !broken.result.stderr.includes('apps/docs-site/package.json')) {
      throw new Error('Original absent docs-site build failure was not reproduced')
    }
    put('Dockerfile', 'FROM scratch\nWORKDIR /cached\n' + cachedCopies.join('\n') + '\nCOPY . /context/\n')
  }
  const { destination, result } = build('positive')
  if (result.status !== 0) throw new Error('Actual Docker COPY failed: ' + result.stderr)
  for (const path of expected) {
    const copied = readFileSync(join(destination, 'cached', path))
    if (!copied.equals(readFileSync(join(root, path)))) throw new Error('Cache manifest differs: ' + path)
  }
  for (const path of ['.env', '.env.local', 'apps/webui/.env.production', '.codegraph/private.json',
    '.craft-agent/credentials.json', '.rox/private.json', '.omp/auth.json', 'node_modules/private.txt',
    'apps/webui/node_modules/private.txt', 'packages/pi-agent-server/dist/stale.js', 'dist/stale.js']) {
    if (existsSync(join(destination, 'context', path))) throw new Error('Private/stale input entered context: ' + path)
  }
  if (!existsSync(join(destination, 'context/apps/electron/resources/config-defaults.json'))) throw new Error('Required resource excluded')
  rmSync(join(context, 'apps/workspace-service/package.json'))
  const negative = build('missing-workspace')
  if (negative.result.status === 0 || !negative.result.stderr.includes('apps/workspace-service/package.json')) {
    throw new Error('Missing workspace negative control was not rejected by Docker')
  }
  console.log(JSON.stringify({ status: 'PASS', scope: 'ACTUAL_DOCKER_COPY_AND_CONTEXT_ONLY',
    workspaceManifests: expected.length - 3, cachedInputs: expected.length,
    privateAndStaleInputsExcluded: 11, missingWorkspaceRejected: true,
    fullImageBuildExecuted: false,
    dockerfileSha256: createHash('sha256').update(dockerfile).digest('hex'),
    dockerignoreSha256: createHash('sha256').update(readFileSync(join(root, '.dockerignore'))).digest('hex'), results }, null, 2))
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
