import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'
import { projectNativeVaultReceipt, safeVaultErrorCode } from './pocket-vault-diagnostics'

const workspace = resolve(import.meta.dir, '../..')
const directory = await mkdtemp(join(tmpdir(), 'rox-pocket-native-vault-'))
const bundle = join(directory, 'probe.cjs')
const reports = join(workspace, 'reports/pocket-sso-native-vault')
const report = join(reports, `${process.platform}.json`)
const receipts: unknown[] = []
let phase: 'write' | 'read' | 'runner' = 'runner'
const save = (passed: boolean, code: string | null = null, exitCode: number | null = null) => writeFile(report, JSON.stringify({ receipts, platform: process.platform, nativeStoreRestartPassed: passed, failure: passed ? null : { phase, code, exitCode }, scope: 'Actual OS encryption and store restart; no OAuth, provider or GUI acceptance.' }, null, 2) + '\n')
try {
  await mkdir(reports, { recursive: true })
  await rm(report, { force: true })
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'pocket-vault-native.ts')], target: 'node', format: 'cjs', external: ['electron'] })
  const output = build.outputs[0]
  if (!build.success || !output) throw new Error('native_probe_bundle_failed')
  await writeFile(bundle, await output.text())
  for (const currentPhase of ['write', 'read'] as const) {
    phase = currentPhase
    const child = Bun.spawn([String(electron), bundle, currentPhase, directory], { cwd: workspace, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
    const [stdout, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).finally(() => clearTimeout(timer))
    const receipt = stdout.split('\n').flatMap(line => { try { const parsed = projectNativeVaultReceipt(JSON.parse(line), currentPhase); return parsed ? [parsed] : [] } catch { return [] } }).at(-1)
    if (receipt) receipts.push(receipt)
    if (code !== 0 || !receipt?.passed) {
      const knownCode = receipt?.code ?? (code !== 0 ? 'native_process_failed' : 'native_probe_receipt_missing')
      await save(false, knownCode, code)
      // Only projected metadata is shown. Raw Electron stderr can contain OS paths or values.
      console.log(JSON.stringify({ platform: process.platform, phase: currentPhase, stage: receipt?.stage ?? 'initialize', code: knownCode, exitCode: code, nativeStoreRestartPassed: false }))
      process.exitCode = 1
      break
    }
  }
  if (!process.exitCode) {
    await save(true)
    console.log(JSON.stringify({ platform: process.platform, nativeStoreRestartPassed: true }))
  }
} catch (error) {
  const code = safeVaultErrorCode(error)
  await mkdir(reports, { recursive: true })
  await save(false, code)
  console.log(JSON.stringify({ platform: process.platform, phase, code, nativeStoreRestartPassed: false }))
  process.exitCode = 1
} finally { await rm(directory, { recursive: true, force: true }) }
