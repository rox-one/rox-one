import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveHostBashShell } from './host-bash-process.ts';

describe('host Bash shell selection', () => {
  it('honors the configured Windows shell without consulting PATH or SHELL', () => {
    expect(resolveHostBashShell({
      CLAUDE_CODE_GIT_BASH_PATH: ' C:\\Custom Git\\bin\\bash.exe ',
      SHELL: 'powershell.exe',
      PATH: 'C:\\Windows\\System32',
    }, 'win32')).toEqual({ command: 'C:\\Custom Git\\bin\\bash.exe', argsPrefix: ['--noprofile', '--norc', '-c'] });
  });

  it('keeps Bash semantics on POSIX even when SHELL names another shell', () => {
    expect(resolveHostBashShell({ SHELL: '/bin/fish' }, 'linux')).toEqual({
      command: '/bin/bash', argsPrefix: ['--noprofile', '--norc', '-c'],
    });
  });

  it('refuses configured WSL or PATH-search launchers instead of calling them native Git Bash', () => {
    for (const configured of ['bash.exe', 'C:relative\\bash.exe', '\\Git\\bin\\bash.exe', 'c:\\WINDOWS\\System32\\bash.exe']) {
      expect(() => resolveHostBashShell({ CLAUDE_CODE_GIT_BASH_PATH: configured, SystemRoot: 'C:\\Windows' }, 'win32')).toThrow('native Git Bash');
    }
  });
});

// Exercise discovery against owned fixtures instead of installed tools.
(process.platform === 'win32' ? describe : describe.skip)('Windows host Bash discovery', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'host-bash-shell-'));
    env = {
      ProgramFiles: join(root, 'Program Files'),
      'ProgramFiles(x86)': join(root, 'Program Files (x86)'),
      LOCALAPPDATA: join(root, 'AppData'),
      SystemRoot: join(root, 'Windows'),
    };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function file(path: string): string {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'fixture');
    return path;
  }

  it('finds Git Bash when only Git cmd is on PATH', () => {
    const bash = file(join(root, 'Custom Git', 'bin', 'bash.exe'));
    env.Path = `"${join(root, 'Custom Git', 'cmd')}"`;
    expect(resolveHostBashShell(env).command).toBe(bash);
  });

  it('finds a conventional installation with no PATH entry', () => {
    const bash = file(join(env.ProgramFiles!, 'Git', 'bin', 'bash.exe'));
    expect(resolveHostBashShell(env).command).toBe(bash);
  });

  it('uses the native shell from the configured Git installation rather than its launcher', () => {
    const launcher = file(join(root, 'Custom Git', 'bin', 'bash.exe'));
    const native = file(join(root, 'Custom Git', 'usr', 'bin', 'bash.exe'));
    env.CLAUDE_CODE_GIT_BASH_PATH = launcher;
    expect(resolveHostBashShell(env).command).toBe(native);
  });

  it('skips the WSL launcher, including a trailing separator in the PATH entry', () => {
    file(join(env.SystemRoot!, 'System32', 'bash.exe'));
    env.Path = `${join(env.SystemRoot!, 'System32')}\\`;
    const bash = file(join(env.LOCALAPPDATA!, 'Programs', 'Git', 'bin', 'bash.exe'));
    expect(resolveHostBashShell(env).command).toBe(bash);
  });

  it('reads case-insensitive Windows environment keys', () => {
    const bash = file(join(root, 'Custom Programs', 'Git', 'bin', 'bash.exe'));
    delete env.ProgramFiles;
    env.PROGRAMFILES = join(root, 'Custom Programs');
    expect(resolveHostBashShell(env).command).toBe(bash);
  });

  it('reports a missing native Bash rather than selecting the WSL launcher', () => {
    file(join(env.SystemRoot!, 'System32', 'bash.exe'));
    env.Path = join(env.SystemRoot!, 'System32');
    expect(() => resolveHostBashShell(env)).toThrow('Git Bash was not found');
  });
});

import { prepareHostBashEnv, killHostBashProcessTree } from './host-bash-process.ts';

describe('host Bash child startup and process ownership', () => {
  it('scrubs Windows mixed-case secrets and startup injections while retaining managed PATH priority', () => {
    const base = { Path: 'C:\\Managed\\bin;C:\\Windows\\System32', aWs_SeSsIoN_tOkEn: 'private',
      BASH_ENV: 'C:\\private-startup', ENV: 'private-startup', 'BASH_FUNC_fixture%%': '() { echo private; }', SAFE: 'ok' };
    const result = prepareHostBashEnv(base, 'C:\\Custom Git\\usr\\bin\\bash.exe', 'win32');
    expect(result).toEqual({ Path: 'C:\\Managed\\bin;C:\\Windows\\System32;C:\\Custom Git\\usr\\bin', SAFE: 'ok' });
    expect(base.BASH_ENV).toBe('C:\\private-startup');
    expect(prepareHostBashEnv(result, 'C:\\Custom Git\\usr\\bin\\bash.exe', 'win32')).toEqual(result);
  });

  it('refuses invalid process identity without invoking a cleanup callback', async () => {
    let killed = false;
    for (const pid of [0, -1, 1.5, NaN, Infinity]) {
      await killHostBashProcessTree(pid, { before: 1, after: 2 }, undefined, () => { killed = true; });
    }
    await killHostBashProcessTree(1, { before: 2, after: 1 }, undefined, () => { killed = true; });
    expect(killed).toBe(false);
  });
});
