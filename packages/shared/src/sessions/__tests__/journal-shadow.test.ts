import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionJsonl } from '../jsonl.ts';
import { setSessionJournalShadow } from '../journal-shadow.ts';
import { SessionPersistenceQueue } from '../persistence-queue.ts';
import type { StoredSession } from '../types.ts';

const dirs: string[] = [];

afterEach(() => {
  setSessionJournalShadow(null);
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
    messages: [
      { id: 'm1', type: 'user', content: 'hello', timestamp: 1 },
    ],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
}

describe('session journal dual-write hook', () => {
  it('notifies after persistence-queue flush', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'journal-shadow-q-'));
    dirs.push(workspace);
    mkdirSync(join(workspace, 'sessions', 's1'), { recursive: true });
    const seen: Array<{ sessionDir: string; lines: string[] }> = [];
    setSessionJournalShadow((args) => {
      seen.push(args);
    });
    const queue = new SessionPersistenceQueue(0);
    queue.enqueue(session('s1', workspace));
    await queue.flush('s1');
    const mine = seen.find((entry) => {
      try {
        return JSON.parse(entry.lines[0] ?? '{}').id === 's1';
      } catch {
        return false;
      }
    });
    expect(mine).toBeDefined();
    expect(mine?.sessionDir).toBe(join(workspace, 'sessions', 's1'));
    expect(mine!.lines.some((line) => line.includes('hello'))).toBe(true);
  });

  it('notifies after writeSessionJsonl', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'journal-shadow-w-'));
    dirs.push(workspace);
    const sessionDir = join(workspace, 'sessions', 's2');
    mkdirSync(sessionDir, { recursive: true });
    const seen: string[][] = [];
    setSessionJournalShadow(({ lines }) => {
      seen.push(lines);
    });
    writeSessionJsonl(join(sessionDir, 'session.jsonl'), session('s2', workspace));
    const mine = seen.find((lines) => {
      try {
        return JSON.parse(lines[0] ?? '{}').id === 's2';
      } catch {
        return false;
      }
    });
    expect(mine).toBeDefined();
  });
});
