import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, renameSync, appendFileSync, promises as filesystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MANIFEST_DATA } from '../manifest-data';
import { createResolver } from '../resolver';
import { createManager } from '../manager';
import { toolchainPaths } from '../manifest';
import { dependencyVersionUsable, readWindowsBootstrap, WINDOWS_BOOTSTRAP_TOOLS, setWindowsBootstrapRuntime } from '../windows-bootstrap';

let dir: string;
let root: string;
let files: Record<string, string>;
let probes: string[];
const probe = async (file: string) => { probes.push(file); return existsSync(file); };
function put(file: string, contents = 'fixture') { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, contents); }
function receipt(mode = 'bundled', patch: Record<string, unknown> = {}) {
  put(join(root, 'status.json'), '\uFEFF' + JSON.stringify({ schemaVersion: 1, platform: 'win32-x64', mode, nativeReady: true,
    tools: WINDOWS_BOOTSTRAP_TOOLS.map((name) => ({ name, source: 'bundled', pinnedVersion: MANIFEST_DATA[name]!.version, executable: files[name] })),
    pathEntries: ['C:\\untrusted-path'], ...patch }));
}
async function read(preference?: 'auto' | 'bundled' | 'system', pathEnv = '', excludedRoots: string[] = []) {
  return readWindowsBootstrap({ platform: 'win32', localAppData: dir, preference, pathEnv, probe, excludedRoots });
}
beforeEach(() => {
  dir = mkdtempSync(join(process.platform === 'win32' ? join(process.env.LOCALAPPDATA!, 'Temp', 'opencode') : tmpdir(), 'rox-runtime-bootstrap-'));
  root = join(dir, 'Rox', 'bootstrap'); probes = []; files = {};
  for (const name of WINDOWS_BOOTSTRAP_TOOLS) {
    const entry = MANIFEST_DATA[name]!;
    files[name] = join(root, 'dependencies', name, entry.version, entry.artifacts['win32-x64']!.binPaths[0]!);
    put(files[name]!);
  }
  put(join(dirname(files.node!), 'npm.cmd'));
  put(join(dirname(files.node!), 'npx.cmd'));
});
afterEach(() => { setWindowsBootstrapRuntime(null); rmSync(dir, { recursive: true, force: true }); });

describe('native installer receipt → runtime', () => {
  it('consumes BOM receipts, ignores arbitrary PATH and re-probes each resolution', async () => {
    receipt(); const native = (await read())!;
    expect(native.missingTools).toEqual([]);
    expect(await native.findExecutable('gh')).toBe(files.gh!);
    expect(await native.findExecutable('npx')).toBe(join(dirname(files.node!), 'npx.cmd'));
    expect(await native.pathEntries()).not.toContain('C:\\untrusted-path');
    rmSync(files.gh!);
    expect(await native.findExecutable('gh.exe')).toBeNull();
    expect(await native.pathEntries()).not.toContain(dirname(files.gh!));
  });
  it('honors explicit system preference over bundled and excludes private/packaged/junction bins', async () => {
    receipt(); const system = join(dir, 'system tools'); put(join(system, 'node.exe'));
    const packaged = join(dir, 'resources'); put(join(packaged, 'gh.exe'));
    const rgDir = join(packaged, 'vendored-rg'); put(join(rgDir, 'rg.exe'));
    const alias = join(dir, 'private-alias'); symlinkSync(dirname(files.gh!), alias, 'junction');
    const native = (await read('system', [dirname(files.gh!), alias, packaged, system].join(';'), [packaged]))!;
    expect(native.mode).toBe('system');
    expect(await native.findExecutable('node')).toBe(join(system, 'node.exe'));
    expect(await native.findExecutable('gh')).toBeNull();
    expect(probes).not.toContain(files.gh!);
    expect(await native.filterPath([alias, dirname(files.gh!), packaged, rgDir, system].join(';'))).toBe([rgDir, system].join(';'));
  });
  it('auto uses a usable system tool before pinned fallback and skips bad versions', async () => {
    receipt('auto'); const system = join(dir, 'system'); put(join(system, 'git.exe'));
    const native = (await read(undefined, system))!;
    expect(await native.findExecutable('git')).toBe(join(system, 'git.exe'));
    expect(await native.findExecutable('gh')).toBe(files.gh!);
    expect(dependencyVersionUsable('node', 'v22.22.9')).toBe(false);
    expect(dependencyVersionUsable('node', 'v22.23.0')).toBe(true);
    expect(dependencyVersionUsable('node', 'v24.0.0')).toBe(true);
    expect(dependencyVersionUsable('git', 'WSL git')).toBe(false);
  });
  it('rejects wrong pins, traversal and arbitrary executable paths without executing them', async () => {
    const outside = join(dir, 'outside.exe'); put(outside);
    receipt('bundled', { tools: [
      { name: 'gh', source: 'bundled', pinnedVersion: MANIFEST_DATA.gh!.version, executable: outside },
      { name: 'node', source: 'bundled', pinnedVersion: 'old', executable: files.node },
    ] });
    const native = (await read())!;
    expect(native.missingTools).toEqual([...WINDOWS_BOOTSTRAP_TOOLS]);
    expect(probes).not.toContain(outside);
  });
  it('rejects a private cache junction escape before probing', async () => {
    receipt(); rmSync(dirname(files.gh!), { recursive: true });
    const outside = join(dir, 'outside'); put(join(outside, 'gh.exe'));
    symlinkSync(outside, dirname(files.gh!), 'junction');
    const native = (await read())!;
    expect(await native.findExecutable('gh')).toBeNull(); expect(probes).not.toContain(files.gh!);
  });
  it('tolerates absent/invalid/failure receipts and never trusts nativeReady', async () => {
    expect(await read()).toBeNull();
    receipt('system', { nativeReady: false, code: 2, error: 'not propagated' });
    expect((await read())!.receiptState).toBe('failed');
    put(join(root, 'status.json'), 'broken'); expect(await read()).toBeNull();
    const native = (await read('system'))!; expect(native.receiptState).toBe('invalid');
    expect(await native.findExecutable('gh')).toBeNull();
    expect(await readWindowsBootstrap({ platform: 'linux', localAppData: dir })).toBeNull();
  });
  it('refuses symlink, directory and oversized receipt leaves without executing their tools', async () => {
    const file = join(root, 'status.json');
    receipt(); const external = join(dir, 'external-receipt.json'); renameSync(file, external);
    symlinkSync(external, file);
    expect((await read('bundled'))?.receiptState).toBe('invalid'); expect(probes).toEqual([]);
    rmSync(file); mkdirSync(file);
    expect((await read('bundled'))?.receiptState).toBe('invalid'); expect(probes).toEqual([]);
    rmSync(file, { recursive: true }); put(file, ' '.repeat(64 * 1024 + 1));
    expect((await read('bundled'))?.receiptState).toBe('invalid'); expect(probes).toEqual([]);
  });
  it('rejects path replacement after opening instead of accepting the substituted receipt', async () => {
    receipt(); const file = join(root, 'status.json'); const originalOpen = filesystem.open.bind(filesystem);
    const swap = spyOn(filesystem, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === file) { renameSync(file, join(root, 'old-status.json')); receipt('system'); }
      return handle;
    });
    try { expect((await read('bundled'))?.receiptState).toBe('invalid'); expect(probes).toEqual([]); }
    finally { swap.mockRestore(); }
    expect((await read())?.mode).toBe('system');
  });
  it('bounds a receipt that grows after its descriptor size check', async () => {
    receipt(); const file = join(root, 'status.json'); const originalOpen = filesystem.open.bind(filesystem);
    const growth = spyOn(filesystem, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) === file) {
        const originalStat = handle.stat.bind(handle);
        handle.stat = (async () => { const stat = await originalStat(); appendFileSync(file, ' '.repeat(128 * 1024)); return stat; }) as typeof handle.stat;
      }
      return handle;
    });
    try { expect((await read('bundled'))?.receiptState).toBe('invalid'); expect(probes).toEqual([]); }
    finally { growth.mockRestore(); }
  });
  it('resolves installer tools explicitly, preserves managed non-prerequisites, avoids duplicate installs/state', async () => {
    receipt(); const native = (await read())!; const paths = toolchainPaths(join(dir, 'isolated config'));
    const manifest = WINDOWS_BOOTSTRAP_TOOLS.map((name) => ({ name, ...MANIFEST_DATA[name]! }));
    const resolver = createResolver(paths, { platform: 'win32', windowsBootstrap: native, pathEnv: '' });
    expect(await resolver.findExecutable('node')).toBe(files.node!);
    expect(await resolver.findExecutable('npm.cmd')).toBe(join(dirname(files.node!), 'npm.cmd'));
    const manager = createManager(paths, { platform: 'win32-x64', manifest, windowsBootstrap: native,
      fetchImpl: (() => { throw new Error('duplicate download'); }) as unknown as typeof fetch });
    expect((await manager.ensureAll({ background: false })).every((tool) => tool.phase === 'ready')).toBe(true);
    expect((await manager.update('node')).phase).toBe('ready');
    expect(existsSync(paths.stateFile)).toBe(false);
    const prefix = await resolver.toolchainPathPrefix(); expect(prefix).toContain(dirname(files.node!));
    expect(prefix).not.toContain(join(paths.toolchainDir, 'node'));
  });
  it('retains managed bundled precedence but auto still prefers usable system prerequisites', async () => {
    receipt(); const native = (await read())!; const paths = toolchainPaths(join(dir, 'isolated config'));
    const managedNode = join(paths.toolchainDir, 'node', 'current', MANIFEST_DATA.node!.artifacts['win32-x64']!.binPaths[0]!);
    put(managedNode);
    put(join(dirname(managedNode), 'npm.cmd'));
    put(join(dirname(managedNode), 'npx.cmd'));
    const resolver = createResolver(paths, { platform: 'win32', windowsBootstrap: native, pathEnv: '' });
    expect(await resolver.findExecutable('node')).toBe(managedNode);
    expect(await resolver.toolchainPathPrefix()).toContain(dirname(managedNode));
    receipt('auto'); const system = join(dir, 'system'); put(join(system, 'node.exe'));
    const auto = (await read(undefined, system))!;
    expect(await createResolver(paths, { platform: 'win32', windowsBootstrap: auto }).findExecutable('node')).toBe(join(system, 'node.exe'));
  });
  it('does not substitute installer Node for an explicitly requested OpenClaw managed Node', async () => {
    receipt(); const native = (await read())!; const paths = toolchainPaths(join(dir, 'isolated config'));
    const downloads: string[] = [];
    const manager = createManager(paths, { platform: 'win32-x64', windowsBootstrap: native, retryDelaysMs: [],
      fetchImpl: (async (url: string | URL | Request) => { downloads.push(String(url)); return new Response('', { status: 404 }); }) as typeof fetch });
    expect((await manager.update('openclaw')).phase).toBe('error');
    expect(downloads).toEqual([MANIFEST_DATA.node!.artifacts['win32-x64']!.url]);
    expect(await createResolver(paths, { windowsBootstrap: native }).resolveOpenClawLauncher()).toBeNull();
  });
});

// Real PE fixture: proves Node/Bun spawning and PATH-only native child resolution,
// not just mock existence. All files/processes are confined to the temporary tree.
it.skipIf(process.platform !== 'win32')('launches installer-provisioned node and npx companions through native children', async () => {
  const compile = join(dir, 'compile.ps1');
  rmSync(files.node!);
  put(join(dirname(files.node!), 'npx.cmd'), '@"%~dp0node.exe" child\r\n');
  put(compile, `Add-Type -OutputAssembly '${files.node!.replaceAll("'", "''")}' -OutputType ConsoleApplication -TypeDefinition @'
using System;
public class CLI { public static int Main(string[] args) { Console.WriteLine(args.Length == 1 && args[0] == "--version" ? "v22.23.2" : "native-child-ok"); return 0; } }
'@`);
  execFileSync(join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile]);
  receipt(); const native = (await readWindowsBootstrap({ localAppData: dir }))!;
  expect(await native.findExecutable('node')).toBe(files.node!);
  const childEnv = { ...process.env, PATH: (await native.pathEntries()).join(';') };
  for (const key of Object.keys(childEnv)) if (key !== 'PATH' && key.toUpperCase() === 'PATH') delete childEnv[key as keyof typeof childEnv];
  expect(execFileSync('node.exe', ['child'], { env: childEnv, encoding: 'utf8' }).trim()).toBe('native-child-ok');
  expect(execFileSync(join(process.env.SystemRoot!, 'System32', 'cmd.exe'), ['/d', '/c', 'npx.cmd'],
    { env: childEnv, encoding: 'utf8' }).trim()).toBe('native-child-ok');
});
