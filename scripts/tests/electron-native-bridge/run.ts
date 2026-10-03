/** Portable, bounded real-Electron bridge probe. Not a packaged product UI test. */
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import * as esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const repo = realpathSync(resolve(here, '../../..'))
const require = createRequire(import.meta.url)
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const fixtureSource = join(here, 'fixture.ts')
const preload = join(repo, 'apps/electron/dist/bootstrap-preload.cjs')
const phases = ['single', 'prepare', 'replay'] as const
type Phase = typeof phases[number]
interface Stage {
  phase: Phase
  pid: number
  exit: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  pidExited: boolean
}

function outputDirectory(): string {
  const args = process.argv.slice(2)
  if (args.length === 0) return realpathSync(mkdtempSync(join(tmpdir(), 'rox-native-bridge-report-')))
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) {
    throw new Error('Usage: run.ts [--output NEW_REPORT_DIRECTORY]')
  }
  const path = resolve(args[1])
  // Never overwrite an existing directory or select a caller-supplied profile root.
  mkdirSync(path, { mode: 0o700 })
  return realpathSync(path)
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error // Unknown liveness is not a successful cleanup.
  }
}

function childEnvironment(root: string, archive: string, runId: string, phase: Phase): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ROX_CONFIG_DIR: join(root, 'config'),
    CRAFT_CONFIG_DIR: join(root, 'config'),
    ROX_BRIDGE_ROOT: root,
    ROX_BRIDGE_ARCHIVE: archive,
    ROX_BRIDGE_RUN_ID: runId,
    ROX_BRIDGE_PHASE: phase,
    ROX_BRIDGE_PRELOAD: preload,
  }
  // Only process/display prerequisites; no host HOME, auth, provider or keychain variables.
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

async function runChild(binary: string, bundle: string, root: string, archive: string, runId: string, phase: Phase): Promise<Stage> {
  const child = spawn(binary, [bundle], {
    cwd: repo, env: childEnvironment(root, archive, runId, phase), stdio: ['ignore', 'pipe', 'pipe'],
  })
  const pid = child.pid
  if (!pid) throw new Error(`Electron ${phase} did not start`)
  let output = ''
  child.stdout?.on('data', data => { output += String(data) })
  child.stderr?.on('data', data => { output += String(data) })
  let timedOut = false
  let escalation: ReturnType<typeof setTimeout> | undefined
  const deadline = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    escalation = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 2000)
  }, 45_000)
  try {
    const outcome = await new Promise<{ exit: number | null; signal: NodeJS.Signals | null }>((done, fail) => {
      child.once('error', fail)
      child.once('close', (exit, signal) => done({ exit, signal }))
    })
    writeFileSync(join(archive, `${phase}.log`), output)
    const stage: Stage = { phase, pid, ...outcome, timedOut, pidExited: !pidAlive(pid) }
    return stage
  } finally {
    clearTimeout(deadline)
    if (escalation) clearTimeout(escalation)
  }
}

function readResult(archive: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(archive, name), 'utf8')) as Record<string, unknown>
}

function verifyResult(result: Record<string, unknown>, revision: number): void {
  assert.equal(result.status, 'passed')
  assert.equal(result.createRevision, revision)
  assert.equal(result.pendingAfterExactACK, 0)
  assert.equal(result.canonicalFileReadback, true)
  assert.equal(result.grantRevocationDenied, true)
  assert.equal(result.canonicalBytesUnchangedAfterRevoke, true)
  assert.equal(result.canonicalReceiptsBefore, revision)
  assert.equal(result.canonicalReceiptsAfter, revision)
  assert.equal(result.wrongWindowDenied, true)
  assert.equal(result.destroyedOwnerHandleRejected, true)
  assert.deepEqual(result.safety, { forgedACKRejected: true, pendingRetained: 1 })
  assert.deepEqual(result.revokedMutation, { enqueueDenied: true, commitDenied: true })
}

async function main(): Promise<void> {
  if (!existsSync(preload)) {
    throw new Error('Production preload missing. Run `bun run electron:build:preload` in this checkout, then retry. No install or product main launch is performed by this harness.')
  }
  const resolvedElectron: unknown = require('electron')
  if (typeof resolvedElectron !== 'string' || !isAbsolute(resolvedElectron) || !existsSync(resolvedElectron)) {
    throw new Error('The installed electron package must provide its existing binary; install dependencies separately using the project workflow.')
  }
  const binary = realpathSync(resolvedElectron)
  const archive = outputDirectory()
  const runId = randomUUID()
  const bundle = join(archive, 'fixture.cjs')
  const launcher = join(archive, 'launch.cjs')
  const stages: Stage[] = []
  let sourceBindings: Array<{ path: string; sha256: string }> = []
  const inputs = {
    runnerSha256: sha256(fileURLToPath(import.meta.url)), fixtureSha256: sha256(fixtureSource),
    preloadSha256: sha256(preload), electronBinary: binary,
    dependencyLockSha256: sha256(join(repo, 'bun.lock')),
    runnerRuntime: { node: process.version, bun: process.versions.bun ?? null, platform: process.platform, arch: process.arch },
  }
  let externalSdk: { path: string; sha256: string } | undefined
  let failure: string | undefined
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rox-native-bridge-profile-')))
  try {
    // Preserve the SDK's native ESM/import.meta module initialization; no query is called.
    const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk')
    externalSdk = { path: sdkEntry, sha256: sha256(sdkEntry) }
    const build = await esbuild.build({
      absWorkingDir: repo, entryPoints: [fixtureSource], outfile: bundle,
      bundle: true, platform: 'node', format: 'cjs', metafile: true,
      tsconfig: join(repo, 'apps/electron/tsconfig.json'),
      external: ['electron', 'bun:*', 'onnxruntime-node', '@xenova/transformers', 'sharp'],
      plugins: [{ name: 'installed-sdk-esm-boundary', setup(builder) {
        builder.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, () => ({ path: sdkEntry, external: true }))
      } }],
      logLevel: 'warning',
    })
    sourceBindings = Object.keys(build.metafile.inputs)
      .filter(path => path.startsWith('packages/') || path.startsWith('apps/') || path.startsWith('scripts/'))
      .map(path => ({ path, sha256: sha256(join(repo, path)) }))
      .sort((a, b) => a.path.localeCompare(b.path))
    assert(sourceBindings.some(input => input.path === 'packages/server-core/src/authority/native-journal.ts'))
    assert(sourceBindings.some(input => input.path === 'apps/electron/src/main/native-replica.ts'))
    // Establish the owned hidden profile before any service-module initialization.
    // Module/runtime incompatibility must fail without Electron's default error UI.
    writeFileSync(launcher, `const {app}=require('electron');const fs=require('node:fs');const path=require('node:path');
const root=process.env.ROX_BRIDGE_ROOT;const archive=process.env.ROX_BRIDGE_ARCHIVE;
if(process.platform==='darwin')app.setActivationPolicy('prohibited');
app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
try{require(${JSON.stringify(bundle)})}catch(error){fs.writeFileSync(path.join(archive,'result.json'),JSON.stringify({status:'failed',phase:process.env.ROX_BRIDGE_PHASE,pid:process.pid,error:String(error)}));app.exit(1)}`)
    writeFileSync(join(archive, 'inputs.json'), JSON.stringify({ ...inputs, sourceBindings, externalSdk, bundleSha256: sha256(bundle), launcherSha256: sha256(launcher) }, null, 2))
    for (const phase of phases) {
      mkdirSync(root, { recursive: true, mode: 0o700 })
      writeFileSync(join(root, 'owned-run-id'), runId, { mode: 0o600 })
      const stage = await runChild(binary, launcher, root, archive, runId, phase)
      stages.push(stage)
      assert.equal(stage.exit, 0, `Electron ${phase} failed; see ${phase}.log`)
      assert.equal(stage.signal, null)
      assert.equal(stage.timedOut, false)
      assert.equal(stage.pidExited, true)
      if (phase !== 'prepare') {
        const result = readResult(archive, 'result.json')
        assert.equal(result.phase, phase)
        assert.equal(result.pid, stage.pid)
        verifyResult(result, phase === 'single' ? 1 : 2)
        writeFileSync(join(archive, `${phase}.json`), JSON.stringify(result, null, 2))
      }
    }
    const prepared = readResult(archive, 'restart-prepared.json')
    const replay = readResult(archive, 'replay.json')
    assert.equal(prepared.pid, stages[1]?.pid)
    assert.equal(prepared.pending, 1)
    assert.equal(prepared.canonicalRevision, 1)
    assert.equal(typeof prepared.operationHash, 'string')
    assert.equal(prepared.operationHash, replay.operationHash)
    assert.equal(replay.wholeChildRestart, true)
    assert.equal(new Set(stages.map(stage => stage.pid)).size, 3)
    assert.equal(sha256(preload), inputs.preloadSha256, 'Production preload changed during the run')
    assert.equal(sha256(sdkEntry), externalSdk.sha256, 'Installed external SDK entry changed')
    for (const input of sourceBindings) assert.equal(sha256(join(repo, input.path)), input.sha256, `Source changed: ${input.path}`)
  } catch (error) {
    failure = String(error)
  } finally {
    // Only this runner-generated root, never HOME or a supplied user profile.
    rmSync(root, { recursive: true, force: true })
    const receipt = {
      status: failure ? 'FAILED' : 'PASS_BOUNDED_ELECTRON_BRIDGE', failure, inputs, stages,
      ownedFixtureRemoved: !existsSync(root), sourceBindings, externalSdk,
      evidenceLevel: 'Actual Electron bridge composition; NOT packaged product UI E3',
      adapters: ['Synthetic task authority bootstrap/enrollment', 'Task-generated persistent credential/key DI; NOT OS custody', 'Minimal main bootstrap adapters; NOT full product main'],
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
      limits: ['Graceful restart, NOT SIGKILL/powerloss', 'No provider/model/media/foreground/UI/platform acceptance', 'Postdestroy foreign caller denial does not isolate owner-destruction cleanup causality', 'Missing dependencies/display/production preload and node:sqlite CJS compatibility are readiness failures; no implicit installs or future adapter transplant'],
    }
    writeFileSync(join(archive, 'receipt.json'), JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify({ status: receipt.status, archive, actualElectronMainPids: stages.map(stage => stage.pid), ownedFixtureRemoved: receipt.ownedFixtureRemoved }))
  }
  if (failure) throw new Error(`Bridge failed: ${failure}. See ${relative(process.cwd(), archive)}/receipt.json`)
}

main().catch(error => { console.error(String(error)); process.exitCode = 1 })
