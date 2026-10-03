import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeWindowsBootstrap } from '../windows-bootstrap';
import { getWindowsBootstrapRuntime, setWindowsBootstrapRuntime } from '@craft-agent/shared/toolchain';
import type { WindowsBootstrapRuntime } from '@craft-agent/shared/toolchain';

const dirs: string[] = [];
afterEach(() => { setWindowsBootstrapRuntime(null); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
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
  it('registers before children and preserves PATH casing, managed bins and vendored rg', async () => {
    const opts = fixture(); const native = runtime('auto');
    const result = await initializeWindowsBootstrap({ ...opts, read: async () => native,
      run: async () => { throw new Error('unnecessary recovery'); } });
    expect(result?.mode).toBe('auto'); expect(getWindowsBootstrapRuntime()).toBe(native);
    expect(opts.env.Path).toBe('C:\\selected-node;C:\\unrelated;C:\\vendored-rg;C:\\managed\\omp');
    expect('PATH' in opts.env).toBe(false);
  });
  it.each([1, 2, 3, 3010])('surfaces recovery exit %s, uses preference, re-reads receipt, never opts into WSL', async (code) => {
    const opts = fixture(); let reads = 0; const calls: unknown[][] = [];
    const result = await initializeWindowsBootstrap({ ...opts, preference: 'system',
      read: async (options) => { expect(options?.preference).toBe('system'); return runtime('system', ++reads === 1); },
      run: async (...args) => { calls.push(args); return code; } });
    expect(result?.recoveryCode).toBe(code); expect(reads).toBe(2);
    expect(calls[0]![1]).toBe('system'); expect(calls[0]!.length).toBe(3);
    expect(JSON.stringify(result)).not.toContain('error');
  });
  it('does not provision for non-Windows/dev launches', async () => {
    const opts = fixture(); const run = async () => { throw new Error('unexpected provisioning'); };
    expect(await initializeWindowsBootstrap({ ...opts, platform: 'linux', run })).toBeNull();
    await initializeWindowsBootstrap({ ...opts, isPackaged: false, read: async () => null, run });
    expect(getWindowsBootstrapRuntime()).toBeNull();
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
