import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CredentialManager } from '@craft-agent/shared/credentials'
import { SecureStorageBackend } from '@craft-agent/shared/credentials/backends/secure-storage'
import { accountToCredentialId, credentialIdToAccount } from '@craft-agent/shared/credentials/types'
import { NativeAuthority } from '../../../../../packages/server-core/src/authority/native-authority.ts'
import { WsRpcServer } from '../../../../../packages/server-core/src/transport/server.ts'
import { WsRpcClient } from '../../../../../packages/server-core/src/transport/client.ts'
import { resolveNativeTransportCredential, type NativeTransportBinding } from '../native-transport-credential'
const cleanup: Array<() => void> = []
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn() })
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'native-credential-')))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const authority = new NativeAuthority({ stateDir: join(dir, 'authority') })
  cleanup.push(() => authority.close())
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  let admin
  try { Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }); admin = authority.bootstrapLocalAdministrator('fixture operator') }
  finally { if (tty) Object.defineProperty(process.stdin, 'isTTY', tty); else Reflect.deleteProperty(process.stdin, 'isTTY') }
  const root = join(dir, 'workspace'); mkdirSync(root)
  authority.registerWorkspace(admin.credential, 'workspace-a', root)
  const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'device', Date.now() + 60000), 'device')!
  authority.grantWorkspace(admin.credential, issued.principal.subject, 'workspace-a', ['read', 'subscribe'])
  const store = join(dir, 'credentials')
  const manager = () => new CredentialManager({ backends: [new SecureStorageBackend({ directory: store })] })
  let binding: NativeTransportBinding | null = { workspaceId: 'workspace-a', nativeRoot: root }
  const options = () => ({ credentials: manager(), authority, getBinding: () => binding, expectedWorkspaceId: 'workspace-a', legacyToken: 'fixture-legacy-session-token' })
  return { dir, root, store, authority, admin, issued, manager, options, setBinding: (next: NativeTransportBinding | null) => { binding = next } }
}

test('workspace-scoped enrolled secret survives encrypted storage restart and authenticates actual WS native principal', async () => {
  const f = fixture()
  await f.manager().setNativeTransportCredential('workspace-a', f.issued.credential)
  expect(readFileSync(join(f.store, 'credentials.enc')).includes(Buffer.from(f.issued.credential))).toBe(false)
  const token = await resolveNativeTransportCredential(f.options())
  expect(token).toBe(f.issued.credential)
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: f.authority, validateToken: async token => token === 'fixture-legacy-session-token' })
  cleanup.push(() => server.close())
  server.handle('fixture:subject', ctx => ctx.principal?.subject, { nativeAction: 'read' })
  await server.listen()
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { workspaceId: 'workspace-a', autoReconnect: false, resolveTarget: async () => ({ url: `ws://127.0.0.1:${server.port}`, token: await resolveNativeTransportCredential(f.options()) }) })
  cleanup.push(() => client.destroy()); client.connect()
  expect(await client.invoke('fixture:subject')).toBe(f.issued.principal.subject)
})

test('only absent enrollment falls back; revoked, malformed and foreign-root credentials deny', async () => {
  const f = fixture()
  expect(await resolveNativeTransportCredential(f.options())).toBe('fixture-legacy-session-token')
  await f.manager().setNativeTransportCredential('workspace-a', 'invalid-enrolled-secret')
  await expect(resolveNativeTransportCredential(f.options())).rejects.toThrow('denied')
  await f.manager().setNativeTransportCredential('workspace-a', f.issued.credential)
  f.setBinding({ workspaceId: 'workspace-a', nativeRoot: f.dir })
  await expect(resolveNativeTransportCredential(f.options())).rejects.toThrow('denied')
  f.setBinding({ workspaceId: 'workspace-a', nativeRoot: f.root })
  f.authority.revokeCredential(f.admin.credential, f.issued.principal.credentialId)
  await expect(resolveNativeTransportCredential(f.options())).rejects.toThrow('denied')
})

test('foreign workspace, destroyed window and workspace switch during secure-store await reject', async () => {
  const f = fixture()
  await f.manager().setNativeTransportCredential('workspace-a', f.issued.credential)
  await expect(resolveNativeTransportCredential({ ...f.options(), expectedWorkspaceId: 'workspace-b' })).rejects.toThrow('binding')
  f.setBinding(null)
  await expect(resolveNativeTransportCredential(f.options())).rejects.toThrow('binding')
  f.setBinding({ workspaceId: 'workspace-a', nativeRoot: f.root })
  const base = f.options()
  await expect(resolveNativeTransportCredential({ ...base, credentials: { getNativeTransportCredential: async id => { const token = await base.credentials.getNativeTransportCredential(id); f.setBinding({ workspaceId: 'workspace-b', nativeRoot: f.root }); return token } } })).rejects.toThrow('changed')
})

test('a valid principal enrolled for another workspace cannot bootstrap this owned window', async () => {
  const f = fixture()
  const otherRoot = join(f.dir, 'foreign'); mkdirSync(otherRoot)
  f.authority.registerWorkspace(f.admin.credential, 'workspace-b', otherRoot)
  const foreign = f.authority.redeemEnrollment(f.authority.issueEnrollment(f.admin.credential, 'foreign device', Date.now() + 60000), 'foreign device')!
  f.authority.grantWorkspace(f.admin.credential, foreign.principal.subject, 'workspace-b', ['read'])
  await f.manager().setNativeTransportCredential('workspace-a', foreign.credential)
  await expect(resolveNativeTransportCredential(f.options())).rejects.toThrow('denied')
  expect(f.authority.authenticate(foreign.credential)).not.toBeNull()
})

test('unreadable ciphertext path and invalid stored payload fail closed', async () => {
  const f = fixture()
  const backend = new SecureStorageBackend({ directory: f.store })
  await backend.set({ type: 'native_transport_credential', workspaceId: 'workspace-a' }, { value: '' })
  await expect(resolveNativeTransportCredential(f.options())).rejects.toThrow('Invalid')
  rmSync(join(f.store, 'credentials.enc')); mkdirSync(join(f.store, 'credentials.enc'))
  await expect(resolveNativeTransportCredential(f.options())).rejects.toThrow()
})

test('damaged ciphertext is never treated as absent enrollment', async () => {
  const f = fixture()
  await f.manager().setNativeTransportCredential('workspace-a', f.issued.credential)
  writeFileSync(join(f.store, 'credentials.enc'), 'damaged encrypted store')
  await expect(resolveNativeTransportCredential(f.options())).rejects.toThrow()
})

test('native credential identifier rejects unscoped and delimiter-derived aliases', () => {
  const id = { type: 'native_transport_credential' as const, workspaceId: 'workspace-a' }
  expect(accountToCredentialId(credentialIdToAccount(id))).toEqual(id)
  expect(() => credentialIdToAccount({ type: id.type })).toThrow()
  expect(() => credentialIdToAccount({ type: id.type, workspaceId: 'a::b' })).toThrow()
  expect(accountToCredentialId('native_transport_credential::global::extra')).toBeNull()
})
