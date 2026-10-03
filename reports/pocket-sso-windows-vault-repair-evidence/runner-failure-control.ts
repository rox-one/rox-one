import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const root = resolve(import.meta.dir, '../..')
const fixture = mkdtempSync(join(tmpdir(), 'pocket-runner-failure-review-'))
const secret = 'fixture-secret-canary-never-log'
try {
  for (const mode of ['failed', 'hung']) {
    const workspace = join(fixture, mode)
    const scripts = join(workspace, 'scripts/probes')
    mkdirSync(scripts, {recursive: true})
    writeFileSync(join(scripts, 'pocket-vault-diagnostics.ts'), readFileSync(join(root, 'scripts/probes/pocket-vault-diagnostics.ts')))
    const runner = readFileSync(join(root, 'scripts/probes/run-pocket-vault-native.ts'), 'utf8')
      .replace("import electron from 'electron'", 'const electron = process.env.REVIEW_SHIM!')
      .replace("join(tmpdir(), 'rox-pocket-native-vault-')", "join(workspace, 'rox-pocket-native-vault-')")
    writeFileSync(join(scripts, 'run-pocket-vault-native.ts'), runner)
    const shim = join(workspace, 'fake-electron')
    writeFileSync(shim, `#!${process.execPath}\nconst [,phase]=process.argv.slice(2);if(process.env.REVIEW_CHILD_MODE==='hung'){setInterval(()=>{},1000)}else{console.error('${secret}');console.log(JSON.stringify({phase,platform:'darwin',electron:'39.2.7',encryptionAvailable:true,stage:'account_write',passed:false,code:'ROX_SECURE_STORE_WRITE_FAILED',apiKey:'${secret}',fsync:[{access:'readonly',opened:true,flushed:false,code:'EPERM',path:'${secret}'},{access:'writable',opened:true,flushed:true,code:null}]}));process.exit(1)}\n`, { mode: 0o700 })
    const child = Bun.spawn([process.execPath, '-e', `const realSpawn=Bun.spawn;Bun.spawn=(args,options)=>{if(args[0]!==${JSON.stringify(shim)})throw Error('fixture_executable_mismatch');return realSpawn(args,options)};Bun.build=async()=>({success:true,outputs:[new Blob(['synthetic fixture bundle'])]});const timeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timeout(fn,ms===30000&&process.env.REVIEW_CHILD_MODE==='hung'?500:ms,...args);await import(${JSON.stringify(join(scripts,'run-pocket-vault-native.ts'))});`], { env: {...process.env, REVIEW_CHILD_MODE: mode, REVIEW_SHIM: shim}, stdout: 'pipe', stderr: 'pipe' })
    const start = Date.now()
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    const raw = readFileSync(join(workspace, 'reports/pocket-sso-native-vault', process.platform+'.json'), 'utf8')
    const receipt = JSON.parse(raw)
    if (exit !== 1 || receipt.nativeStoreRestartPassed !== false || stdout.includes(secret) || stderr.includes(secret) || raw.includes(secret) || readdirSync(workspace).some(name=>name.startsWith('rox-pocket-native-vault-')) || Date.now()-start>10000) throw Error('failure_boundary_control_failed')
    if (mode==='failed' && (receipt.failure.code!=='ROX_SECURE_STORE_WRITE_FAILED' || receipt.receipts[0].stage!=='account_write')) throw Error('stage_projection_control_failed')
    if (mode==='hung' && receipt.failure.code!=='native_process_failed') throw Error('timeout_control_failed')
    console.log(JSON.stringify({ mode, exit, elapsedMs: Date.now()-start, sanitizedReceiptPresent: true, secretCanaryAbsent: true, temporaryProfileRemoved: true, failure: receipt.failure, stage: receipt.receipts[0]?.stage??null, scope:'Explicit synthetic executable; runner control proof only, no native encryption.' }))
  }
} finally { rmSync(fixture, {recursive:true, force:true}) }
