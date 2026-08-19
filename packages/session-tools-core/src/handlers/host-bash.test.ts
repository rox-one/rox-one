import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { handleHostBash } from './host-bash.ts';

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
});
