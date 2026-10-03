import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_DATA } from '../../toolchain/manifest-data.ts';
import type { ToolResult } from '@rox/session-tools-core';
import { createHostBashEnv } from '../../toolchain-runtime.ts';
import { pathEnvKey, whichTool } from '../../toolchain/exec.ts';

// Other OMP suites temporarily replace PATH. Capture lookup inputs and the
// real process primitive while this module loads, before any test hooks run.
const initialEnv = { ...process.env };
const initialPath = initialEnv[pathEnvKey(initialEnv)] ?? '';
const nativeSpawn = spawn;
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const monotonicNow = performance.now.bind(performance);
const nativeNodeOnInitialPath = process.platform === 'win32'
  ? whichTool('node.exe', initialPath, true)
  : Promise.resolve(null);
const nodeIdentity = 'JSON.stringify({ runtime: process.release.name, execPath: process.execPath, version: process.version, bun: process.versions.bun ?? null })';

interface NodeIdentity { runtime: string; execPath: string; version: string; bun: string | null }

interface ProbeResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
  timedOut: boolean;
  elapsedMs: number;
  deadlineMs: number;
}

/** Async process IO keeps Bun's shared test loop running; no spawnSync timeout machinery. */
function runProbe(executable: string, args: string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  deadlineMs: number;
}): Promise<ProbeResult> {
  const startedAt = monotonicNow();
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (status: number | null, signal: NodeJS.Signals | null, error?: Error, timedOut = false) => {
      if (settled) return;
      settled = true;
      if (timer) nativeClearTimeout(timer);
      resolve({ status, signal, stdout, stderr, error, timedOut,
        elapsedMs: Math.round(monotonicNow() - startedAt), deadlineMs: options.deadlineMs });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = nativeSpawn(executable, args, {
        cwd: options.cwd, env: options.env, shell: false,
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(null, null, error instanceof Error ? error : new Error(String(error)));
      return;
    }
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(0, 256 * 1024); });
    child.stderr!.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(0, 256 * 1024); });
    child.once('error', error => finish(null, null, error));
    child.once('close', (code, signal) => finish(code, signal));
    timer = nativeSetTimeout(() => {
      const error = Object.assign(new Error(`${executable} exceeded ${options.deadlineMs}ms`), { code: 'ETIMEDOUT' });
      finish(null, 'SIGKILL', error, true);
      child.kill('SIGKILL');
      child.stdout!.destroy();
      child.stderr!.destroy();
    }, options.deadlineMs);
  });
}

function spawnErrorCode(error: Error | undefined): string | undefined {
  return error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function probeDiagnostic(probe: ProbeResult, executable: string, path: string): string {
  return JSON.stringify({
    executable, status: probe.status, signal: probe.signal,
    error: probe.error && { code: spawnErrorCode(probe.error), message: probe.error.message },
    stderr: probe.stderr, stdout: probe.stdout,
    elapsedMs: probe.elapsedMs, deadlineMs: probe.deadlineMs, timedOut: probe.timedOut,
    // PATH only: never dump the credential-bearing environment.
    pathSnapshot: { initial: initialPath, probe: path, current: process.env.PATH },
  });
}

interface RuntimeProbeResult {
  pandoc: { isError: boolean; text: string };
  uvx: { isError: boolean; text: string };
  python: { isError: boolean; text: string };
  python3: { isError: boolean; text: string };
  node: { isError: boolean; text: string };
  nestedPython: ToolResult;
  python3Location: ToolResult;
  sanitized: ToolResult;
  portCalled: boolean;
  parentPathUnchanged: boolean;
}

(process.platform === 'win32' ? describe : describe.skip)('registry host Bash managed environment (native fixtures)', () => {
  let root: string;
  let bundle: string;
  let node: string;
  let files: Record<string, string>;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'host-bash-runtime with spaces-'));
    const candidate = await nativeNodeOnInitialPath;
    expect(candidate, `No native node.exe on captured PATH: ${initialPath}`).not.toBeNull();
    const probe = await runProbe(candidate!, ['-p', nodeIdentity], {
      cwd: dirname(fileURLToPath(import.meta.url)), env: initialEnv,
      deadlineMs: 5000,
    });
    const diagnostic = probeDiagnostic(probe, candidate!, initialPath);
    expect(probe.error, diagnostic).toBeUndefined();
    expect(probe.status, diagnostic).toBe(0);
    const identity = JSON.parse(probe.stdout.trim()) as NodeIdentity;
    expect(identity.runtime).toBe('node');
    expect(identity.bun).toBeNull();
    node = identity.execPath;
    files = {};
    function nativeFixture(file: string): void {
      mkdirSync(dirname(file), { recursive: true });
      // Native Node renamed as a CLI fixture: real CreateProcess/Bash/PATH
      // behavior without downloads, installs, or writes to managed user data.
      try { linkSync(node, file); } catch { copyFileSync(node, file); }
    }
    for (const name of ['pandoc', 'uv', 'python'] as const) {
      const entry = MANIFEST_DATA[name]!;
      for (const bin of entry.artifacts['win32-x64']!.binPaths) {
        const file = join(root, 'toolchain', name, 'current', bin);
        nativeFixture(file);
        files[bin.endsWith('uvx.exe') ? 'uvx' : name] = file;
      }
    }
    files.node = join(root, 'bootstrap', 'node.exe');
    nativeFixture(files.node);
    // A runnable canary ahead of inherited PATH proves python3 does not fall
    // through to a WindowsApps-style alias when managed Python is python.exe.
    nativeFixture(join(root, 'WindowsApps', 'python3.exe'));
    bundle = join(root, 'probe.mjs');
    const built = await Bun.build({
      entrypoints: [fileURLToPath(new URL('./host-bash-runtime.fixture.ts', import.meta.url))],
      target: 'node', format: 'esm', external: ['electron', 'koffi'],
    });
    expect(built.success, built.logs.map(String).join('\n')).toBe(true);
    await Bun.write(bundle, built.outputs[0]!);
  }, 30000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  function probeEnv(): NodeJS.ProcessEnv {
    const systemRoot = Object.entries(initialEnv).find(([key]) => key.toUpperCase() === 'SYSTEMROOT')?.[1] ?? 'C:\\Windows';
    const path = `${join(root, 'WindowsApps')};${dirname(node)};${systemRoot}\\System32`;
    const base = { ...initialEnv };
    for (const key of Object.keys(base)) if (key.toUpperCase() === 'PATH') delete base[key];
    return {
      ...base,
      ROX_CONFIG_DIR: root, CRAFT_CONFIG_DIR: root,
      HOST_BASH_RUNTIME_FIXTURE: root,
      CLAUDE_CODE_GIT_BASH_PATH: initialEnv.CLAUDE_CODE_GIT_BASH_PATH || 'C:\\Program Files\\Git\\bin\\bash.exe',
      HOME: root,
      PATH: path, ORIGINAL_PATH: path,
      AWS_SECRET_ACCESS_KEY: 'fixture-secret-must-not-leak',
      ROX_SECRET_FIXTURE: 'fixture-secret-must-not-leak',
      aws_session_token: 'fixture-secret-must-not-leak',
    };
  }

  it('runs the captured native Node even when another test environment removes Node from PATH', async () => {
    const env = { ...probeEnv(), PATH: join(root, 'unrelated-test-bin') };
    const missing = await runProbe('node', ['-p', nodeIdentity], {
      cwd: root, env, deadlineMs: 5000,
    });
    expect(spawnErrorCode(missing.error), probeDiagnostic(missing, 'node', env.PATH)).toBe('ENOENT');
    const actual = await runProbe(node, ['-p', nodeIdentity], {
      cwd: root, env, deadlineMs: 5000,
    });
    const diagnostic = probeDiagnostic(actual, node, env.PATH);
    expect(actual.error, diagnostic).toBeUndefined();
    expect(actual.status, diagnostic).toBe(0);
    const identity = JSON.parse(actual.stdout.trim()) as NodeIdentity;
    expect(identity.runtime).toBe('node');
    expect(identity.bun).toBeNull();
    expect(identity.execPath).toBe(node);
  });

  it('keeps the parent event loop running while a native Node probe is pending', async () => {
    const tick = new Promise<'parent-timer'>(resolve => nativeSetTimeout(() => resolve('parent-timer'), 20));
    const pending = runProbe(node, ['-e', `setTimeout(() => console.log(${nodeIdentity}), 150)`], {
      cwd: root, env: probeEnv(), deadlineMs: 5000,
    });
    expect(await Promise.race([tick, pending.then(() => 'child-process')])).toBe('parent-timer');
    const result = await pending;
    const diagnostic = probeDiagnostic(result, node, probeEnv().PATH!);
    expect(result.error, diagnostic).toBeUndefined();
    expect(result.status, diagnostic).toBe(0);
    expect(result.timedOut).toBe(false);
    const identity = JSON.parse(result.stdout.trim()) as NodeIdentity;
    expect(identity.runtime).toBe('node');
    expect(identity.bun).toBeNull();
  });

  it('reports a genuine async deadline for a hung native Node probe', async () => {
    const result = await runProbe(node, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: root, env: probeEnv(), deadlineMs: 200,
    });
    const diagnostic = probeDiagnostic(result, node, probeEnv().PATH!);
    expect(spawnErrorCode(result.error), diagnostic).toBe('ETIMEDOUT');
    expect(result.timedOut).toBe(true);
    expect(result.elapsedMs, diagnostic).toBeGreaterThanOrEqual(150);
    expect(result.status).toBeNull();
  });

  it('reproduces exit 127 without the factory environment provider', async () => {
    const probe = await runProbe(process.execPath, [bundle, '--without-provider'], {
      cwd: root, deadlineMs: 20000, env: probeEnv(),
    });
    const diagnostic = probeDiagnostic(probe, process.execPath, probeEnv().PATH!);
    expect(probe.error, diagnostic).toBeUndefined();
    expect(probe.status, diagnostic).toBe(0);
    const result = JSON.parse(probe.stdout.trim()) as RuntimeProbeResult;
    expect(result.pandoc.isError).toBe(true);
    expect(result.pandoc.text).toContain('exitCode: 127');
    expect(result.python3.text).not.toContain(files.python!);
    expect(result.python3Location.content[0]?.text).toContain('WindowsApps/');
    expect(result.parentPathUnchanged).toBe(true);
  }, 25000);

  it('does not advertise a WindowsApps Python as managed or retain a stale managed alias', async () => {
    const inherited = { PATH: '', CRAFT_HOST_BASH_PYTHON: 'stale/python.exe' };
    const env = await createHostBashEnv(inherited, {
      findExecutable: async () => join(root, 'WindowsApps', 'python3.exe'),
      toolchainDir: () => join(root, 'toolchain'),
      toolchainPathPrefix: async () => '',
      resolveOpenClawLauncher: async () => null,
    });
    expect(env.CRAFT_HOST_BASH_PYTHON).toBeUndefined();
    expect(env.UV_PYTHON).toBeUndefined();
    expect(inherited.CRAFT_HOST_BASH_PYTHON).toBe('stale/python.exe');
  });

  for (const runtime of ['Bun', 'Node']) {
    it(`${runtime}: factory → core registry → Bash uses managed/bootstrap bins and scrubs credentials`, async () => {
      const executable = runtime === 'Bun' ? process.execPath : node;
      const probe = await runProbe(executable, [bundle], {
        cwd: root, deadlineMs: 20000,
        env: probeEnv(),
      });
      const diagnostic = probeDiagnostic(probe, executable, probeEnv().PATH!);
      expect(probe.error, diagnostic).toBeUndefined();
      expect(probe.status, diagnostic).toBe(0);
      const result = JSON.parse(probe.stdout.trim()) as RuntimeProbeResult;
      for (const name of ['pandoc', 'uvx', 'python', 'python3', 'node'] as const) {
        expect(result[name].isError, result[name].text).toBe(false);
        expect(result[name].text).toContain(files[name === 'python3' ? 'python' : name]!);
      }
      expect(result.nestedPython.isError, result.nestedPython.content[0]?.text).toBe(false);
      expect(result.nestedPython.content[0]?.text).toContain(files.python!);
      expect(result.sanitized.isError).toBe(false);
      const sanitizedStdout = result.sanitized.content[0]!.text.split('\nstdout:\n')[1]!.trim();
      expect(JSON.parse(sanitizedStdout)).toEqual([null, null, null, files.python]);
      expect(JSON.stringify(result)).not.toContain('fixture-secret-must-not-leak');
      expect(result.portCalled).toBe(false);
      expect(result.parentPathUnchanged).toBe(true);
    }, 25000);
  }
});
