import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionJsonl, readSessionMessages } from '../jsonl.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function header(id: string, messageCount: number) {
  return {
    id,
    workspaceRootPath: '/tmp/ws',
    createdAt: 1,
    lastUsedAt: 2,
    messageCount,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      contextTokens: 0,
    },
  };
}

function message(id: string, content: string) {
  return { id, type: 'user', content, timestamp: 1 };
}

describe('session jsonl crash recovery (characterization)', () => {
  it('keeps complete messages when the last line is truncated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jsonl-trunc-'));
    tempDirs.push(dir);
    const file = join(dir, 'session.jsonl');
    const complete = [
      JSON.stringify(header('s-trunc', 2)),
      JSON.stringify(message('m1', 'first')),
      JSON.stringify(message('m2', 'second')),
    ].join('\n');
    writeFileSync(file, `${complete}\n{"id":"m3","type":"user","content":"cut`, 'utf-8');

    const loaded = readSessionJsonl(file);
    expect(loaded).not.toBeNull();
    expect(loaded?.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(readSessionMessages(file).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('returns null when the header line itself is truncated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jsonl-bad-header-'));
    tempDirs.push(dir);
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, '{"id":"s-bad","workspaceRootPath":', 'utf-8');
    expect(readSessionJsonl(file)).toBeNull();
  });

  it('ignores leftover session.jsonl.tmp and reads the committed file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jsonl-tmp-'));
    tempDirs.push(dir);
    const file = join(dir, 'session.jsonl');
    writeFileSync(
      file,
      `${JSON.stringify(header('s-tmp', 1))}\n${JSON.stringify(message('m1', 'kept'))}\n`,
      'utf-8',
    );
    writeFileSync(`${file}.tmp`, '{"id":"garbage"\n', 'utf-8');
    const loaded = readSessionJsonl(file);
    expect(loaded?.id).toBe('s-tmp');
    expect(loaded?.messages.map((m) => m.id)).toEqual(['m1']);
  });
});
