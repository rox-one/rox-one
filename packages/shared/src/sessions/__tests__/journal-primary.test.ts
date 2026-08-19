import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionPersistenceQueue } from '../persistence-queue.ts';
import { setSessionJournalPrimary } from '../journal-primary.ts';
import type { StoredSession } from '../types.ts';

const dirs: string[] = [];

afterEach(() => {
  setSessionJournalPrimary(null);
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function session(id: string, workspaceRootPath: string): StoredSession {
  return {
    id,
    workspaceRootPath,
    createdAt: 1,
    lastUsedAt: 2,
    lastMessageAt: 2,
    messages: [{ id: 'm1', type: 'user', content: 'hello-primary', timestamp: 1 }],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
}

describe('session journal primary writer', () => {
  it('skips the TS write when the primary hook writes session.jsonl', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'journal-primary-'));
    dirs.push(workspace);
    mkdirSync(join(workspace, 'sessions', 's1'), { recursive: true });
    const filePath = join(workspace, 'sessions', 's1', 'session.jsonl');
    setSessionJournalPrimary(async ({ sessionDir, lines }) => {
      expect(sessionDir).toBe(join(workspace, 'sessions', 's1'));
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(sessionDir, 'session.jsonl'), `PRIMARY\n${lines.join('\n')}\n`);
      return true;
    });
    const queue = new SessionPersistenceQueue(0);
    queue.enqueue(session('s1', workspace));
    await queue.flush('s1');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toContain('PRIMARY');
    expect(readFileSync(filePath, 'utf8')).toContain('hello-primary');
  });

  it('falls back to the TS write when the primary hook fails', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'journal-primary-fb-'));
    dirs.push(workspace);
    mkdirSync(join(workspace, 'sessions', 's2'), { recursive: true });
    const filePath = join(workspace, 'sessions', 's2', 'session.jsonl');
    setSessionJournalPrimary(async () => {
      throw new Error('sidecar down');
    });
    const queue = new SessionPersistenceQueue(0);
    queue.enqueue(session('s2', workspace));
    await queue.flush('s2');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toContain('hello-primary');
    expect(readFileSync(filePath, 'utf8')).not.toContain('PRIMARY');
  });
});
