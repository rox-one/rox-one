import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, win32 } from 'node:path'
import { buildSync } from 'esbuild'
import { captureTestCommand } from '../../../../../scripts/test-all'
import { requireOsOwner, resolveWindowsSystemRoot, secureOsPrivatePaths } from '../os-private-path.ts'

const ownerError = 'maintenance requires the state directory OS owner'
const privateRulesError = 'native authority requires OS-owner private access rules'
const currentSid = 'S-1-5-21-111-222-333-1001'

// The batch probe reads the request from base64 stdin and never from argv, so
// every Windows case is exercised through the real single probe implementation.
// The child imports the probe with a dynamic import because bun's mock.module
// must be registered before the module loads; a static import cannot work here.
function runProbeChild(script: string): Record<string, unknown> {
  const result = spawnSync(process.execPath, ['--eval', script], { encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`Probe boundary failed: ${result.error ?? result.stderr}`)
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>
}

test('Windows ownership reuses the single batch probe with a fixed executable, base64 stdin request and unified 180s budget', () => {
  const proof = runProbeChild(`
import { mock } from 'bun:test';
import * as filesystem from 'node:fs';
import * as childProcess from 'node:child_process';
const resolver = () => { throw new Error('ancestor walker must not run'); };
resolver.native = () => 'C:\\\\Windows';
mock.module('node:fs', () => ({ ...filesystem, realpathSync: resolver }));
let captured;
mock.module('node:child_process', () => ({ ...childProcess, spawnSync(executable, args, options) {
  captured = { executable, args, options };
  const descriptor = { currentSid: '${currentSid}', tokenOwnerSid: '${currentSid}', paths: [
    { path: 'C:\\\\owned\\\\state', kind: 'directory', ownerSid: '${currentSid}', reparsePoint: false, protected: true,
      rules: [{ sid: '${currentSid}', type: 'Allow', rights: 2032127, inherited: false, inheritance: 3, propagation: 0 }] }] };
  return { status: 0, signal: null, stdout: JSON.stringify(descriptor), stderr: '', error: undefined };
} }));
Object.defineProperty(process, 'platform', { value: 'win32' });
const { requireOsOwner } = await import(${JSON.stringify(new URL('../os-private-path.ts', import.meta.url).href)});
requireOsOwner('C:\\\\owned\\\\state');
console.log(JSON.stringify({ executable: captured.executable, args: captured.args, timeout: captured.options.timeout,
  maxBuffer: captured.options.maxBuffer, windowsHide: captured.options.windowsHide,
  stdin: Buffer.from(captured.options.input, 'base64').toString('utf8') }));
`)
  expect(proof.executable).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  expect((proof.args as string[]).slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  expect((proof.args as string[]).join(' ')).not.toContain('owned')
  expect(JSON.parse(proof.stdin as string)).toEqual({
    paths: [{ path: 'C:\\owned\\state', kind: 'directory' }], operation: 'require-private',
  })
  expect(proof.timeout).toBe(180_000)
  expect(proof.maxBuffer).toBe(64 * 1024)
  expect(proof.windowsHide).toBe(true)
})

test('Windows ownership fails closed without disclosing diagnostics when the batch probe fails', () => {
  const proof = runProbeChild(`
import { mock } from 'bun:test';
import * as filesystem from 'node:fs';
import * as childProcess from 'node:child_process';
const resolver = () => { throw new Error('ancestor walker must not run'); };
resolver.native = () => 'C:\\\\Windows';
mock.module('node:fs', () => ({ ...filesystem, realpathSync: resolver }));
let timeout;
mock.module('node:child_process', () => ({ ...childProcess, spawnSync(executable, args, options) {
  timeout = options.timeout;
  return { status: null, signal: 'SIGTERM', stdout: '', stderr: 'x'.repeat(5000) + '\\nWindows private authority stage: input-ready',
    error: Object.assign(new Error('controlled child deadline'), { code: 'ETIMEDOUT' }) };
} }));
Object.defineProperty(process, 'platform', { value: 'win32' });
const { requireOsOwner } = await import(${JSON.stringify(new URL('../os-private-path.ts', import.meta.url).href)});
try { requireOsOwner('C:\\\\owned\\\\state'); console.log(JSON.stringify({ accepted: true })); }
catch (error) { console.log(JSON.stringify({ accepted: false, message: error.message, timeout })); }
`)
  expect(proof.accepted).toBe(false)
  const message = proof.message as string
  expect(message).toContain('Windows OS ownership verification failed')
  expect(message).toContain('ETIMEDOUT')
  expect(message).toContain('Windows private authority stage: input-ready')
  expect(message).not.toContain('xxx')
  expect(proof.timeout).toBe(180_000)
})

test('Windows ownership rejects a malformed descriptor output', () => {
  const proof = runProbeChild(`
import { mock } from 'bun:test';
import * as filesystem from 'node:fs';
import * as childProcess from 'node:child_process';
const resolver = () => { throw new Error('ancestor walker must not run'); };
resolver.native = () => 'C:\\\\Windows';
mock.module('node:fs', () => ({ ...filesystem, realpathSync: resolver }));
mock.module('node:child_process', () => ({ ...childProcess, spawnSync() { return { status: 0, signal: null, stdout: 'not json', stderr: '', error: undefined }; } }));
Object.defineProperty(process, 'platform', { value: 'win32' });
const { requireOsOwner } = await import(${JSON.stringify(new URL('../os-private-path.ts', import.meta.url).href)});
try { requireOsOwner('C:\\\\owned\\\\state'); console.log(JSON.stringify({ accepted: true })); }
catch (error) { console.log(JSON.stringify({ accepted: false, message: error.message })); }
`)
  expect(proof.accepted).toBe(false)
  expect(proof.message).toContain('invalid descriptor')
})

if (process.platform !== 'win32') test('POSIX owner checks retain real UID equality locally', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rox-owner-posix-')))
  try {
    expect(() => requireOsOwner(directory)).not.toThrow()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

if (process.platform !== 'win32') test('POSIX owner checks reject a foreign UID without changing ownership', () => {
  const proof = runProbeChild(`
import { mock } from 'bun:test';
import * as filesystem from 'node:fs';
mock.module('node:fs', () => ({ ...filesystem, statSync: () => ({ uid: 502 }) }));
Object.defineProperty(process, 'getuid', { value: () => 501, configurable: true });
const { requireOsOwner } = await import(${JSON.stringify(new URL('../os-private-path.ts', import.meta.url).href)});
try { requireOsOwner('/controlled'); console.log(JSON.stringify({ accepted: true })); }
catch (error) { console.log(JSON.stringify({ accepted: false, message: error.message })); }
`)
  expect(proof.accepted).toBe(false)
  expect(proof.message).toBe(ownerError)
})

function broadenWindowsAcl(path: string): void {
  const systemRoot = resolveWindowsSystemRoot()
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
    input: Buffer.from(path, 'utf8').toString('base64'), encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024,
    env: { SystemRoot: systemRoot, WINDIR: systemRoot }, windowsHide: true,
  })
  if (result.error || result.status !== 0) throw new Error(`Actual Windows ACL test mutation failed: ${result.error ?? result.stderr}`)
}

if (process.platform === 'win32') test('actual Windows batch probe secures, re-verifies and rejects a broadened state-directory DACL', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rox-owner-actual-')))
  try {
    const stateDir = join(root, 'state')
    mkdirSync(stateDir)
    secureOsPrivatePaths([{ path: stateDir, kind: 'directory' }])
    expect(() => requireOsOwner(stateDir)).not.toThrow()
    broadenWindowsAcl(stateDir)
    expect(() => requireOsOwner(stateDir)).toThrow(privateRulesError)
    secureOsPrivatePaths([{ path: stateDir, kind: 'directory' }])
    expect(() => requireOsOwner(stateDir)).not.toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 480_000)

async function runOwnerHost(program: string) {
  const root = resolve(import.meta.dir, '../../../../..')
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rox-owner-host-')))
  try {
    const result = buildSync({ stdin: { contents: program, resolveDir: root, loader: 'ts' }, bundle: true,
      write: false, format: 'cjs', platform: 'node', target: 'node24' })
    const executable = join(directory, 'owner-host.cjs')
    writeFileSync(executable, result.outputFiles[0]!.contents)
    const environment: NodeJS.ProcessEnv = { NODE_NO_WARNINGS: '1' }
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP']) {
      if (process.env[key]) environment[key] = process.env[key]
    }
    return await captureTestCommand(['node', executable], { cwd: root, environment, timeoutMs: 420_000 })
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

// Real Node host execution exposes the Windows SID/ACL batch probe and the
// complete constructor/reopen path in the Windows CI lane; no native UI starts.
test('real Node host creates and reopens authority while retaining hardlink and directory-alias guards', async () => {
    const program = `
      import assert from 'node:assert/strict';
      import {mkdtempSync,realpathSync,rmSync,linkSync,symlinkSync} from 'node:fs';
      import {tmpdir} from 'node:os'; import {join} from 'node:path';
      import {NativeAuthority} from './packages/server-core/src/authority/native-authority';
      const root=realpathSync(mkdtempSync(join(tmpdir(),'rox-owner-actual-')));
      let authority;
      try {
        const stateDir=join(root,'state');
        authority=new NativeAuthority({stateDir});
        assert.equal(authority.hasRegisteredWorkspaces(),false);
        authority.close(); authority=new NativeAuthority({stateDir});
        assert.equal(authority.hasRegisteredWorkspaces(),false);authority.close();authority=undefined;
        linkSync(join(stateDir,'authority.sqlite'),join(root,'linked.sqlite'));
        assert.throws(()=>new NativeAuthority({stateDir}),/OS-owner private regular file/);
        symlinkSync(stateDir,join(root,'alias'),process.platform==='win32'?'junction':'dir');
        assert.throws(()=>new NativeAuthority({stateDir:join(root,'alias')}),/real directory/);
        process.stdout.write('actual native authority owner/create/reopen/hardlink/alias guards passed\\n');
      } finally {authority?.close();rmSync(root,{recursive:true,force:true})}
    `
    const resultHost = await runOwnerHost(program)
    expect({ exitCode: resultHost.exitCode, stdout: resultHost.stdout, stderr: resultHost.stderr, timedOut: resultHost.timedOut }).toEqual({
      exitCode: 0, stdout: 'actual native authority owner/create/reopen/hardlink/alias guards passed\n', stderr: '', timedOut: false,
    })
}, 480_000)