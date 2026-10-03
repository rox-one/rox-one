import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'

const workspace = resolve(import.meta.dir, '../..')
const directory = await mkdtemp(join(tmpdir(), 'rox-pocket-native-vault-'))
const bundle = join(directory, 'probe.cjs')
try {
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'pocket-vault-native.ts')], target: 'node', format: 'cjs', external: ['electron'] })
  const output = build.outputs[0]
  if (!build.success || !output) throw new Error('native_probe_bundle_failed')
  await writeFile(bundle, await output.text())
  const receipts: unknown[] = []
  for (const phase of ['write', 'read']) {
    const child = Bun.spawn([String(electron), bundle, phase, directory], { cwd: workspace, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
    const [stdout, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).finally(() => clearTimeout(timer))
    if (code !== 0) throw new Error(`native_probe_${phase}_failed_${code}`)
    const receipt = stdout.split('\n').map(line => { try { return JSON.parse(line) } catch { return null } }).find(value => value?.phase === phase && value?.passed === true)
    if (!receipt) throw new Error('native_probe_receipt_missing')
    receipts.push(receipt)
  }
  const reports = join(workspace, 'reports/pocket-sso-native-vault')
  await mkdir(reports, { recursive: true })
  await writeFile(join(reports, `${process.platform}.json`), JSON.stringify({ receipts, scope: 'Actual OS encryption and store restart; no OAuth, provider or GUI acceptance.' }, null, 2) + '\n')
  console.log(JSON.stringify({ platform: process.platform, nativeStoreRestartPassed: true }))
} finally { await rm(directory, { recursive: true, force: true }) }
