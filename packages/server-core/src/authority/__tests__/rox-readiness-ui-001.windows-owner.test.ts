import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildSync } from 'esbuild'
import { captureTestCommand } from '../../../../../scripts/test-all'
import { requireOsOwner, type OsOwnerDependencies } from '../native-os-owner'

const ownerError = 'maintenance requires the state directory OS owner'
const windows: OsOwnerDependencies = { platform: 'win32', arch: 'x64', env: { SystemRoot: 'C:\\Windows' } }

test('Windows ownership uses a successful actual command callback when POSIX UID is absent', () => {
  let calls = 0
  requireOsOwner('C:\\private\\authority', {
    ...windows, getuid: undefined,
    stat: () => { throw new Error('POSIX stat owner must not authorize Windows') },
    exec: () => { calls++; return '1' },
  })
  expect(calls).toBe(1)
})

test('Windows ownership keeps a fixed encoded script and a literal target outside argv', () => {
  const invocations: Array<{ file: string; args: string[]; options: any }> = []
  const env = { SystemRoot: 'C:\\Windows', Path: 'existing path', ROX_NATIVE_OWNER_PROBE_PATH: 'stale inherited target' }
  const target = "C:\\private\\[literal] 'quoted'; $env:OTHER"
  const exec: OsOwnerDependencies['exec'] = (file, args, options) => { invocations.push({ file, args, options }); return '1\r\n' }
  requireOsOwner(target, { ...windows, env, exec })
  requireOsOwner('C:\\other\\authority', { ...windows, env, exec })
  expect(invocations[0]!.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  expect(invocations[0]!.args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  expect(invocations[0]!.args).toEqual(invocations[1]!.args)
  expect(invocations[0]!.args.join(' ')).not.toContain(target)
  const script = Buffer.from(invocations[0]!.args[4]!, 'base64').toString('utf16le')
  expect(script).toContain('Get-Acl -LiteralPath $target')
  expect(script).toContain('[Security.Principal.WindowsIdentity]::GetCurrent()')
  expect(script).toContain('$tokenOwner = $identity.Owner')
  expect(script).not.toContain('$identity.Groups')
  expect(script).not.toContain(target)
  expect(script).not.toContain('Set-Acl')
  expect(invocations[0]!.options).toMatchObject({ timeout: 2_000, maxBuffer: 1_024, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, ROX_NATIVE_OWNER_PROBE_PATH: target } })
  expect(env.ROX_NATIVE_OWNER_PROBE_PATH).toBe('stale inherited target')
})

test('a WOW64 host uses the fixed native PowerShell executable', () => {
  let executable = ''
  requireOsOwner('C:\\private\\authority', { ...windows, arch: 'ia32',
    exec: file => { executable = file; return '1' } })
  expect(executable).toBe('C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe')
})

for (const output of ['0', '', 'true', '1\nprivate diagnostics', 'S-1-5-21-foreign']) {
  test(`foreign or malformed Windows owner evidence fails closed (${JSON.stringify(output)})`, () => {
    expect(() => requireOsOwner('C:\\private\\authority', { ...windows, exec: () => output })).toThrow(ownerError)
  })
}

for (const code of ['ENOENT', 'ETIMEDOUT', 'ENOBUFS', 'EACCES']) {
  test(`Windows command ${code} fails closed without disclosing its diagnostics`, () => {
    const privateError = Object.assign(new Error('private path and SID'), { code })
    let failure: unknown
    try { requireOsOwner('C:\\private\\authority', { ...windows, exec: () => { throw privateError } }) }
    catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(ownerError)
    expect((failure as Error).message).not.toContain('private path and SID')
  })
}

for (const [env, target] of [[{}, 'C:\\private'], [{ SystemRoot: 'relative' }, 'C:\\private'],
  [{ SystemRoot: 'C:\\Windows' }, 'relative'], [{ SystemRoot: 'C:\\Windows' }, 'C:\\invalid\0path']] as const) {
  test(`unsafe Windows command input is rejected before execution (${JSON.stringify(env)}, ${JSON.stringify(target)})`, () => {
    let calls = 0
    expect(() => requireOsOwner(target, { ...windows, env, exec: () => { calls++; return '1' } })).toThrow(ownerError)
    expect(calls).toBe(0)
  })
}

test('POSIX owner checks retain UID equality and reject missing identity', () => {
  expect(() => requireOsOwner('/controlled', { platform: 'linux', getuid: () => 501, stat: () => ({ uid: 501 }) })).not.toThrow()
  expect(() => requireOsOwner('/controlled', { platform: 'linux', getuid: () => 501, stat: () => ({ uid: 502 }) })).toThrow(ownerError)
  expect(() => requireOsOwner('/controlled', { platform: 'linux', getuid: undefined,
    stat: () => { throw new Error('No stat without identity') } })).toThrow(ownerError)
})

if (process.platform !== 'win32') test('the actual POSIX filesystem rejects a controlled foreign UID without changing ownership', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rox-owner-posix-'))
  try {
    expect(() => requireOsOwner(directory)).not.toThrow()
    expect(() => requireOsOwner(directory, { getuid: () => statSync(directory).uid + 1 })).toThrow(ownerError)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

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
    return await captureTestCommand(['node', executable], { cwd: root, environment, timeoutMs: 15_000 })
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

if (process.platform === 'win32') test('actual Windows identity accepts the user/default token owner and rejects a controlled foreign ACL owner', async () => {
  const result = await runOwnerHost(`
    import assert from 'node:assert/strict'; import {execFileSync} from 'node:child_process';
    import {requireOsOwner} from './packages/server-core/src/authority/native-os-owner';
    // Get-Acl is the sole controlled OS collaborator. The exact production
    // script and real WindowsIdentity getters execute in real PowerShell.
    const aclCallback = \`
      function Get-Acl {
        param([String]$LiteralPath)
        $current = [Security.Principal.WindowsIdentity]::GetCurrent()
        try {
          $mode = [Environment]::GetEnvironmentVariable('ROX_TEST_OWNER_CASE', 'Process')
          $sid = switch ($mode) { 'user' { $current.User.Value } 'token-owner' { $current.Owner.Value } default { 'S-1-0-0' } }
          $result = New-Object PSObject -Property @{ ControlledOwnerSid = $sid }
          $result | Add-Member -MemberType ScriptMethod -Name GetOwner -Value {
            param($type)
            return [Security.Principal.SecurityIdentifier]::new($this.ControlledOwnerSid)
          }
          return $result
        } finally { $current.Dispose() }
      }
    \`;
    for (const mode of ['user','token-owner','foreign']) {
      const operation=()=>requireOsOwner('C:\\\\controlled\\\\authority', { exec(file,args,options) {
        const script=Buffer.from(args.at(-1),'base64').toString('utf16le');
        const encoded=Buffer.from(aclCallback+script,'utf16le').toString('base64');
        return execFileSync(file,[...args.slice(0,-1),encoded],{...options,env:{...options.env,ROX_TEST_OWNER_CASE:mode}});
      }});
      if(mode==='foreign') assert.throws(operation,/maintenance requires the state directory OS owner/);
      else assert.doesNotThrow(operation);
    }
    process.stdout.write('actual Windows user/default-token-owner/foreign ACL callback guards passed\\n');
  `)
  expect({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut }).toEqual({
    exitCode: 0, stdout: 'actual Windows user/default-token-owner/foreign ACL callback guards passed\n', stderr: '', timedOut: false,
  })
}, 20_000)

// Real Node host execution also exposes the Windows SID/ACL command and the
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
}, 20_000)
