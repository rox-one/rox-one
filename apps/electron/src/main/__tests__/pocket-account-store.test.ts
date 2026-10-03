import { afterEach, describe, expect, it } from 'bun:test'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPocketAccountStore } from '../pocket-account-store'
const roots: string[] = []
function fixture(platform: NodeJS.Platform = 'darwin', available = true) {
 const root = mkdtempSync(join(tmpdir(), 'pocket-vault-')); roots.push(root)
 const key = randomBytes(32)
 const safeStorage = { isEncryptionAvailable: () => available,
  encryptString(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm',key,iv); const body = Buffer.concat([cipher.update(value),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),body]) },
  decryptString(value: Buffer) { const iv = value.subarray(0,12), tag = value.subarray(12,28); const cipher = createDecipheriv('aes-256-gcm',key,iv); cipher.setAuthTag(tag); return Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString() },
 }

 const directory = join(root,'vault')
 return { root, directory, safeStorage, store: createPocketAccountStore({ directory, safeStorage, platform }) }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}) })
const callerA = { issuer: 'https://native.test', subject: 'a' }, callerB = { issuer: 'https://native.test', subject: 'b' }
const record = { accountId:'account-a', authGeneration:'generation-fixture', accessToken:'secret-access-fixture', refreshToken:'secret-refresh-fixture', expiresAt:Date.now()+900000 }
describe('Pocket OS protected vault', () => {
 it.each(['darwin','win32'] as const)('uses injected OS encryption on %s and restores caller/account scope', async platform => {
  const f = fixture(platform); await f.store.write(callerA,record)
  expect(await f.store.read(callerB)).toBeNull()
  const restored = createPocketAccountStore({ directory:f.directory,safeStorage:f.safeStorage,platform })
  expect(await restored.read(callerA)).toEqual(record)
  for (const file of readdirSync(f.directory)) { expect(readFileSync(join(f.directory,file)).includes(Buffer.from(record.accessToken))).toBe(false); expect(readFileSync(join(f.directory,file)).includes(Buffer.from(record.refreshToken))).toBe(false) }
  await f.store.clear(callerA); expect(await restored.read(callerA)).toBeNull()
 })
 it('fails closed without OS encryption and on unsupported headless Linux', async () => {
  await expect(fixture('darwin',false).store.write(callerA,record)).rejects.toThrow('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
  await expect(fixture('linux').store.read(callerA)).rejects.toThrow('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
 })
 it('rejects a substituted vault directory', async () => {
  const f = fixture(); symlinkSync(f.root,f.directory)
  await expect(f.store.write(callerA,record)).rejects.toThrow('ROX_OS_SECURE_STORAGE_UNAVAILABLE')
 })
})
