import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeWindowsBootstrap, scheduleWindowsBootstrapRepair, resetWindowsBootstrapRepairForTests, repairBackoffMs, repairStatePath, REPAIR_BACKOFF_BASE_MS, REPAIR_BACKOFF_MAX_MS, WINDOWS_REPAIR_SPAWN_WAIT_MS } from '../windows-bootstrap';
import { createLatchedGate, isSpawnEnvReady, registerSpawnEnvGate, resetSpawnEnvGatesForTests, whenSpawnEnvReady } from '@rox/shared/toolchain/spawn-readiness';
import { windowsProbeCacheSalt } from '@rox/shared/toolchain';
import { getWindowsBootstrapRuntime, setWindowsBootstrapRuntime } from '@rox/shared/toolchain';
import type { WindowsBootstrapRuntime } from '@rox/shared/toolchain';

const dirs: string[] = [];
afterEach(() => { setWindowsBootstrapRuntime(null); resetWindowsBootstrapRepairForTests(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(process.platform === 'win32' ? join(process.env.LOCALAPPDATA!, 'Temp', 'opencode') : tmpdir(), 'rox-startup-'));
  dirs.push(dir);
  const script = join(dir, 'resources', 'windows-bootstrap', 'bootstrap.ps1');
  mkdirSync(dirname(script), { recursive: true }); writeFileSync(script, '# fixture');
  return { isPackaged: true, resourcesPath: join(dir, 'resources'), managedRoot: join(dir, 'managed'), platform: 'win32' as const,
    env: { LOCALAPPDATA: dir, Path: 'C:\\unrelated;C:\\vendored-rg;C:\\managed\\omp' } };
}
function runtime(mode: 'auto' | 'bundled' | 'system', missing = false): WindowsBootstrapRuntime {
  return { mode, receiptState: missing ? 'failed' : 'ready', missingTools: missing ? ['node'] : [],
    async findExecutable() { return null; }, async pathEntries() { return ['C:\\selected-node']; },
    source() { return mode === 'bundled' ? 'bundled' : 'system'; },
    async gitBashPath() { return 'C:\\private-Git\\bin\\bash.exe'; },
    async filterPath(value) { return value; },
    async isExcludedPath() { return false; } };
}
describe('Windows startup handoff', () => {
  it('passes the app version into the persistent probe-cache key', async () => {
    const opts = fixture(); let seen: { has(key: string): boolean } | undefined;
    await initializeWindowsBootstrap({ ...opts, appVersion: '9.8.7',
      read: async (options) => { seen = (options as { probeCache?: { has(key: string): boolean } }).probeCache; return runtime('auto'); } });
    expect((seen as unknown as { salt: string }).salt).toBe(windowsProbeCacheSalt('9.8.7'));
  });
  it('a pending repair gates spawns with a bounded (~6 s), latching wait', async () => {
    expect(WINDOWS_REPAIR_SPAWN_WAIT_MS).toBe(6_000);
    resetSpawnEnvGatesForTests();
    try {
      let finish!: () => void; const repair = new Promise<void>((resolve) => { finish = resolve; });
      registerSpawnEnvGate('windows-repair', createLatchedGate(repair, 40));
      expect(isSpawnEnvReady()).toBe(false);
      const started = performance.now(); await whenSpawnEnvReady();
      expect(performance.now() - started).toBeGreaterThanOrEqual(35);
      expect(isSpawnEnvReady()).toBe(true); // latched after the first timeout
      finish();
    } finally { resetSpawnEnvGatesForTests(); }
  });
  it('registers before children and preserves PATH casing, managed bins and vendored rg', async () => {
    const opts = fixture(); const native = runtime('auto');
    const result = await initializeWindowsBootstrap({ ...opts, read: async () => native });
    expect(result?.mode).toBe('auto'); expect(result?.repairNeeded).toBe(false); expect(getWindowsBootstrapRuntime()).toBe(native);
    expect(opts.env.Path).toBe('C:\\selected-node;C:\\unrelated;C:\\vendored-rg;C:\\managed\\omp');
    expect('PATH' in opts.env).toBe(false);
  });
  it('never runs the PowerShell repair inline; reports repairNeeded instead', async () => {
    const opts = fixture(); let reads = 0;
    const result = await initializeWindowsBootstrap({ ...opts, preference: 'system',
      read: async (options) => { expect(options?.preference).toBe('system'); reads++; return runtime('system', true); } });
    expect(reads).toBe(1); expect(result?.repairNeeded).toBe(true); expect(result?.missingTools).toEqual(['node']);
    expect(JSON.stringify(result)).not.toContain('error');
  });
  it.each([1, 2, 3, 3010])('background repair surfaces exit %s, uses preference, re-reads receipt, never opts into WSL', async (code) => {
    const opts = fixture(); let reads = 0; const calls: unknown[][] = []; let gateOpened = false;
    let open!: () => void; const gate = new Promise<void>((resolve) => { open = resolve; });
    const pending = scheduleWindowsBootstrapRepair({ ...opts, preference: 'system', missingTools: ['node'], mode: 'system',
      after: gate.then(() => { gateOpened = true; }), now: () => 1_000,
      read: async (options) => { expect(options?.preference).toBe('system'); reads++; return runtime('system', true); },
      run: async (...args) => { expect(gateOpened).toBe(true); calls.push(args); return code; } });
    await new Promise((resolve) => setTimeout(resolve, 5)); expect(calls.length).toBe(0);
    open();
    const outcome = await pending;
    expect(outcome).toEqual({ ran: true, recoveryCode: code, attempts: 1, missingTools: ['node'] });
    expect(reads).toBe(1); expect(calls[0]![1]).toBe('system'); expect(calls[0]!.length).toBe(3);
    const state = JSON.parse(readFileSync(repairStatePath(opts.managedRoot), 'utf8'));
    expect(state).toEqual({ attempts: 1, lastAttemptAt: 1_000, lastCode: code, missingKey: 'node', mode: 'system' });
  });
  it('backs off repeated repairs, at most once per launch, and resets when the missing set changes', async () => {
    const opts = fixture(); let runs = 0; let t = 0;
    const base = { ...opts, missingTools: ['node'], now: () => t,
      read: async () => runtime('auto', true), run: async () => { runs++; return 1; } };
    expect((await scheduleWindowsBootstrapRepair(base)).ran).toBe(true);
    expect(await scheduleWindowsBootstrapRepair(base)).toEqual({ ran: false, reason: 'already-ran' });
    resetWindowsBootstrapRepairForTests(); t = REPAIR_BACKOFF_BASE_MS - 1;
    expect(await scheduleWindowsBootstrapRepair(base)).toEqual({ ran: false, reason: 'backoff', nextAttemptAt: REPAIR_BACKOFF_BASE_MS });
    resetWindowsBootstrapRepairForTests(); t = REPAIR_BACKOFF_BASE_MS;
    expect(await scheduleWindowsBootstrapRepair(base)).toMatchObject({ ran: true, attempts: 2 });
    resetWindowsBootstrapRepairForTests(); t += REPAIR_BACKOFF_BASE_MS; // < 2h backoff for attempt 2
    expect((await scheduleWindowsBootstrapRepair(base)).ran).toBe(false);
    resetWindowsBootstrapRepairForTests();
    expect(await scheduleWindowsBootstrapRepair({ ...base, missingTools: ['git', 'node'] })).toMatchObject({ ran: true, attempts: 1 });
    expect(runs).toBe(3);
    expect(repairBackoffMs(0)).toBe(0); expect(repairBackoffMs(3)).toBe(4 * REPAIR_BACKOFF_BASE_MS);
    expect(repairBackoffMs(50)).toBe(REPAIR_BACKOFF_MAX_MS);
  });
  it('clears the backoff once the repair fixes every tool and applies the new runtime', async () => {
    const opts = fixture(); const fixed = runtime('auto');
    const outcome = await scheduleWindowsBootstrapRepair({ ...opts, missingTools: ['node'], now: () => 5,
      read: async () => fixed, run: async () => 0 });
    expect(outcome).toEqual({ ran: true, recoveryCode: 0, attempts: 0, missingTools: [] });
    expect(getWindowsBootstrapRuntime()).toBe(fixed); expect(opts.env.Path.startsWith('C:\\selected-node;')).toBe(true);
    expect(JSON.parse(readFileSync(repairStatePath(opts.managedRoot), 'utf8')).attempts).toBe(0);
  });
  it('does not provision for non-Windows/dev launches', async () => {
    const opts = fixture(); const run = async (): Promise<number> => { throw new Error('unexpected provisioning'); };
    expect(await initializeWindowsBootstrap({ ...opts, platform: 'linux' })).toBeNull();
    const dev = await initializeWindowsBootstrap({ ...opts, isPackaged: false, read: async () => null });
    expect(dev?.repairNeeded).toBe(false);
    expect(getWindowsBootstrapRuntime()).toBeNull();
    expect(await scheduleWindowsBootstrapRepair({ ...opts, isPackaged: false, missingTools: ['node'], run })).toEqual({ ran: false, reason: 'not-needed' });
    expect(existsSync(repairStatePath(opts.managedRoot))).toBe(false);
  });
  it('removes inherited private/stale prerequisite paths in system mode without dropping managed OMP', async () => {
    const opts = fixture(); const omp = join(opts.managedRoot, 'omp', 'current', 'bin');
    opts.env.Path = [join(opts.env.LOCALAPPDATA, 'Rox', 'bootstrap', 'dependencies', 'node'),
      join(opts.managedRoot, 'node', 'current', 'bin'), omp, 'C:\\vendored-rg'].join(';');
    await initializeWindowsBootstrap({ ...opts, isPackaged: false, preference: 'system' });
    expect(opts.env.Path).toBe(`${omp};C:\\vendored-rg`);
  });
  it('keeps explicit Git Bash env/preference ahead of the optional private path', async () => {
    const opts = fixture(); const env: NodeJS.ProcessEnv = { ...opts.env, CLAUDE_CODE_GIT_BASH_PATH: 'C:\\custom\\bash.exe' };
    await initializeWindowsBootstrap({ ...opts, env, read: async () => runtime('bundled') });
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe('C:\\custom\\bash.exe');
    delete env.CLAUDE_CODE_GIT_BASH_PATH;
    await initializeWindowsBootstrap({ ...opts, env, gitBashPreference: 'C:\\configured\\bash.exe', read: async () => runtime('bundled') });
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBeUndefined();
    await initializeWindowsBootstrap({ ...opts, env, read: async () => runtime('bundled') });
    expect(String(env.CLAUDE_CODE_GIT_BASH_PATH)).toBe('C:\\private-Git\\bin\\bash.exe');
  });
});
