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
    }, 'win32')).toEqual({ command: 'C:\\Custom Git\\bin\\bash.exe', argsPrefix: ['-lc'] });
  });

  it('keeps Bash semantics on POSIX even when SHELL names another shell', () => {
    expect(resolveHostBashShell({ SHELL: '/bin/fish' }, 'linux')).toEqual({
      command: '/bin/bash', argsPrefix: ['-lc'],
    });
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
