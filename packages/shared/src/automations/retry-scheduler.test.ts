import { afterEach, describe, expect, it, jest } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RetryScheduler, type RetryExecuteRequest, type RetryQueueEntry } from './retry-scheduler.ts';
import { AUTOMATIONS_HISTORY_FILE, AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts';
import type { WebhookAction, WebhookActionResult } from './types.ts';

function action(url = 'https://example.com/hook'): WebhookAction {
  return { type: 'webhook', url, method: 'POST' };
}

function dueEntry(id: string, matcherId = 'm1'): RetryQueueEntry {
  return {
    id,
    matcherId,
    action: action(),
    expandedUrl: 'https://example.com/hook',
    deferredAttempt: 0,
    nextRetryAt: Date.now() - 1,
    createdAt: Date.now() - 60_000,
  };
}

function writeQueue(dir: string, entries: RetryQueueEntry[]): void {
  const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
  writeFileSync(join(dir, AUTOMATIONS_RETRY_QUEUE_FILE), body, 'utf-8');
}

function readQueue(dir: string): RetryQueueEntry[] {
  try {
    return readFileSync(join(dir, AUTOMATIONS_RETRY_QUEUE_FILE), 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RetryQueueEntry);
  } catch {
    return [];
  }
}

function okResult(): WebhookActionResult {
  return { type: 'webhook', url: 'https://example.com/hook', statusCode: 200, success: true, durationMs: 1 };
}

describe('RetryScheduler', () => {
  const dirs: string[] = [];

  afterEach(() => {
    jest.useRealTimers();
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'retry-scheduler-'));
    dirs.push(dir);
    return dir;
  }

  it('dispose before bootstrap delay never starts fetch', async () => {
    const dir = tmp();
    let calls = 0;
    const executeRequest: RetryExecuteRequest = async () => {
      calls += 1;
      return okResult();
    };
    writeQueue(dir, [dueEntry('due-1')]);
    const scheduler = new RetryScheduler({ workspaceRootPath: dir, executeRequest });
    jest.useFakeTimers();
    scheduler.start();
    scheduler.dispose();
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(calls).toBe(0);
    expect(readQueue(dir).map((e) => e.id)).toEqual(['due-1']);
  });

  it('restart after dispose does not duplicate timers', async () => {
    const dir = tmp();
    let calls = 0;
    const executeRequest: RetryExecuteRequest = async () => {
      calls += 1;
      return okResult();
    };
    writeQueue(dir, [dueEntry('due-1')]);
    const scheduler = new RetryScheduler({
      workspaceRootPath: dir,
      executeRequest,
      bootstrapDelayMs: 5_000,
      tickIntervalMs: 60_000,
    });
    jest.useFakeTimers();
    scheduler.start();
    scheduler.start();
    scheduler.dispose();
    scheduler.start();
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
    expect(calls).toBe(1);
    scheduler.dispose();
  });

  it('late response after dispose does not write history or drop the queue', async () => {
    const dir = tmp();
    let release!: (value: WebhookActionResult) => void;
    let markStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<WebhookActionResult>((resolve) => {
      release = resolve;
    });
    let seenSignal: AbortSignal | undefined;
    const executeRequest: RetryExecuteRequest = async (_action, options) => {
      seenSignal = options.signal;
      markStarted();
      return gate;
    };
    writeQueue(dir, [dueEntry('due-1')]);
    const scheduler = new RetryScheduler({
      workspaceRootPath: dir,
      executeRequest,
      bootstrapDelayMs: 60_000,
    });
    scheduler.start();
    const ticking = scheduler.tick();
    await fetchStarted;
    scheduler.dispose();
    expect(seenSignal?.aborted).toBe(true);
    release(okResult());
    await ticking;
    expect(readQueue(dir).map((e) => e.id)).toEqual(['due-1']);
    try {
      const history = readFileSync(join(dir, AUTOMATIONS_HISTORY_FILE), 'utf-8');
      expect(history.trim()).toBe('');
    } catch {
      // no history file is also fine
    }
  });

  it('dispose aborts only owned requests, not a sibling scheduler', async () => {
    const dirA = tmp();
    const dirB = tmp();
    const signals: AbortSignal[] = [];
    let markA!: () => void;
    let markB!: () => void;
    const startedA = new Promise<void>((resolve) => {
      markA = resolve;
    });
    const startedB = new Promise<void>((resolve) => {
      markB = resolve;
    });
    let releaseA!: (value: WebhookActionResult) => void;
    const gateA = new Promise<WebhookActionResult>((resolve) => {
      releaseA = resolve;
    });
    let releaseB!: (value: WebhookActionResult) => void;
    const gateB = new Promise<WebhookActionResult>((resolve) => {
      releaseB = resolve;
    });
    const executeA: RetryExecuteRequest = async (_action, options) => {
      signals[0] = options.signal!;
      markA();
      return gateA;
    };
    const executeB: RetryExecuteRequest = async (_action, options) => {
      signals[1] = options.signal!;
      markB();
      return gateB;
    };
    writeQueue(dirA, [dueEntry('a')]);
    writeQueue(dirB, [dueEntry('b')]);
    const schedA = new RetryScheduler({ workspaceRootPath: dirA, executeRequest: executeA, bootstrapDelayMs: 60_000 });
    const schedB = new RetryScheduler({ workspaceRootPath: dirB, executeRequest: executeB, bootstrapDelayMs: 60_000 });
    schedA.start();
    schedB.start();
    const tickA = schedA.tick();
    const tickB = schedB.tick();
    await Promise.all([startedA, startedB]);
    schedA.dispose();
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    releaseA(okResult());
    releaseB(okResult());
    await Promise.all([tickA, tickB]);
    expect(readQueue(dirA).map((e) => e.id)).toEqual(['a']);
    expect(readQueue(dirB)).toEqual([]);
    schedB.dispose();
  });

  it('preserves an enqueue that arrives while a tick fetch is in flight', async () => {
    const dir = tmp();
    let release!: (value: WebhookActionResult) => void;
    let markStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<WebhookActionResult>((resolve) => {
      release = resolve;
    });
    const executeRequest: RetryExecuteRequest = async () => {
      markStarted();
      return gate;
    };
    writeQueue(dir, [dueEntry('due-1')]);
    const scheduler = new RetryScheduler({
      workspaceRootPath: dir,
      executeRequest,
      bootstrapDelayMs: 60_000,
    });
    const ticking = scheduler.tick();
    await fetchStarted;
    await scheduler.enqueue('m2', action('https://example.com/new'), 'https://example.com/new');
    release(okResult());
    await ticking;
    const ids = readQueue(dir).map((e) => e.id);
    expect(ids).not.toContain('due-1');
    expect(ids.length).toBe(1);
    expect(ids[0]).toMatch(/^m2-/);
  });
});
