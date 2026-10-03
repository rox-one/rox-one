import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dir, '../..')
const fixture = mkdtempSync(join(tmpdir(), 'pocket-local-state-control-'))
try {
  for (const mode of ['missing', 'changed', 'stable', 'unisolated']) {
    const workspace = join(fixture, mode)
    const scripts = join(workspace, 'scripts/probes')
    mkdirSync(scripts, { recursive: true })
    writeFileSync(join(scripts, 'pocket-vault-diagnostics.ts'), readFileSync(join(root, 'scripts/probes/pocket-vault-diagnostics.ts')))
    const runner = readFileSync(process.env.REVIEW_RUNNER_SOURCE || join(root, 'scripts/probes/run-pocket-vault-native.ts'), 'utf8')
      .replace("import electron from 'electron'", 'const electron = process.env.REVIEW_SHIM!')
      .replace("join(tmpdir(), 'rox-pocket-native-vault-')", "join(workspace, 'rox-pocket-native-vault-')")
    writeFileSync(join(scripts, 'run-pocket-vault-native.ts'), runner)
    const shim = join(workspace, 'synthetic-electron')
    writeFileSync(shim, `#!${process.execPath}
const fs=await import('node:fs');const {join}=await import('node:path');const [,phase,directory]=process.argv.slice(2);const profile=join(directory,'electron-profile');fs.mkdirSync(profile,{recursive:true});if(process.env.REVIEW_MODE!=='missing')fs.writeFileSync(join(profile,'Local State'),JSON.stringify({os_crypt:{encrypted_key:process.env.REVIEW_MODE==='changed'&&phase==='read'?'fixture-replacement':'fixture-wrapped-key'}}));console.log(JSON.stringify({phase,platform:'win32',electron:'39.2.7',encryptionAvailable:true,profileIsolated:process.env.REVIEW_MODE!=='unisolated',stage:'complete',passed:true,code:null,fsync:[{access:'readonly',opened:true,flushed:false,code:'EPERM'},{access:'writable',opened:true,flushed:true,code:null}]}));
`, { mode: 0o700 })
    const child = Bun.spawn([process.execPath, '-e', `Object.defineProperty(process,'platform',{value:'win32'});const realSpawn=Bun.spawn;Bun.spawn=(args,options)=>{if(args[0]!==${JSON.stringify(shim)})throw Error('synthetic_executable_mismatch');return realSpawn(args,options)};Bun.build=async()=>({success:true,outputs:[new Blob(['synthetic bundle'])]});await import(${JSON.stringify(join(scripts, 'run-pocket-vault-native.ts'))});`], { env: { ...process.env, REVIEW_MODE: mode, REVIEW_SHIM: shim }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    const raw = readFileSync(join(workspace, 'reports/pocket-sso-native-vault/win32.json'), 'utf8')
    const receipt = JSON.parse(raw)
    if (raw.includes('fixture-wrapped-key') || raw.includes('fixture-replacement') || stdout.includes('fixture-wrapped-key') || stderr || readdirSync(workspace).some(name => name.startsWith('rox-pocket-native-vault-'))) throw Error('synthetic_projection_or_cleanup_failed')
    const expectedCode = mode === 'missing' ? 'native_local_state_key_missing' : mode === 'changed' ? 'native_local_state_key_changed' : mode === 'unisolated' ? 'native_profile_not_isolated' : null
    if (exit !== (mode === 'stable' ? 0 : 1) || receipt.nativeStoreRestartPassed !== (mode === 'stable') || (receipt.failure?.code ?? null) !== expectedCode) {
      console.log(JSON.stringify({ mode, controlPassed: false, code: 'synthetic_acceptance_gate_failed', actualExit: exit, actualNativeStoreRestartPassed: receipt.nativeStoreRestartPassed, expectedCode, scope: 'Frozen synthetic runner acceptance control; no native proof.' }))
      process.exitCode = 1
      break
    }
    console.log(JSON.stringify({ mode, exit, failure: receipt.failure, localState: receipt.localState, syntheticDataAbsent: true, temporaryProfileRemoved: true, scope: 'Explicit synthetic executable and Windows metadata seam on macOS; no DPAPI or native encryption proof.' }))
  }
} finally { rmSync(fixture, { recursive: true, force: true }) }
