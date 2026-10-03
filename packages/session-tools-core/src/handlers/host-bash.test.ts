import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { handleHostBash } from './host-bash.ts';
import { setHostBashPort } from '../runtime/host-bash-port.ts';

describe('host-tool bash', () => {
  let rootDir: string;
  let workspaceDir: string;
  let sessionDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    rootDir = mkdtempSync(join(tmpdir(), 'host-bash-'));
    workspaceDir = join(rootDir, 'workspace');
    sessionDir = join(rootDir, 'session');
    dataDir = join(sessionDir, 'data');
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    setHostBashPort(null);
    rmSync(rootDir, { recursive: true, force: true });
  });

  function ctx(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
    return {
      sessionId: 'host-bash-session',
      workspacePath: workspaceDir,
      workingDirectory: workspaceDir,
      sourcesPath: join(workspaceDir, 'sources'),
      skillsPath: join(workspaceDir, 'skills'),
      plansFolderPath: join(sessionDir, 'plans'),
      callbacks: {
        onPlanSubmitted: () => {},
        onAuthRequest: () => {},
      },
      fs: {
        exists: () => false,
        readFile: () => '',
        readFileBuffer: () => Buffer.from(''),
        writeFile: () => {},
        isDirectory: () => false,
        readdir: () => [],
        stat: () => ({ size: 0, isDirectory: () => false }),
      },
      loadSourceConfig: () => null,
      sessionPath: sessionDir,
      dataPath: dataDir,
      ...overrides,
    };
  }

  it('rejects a working directory outside the workspace', async () => {
    const outside = join(rootDir, 'outside');
    mkdirSync(outside);
    const result = await handleHostBash(ctx({ workingDirectory: outside }), { command: 'echo no' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('outside the workspace');
  });

  it('allows a subdirectory of the workspace as cwd', async () => {
    const inner = join(workspaceDir, 'src');
    mkdirSync(inner);
    const result = await handleHostBash(ctx({ workingDirectory: inner }), { command: 'node -p "process.cwd()"' });
    expect(result.isError, result.content[0]?.text).toBe(false);
    expect(result.content[0]?.text).toContain(inner);
  });

  it('rejects a blank command', async () => {
    const result = await handleHostBash(ctx(), { command: '   ' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('non-empty command');
  });

  it('runs in the workspace cwd and captures stdout', async () => {
    const result = await handleHostBash(ctx(), { command: 'node -p "process.cwd()" && echo host-bash-ok' });
    expect(result.isError, result.content[0]?.text).toBe(false);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('exitCode: 0');
    expect(text).toContain(workspaceDir);
    expect(text).toContain('host-bash-ok');
  });

  it('strips blocked credential env vars from the child', async () => {
    const previous = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-should-not-leak';
    try {
      const result = await handleHostBash(ctx(), {
        command: 'printenv AWS_SECRET_ACCESS_KEY || true',
      });
      expect(result.isError).toBe(false);
      const text = result.content[0]?.text ?? '';
      expect(text).not.toContain('secret-should-not-leak');
    } finally {
      if (previous === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
      else process.env.AWS_SECRET_ACCESS_KEY = previous;
    }
  });

  it('times out a hung command and reports timedOut', async () => {
    const startedAt = Date.now();
    const result = await handleHostBash(ctx(), { command: 'sleep 8', timeoutMs: 250 });
    expect(Date.now() - startedAt).toBeLessThan(4000);
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('timedOut: true');
  });

  it('uses a fresh host environment provider and sanitizes its values before spawning', async () => {
    let value = 'first-host-env';
    const provider = async () => ({
      ...process.env,
      HOST_BASH_ENV_FIXTURE: value,
      AWS_SECRET_ACCESS_KEY: 'provider-secret-must-not-leak',
      ROX_SECRET_FIXTURE: 'provider-secret-must-not-leak',
      ...(process.platform === 'win32' ? { aws_session_token: 'provider-secret-must-not-leak' } : {}),
    });
    const context = ctx({ getHostBashEnv: provider });
    for (const expected of ['first-host-env', 'second-host-env']) {
      value = expected;
      const result = await handleHostBash(context, {
        command: 'node -p "JSON.stringify([process.env.HOST_BASH_ENV_FIXTURE, process.env.AWS_SECRET_ACCESS_KEY, process.env.ROX_SECRET_FIXTURE, process.env.aws_session_token])"',
      });
      expect(result.isError, result.content[0]?.text).toBe(false);
      expect(result.content[0]?.text).toContain(expected);
      expect(result.content[0]?.text).not.toContain('provider-secret-must-not-leak');
    }
    expect(process.env.HOST_BASH_ENV_FIXTURE).toBeUndefined();
  });

  it('keeps injected environments on local execution when the native port cannot accept env', async () => {
    let portCalled = false;
    setHostBashPort(async () => {
      portCalled = true;
      throw new Error('legacy native exec has no env contract');
    });
    const result = await handleHostBash(ctx({ getHostBashEnv: async () => ({ ...process.env }) }), {
      command: 'echo injected-local-execution',
    });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('injected-local-execution');
    expect(portCalled).toBe(false);
  });

  // Use a real Git Bash, native child process, and .cmd fixture on Windows.
  // No npm install, Python download, or user-config writes are involved.
  const gitBash = process.env.CLAUDE_CODE_GIT_BASH_PATH || 'C:\\Program Files\\Git\\bin\\bash.exe';
  const windowsIt = process.platform === 'win32' && existsSync(gitBash) ? it : it.skip;

  windowsIt('honors the configured Git Bash even when bash is not on PATH', async () => {
    process.env.CLAUDE_CODE_GIT_BASH_PATH = gitBash;
    process.env.PATH = `${dirname(process.execPath)};${process.env.SystemRoot}\\System32`;
    const result = await handleHostBash(ctx(), { command: 'echo configured-bash' });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('configured-bash');
  });

  windowsIt('runs a .cmd shim from the inherited PATH with arguments containing spaces', async () => {
    const binDir = join(workspaceDir, 'bin');
    mkdirSync(binDir);
    writeFileSync(join(binDir, 'host-bash-fixture.cmd'), '@echo off\r\necho shim:%~1\r\n');
    process.env.CLAUDE_CODE_GIT_BASH_PATH = gitBash;
    process.env.PATH = `${binDir}${delimiter}${process.env.PATH}`;
    const result = await handleHostBash(ctx(), { command: 'host-bash-fixture.cmd "argument with spaces"' });
    expect(result.isError, result.content[0]?.text).toBe(false);
    expect(result.content[0]?.text).toContain('shim:argument with spaces');
  });

  async function expectNativeTreeTerminated(command: string): Promise<void> {
    // Let the old resolver find Bash so this regression isolates tree termination.
    process.env.PATH = `${dirname(gitBash)}${delimiter}${process.env.PATH}`;
    const pidFile = join(workspaceDir, 'child.pid');
    const script = join(workspaceDir, 'tree.cjs');
    writeFileSync(script, `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
require('node:fs').writeFileSync('child.pid', JSON.stringify({ parent: process.pid, child: child.pid }));
setInterval(() => {}, 1000);
`);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        handleHostBash(ctx(), { command, timeoutMs: 2500 }),
        new Promise<never>((_, reject) => {
          watchdog = setTimeout(() => reject(new Error('descendant kept host-bash pipes open after timeout')), 6000);
        }),
      ]);
      expect(existsSync(pidFile), result.content[0]?.text).toBe(true);
      const { parent, child } = JSON.parse(readFileSync(pidFile, 'utf8'));
      expect(result.content[0]?.text).toContain('timedOut: true');
      expect(() => process.kill(parent, 0)).toThrow();
      expect(() => process.kill(child, 0)).toThrow();
    } finally {
      clearTimeout(watchdog);
      if (existsSync(pidFile)) {
        const { parent, child } = JSON.parse(readFileSync(pidFile, 'utf8'));
        for (const pid of [parent, child]) {
          spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        }
      }
    }
  }

  windowsIt('kills native descendants on timeout rather than leaving them holding stdout open', async () => {
    await expectNativeTreeTerminated('node tree.cjs');
  }, 10000);

  windowsIt('kills pipe-holding descendants even after the shell has exited', async () => {
    process.env.CLAUDE_CODE_GIT_BASH_PATH = gitBash;
    await expectNativeTreeTerminated('node tree.cjs &');
  }, 10000);

  it('truncates oversized stdout', async () => {
    const result = await handleHostBash(ctx(), {
      command: "node -e \"process.stdout.write('x'.repeat(25000))\"",
      timeoutMs: 5000,
    });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('truncated');
    expect(text.length).toBeLessThan(30_000);
  });

  it('uses the craft-exec port when installed', async () => {
    setHostBashPort(async (req) => ({
      stdout: `port:${req.command}`,
      stderr: '',
      exitCode: 0,
      timedOut: false,
      durationMs: 3,
      cwd: req.cwd,
    }));
    const result = await handleHostBash(ctx(), { command: 'echo ignored' });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('port:echo ignored');
  });

  it('falls back to local spawn when the port throws', async () => {
    setHostBashPort(async () => {
      throw new Error('sidecar down');
    });
    const result = await handleHostBash(ctx(), { command: 'echo local-fallback' });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('local-fallback');
  });

  it('does not mention isolation when the sandbox flag is off', async () => {
    const previous = process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX;
    delete process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX;
    try {
      const result = await handleHostBash(ctx(), { command: 'echo nosandbox' });
      expect(result.isError).toBe(false);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('nosandbox');
      expect(text).not.toContain('filesystemIsolation:');
    } finally {
      if (previous === undefined) delete process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX;
      else process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX = previous;
    }
  });

  it('skips the native port and fail-closes when sandbox is on without a backend', async () => {
    const previous = process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX;
    process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX = '1';
    let portCalled = false;
    setHostBashPort(async () => {
      portCalled = true;
      return {
        stdout: 'should-not-run',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 1,
        cwd: workspaceDir,
      };
    });
    try {
      const result = await handleHostBash(ctx(), { command: 'echo sandboxed' });
      const text = result.content[0]?.text ?? '';
      expect(portCalled).toBe(false);
      if (result.isError) {
        expect(text).toContain('CRAFT_FEATURE_HOST_BASH_SANDBOX');
        expect(text).toContain('isolation backend');
      } else {
        expect(text).toContain('filesystemIsolation: enforced');
        expect(text).toContain('networkIsolation: enforced');
        expect(text).toContain('sandboxed');
      }
    } finally {
      if (previous === undefined) delete process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX;
      else process.env.CRAFT_FEATURE_HOST_BASH_SANDBOX = previous;
    }
  });
});
