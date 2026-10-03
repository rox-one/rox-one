import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test.skipIf(process.platform === 'win32')('a substituted account FIFO is rejected without blocking the native process', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rox-pocket-descriptor-'))
  const caller = { issuer: 'https://fixture.invalid', subject: 'owned-descriptor' }
  const file = join(directory, createHash('sha256').update(JSON.stringify([caller.issuer, caller.subject])).digest('hex') + '.enc')
  try {
    const created = spawnSync('mkfifo', [file], { timeout: 2000 })
    expect(created.status).toBe(0)
    const source = new URL('../pocket-account-store.ts', import.meta.url).pathname
    const code = `import {createPocketAccountStore} from ${JSON.stringify(source)};
      const store=createPocketAccountStore({directory:${JSON.stringify(directory)},platform:'darwin',safeStorage:{isEncryptionAvailable:()=>true,encryptString:()=>Buffer.alloc(0),decryptString:()=>{throw Error('must not decrypt FIFO')}}});
      try {await store.read(${JSON.stringify(caller)});process.exit(1)} catch(error) {if(error.message!=='ROX_SECURE_STORE_READ_FAILED')throw error;console.log('regular-file rejection')}`
    const result = spawnSync(process.execPath, ['--eval', code], { timeout: 2000, encoding: 'utf8' })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('regular-file rejection')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
