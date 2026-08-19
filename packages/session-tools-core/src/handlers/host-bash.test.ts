import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { handleHostBash } from './host-bash.ts';
import { setHostBashPort } from '../runtime/host-bash-port.ts';

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
    const result = await handleHostBash(ctx({ workingDirectory: inner }), { command: 'pwd' });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain(inner);
  });

  it('rejects a blank command', async () => {
    const result = await handleHostBash(ctx(), { command: '   ' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('non-empty command');
  });

  it('runs in the workspace cwd and captures stdout', async () => {
    const result = await handleHostBash(ctx(), { command: 'pwd && echo host-bash-ok' });
    expect(result.isError).toBe(false);
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
});
