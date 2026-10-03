import { spawn } from 'node:child_process';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';
import { createSanitizedEnv } from '../runtime/sandbox-env.ts';
import { resolveHostBashCwd } from '../runtime/host-bash-cwd.ts';
import { getHostBashPort, type HostBashExecResult } from '../runtime/host-bash-port.ts';
import { prepareHostBashEnv, resolveHostBashShell, killHostBashProcessTree, HOST_BASH_KILL_GRACE_MS } from '../runtime/host-bash-process.ts';
import {
  isHostBashSandboxEnabled,
  planHostBashSandbox,
  type HostBashSandboxPlan,
} from '../runtime/host-bash-sandbox.ts';

export interface HostBashArgs {
  command: string;
  timeoutMs?: number;
}

export const HOST_BASH_DEFAULT_TIMEOUT_MS = 30_000;
export const HOST_BASH_MAX_TIMEOUT_MS = 120_000;
export const HOST_BASH_MAX_OUTPUT_CHARS = 20_000;

function truncateOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= HOST_BASH_MAX_OUTPUT_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, HOST_BASH_MAX_OUTPUT_CHARS),
    truncated: true,
  };
}

/**
 * Craft-executed host-tool Bash.
 *
 * OMP (and any other `set_host_tools` backend) calls into craft instead of
 * spawning Bash inside the backend. When the native sidecar is up, execution
 * goes through `exec:run` (`craft-exec`); otherwise local spawn. Caps:
 * stdout size, wall-clock timeout, process-tree kill, credential env scrub,
 * cwd jailed to the workspace root. Optional FS+net jail via
 * CRAFT_FEATURE_HOST_BASH_SANDBOX=1 (default off). When that flag is on,
 * skip the native exec port and wrap local spawn; fail closed if no
 * isolation backend is available.
 */
export async function runHostBash(req: {
  command: string;
  cwd: string;
  workspaceRoot?: string;
  timeoutMs?: number;
  envProvider?: () => Promise<NodeJS.ProcessEnv>;
}): Promise<ToolResult> {
  const command = typeof req.command === 'string' ? req.command.trim() : '';
  if (!command) {
    return errorResponse('bash requires a non-empty command.');
  }
  const jailed = resolveHostBashCwd(req.cwd, req.workspaceRoot);
  if ('error' in jailed) {
    return errorResponse(jailed.error);
  }
  const cwd = jailed.cwd;

  if (req.timeoutMs !== undefined && !Number.isFinite(req.timeoutMs)) {
    return errorResponse('bash timeoutMs must be finite.');
  }
  const timeoutMs = Math.min(
    Math.max(req.timeoutMs ?? HOST_BASH_DEFAULT_TIMEOUT_MS, 1),
    HOST_BASH_MAX_TIMEOUT_MS,
  );

  const sandboxEnabled = isHostBashSandboxEnabled();
  const port = getHostBashPort();
  // This legacy native port cannot receive a per-call managed environment.
  // Keep it available to callers without a provider; do not silently lose
  // managed tool resolution for the real session registry.
  if (port && !sandboxEnabled && !req.envProvider) {
    try {
      const remote = await port({
        command,
        cwd,
        timeoutMs,
        workspaceRoot: req.workspaceRoot,
      });
      return formatHostBashResult(remote);
    } catch {
      // Sidecar down or invoke failed — local spawn stays the primary path.
    }
  }

  const startedAt = Date.now();
  const deadline = performance.now() + timeoutMs;
  let env: NodeJS.ProcessEnv;
  if (req.envProvider) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const provided = await Promise.race([
        req.envProvider(),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
      if (!provided || performance.now() >= deadline) {
        return errorResponse('host-tool bash environment preparation timed out; command was not started.');
      }
      env = createSanitizedEnv(provided);
    } catch {
      return errorResponse('host-tool bash environment preparation failed; command was not started.');
    } finally {
      if (timer) clearTimeout(timer);
    }
  } else {
    env = createSanitizedEnv();
  }
  let shell: ReturnType<typeof resolveHostBashShell>;
  try { shell = resolveHostBashShell(env); } catch {
    return errorResponse('Native Git Bash was not found. Configure CLAUDE_CODE_GIT_BASH_PATH to bash.exe.');
  }
  env = prepareHostBashEnv(env, shell.command);
  // Managed Windows Python ships python.exe; nested Bash inherits the same
  // explicit alias rather than falling through to a WindowsApps stub.
  const script = process.platform === 'win32' && env.CRAFT_HOST_BASH_PYTHON
    ? `python3() { "$CRAFT_HOST_BASH_PYTHON" "$@"; }; export -f python3;\n${command}`
    : command;
  const shellArgs = [...shell.argsPrefix, script];
  const jailRoot = req.workspaceRoot?.trim() || cwd;
  const sandbox = sandboxEnabled ? planHostBashSandbox(shell.command, shellArgs, jailRoot) : null;
  if (sandbox && sandbox.status !== 'enforced') {
    return errorResponse(
      'host-tool bash sandbox requested (CRAFT_FEATURE_HOST_BASH_SANDBOX) but no FS+net isolation backend is available on this platform/runtime.',
    );
  }
  const spawnCommand = sandbox?.command ?? shell.command;
  const spawnArgs = sandbox?.args ?? shellArgs;
  const memoryCap = HOST_BASH_MAX_OUTPUT_CHARS * 2;

  try {
    const result = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
      timedOut: boolean;
    }>((resolvePromise, reject) => {
      const before = Date.now();
      const child = spawn(spawnCommand, spawnArgs, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });

      const spawnedAt = { before, after: Date.now() };
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let exitedAt: number | undefined;
      let teardownTimer: ReturnType<typeof setTimeout> | undefined;
      const pid = child.pid;

      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (teardownTimer) clearTimeout(teardownTimer);
        child.stdout.destroy();
        child.stderr.destroy();
        resolvePromise({ stdout, stderr, code, timedOut });
      };

      const killTimer = setTimeout(() => {
        timedOut = true;
        teardownTimer = setTimeout(() => finish(null), HOST_BASH_KILL_GRACE_MS);
        if (typeof pid === 'number') {
          void killHostBashProcessTree(pid, spawnedAt, exitedAt, () => {
            if (exitedAt === undefined) child.kill('SIGKILL');
          }).catch(() => {}).finally(() => finish(null));
        } else finish(null);
      }, Math.max(1, deadline - performance.now()));

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < memoryCap) stdout = (stdout + chunk.toString()).slice(0, memoryCap);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < memoryCap) stderr = (stderr + chunk.toString()).slice(0, memoryCap);
      });

      child.once('exit', () => { exitedAt = Date.now(); });
      child.once('close', (code) => { if (!timedOut) finish(code); });
      child.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (teardownTimer) clearTimeout(teardownTimer);
        child.stdout.destroy(); child.stderr.destroy();
        reject(err);
      });
    });

    const durationMs = Date.now() - startedAt;
    return formatHostBashResult(
      {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        timedOut: result.timedOut,
        durationMs,
        cwd,
      },
      sandbox ?? undefined,
    );
  } catch (error) {
    return errorResponse('Error running host-tool bash: the command could not be started.');
  }
}

export async function handleHostBash(
  ctx: SessionToolContext,
  args: HostBashArgs,
): Promise<ToolResult> {
  const cwd = ctx.workingDirectory || ctx.workspacePath;
  return runHostBash({
    command: args.command,
    cwd,
    workspaceRoot: ctx.workspacePath,
    timeoutMs: args.timeoutMs,
    envProvider: ctx.getHostBashEnv,
  });
}

function formatHostBashResult(result: HostBashExecResult, sandbox?: HostBashSandboxPlan): ToolResult {
  const stdout = result.stdoutTruncated
    ? { text: result.stdout, truncated: true }
    : truncateOutput(result.stdout);
  const stderr = result.stderrTruncated
    ? { text: result.stderr, truncated: true }
    : truncateOutput(result.stderr);
  const lines: string[] = [
    `exitCode: ${result.exitCode ?? 'null'}`,
    `durationMs: ${result.durationMs}`,
    `timedOut: ${result.timedOut}`,
    `cwd: ${result.cwd}`,
  ];
  if (sandbox) {
    lines.push(
      `filesystemIsolation: ${sandbox.filesystem.status}`,
      `filesystemBackend: ${sandbox.filesystem.backend}`,
      `networkIsolation: ${sandbox.network.status}`,
      `networkBackend: ${sandbox.network.backend}`,
    );
  }

  if (stdout.text.length > 0) {
    lines.push('', 'stdout:', stdout.text);
    if (stdout.truncated) {
      lines.push(`\n[stdout truncated to ${HOST_BASH_MAX_OUTPUT_CHARS} characters]`);
    }
  }
  if (stderr.text.length > 0) {
    lines.push('', 'stderr:', stderr.text);
    if (stderr.truncated) {
      lines.push(`\n[stderr truncated to ${HOST_BASH_MAX_OUTPUT_CHARS} characters]`);
    }
  }

  if (result.timedOut || result.exitCode !== 0) {
    return errorResponse(lines.join('\n'));
  }
  return successResponse(lines.join('\n'));
}
