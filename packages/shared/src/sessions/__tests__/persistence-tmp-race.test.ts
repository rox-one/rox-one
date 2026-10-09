/**
 * Regression: a session write must survive crash-recovery running in the same
 * window. Writers used a fixed `session.jsonl.tmp`, so recovery (which unlinks
 * `dest + '.tmp'`) could delete the writer's in-flight tmp between writeFile and
 * rename, making the rename throw ENOENT and silently dropping the write.
 *
 * Run by scripts/test-all.ts in its own process, so mock.module cannot leak.
 */
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredSession } from '../types.ts';

// Module-loading-boundary exception: snapshot the REAL fs exports before the
// mock installs, then load modules under test afterwards. Static imports cannot
// order themselves around mock.module.
const realFsPromises = { ...(await import('fs/promises')) };
const realNodeFsPromises = { ...(await import('node:fs/promises')) };
const { writeFile: realWriteFile } = realFsPromises;

// Synchronous reader invoked from inside the writer's writeFile window.
let raceHook: (() => void) | null = null;

// Optional gate: blocks a writer's .tmp writeFile until released, and signals
// when the writer has reached that point. Lets a test hold an in-flight write
// open while exercising cancel/delete ordering, without real timers.
let writeGate: { blocked: Promise<void>; reached: Promise<void>; release: () => void; signalReached: () => void } | null = null;

type WriteFileArgs = Parameters<typeof realWriteFile>;

function withWriteFileHook<T extends object>(real: T) {
  return {
    ...real,
    writeFile: async (...args: WriteFileArgs) => {
      const [path] = args;
      if (writeGate && String(path).endsWith('.tmp')) {
        writeGate.signalReached();
        await writeGate.blocked;
      }
      const result = await realWriteFile(...args);
      if (raceHook && String(path).endsWith('.tmp')) raceHook();
      return result;
    },
  };
}

mock.module('fs/promises', () => withWriteFileHook(realFsPromises));
mock.module('node:fs/promises', () => withWriteFileHook(realNodeFsPromises));

const { SessionPersistenceQueue } = await import('../persistence-queue.ts');
const { loadSession, listSessions } = await import('../storage.ts');
const { readSessionJsonl } = await import('../jsonl.ts');

const dirs: string[] = [];

afterEach(() => {
  raceHook = null;
  writeGate = null;
  for (const dir of dirs.splice(0)) {
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

function makeWorkspace(prefix: string, sessionId: string) {
  const workspace = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(workspace);
  const sessionDir = join(workspace, 'sessions', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const dest = join(sessionDir, 'session.jsonl');
  return { workspace, sessionDir, dest, tmp: dest + '.tmp' };
}

function storedSession(id: string, workspaceRootPath: string, messages: StoredSession['messages']): StoredSession {
  return {
    id,
    workspaceRootPath,
    createdAt: 1,
    lastUsedAt: 2,
    lastMessageAt: 2,
    messages,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  };
}

describe('session tmp race: recovery vs writer', () => {
  it('does not delete a fresh in-flight tmp while dest exists (old fixed-name recovery did)', () => {
    const { workspace, dest, tmp } = makeWorkspace('session-fresh-tmp-', 's-fresh');
    writeJournal(dest, 's-fresh', [{ id: 'committed', content: 'committed' }]);
    // Simulate writers having just written a legacy AND a unique tmp microseconds ago.
    writeJournal(tmp, 's-fresh', [{ id: 'in-flight-legacy', content: 'in-flight-legacy' }]);
    const uniqueTmp = dest + '.4242.abcdefabcdef.tmp';
    writeJournal(uniqueTmp, 's-fresh', [{ id: 'in-flight-unique', content: 'in-flight-unique' }]);
    expect(Date.now() - statSync(tmp).mtimeMs).toBeLessThan(5000);
    expect(Date.now() - statSync(uniqueTmp).mtimeMs).toBeLessThan(5000);

    listSessions(workspace); // synchronous reader
    loadSession(workspace, 's-fresh');

    // OLD CODE (unconditional unlinkSync(dest.tmp)) deleted this -> rename would ENOENT.
    expect(existsSync(tmp)).toBe(true);
    expect(existsSync(uniqueTmp)).toBe(true);
    expect(readSessionJsonl(dest)?.messages.map((m) => m.id)).toEqual(['committed']);
  });

  it('still reaps an aged orphan tmp when dest exists', () => {
    const { workspace, dest, tmp } = makeWorkspace('session-aged-tmp-', 's-aged');
    writeJournal(dest, 's-aged', [{ id: 'committed', content: 'committed' }]);
    writeFileSync(tmp, '{"id":"garbage"\n', 'utf-8');
    const uniqueTmp = dest + '.4242.abcdefabcdef.tmp';
    writeFileSync(uniqueTmp, '{"id":"garbage"\n', 'utf-8');
    const stale = (Date.now() - 60_000) / 1000;
    utimesSync(tmp, stale, stale);
    utimesSync(uniqueTmp, stale, stale);

    listSessions(workspace);

    expect(existsSync(tmp)).toBe(false);
    expect(existsSync(uniqueTmp)).toBe(false);
    expect(existsSync(dest)).toBe(true);
  });

  it('a real persistence-queue write wins over a synchronous reader in the write window', async () => {
    const id = 's-race';
    const { workspace, dest } = makeWorkspace('session-race-', id);
    writeJournal(dest, id, [{ id: 'old', content: 'old' }]);

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

    let readerRuns = 0;
    const queue = new SessionPersistenceQueue(0);
    raceHook = () => { readerRuns += 1; loadSession(workspace, id); };
    try {
      queue.enqueue(storedSession(id, workspace, [{ id: 'm-new', type: 'user', content: 'new', timestamp: 2 }]));
      await queue.flush(id);
    } finally {
      raceHook = null;
      errorSpy.mockRestore();
    }

    // The reader really did run inside the writer's writeFile window.
    expect(readerRuns).toBeGreaterThan(0);
    const persisted = readSessionJsonl(dest);
    expect(persisted?.messages.map((m) => m.id)).toEqual(['m-new']);
    expect(errorSpy.mock.calls.filter((args) => String(args[0]).includes('Failed to write session'))).toHaveLength(0);
  });

  it('uses a unique tmp name per write, never the fixed session.jsonl.tmp', async () => {
    const id = 's-name';
    const { workspace, sessionDir, dest } = makeWorkspace('session-tmp-name-', id);
    // Occupy dest with a directory so the final rename fails and leaves the tmp
    // on disk for inspection.
    mkdirSync(dest);

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const queue = new SessionPersistenceQueue(0);
      queue.enqueue(storedSession(id, workspace, [{ id: 'm1', type: 'user', content: 'x', timestamp: 1 }]));
      // C-02 contract: a failed write is surfaced by flush() as a rejection
      // (throwIfWriteFailed) instead of resolving silently. Occupying dest with
      // a directory forces the final rename to fail, which both exercises that
      // rejection and leaves the writer's tmp on disk for the naming assertions.
      const failure = await queue.flush(id).then(
        () => { throw new Error('expected flush() to reject when the write fails'); },
        (error: NodeJS.ErrnoException) => error,
      );
      expect(typeof failure?.code).toBe('string');
    } finally {
      errorSpy.mockRestore();
    }

    const tmps = readdirSync(sessionDir).filter((n) => n.endsWith('.tmp'));
    expect(tmps).toHaveLength(1);
    expect(tmps[0]).not.toBe('session.jsonl.tmp');
    expect(tmps[0]).toMatch(/^session\.jsonl\.\d+\.[0-9a-f]{12}\.tmp$/);
    expect(readFileSync(join(sessionDir, tmps[0]!), 'utf8')).toContain('"m1"');
  });
});

describe('session delete vs in-flight write (durability)', () => {
  it('cancel awaits the in-flight write, so a later delete cannot be resurrected', async () => {
    const id = 's-cancel';
    const { workspace, sessionDir, dest } = makeWorkspace('session-cancel-', id);
    writeJournal(dest, id, [{ id: 'old', content: 'old' }]);

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    let releaseGate!: () => void;
    let signalReached!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseGate = resolve; });
    const reached = new Promise<void>((resolve) => { signalReached = resolve; });
    writeGate = { blocked, reached, release: releaseGate, signalReached };
    const queue = new SessionPersistenceQueue(0);
    try {
      queue.enqueue(storedSession(id, workspace, [{ id: 'm-new', type: 'user', content: 'new', timestamp: 2 }]));
      // The writer is now parked inside writeFile(.tmp) — genuinely in flight.
      await reached;

      let cancelResolved = false;
      const cancelPromise = queue.cancel(id).then(() => { cancelResolved = true; });
      // Old cancel() returned synchronously; the new one must wait for the write.
      expect(cancelResolved).toBe(false);

      releaseGate();
      await cancelPromise;
      expect(cancelResolved).toBe(true);
      // The in-flight write landed BEFORE cancel resolved, so deleteStoredSession
      // (which runs after `await cancel`) removes it instead of racing it.
      expect(readSessionJsonl(dest)?.messages.map((m) => m.id)).toEqual(['m-new']);

      // Simulate deleteStoredSession.
      rmSync(sessionDir, { recursive: true, force: true });
      expect(existsSync(dest)).toBe(false);

      // A late enqueue (fs.watch metadata echo / debounced timer) must be dropped.
      queue.enqueue(storedSession(id, workspace, [{ id: 'echo', type: 'user', content: 'echo', timestamp: 3 }]));
      expect(queue.hasPending(id)).toBe(false);
      await queue.flush(id);
      expect(existsSync(dest)).toBe(false);
    } finally {
      writeGate = null;
      errorSpy.mockRestore();
    }
  });

  it('cancel seals the session even with no in-flight write', async () => {
    const id = 's-seal';
    const { workspace, dest } = makeWorkspace('session-seal-', id);
    const queue = new SessionPersistenceQueue(0);

    await queue.cancel(id);
    queue.enqueue(storedSession(id, workspace, [{ id: 'm', type: 'user', content: 'm', timestamp: 1 }]));
    expect(queue.hasPending(id)).toBe(false);
    await queue.flush(id);
    expect(existsSync(dest)).toBe(false);
  });
});