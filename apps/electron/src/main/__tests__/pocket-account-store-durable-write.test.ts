import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('actual Pocket store flushes pending records through Windows-write-capable handles and preserves sealed recovery', async () => {
  const root = join(import.meta.dir, '../../../../..')
  const temp = mkdtempSync(join(tmpdir(), 'pocket-write-rights-'))
  try {
    const child = Bun.spawn([process.execPath, '-e', `
const {mock}=await import('bun:test');const fs={...await import('node:fs')};const {createCipheriv,createDecipheriv,randomBytes}=await import('node:crypto');const {join}=await import('node:path');
const flags=new Map();let writableFlushes=0,readonlyFlushAttempts=0,forceFlushFailure=false;
mock.module('node:fs',()=>({...fs,openSync(path,mode,...args){const fd=fs.openSync(path,mode,...args);flags.set(fd,mode);return fd},closeSync(fd){flags.delete(fd);return fs.closeSync(fd)},fsyncSync(fd){if((flags.get(fd)&(fs.constants.O_WRONLY|fs.constants.O_RDWR))===0){readonlyFlushAttempts++;throw Object.assign(Error('fixture_write_access_required'),{code:'EPERM'})}if(forceFlushFailure)throw Object.assign(Error('fixture_flush_failure'),{code:'EIO'});writableFlushes++;return fs.fsyncSync(fd)}}));
const {createPocketAccountStore}=await import(process.env.REVIEW_STORE_SOURCE||'./apps/electron/src/main/pocket-account-store.ts');
const key=randomBytes(32);const storage={isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,(()=>{const data=Buffer.concat([cipher.update(value),cipher.final()]);return Buffer.concat([cipher.getAuthTag(),data])})()])},decryptString(value){const cipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));cipher.setAuthTag(value.subarray(12,28));return Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString()}};
const caller={issuer:'fixture',subject:'windows-contract'};const record={accountId:'fixture-a',accessToken:'synthetic-access',refreshToken:'synthetic-refresh',authGeneration:'fixture-generation',expiresAt:123};const binding={caller,accountId:record.accountId,authGeneration:record.authGeneration};
let error=null,restored=false,failedFlushRejected=false,priorRecordUnchanged=false;const directory=join(process.env.REVIEW_VAULT_ROOT,'sealed');try{const store=createPocketAccountStore({directory,safeStorage:storage,platform:'win32'});await store.write(caller,record);await store.writeLogout(caller,record);await store.writeBinding('fixture-resource',binding);const next=createPocketAccountStore({directory,safeStorage:storage,platform:'win32'});restored=JSON.stringify(await next.read(caller))===JSON.stringify(record)&&!!await next.readLogout(caller)&&JSON.stringify(await next.readBinding('fixture-resource'))===JSON.stringify(binding);forceFlushFailure=true;try{await next.write(caller,{...record,expiresAt:234})}catch(e){failedFlushRejected=e.message==='ROX_SECURE_STORE_WRITE_FAILED'}forceFlushFailure=false;priorRecordUnchanged=JSON.stringify(await next.read(caller))===JSON.stringify(record);await next.clear(caller);await next.clearLogout(caller)}catch(e){error=e.message}
console.log(JSON.stringify({error,writableFlushes,readonlyFlushAttempts,restored,failedFlushRejected,priorRecordUnchanged,pendingFiles:fs.existsSync(directory)?fs.readdirSync(directory).filter(n=>n.startsWith('.pending-')).length:0}));
`], { cwd: root, env: { ...process.env, REVIEW_VAULT_ROOT: temp }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(exit).toBe(0)
    const result = JSON.parse(stdout.trim())
    expect(result.error).toBeNull()
    expect(result.readonlyFlushAttempts).toBe(0)
    expect(result.writableFlushes).toBe(4)
    expect(result.restored).toBe(true)
    expect(result.failedFlushRejected).toBe(true)
    expect(result.priorRecordUnchanged).toBe(true)
    expect(result.pendingFiles).toBe(0)
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 30_000)
