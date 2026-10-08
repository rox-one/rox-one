import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, renameSync, appendFileSync, promises as filesystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MANIFEST_DATA } from '../manifest-data';
import { createResolver } from '../resolver';
import { createManager } from '../manager';
import { toolchainPaths } from '../manifest';
import { createFileProbeCache, dependencyVersionUsable, readWindowsBootstrap, WINDOWS_BOOTSTRAP_TOOLS, WINDOWS_DEPENDENCY_REQUIREMENTS, WINDOWS_PROBE_CACHE_TTL_MS, WINDOWS_PROBE_REQUIREMENTS_HASH, windowsProbeCacheSalt, setWindowsBootstrapRuntime } from '../windows-bootstrap';
import { createHash } from 'node:crypto';

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

describe('PERF-03 probe parallelism and cache', () => {
  it('probes tools concurrently but keeps tool order for missingTools', async () => {
    receipt(); let active = 0; let peak = 0;
    rmSync(files.git!); rmSync(files.yq!);
    const slowProbe = async (file: string) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 20)); active--; return existsSync(file); };
    const native = (await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe: slowProbe }))!;
    expect(peak).toBeGreaterThan(1);
    expect(native.missingTools).toEqual(['git', 'yq']);
    expect(await native.pathEntries()).toEqual(['gh', 'node', 'jq'].map((name) => dirname(files[name]!)));
  });
  it('reuses successful probes across launches, re-probes replaced binaries, never caches failures', async () => {
    receipt(); const cacheFile = join(dir, 'managed', 'probe-cache.json'); let t = 1_000;
    const first = createFileProbeCache(cacheFile, { now: () => t }); await first.load();
    expect((await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe, probeCache: first }))!.missingTools).toEqual([]);
    await first.flush();
    expect(probes.length).toBe(WINDOWS_BOOTSTRAP_TOOLS.length);

    probes = []; const second = createFileProbeCache(cacheFile, { now: () => t }); await second.load();
    const native = (await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe, probeCache: second }))!;
    expect(native.missingTools).toEqual([]); expect(await native.findExecutable('gh')).toBe(files.gh!);
    expect(probes).toEqual([]);

    // Replacing the binary changes its identity → probed again.
    await new Promise((r) => setTimeout(r, 15)); writeFileSync(files.gh!, 'replaced binary');
    expect(await native.findExecutable('gh')).toBe(files.gh!); expect(probes).toEqual([files.gh!]);

    // Failures are not cached.
    probes = []; const failing = async (file: string) => { probes.push(file); return false; };
    rmSync(cacheFile); const third = createFileProbeCache(cacheFile, { now: () => t }); await third.load();
    await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe: failing, probeCache: third }); await third.flush();
    expect(existsSync(cacheFile)).toBe(false);

    // Expired entries are dropped.
    const fresh = createFileProbeCache(cacheFile, { now: () => t }); await fresh.load();
    await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe, probeCache: fresh }); await fresh.flush();
    t += WINDOWS_PROBE_CACHE_TTL_MS + 1; probes = [];
    const expired = createFileProbeCache(cacheFile, { now: () => t }); await expired.load();
    await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe, probeCache: expired });
    expect(probes.length).toBe(WINDOWS_BOOTSTRAP_TOOLS.length);
  });
  it('folds the app version and the requirements hash into the cache key (update or raised minimum re-probes)', async () => {
    receipt(); const cacheFile = join(dir, 'managed', 'probe-cache.json');
    const v1 = createFileProbeCache(cacheFile, { appVersion: '1.0.0' }); await v1.load();
    await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe, probeCache: v1 }); await v1.flush();
    expect(probes.length).toBe(WINDOWS_BOOTSTRAP_TOOLS.length);
    const stored = JSON.parse(await filesystem.readFile(cacheFile, 'utf8')) as { entries: Record<string, number> };
    expect(Object.keys(stored.entries).every((key) => key.startsWith(`app=1.0.0|req=${WINDOWS_PROBE_REQUIREMENTS_HASH}|`))).toBe(true);

    // Same version → cache hit.
    probes = []; const same = createFileProbeCache(cacheFile, { appVersion: '1.0.0' }); await same.load();
    await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe, probeCache: same });
    expect(probes).toEqual([]);

    // App update → every tool re-probed; stale entries pruned on flush.
    probes = []; const v2 = createFileProbeCache(cacheFile, { appVersion: '1.1.0' }); await v2.load();
    await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe, probeCache: v2 }); await v2.flush();
    expect(probes.length).toBe(WINDOWS_BOOTSTRAP_TOOLS.length);
    const after = JSON.parse(await filesystem.readFile(cacheFile, 'utf8')) as { entries: Record<string, number> };
    expect(Object.keys(after.entries).every((key) => key.startsWith('app=1.1.0|'))).toBe(true);

    // Entries recorded under different acceptance rules (e.g. a lower minimum) are ignored.
    const foreign = Object.fromEntries(Object.entries(after.entries).map(([key, at]) => [key.replace(`req=${WINDOWS_PROBE_REQUIREMENTS_HASH}`, 'req=0000000000000000'), at]));
    await filesystem.writeFile(cacheFile, JSON.stringify({ ...after, entries: foreign }));
    probes = []; const raised = createFileProbeCache(cacheFile, { appVersion: '1.1.0' }); await raised.load();
    await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe, probeCache: raised });
    expect(probes.length).toBe(WINDOWS_BOOTSTRAP_TOOLS.length);
  });
  it('derives the requirements hash from the acceptance table used by dependencyVersionUsable', () => {
    const expected = createHash('sha256').update(JSON.stringify(Object.entries(WINDOWS_DEPENDENCY_REQUIREMENTS)
      .map(([tool, rule]) => [tool, rule instanceof RegExp ? `${rule.source}/${rule.flags}` : rule]))).digest('hex').slice(0, 16);
    expect(WINDOWS_PROBE_REQUIREMENTS_HASH).toBe(expected);
    expect(windowsProbeCacheSalt('2.3.4')).toBe(`app=2.3.4|req=${expected}`);
    expect(windowsProbeCacheSalt(undefined)).toBe(`app=unknown|req=${expected}`);
    expect(dependencyVersionUsable('node', 'v22.23.0')).toBe(true);
    expect(dependencyVersionUsable('node', 'v22.22.9')).toBe(false);
    expect(dependencyVersionUsable('gh', 'gh version 2.60.0 (2024-10-01)')).toBe(true);
    expect(dependencyVersionUsable('yq', 'yq (https://github.com/mikefarah/yq/) version v3.4.1')).toBe(false);
  });
  it('treats a corrupt probe cache as empty', async () => {
    receipt(); const cacheFile = join(dir, 'probe-cache.json'); writeFileSync(cacheFile, '{not json');
    const cache = createFileProbeCache(cacheFile); await cache.load();
    expect((await readWindowsBootstrap({ platform: 'win32', localAppData: dir, probe, probeCache: cache }))!.missingTools).toEqual([]);
    expect(probes.length).toBe(WINDOWS_BOOTSTRAP_TOOLS.length);
  });
});
