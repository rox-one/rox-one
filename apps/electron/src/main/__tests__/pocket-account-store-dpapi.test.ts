import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('Windows secure-store fallback persists opaque data and fails closed when current-user unprotect fails', async () => {
  const root = join(import.meta.dir, '../../../../..')
  const temp = mkdtempSync(join(tmpdir(), 'pocket-dpapi-contract-'))
  try {
    const child = Bun.spawn([process.execPath, '-e', `
const { mock } = await import('bun:test');
const { createHmac } = await import('node:crypto');
const childProcess = await import('node:child_process');
const fs = await import('node:fs');
const { join } = await import('node:path');
const key = Buffer.from('test-only-current-user-boundary-key-32');
let failUnprotect = false;
let protectCalls = 0;
let unprotectCalls = 0;
function transform(input) {
  const stream = createHmac('sha256', key).update('test-only stream').digest();
  const ciphertext = Buffer.alloc(input.length);
  for (let i = 0; i < input.length; i++) ciphertext[i] = input[i] ^ stream[i % stream.length];
  const tag = createHmac('sha256', key).update(ciphertext).digest().subarray(0, 16);
  return Buffer.concat([tag, ciphertext]);
}
function untransform(input) {
  if (input.length < 16) throw Error('invalid test ciphertext');
  const tag = input.subarray(0, 16), ciphertext = input.subarray(16);
  const expected = createHmac('sha256', key).update(ciphertext).digest().subarray(0, 16);
  if (!tag.equals(expected)) throw Error('test authentication failed');
  const stream = createHmac('sha256', key).update('test-only stream').digest();
  const plaintext = Buffer.alloc(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) plaintext[i] = ciphertext[i] ^ stream[i % stream.length];
  return plaintext;
}
mock.module('node:child_process', () => ({
  ...childProcess,
  spawnSync(command, args, options) {
    if (command !== 'powershell.exe') throw Error('unexpected child process');
    const script = Buffer.from(args[4], 'base64').toString('utf16le');
    const input = Buffer.from(options.input, 'base64');
    if (script.includes('ProtectedData]::Protect')) {
      protectCalls++;
      return { error: undefined, status: 0, stdout: transform(input).toString('base64') };
    }
    if (script.includes('ProtectedData]::Unprotect')) {
      unprotectCalls++;
      if (failUnprotect) return { error: undefined, status: 1, stdout: '' };
      return { error: undefined, status: 0, stdout: untransform(input).toString('base64') };
    }
    throw Error('unexpected secure-storage operation');
  },
}));
const { createPocketAccountStore } = await import(process.env.POCKET_STORE_SOURCE);
const directory = join(process.env.POCKET_VAULT_ROOT, 'vault');
const caller = { issuer: 'https://pocket.test', subject: 'dpapi-fallback-user' };
const record = { accountId: 'account-dpapi', accessToken: 'access-token-must-not-persist', refreshToken: 'refresh-token-must-not-persist', authGeneration: 'generation-dpapi', expiresAt: 123456 };
const unavailableStorage = {
  isEncryptionAvailable: () => false,
  encryptString() { throw Error('Electron safeStorage must not be called'); },
  decryptString() { throw Error('Electron safeStorage must not be called'); },
};
let writeError = null, readError = null, failure = null, restored = null, sealedOpaque = false;
try {
  await createPocketAccountStore({ directory, platform: 'win32', safeStorage: unavailableStorage }).write(caller, record);
} catch (error) { writeError = error.message; }
if (!writeError) {
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.enc')).map(name => fs.readFileSync(join(directory, name)));
  sealedOpaque = files.length === 2 && files.every(data => data.subarray(0, 10).toString() === 'ROXDPAPI1:' && !data.includes(Buffer.from(record.accessToken)) && !data.includes(Buffer.from(record.refreshToken)));
  try {
    restored = await createPocketAccountStore({ directory, platform: 'win32', safeStorage: unavailableStorage }).read(caller);
  } catch (error) { readError = error.message; }
  failUnprotect = true;
  try { await createPocketAccountStore({ directory, platform: 'win32', safeStorage: unavailableStorage }).read(caller); }
  catch (error) { failure = { message: error.message, code: error.code }; }
}
console.log(JSON.stringify({ writeError, readError, restored, sealedOpaque, failure, protectCalls, unprotectCalls }));
`], {
      cwd: root,
      env: {
        ...process.env,
        POCKET_STORE_SOURCE: join(root, 'apps/electron/src/main/pocket-account-store.ts'),
        POCKET_VAULT_ROOT: temp,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exit, stderr).toBe(0)
    const result = JSON.parse(stdout.trim())
    expect(result.writeError).toBeNull()
    expect(result.sealedOpaque).toBe(true)
    expect(result.restored).toEqual({
      accountId: 'account-dpapi',
      accessToken: 'access-token-must-not-persist',
      refreshToken: 'refresh-token-must-not-persist',
      authGeneration: 'generation-dpapi',
      expiresAt: 123456,
    })
    expect(result.readError).toBeNull()
    expect(result.protectCalls).toBe(2)
    expect(result.unprotectCalls).toBe(3)
    expect(result.failure).toEqual({ message: 'ROX_SECURE_STORE_READ_FAILED', code: 'secure_store_decrypt_failed' })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
