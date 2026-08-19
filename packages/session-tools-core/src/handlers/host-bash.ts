import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';
import { createSanitizedEnv } from '../runtime/sandbox-env.ts';

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

function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      process.kill(pid, 'SIGKILL');
      return;
    }
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already dead */
    }
  }
}

function resolveShell(): { command: string; argsPrefix: string[] } {
  if (process.platform === 'win32') {
    return { command: 'bash', argsPrefix: ['-lc'] };
  }
  return { command: '/bin/bash', argsPrefix: ['-lc'] };
}

/**
 * Craft-executed host-tool Bash.
 *
 * This is the TS precondition for later `craft-exec`: OMP (and any other
 * `set_host_tools` backend) must call into craft instead of spawning Bash
 * inside the backend. Caps here are stdout size, wall-clock timeout,
 * process-tree kill, and credential env scrubbing — not a full sandbox.
 */
export async function handleHostBash(
  ctx: SessionToolContext,
  args: HostBashArgs,
): Promise<ToolResult> {
  const command = typeof args.command === 'string' ? args.command.trim() : '';
  if (!command) {
    return errorResponse('bash requires a non-empty command.');
  }

  const cwd = ctx.workingDirectory || ctx.workspacePath;
  if (!cwd) {
    return errorResponse('bash requires a workspace working directory.');
  }
  if (!existsSync(cwd)) {
    return errorResponse(`bash working directory does not exist: ${cwd}`);
  }

  const timeoutMs = Math.min(
    Math.max(args.timeoutMs ?? HOST_BASH_DEFAULT_TIMEOUT_MS, 1),
    HOST_BASH_MAX_TIMEOUT_MS,
  );
  const env = createSanitizedEnv();
  const shell = resolveShell();
  const memoryCap = HOST_BASH_MAX_OUTPUT_CHARS * 2;

  const startedAt = Date.now();
  try {
    const result = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
      timedOut: boolean;
    }>((resolvePromise, reject) => {
      const child = spawn(shell.command, [...shell.argsPrefix, command], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const pid = child.pid;

      const killTimer = setTimeout(() => {
        timedOut = true;
        if (typeof pid === 'number') killProcessTree(pid);
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < memoryCap) stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < memoryCap) stderr += chunk.toString();
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);
        resolvePromise({ stdout, stderr, code, timedOut });
      });
      child.on('error', (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
    });

    const durationMs = Date.now() - startedAt;
    const stdout = truncateOutput(result.stdout);
    const stderr = truncateOutput(result.stderr);
    const lines: string[] = [
      `exitCode: ${result.code ?? 'null'}`,
      `durationMs: ${durationMs}`,
      `timedOut: ${result.timedOut}`,
      `cwd: ${cwd}`,
    ];

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

    if (result.timedOut || result.code !== 0) {
      return errorResponse(lines.join('\n'));
    }
    return successResponse(lines.join('\n'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Error running host-tool bash: ${msg}`);
  }
}
