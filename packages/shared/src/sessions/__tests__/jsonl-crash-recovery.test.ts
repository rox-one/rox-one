import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionJsonl, readSessionMessages } from '../jsonl.ts';
import { listSessions, loadSession } from '../storage.ts';

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

function writeJournal(file: string, id: string, messages: Array<{ id: string; content: string }>) {
  const lines = [
    JSON.stringify(header(id, messages.length)),
    ...messages.map((m) => JSON.stringify(message(m.id, m.content))),
  ];
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');
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

describe('session journal crash recovery (load / list)', () => {
  function makeWorkspace(prefix: string, sessionId: string) {
    const workspace = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(workspace);
    const sessionDir = join(workspace, 'sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const dest = join(sessionDir, 'session.jsonl');
    return { workspace, dest, tmp: dest + '.tmp' };
  }

  it('promotes a complete session.jsonl.tmp when dest is missing', () => {
    const { workspace, dest, tmp } = makeWorkspace('jsonl-promote-', 's-promote');
    writeJournal(tmp, 's-promote', [{ id: 'm1', content: 'recovered' }]);
    expect(existsSync(dest)).toBe(false);

    const listed = listSessions(workspace);
    expect(listed.map((s) => s.id)).toContain('s-promote');
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(tmp)).toBe(false);

    const loaded = loadSession(workspace, 's-promote');
    expect(loaded?.id).toBe('s-promote');
    expect(loaded?.messages.map((m) => m.id)).toEqual(['m1']);
    expect(loaded?.messages[0]?.content).toBe('recovered');
  });

  it('loadSession promotes dest-missing tmp without listSessions first', () => {
    const { workspace, dest, tmp } = makeWorkspace('jsonl-load-promote-', 's-load');
    writeJournal(tmp, 's-load', [{ id: 'm1', content: 'from-tmp' }]);
    expect(existsSync(dest)).toBe(false);

    const loaded = loadSession(workspace, 's-load');
    expect(loaded?.id).toBe('s-load');
    expect(loaded?.messages.map((m) => m.id)).toEqual(['m1']);
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(tmp)).toBe(false);
  });

  it('promotes a unique-named session.jsonl.<pid>.<hex>.tmp when dest is missing', () => {
    const { workspace, dest } = makeWorkspace('jsonl-promote-unique-', 's-promote-unique');
    const tmp = dest + '.1234.abcdefabcdef.tmp';
    writeJournal(tmp, 's-promote-unique', [{ id: 'm1', content: 'recovered-unique' }]);
    expect(existsSync(dest)).toBe(false);

    const loaded = loadSession(workspace, 's-promote-unique');
    expect(loaded?.id).toBe('s-promote-unique');
    expect(loaded?.messages.map((m) => m.id)).toEqual(['m1']);
    expect(loaded?.messages[0]?.content).toBe('recovered-unique');
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(tmp)).toBe(false);
  });

  it('promotes the newest valid tmp when several candidates exist', () => {
    const { workspace, dest } = makeWorkspace('jsonl-promote-newest-', 's-newest');
    const older = dest + '.1111.aaaaaaaaaaaa.tmp';
    const newer = dest + '.2222.bbbbbbbbbbbb.tmp';
    writeJournal(older, 's-newest', [{ id: 'old', content: 'old' }]);
    writeJournal(newer, 's-newest', [{ id: 'new', content: 'new' }]);
    const past = (Date.now() - 60_000) / 1000;
    utimesSync(older, past, past);

    const loaded = loadSession(workspace, 's-newest');
    expect(loaded?.messages.map((m) => m.id)).toEqual(['new']);
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(newer)).toBe(false);
    expect(existsSync(older)).toBe(true); // only the promoted tmp is consumed
  });

  it('listSessions deletes leftover tmp when dest is already present', () => {
    const { workspace, dest, tmp } = makeWorkspace('jsonl-cleanup-', 's-keep');
    writeJournal(dest, 's-keep', [{ id: 'm1', content: 'committed' }]);
    writeFileSync(tmp, '{"id":"garbage"\n', 'utf-8');
    // Recovery only reaps an AGED orphan; a fresh tmp may be an in-flight write.
    const stale = (Date.now() - 60_000) / 1000;
    utimesSync(tmp, stale, stale);

    const listed = listSessions(workspace);
    expect(listed.map((s) => s.id)).toContain('s-keep');
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(tmp)).toBe(false);

    const loaded = loadSession(workspace, 's-keep');
    expect(loaded?.messages.map((m) => m.id)).toEqual(['m1']);
    expect(loaded?.messages[0]?.content).toBe('committed');
  });

  it('does not delete a tmp that is the only copy even if the header is unreadable', () => {
    const { workspace, dest, tmp } = makeWorkspace('jsonl-keep-tmp-', 's-orphan');
    writeFileSync(tmp, '{"id":"s-orphan","workspaceRootPath":', 'utf-8');
    expect(existsSync(dest)).toBe(false);

    expect(listSessions(workspace).map((s) => s.id)).not.toContain('s-orphan');
    expect(loadSession(workspace, 's-orphan')).toBeNull();
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(tmp)).toBe(true);
  });
});
