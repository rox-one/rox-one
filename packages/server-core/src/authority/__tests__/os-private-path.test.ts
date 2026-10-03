import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { NativeAuthority } from '../native-authority.ts'
import { runLocalMaintenanceCommand } from '../local-maintenance.ts'
import { privateFileIdentity, requireOsOwner, requireOsPrivatePaths, secureOsPrivatePaths, validateWindowsPrivatePaths, VerifiedPrivateFileGuard } from '../os-private-path.ts'

const currentSid = 'S-1-5-21-111-222-333-1001'
const foreignSid = 'S-1-5-21-111-222-333-1002'
const directory = { path: 'C:\\owned\\state', kind: 'directory' as const }
function descriptor() {
  return {
    currentSid, tokenOwnerSid: currentSid,
    paths: [{ ...directory, ownerSid: currentSid, reparsePoint: false, protected: true,
      rules: [{ sid: currentSid, type: 'Allow', rights: 2032127, inherited: false, inheritance: 3, propagation: 0 }] }],
  }
}

function broadenWindowsAcl(path: string): void {
  const systemRoot = realpathSync(String.raw`\\?\GLOBALROOT\SystemRoot`)
  const executable = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = `
$ErrorActionPreference = 'Stop'
$path = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
$acl = [System.IO.Directory]::GetAccessControl($path)
$everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, [System.Security.AccessControl.FileSystemRights]::ReadAndExecute, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
[System.IO.Directory]::SetAccessControl($path, $acl)
`
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    input: Buffer.from(path, 'utf8').toString('base64'), encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
    env: { SystemRoot: systemRoot, WINDIR: systemRoot }, windowsHide: true,
  })
  if (result.error || result.status !== 0) throw new Error(`Actual Windows ACL test mutation failed: ${result.error ?? result.stderr}`)
}

// Protocol/policy cases are not Windows OS evidence. The portable filesystem
// cases below use the actual current OS branch, including real Windows APIs in CI.
test('Windows descriptor policy accepts only the exact owned and private path requested', () => {
  expect(() => validateWindowsPrivatePaths(descriptor(), [directory], 'require-private')).not.toThrow()
  const elevated = descriptor()
  elevated.tokenOwnerSid = 'S-1-5-32-544'
  elevated.paths[0]!.ownerSid = elevated.tokenOwnerSid
  expect(() => validateWindowsPrivatePaths(elevated, [directory], 'require-private')).not.toThrow()
  elevated.paths[0]!.rules[0]!.sid = elevated.tokenOwnerSid
  expect(() => validateWindowsPrivatePaths(elevated, [directory], 'require-private')).toThrow()
  const file = { path: 'C:\\owned\\authority.sqlite', kind: 'file' as const }
  const value = descriptor()
  Object.assign(value.paths[0]!, file)
  value.paths[0]!.rules[0]!.inheritance = 0
  expect(() => validateWindowsPrivatePaths(value, [file], 'secure')).not.toThrow()
})

test('Windows descriptor policy rejects absent identity, foreign owner, changed path, kind and reparse points', () => {
  for (const change of [
    (value: ReturnType<typeof descriptor>) => { value.currentSid = '' },
    (value: ReturnType<typeof descriptor>) => { value.tokenOwnerSid = '' },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.ownerSid = foreignSid },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.ownerSid = 'S-1-5-32-544' },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.path = 'C:\\foreign\\state' },
    (value: ReturnType<typeof descriptor>) => { Object.assign(value.paths[0]!, { kind: 'file' }) },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.reparsePoint = true },
  ]) {
    const value = descriptor(); change(value)
    expect(() => validateWindowsPrivatePaths(value, [directory], 'secure')).toThrow()
  }
  for (const value of [null, {}, { currentSid }, { currentSid, paths: [] }, { currentSid, paths: [null] }]) {
    expect(() => validateWindowsPrivatePaths(value, [directory], 'secure')).toThrow()
  }
})

test('Windows descriptor policy rejects null, inherited, broad, partial, denied and malformed access rules', () => {
  for (const change of [
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.protected = false },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.rules = [] },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.rules[0]!.sid = 'S-1-1-0' },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.rules[0]!.inherited = true },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.rules[0]!.rights = 1179785 },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.rules[0]!.type = 'Deny' },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.rules[0]!.propagation = 2 },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.rules[0]!.inheritance = 0 },
    (value: ReturnType<typeof descriptor>) => { value.paths[0]!.rules.push({ ...value.paths[0]!.rules[0]!, sid: foreignSid }) },
    (value: ReturnType<typeof descriptor>) => { Object.assign(value.paths[0]!.rules[0]!, { rights: '2032127' }) },
  ]) {
    const value = descriptor(); change(value)
    expect(() => validateWindowsPrivatePaths(value, [directory], 'require-private')).toThrow()
  }
})

test('private identity custody refuses unavailable or zero file IDs instead of caching replacements under one key', () => {
  expect(privateFileIdentity({ dev: 7n, ino: 19n })).toBe('7:19')
  expect(() => privateFileIdentity({ dev: 7n, ino: 0n })).toThrow('stable private file identity')
  expect(() => privateFileIdentity({ dev: 7n, ino: -1n })).toThrow('stable private file identity')
  expect(() => privateFileIdentity({ dev: -1n, ino: 19n })).toThrow('stable private file identity')
})

test('actual POSIX file custody restores private mode for the same inode on every call', () => {
  const root = mkdtempSync(join(tmpdir(), 'authority-posix-mode-'))
  const file = { path: join(root, 'authority.sqlite'), kind: 'file' as const }
  try {
    secureOsPrivatePaths([{ path: root, kind: 'directory' }])
    writeFileSync(file.path, '')
    const guard = new VerifiedPrivateFileGuard()
    guard.secure([file])
    const identity = privateFileIdentity(statSync(file.path, { bigint: true }))
    if (process.platform !== 'win32') {
      chmodSync(file.path, 0o777)
      guard.secure([file])
      expect(privateFileIdentity(statSync(file.path, { bigint: true }))).toBe(identity)
      expect(statSync(file.path).mode & 0o777).toBe(0o600)
    } else {
      // Windows privacy is a DACL, and the stable-file/audit proof below
      // verifies that this OS uses its separately scoped identity fast path.
      requireOsPrivatePaths([file])
      expect(privateFileIdentity(statSync(file.path, { bigint: true }))).toBe(identity)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 20_000)

test('actual OS branch secures a new authority and its sidecars before a durable reopen', () => {
  const root = mkdtempSync(join(tmpdir(), 'authority-os-private-'))
  const stateDir = join(root, 'state')
  let authority: NativeAuthority | undefined
  try {
    authority = new NativeAuthority({ stateDir })
    const issuer = authority.issuerId
    requireOsOwner(stateDir)
    if (process.platform !== 'win32') {
      expect(statSync(stateDir).mode & 0o777).toBe(0o700)
      expect(statSync(join(stateDir, 'authority.sqlite')).mode & 0o777).toBe(0o600)
    }
    authority.close()
    authority = new NativeAuthority({ stateDir })
    expect(authority.issuerId).toBe(issuer)
    if (process.platform === 'win32') {
      // This mutates the actual Windows DACL and invokes real maintenance
      // guards; Linux does not execute or claim these Windows assertions.
      broadenWindowsAcl(stateDir)
      expect(() => requireOsOwner(stateDir)).toThrow('private access rules')
      expect(() => authority!.bootstrapLocalAdministrator('operator')).toThrow('private access rules')
      expect(() => authority!.recoverLocalAdministrator('operator')).toThrow('private access rules')
      secureOsPrivatePaths([{ path: stateDir, kind: 'directory' }])
      expect(() => requireOsOwner(stateDir)).not.toThrow()
    }
  } finally { authority?.close(); rmSync(root, { recursive: true, force: true }) }
}, 20_000)

test('actual OS identity guard keeps invalid-token audits free of repeated verifier subprocesses', () => {
  // The mock is confined to this fresh child and delegates every OS probe to
  // the actual executable. It observes process count, never supplies a SID/ACL.
  const script = `
import { mock } from 'bun:test';
import * as childProcess from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const originalSpawn = childProcess.spawnSync;
let probes = 0;
mock.module('node:child_process', () => ({ ...childProcess, spawnSync(...args) { probes++; return originalSpawn(...args); } }));
// Environment-selected fake roots/modules must not select the security oracle.
process.env.SystemRoot = join(tmpdir(), 'nonexistent-untrusted-verifier');
process.env.PSModulePath = process.env.SystemRoot;
const { NativeAuthority } = await import(${JSON.stringify(new URL('../native-authority.ts', import.meta.url).href)});
const root = mkdtempSync(join(tmpdir(), 'authority-probe-count-'));
const authority = new NativeAuthority({ stateDir: join(root, 'state') });
try {
  const initial = probes;
  for (let index = 0; index < 20; index++) {
    if (authority.authenticate('different-invalid-token-' + index) !== null) throw new Error('invalid credential accepted');
  }
  if (probes !== initial) throw new Error('invalid credentials launched verifier subprocesses');
  if (process.platform === 'win32' && initial < 2) throw new Error('real Windows verification did not execute');
  console.log(JSON.stringify({ platform: process.platform, initialProbes: initial, afterInvalidProbes: probes, rejected: 20 }));
} finally { authority.close(); rmSync(root, { recursive: true, force: true }); }
`
  const result = spawnSync(process.execPath, ['--eval', script], { encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`OS verifier subprocess-count proof failed: ${result.error ?? result.stderr}`)
  const proof = JSON.parse(result.stdout.trim())
  expect(proof.platform).toBe(process.platform)
  expect(proof.afterInvalidProbes).toBe(proof.initialProbes)
  expect(proof.rejected).toBe(20)
}, 25_000)

test('actual file identity custody re-verifies replacement and new sidecars, rejects hard links, and retires missing paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'authority-file-custody-'))
  const database = { path: join(root, 'authority.sqlite'), kind: 'file' as const }
  const sidecar = { path: join(root, 'authority.sqlite-wal'), kind: 'file' as const }
  try {
    secureOsPrivatePaths([{ path: root, kind: 'directory' }])
    const guard = new VerifiedPrivateFileGuard()
    writeFileSync(database.path, '')
    guard.secure([database])
    requireOsPrivatePaths([database])
    // Rename retains the old inode, preventing inode reuse from masking this
    // genuine replacement with a fresh, deliberately public POSIX file.
    renameSync(database.path, join(root, 'previous.sqlite'))
    writeFileSync(database.path, 'replacement', { mode: 0o666 })
    if (process.platform !== 'win32') chmodSync(database.path, 0o666)
    guard.secure([database])
    requireOsPrivatePaths([database])
    if (process.platform !== 'win32') expect(statSync(database.path).mode & 0o777).toBe(0o600)
    writeFileSync(sidecar.path, '', { mode: 0o666 })
    if (process.platform !== 'win32') chmodSync(sidecar.path, 0o666)
    const link = join(root, 'hard-linked-wal')
    linkSync(sidecar.path, link)
    expect(() => guard.secure([database, sidecar])).toThrow('private regular file')
    // A failed new-identity check must not cache that sidecar. After removing
    // its alias, retry needs the real OS security check before it is trusted.
    rmSync(link)
    guard.secure([database, sidecar])
    requireOsPrivatePaths([sidecar])
    if (process.platform !== 'win32') expect(statSync(sidecar.path).mode & 0o777).toBe(0o600)
    linkSync(sidecar.path, link)
    expect(() => guard.secure([database, sidecar])).toThrow('private regular file')
    rmSync(link); rmSync(sidecar.path)
    guard.secure([database])
    writeFileSync(sidecar.path, '')
    guard.secure([database, sidecar])
    requireOsPrivatePaths([sidecar])
    expect(readFileSync(database.path, 'utf8')).toBe('replacement')
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 20_000)

test('actual OS branch rejects directory aliases and hard-linked database files', () => {
  const root = mkdtempSync(join(tmpdir(), 'authority-os-alias-'))
  try {
    const state = join(root, 'state'); mkdirSync(state)
    const alias = join(root, 'alias'); symlinkSync(state, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => new NativeAuthority({ stateDir: alias })).toThrow('real directory')
    const database = join(state, 'authority.sqlite'); writeFileSync(database, '')
    linkSync(database, join(root, 'linked-database'))
    expect(() => new NativeAuthority({ stateDir: state })).toThrow('OS-owner private regular file')
    expect(readFileSync(database)).toHaveLength(0)
    const foreign = join(root, 'foreign-file'); writeFileSync(foreign, '')
    const fileAlias = join(root, 'file-alias'); linkSync(foreign, fileAlias)
    expect(() => secureOsPrivatePaths([{ path: fileAlias, kind: 'file' }])).toThrow('without aliases')
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 20_000)

test('actual OS maintenance denies a non-terminal and preserves an occupied delivery without consuming first bootstrap', () => {
  const root = mkdtempSync(join(tmpdir(), 'authority-os-maintenance-'))
  const stateDir = join(root, 'state'), secret = join(root, 'administrator.secret')
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  let authority: NativeAuthority | undefined
  try {
    writeFileSync(secret, 'occupied delivery')
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false })
    const args = ['bootstrap', '--state-dir', stateDir, '--label', 'operator', '--secret-file', secret]
    expect(() => runLocalMaintenanceCommand(args)).toThrow('interactive host-local terminal')
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    expect(() => runLocalMaintenanceCommand(args)).toThrow()
    expect(readFileSync(secret, 'utf8')).toBe('occupied delivery')
    rmSync(secret)
    expect(runLocalMaintenanceCommand(args).exitCode).toBe(0)
    const credential = readFileSync(secret, 'utf8').trim()
    authority = new NativeAuthority({ stateDir })
    expect(authority.authenticate(credential)).not.toBeNull()
    if (process.platform !== 'win32') expect(statSync(secret).mode & 0o777).toBe(0o600)
  } finally {
    authority?.close(); rmSync(root, { recursive: true, force: true })
    if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
  }
}, 20_000)
