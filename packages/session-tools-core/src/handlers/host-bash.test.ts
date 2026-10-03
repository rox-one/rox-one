import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { handleHostBash } from './host-bash.ts';
import { type HostBashObservation, setHostBashPort } from '../runtime/host-bash-port.ts';

describe('host-tool bash', () => {
  let rootDir: string;
  let workspaceDir: string;
  let sessionDir: string;
  let dataDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'host-bash-'));
    workspaceDir = join(rootDir, 'workspace');
    sessionDir = join(rootDir, 'session');
    dataDir = join(sessionDir, 'data');
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
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
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain(inner);
  });

  it('rejects a blank command', async () => {
    const result = await handleHostBash(ctx(), { command: '   ' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('non-empty command');
  });

  it('runs in the workspace cwd and captures stdout', async () => {
    const result = await handleHostBash(ctx(), { command: 'node -p "process.cwd()" && echo host-bash-ok' });
    expect(result.isError).toBe(false);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('exitCode: 0');
    expect(text).toContain(workspaceDir);
    expect(text).toContain('host-bash-ok');
  });

  it('publishes real stdout, stderr, exit code, cwd and monotonic executor evidence', async () => {
    const observations: HostBashObservation[] = [];
    const command = "printf 'actual-out'; printf 'actual-err' >&2; exit 7";
    const result = await handleHostBash(ctx({ hostBashObserver: observation => observations.push(observation) }), { command });
    expect(result.isError).toBe(true);
    expect(observations[0]).toMatchObject({ phase: 'started', execution: 'local', command, cwd: realpathSync(workspaceDir) });
    expect(observations.filter(observation => observation.phase === 'output').map(observation => observation.stdout ?? '').join('')).toBe('actual-out');
    expect(observations.filter(observation => observation.phase === 'output').map(observation => observation.stderr ?? '').join('')).toBe('actual-err');
    const completed = observations.at(-1)!;
    expect(completed).toMatchObject({ phase: 'completed', execution: 'local', result: { stdout: 'actual-out', stderr: 'actual-err', exitCode: 7, timedOut: false, cwd: realpathSync(workspaceDir) } });
    expect(completed.monotonicMs).toBeGreaterThanOrEqual(observations[0]!.monotonicMs);
    expect(completed.result!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('observer failures cannot rerun a successful sidecar command through fallback', async () => {
    let calls = 0;
    setHostBashPort(async req => {
      calls++;
      return { stdout: 'sidecar-executed-once', stderr: '', exitCode: 0, timedOut: false, durationMs: 4, cwd: req.cwd };
    });
    const result = await handleHostBash(ctx({ hostBashObserver: () => { throw new Error('trace unavailable'); } }), { command: 'printf should-never-run-locally' });
    expect(calls).toBe(1);
    expect(result.isError).toBe(false);
    expect(result.content[0]!.text).toContain('sidecar-executed-once');
    expect(result.content[0]!.text).not.toContain('stdout:\nshould-never-run-locally');
  });

  it('passive observers cannot rewrite the actual sidecar result returned to the caller', async () => {
    let calls = 0;
    setHostBashPort(async req => {
      calls++;
      return { stdout: 'actual-result', stderr: '', exitCode: 0, timedOut: false, durationMs: 4, cwd: req.cwd };
    });
    const result = await handleHostBash(ctx({ hostBashObserver: observation => {
      if (observation.result) { observation.result.stdout = 'rewritten-observation'; observation.result.exitCode = 17; }
    } }), { command: 'printf should-not-run' });
    expect(calls).toBe(1);
    expect(result.isError).toBe(false);
    expect(result.content[0]!.text).toContain('actual-result');
    expect(result.content[0]!.text).not.toContain('rewritten-observation');
  });

  it('reports an actual sidecar failure separately from the following local execution', async () => {
    const observations: HostBashObservation[] = [];
    setHostBashPort(async () => { throw new Error('sidecar down'); });
    const result = await handleHostBash(ctx({ hostBashObserver: observation => observations.push(observation) }), { command: 'printf fallback-output' });
    expect(result.isError).toBe(false);
    expect(observations[0]).toMatchObject({ phase: 'started', execution: 'sidecar' });
    expect(observations[1]).toMatchObject({ phase: 'failed', execution: 'sidecar', error: 'sidecar down' });
    expect(observations[2]).toMatchObject({ phase: 'started', execution: 'local' });
    expect(observations.at(-1)).toMatchObject({ phase: 'completed', execution: 'local', result: { stdout: 'fallback-output', exitCode: 0 } });
  });

  it('strips blocked credential env vars from the child', async () => {
    const previous = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-should-not-leak';
    try {
      const result = await handleHostBash(ctx(), {
        command: 'printenv AWS_SECRET_ACCESS_KEY || true',
      });
      const text = result.content[0]?.text ?? '';
      expect(text).not.toContain('secret-should-not-leak');
    } finally {
      if (previous === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
      else process.env.AWS_SECRET_ACCESS_KEY = previous;
    }
  });

  it('times out a hung command and reports timedOut', async () => {
    const result = await handleHostBash(ctx(), { command: 'sleep 8', timeoutMs: 250 });
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('timedOut: true');
  });

  it('kills the actual timed-out process tree and never reports its late stdout as completed work', async () => {
    const observations: HostBashObservation[] = [];
    const result = await handleHostBash(ctx({ hostBashObserver: observation => observations.push(observation) }), {
      command: "printf 'before-timeout'; sleep 2; printf 'late-after-kill'", timeoutMs: 100,
    });
    expect(result.isError).toBe(true);
    const completed = observations.filter(observation => observation.phase === 'completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.result).toMatchObject({ timedOut: true, stdout: 'before-timeout' });
    expect(observations.filter(observation => observation.phase === 'output').map(observation => observation.stdout ?? '').join('')).toBe('before-timeout');
    expect(JSON.stringify(observations)).not.toContain('stdout":"late-after-kill');
    expect(completed[0]!.result!.durationMs).toBeLessThan(1500);
  });

  it('truncates oversized stdout', async () => {
    const result = await handleHostBash(ctx(), {
      command: "node -e \"process.stdout.write('x'.repeat(25000))\"",
      timeoutMs: 5000,
    });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('truncated');
    expect(text.length).toBeLessThan(30_000);
  });

  it('caps both passive executor capture and displayed output when capture already reports truncation', async () => {
    const observations: HostBashObservation[] = [];
    const result = await handleHostBash(ctx({ hostBashObserver: observation => observations.push(observation) }), {
      command: "node -e \"process.stdout.write('x'.repeat(150000)); process.stderr.write('y'.repeat(150000))\"", timeoutMs: 5000,
    });
    expect(result.isError, result.content[0]?.text).toBe(false);
    const completed = observations.at(-1)!;
    expect(completed.phase).toBe('completed');
    expect(completed.result!.stdout).toHaveLength(40000);
    expect(completed.result!.stderr).toHaveLength(40000);
    expect(completed.result!.stdoutTruncated).toBe(true);
    expect(completed.result!.stderrTruncated).toBe(true);
    expect(observations.filter(observation => observation.phase === 'output').reduce((size, observation) => size + (observation.stdout?.length ?? 0), 0)).toBe(40000);
    expect(result.content[0]!.text.length).toBeLessThan(41000);
    expect(result.content[0]!.text).toContain('[stdout truncated to 20000 characters]');
    expect(result.content[0]!.text).toContain('[stderr truncated to 20000 characters]');
  });

  it('refreshes the real context provider on every registry call without parent mutation', async () => {
    let current = 'first-prepared-value';
    const context = ctx({ getHostBashEnv: async () => ({ ...process.env, HOST_BASH_FRESH_FIXTURE: current }) });
    const parent = process.env.HOST_BASH_FRESH_FIXTURE;
    for (const value of ['first-prepared-value', 'second-prepared-value']) {
      current = value;
      const result = await handleHostBash(context, { command: 'printf "%s" "$HOST_BASH_FRESH_FIXTURE"' });
      expect(result.isError).toBe(false);
      expect(result.content[0]?.text).toContain(value);
    }
    expect(process.env.HOST_BASH_FRESH_FIXTURE).toBe(parent);
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

// Provider path is the production registry route; the native port has no env contract.
describe('host Bash prepared environment and deadline', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'host-bash-provider-')); });
  afterEach(() => { setHostBashPort(null); rmSync(root, { recursive: true, force: true }); });

  it('uses the prepared PATH, scrubs provider credentials, and bypasses the env-less port', async () => {
    const { writeFileSync } = await import('node:fs');
    const { runHostBash } = await import('./host-bash.ts');
    const bin = join(root, 'managed'); mkdirSync(bin);
    writeFileSync(join(bin, 'managed-canary'), '#!/bin/bash\nprintf managed-ok', { mode: 0o700 });
    let portCalled = false;
    setHostBashPort(async () => { portCalled = true; throw new Error('must not run'); });
    const env = { ...process.env, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`, AWS_SECRET_ACCESS_KEY: 'private-provider-canary' };
    const before = env.PATH;
    const result = await runHostBash({ command: 'managed-canary; printf "|%s" "$AWS_SECRET_ACCESS_KEY"', cwd: root, envProvider: async () => env });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('managed-ok|');
    expect(result.content[0]?.text).not.toContain('private-provider-canary');
    expect(portCalled).toBe(false);
    expect(env.PATH).toBe(before);
  });

  it('returns a stable private preparation error without running the command or falling back', async () => {
    const { runHostBash } = await import('./host-bash.ts');
    const { existsSync } = await import('node:fs');
    const result = await runHostBash({ command: 'touch forbidden', cwd: root, envProvider: async () => { throw new Error('private-provider-secret'); } });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('preparation failed');
    expect(result.content[0]?.text).not.toContain('private-provider-secret');
    expect(existsSync(join(root, 'forbidden'))).toBe(false);
  });

  it('bounds preparation and ignores a late provider without starting the command', async () => {
    const { runHostBash } = await import('./host-bash.ts');
    const { existsSync } = await import('node:fs');
    let release!: (env: NodeJS.ProcessEnv) => void;
    const started = performance.now();
    const result = await runHostBash({ command: 'touch forbidden', cwd: root, timeoutMs: 30,
      envProvider: () => new Promise(resolve => { release = resolve; }) });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('preparation timed out');
    expect(performance.now() - started).toBeLessThan(1000);
    release({ ...process.env });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(existsSync(join(root, 'forbidden'))).toBe(false);
  });

  it('rejects a non-finite timeout before calling a provider', async () => {
    const { runHostBash } = await import('./host-bash.ts');
    let called = false;
    for (const timeoutMs of [NaN, Infinity, -Infinity]) {
      const result = await runHostBash({ command: 'echo forbidden', cwd: root, timeoutMs,
        envProvider: async () => { called = true; return {}; } });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('must be finite');
    }
    expect(called).toBe(false);
  });

  (process.platform === 'win32' ? it.skip : it)('does not source inherited non-interactive startup or exported functions', async () => {
    const { runHostBash } = await import('./host-bash.ts');
    const { writeFileSync } = await import('node:fs');
    const startup = join(root, 'startup');
    writeFileSync(startup, 'export AWS_SECRET_ACCESS_KEY=profile-private-canary; export PATH=/broken\n');
    const env = { ...process.env, HOME: root, BASH_ENV: startup, ENV: startup,
      'BASH_FUNC_fixture%%': '() { echo inherited-private-function; }' };
    const result = await runHostBash({ cwd: root,
      command: 'printf "canary:%s" "$AWS_SECRET_ACCESS_KEY"; type fixture 2>/dev/null || true', envProvider: async () => env });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('canary:');
    expect(result.content[0]?.text).not.toContain('profile-private-canary');
    expect(result.content[0]?.text).not.toContain('inherited-private-function');
    expect(env.BASH_ENV).toBe(startup);
  });

  (process.platform === 'win32' ? it.skip : it)('bounds inherited pipes after the shell exits, preserving earlier output', async () => {
    const { runHostBash } = await import('./host-bash.ts');
    const { readFileSync, existsSync } = await import('node:fs');
    const { HOST_BASH_KILL_GRACE_MS } = await import('../runtime/host-bash-process.ts');
    const file = join(root, 'owned-child.pid');
    const node = process.env.HOST_BASH_TEST_NODE ?? 'node';
    // A detached descendant escapes the shell process group but inherits IO.
    // The fixture owns its PID and tears it down independently below.
    const code = `const fs=require('fs'),cp=require('child_process'); const c=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]}); fs.writeFileSync(${JSON.stringify(file)},String(c.pid)); c.unref(); console.log('before-root-exit');`;
    const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
    const started = performance.now();
    try {
      const result = await runHostBash({ command: `${quote(node)} -e ${quote(code)}`, cwd: root, timeoutMs: 1500 });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('timedOut: true');
      expect(result.content[0]?.text).toContain('before-root-exit');
      expect(performance.now() - started).toBeLessThan(1500 + HOST_BASH_KILL_GRACE_MS + 1000);
      expect(existsSync(file)).toBe(true);
    } finally {
      if (existsSync(file)) { const pid = Number(readFileSync(file, 'utf8')); try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  }, 7000);
});

(process.platform === 'win32' ? describe : describe.skip)('native Windows host Bash lifetime', () => {
  let root: string;
  let gitBash: string;
  beforeEach(async () => {
    const { existsSync } = await import('node:fs');
    root = mkdtempSync(join(tmpdir(), 'host-bash-native tree-'));
    gitBash = process.env.CLAUDE_CODE_GIT_BASH_PATH || 'C:\\Program Files\\Git\\bin\\bash.exe';
    expect(existsSync(gitBash), 'Native Git Bash is required for Windows host Bash acceptance').toBe(true);
  });
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('honors configured Bash off PATH and runs a cmd shim with spaced arguments', async () => {
    const { writeFileSync } = await import('node:fs');
    const { runHostBash } = await import('./host-bash.ts');
    writeFileSync(join(root, 'owned-shim.cmd'), '@echo off\r\necho shim:%~1\r\n');
    const result = await runHostBash({ cwd: root, command: 'owned-shim.cmd "argument with spaces"',
      envProvider: async () => ({ ...process.env, CLAUDE_CODE_GIT_BASH_PATH: gitBash, PATH: `${root};${process.env.SystemRoot}\\System32` }) });
    expect(result.isError, result.content[0]?.text).toBe(false);
    expect(result.content[0]?.text).toContain('shim:argument with spaces');
  });

  for (const background of [false, true]) {
    it(`terminates native descendants holding IO ${background ? 'after shell exit' : 'while shell is alive'}`, async () => {
      const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
      const { runHostBash } = await import('./host-bash.ts');
      const node = process.env.HOST_BASH_TEST_NODE ?? Bun.which('node');
      expect(node, 'Native Node is required for Windows descendant fixtures').not.toBeNull();
      const { dirname } = await import('node:path');
      const file = join(root, 'owned-pids.json');
      writeFileSync(join(root, 'tree.cjs'), `const cp=require('child_process'),fs=require('fs'); const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); fs.writeFileSync('owned-pids.json',JSON.stringify([process.pid,child.pid])); setInterval(()=>{},1000);`);
      const start = performance.now();
      try {
        const result = await runHostBash({ cwd: root, command: `node tree.cjs${background ? ' &' : ''}`, timeoutMs: 2500,
          envProvider: async () => ({ ...process.env, CLAUDE_CODE_GIT_BASH_PATH: gitBash, PATH: `${dirname(node!)};${process.env.PATH}` }) });
        expect(performance.now() - start).toBeLessThan(6000);
        expect(result.content[0]?.text).toContain('timedOut: true');
        expect(existsSync(file), result.content[0]?.text).toBe(true);
        const pids = JSON.parse(readFileSync(file, 'utf8')) as number[];
        expect(pids).toHaveLength(2);
        for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
      } finally {
        if (existsSync(file)) for (const pid of JSON.parse(readFileSync(file, 'utf8')) as number[]) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      }
    }, 10000);
  }
});
