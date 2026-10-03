import { spawn } from 'node:child_process';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';
import { createSanitizedEnv } from '../runtime/sandbox-env.ts';
import { resolveHostBashCwd } from '../runtime/host-bash-cwd.ts';
import { getHostBashPort, type HostBashExecResult } from '../runtime/host-bash-port.ts';
import { HOST_BASH_KILL_GRACE_MS, killHostBashProcessTree, resolveHostBashShell } from '../runtime/host-bash-process.ts';
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
  envProvider?: SessionToolContext['getHostBashEnv'];
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

  const timeoutMs = Math.min(
    Math.max(req.timeoutMs ?? HOST_BASH_DEFAULT_TIMEOUT_MS, 1),
    HOST_BASH_MAX_TIMEOUT_MS,
  );

  const sandboxEnabled = isHostBashSandboxEnabled();
  const port = getHostBashPort();
  // Legacy native exec has no environment contract. Never silently drop the
  // host's managed runtime environment by delegating such calls to that port.
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

  let env: NodeJS.ProcessEnv;
  try {
    env = createSanitizedEnv(req.envProvider ? await req.envProvider() : process.env);
  } catch (error) {
    return errorResponse(`Error resolving host-tool bash environment: ${error instanceof Error ? error.message : String(error)}`);
  }
  let shell: ReturnType<typeof resolveHostBashShell>;
  try {
    shell = resolveHostBashShell(env);
  } catch (error) {
    return errorResponse(`Error running host-tool bash: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Windows' managed Python is python.exe; PATH alone cannot make python3
  // resolve to it. The trusted host provider supplies this explicit binding.
  const pythonBinding = process.platform === 'win32' && env.CRAFT_HOST_BASH_PYTHON
    ? 'python3() { "$CRAFT_HOST_BASH_PYTHON" "$@"; }; export -f python3\n'
    : '';
  const shellArgs = [...shell.argsPrefix, pythonBinding + command];
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

  const startedAt = Date.now();
  try {
    const result = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
      timedOut: boolean;
    }>((resolvePromise, reject) => {
      const child = spawn(spawnCommand, spawnArgs, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const pid = child.pid;
      let cleanup: Promise<void> | undefined;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

      const finishTimeout = () => {
        clearTimeout(cleanupTimer);
        // 'exit' is not 'close': an orphan can still hold these handles. After
        // bounded tree cleanup, release our pipe ends and settle explicitly.
        child.stdout.destroy();
        child.stderr.destroy();
        resolvePromise({ stdout, stderr, code: child.exitCode, timedOut: true });
      };

      const killTimer = setTimeout(() => {
        timedOut = true;
        cleanupTimer = setTimeout(finishTimeout, HOST_BASH_KILL_GRACE_MS);
        cleanup = typeof pid === 'number' ? killHostBashProcessTree(pid, startedAt) : Promise.resolve();
        void cleanup.then(finishTimeout, finishTimeout);
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < memoryCap) stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < memoryCap) stderr += chunk.toString();
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);
        // Wait for descendant cleanup even if the root's pipes close first.
        if (!timedOut) resolvePromise({ stdout, stderr, code, timedOut });
      });
      child.on('error', (err) => {
        clearTimeout(killTimer);
        clearTimeout(cleanupTimer);
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
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Error running host-tool bash: ${msg}`);
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
