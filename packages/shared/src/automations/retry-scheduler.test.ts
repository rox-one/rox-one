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

function failResult(): WebhookActionResult {
  return {
    type: 'webhook',
    url: 'https://example.com/hook',
    statusCode: 500,
    success: false,
    error: 'remote 500',
    durationMs: 1,
  };
}

function throwOnceBeforeAck(): { beforeAck: () => Promise<void>; crashes: () => number } {
  let crashes = 0;
  return {
    crashes: () => crashes,
    beforeAck: async () => {
      if (crashes === 0) {
        crashes += 1;
        throw new Error('simulated crash after effect before ack');
      }
    },
  };
}

function readHistory(dir: string): string {
  try {
    return readFileSync(join(dir, AUTOMATIONS_HISTORY_FILE), 'utf-8');
  } catch {
    return '';
  }
}

function successHistoryCount(dir: string): number {
  return readHistory(dir)
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      try {
        return (JSON.parse(line) as { ok?: boolean }).ok === true;
      } catch {
        return false;
      }
    }).length;
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
      bootstrapDelayMs: 30,
      tickIntervalMs: 60_000,
    });
    scheduler.start();
    scheduler.start();
    scheduler.dispose();
    scheduler.start();
    await Bun.sleep(80);
    expect(calls).toBe(1);
    scheduler.dispose();
    await Bun.sleep(80);
    expect(calls).toBe(1);
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
    expect(successHistoryCount(dir)).toBe(0);
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

  // Effect (HTTP) then ack (atomic rewrite) then history. Same-process pending
  // acks prevent a duplicate fire when the rewrite crashes. History is not
  // written until ack succeeds, so a crash cannot leave ok:true with the queue
  // row still present. Process restart loses those acks; the JSONL row is the
  // recoverability source of truth (at-least-once). Multi-worker / multi-process
  // ownership of one queue file is unsupported.

  it('same-process crash after effect before ack does not duplicate fire and stays recoverable until ack', async () => {
    const dir = tmp();
    let calls = 0;
    const { beforeAck, crashes } = throwOnceBeforeAck();
    const executeRequest: RetryExecuteRequest = async () => {
      calls += 1;
      return okResult();
    };
    writeQueue(dir, [dueEntry('due-1')]);
    const scheduler = new RetryScheduler({
      workspaceRootPath: dir,
      executeRequest,
      beforeAck,
      bootstrapDelayMs: 60_000,
    });

    await scheduler.tick();
    expect(crashes()).toBe(1);
    expect(calls).toBe(1);
    expect(readQueue(dir).map((e) => e.id)).toEqual(['due-1']);
    expect(successHistoryCount(dir)).toBe(0);

    await scheduler.tick();
    expect(calls).toBe(1);
    expect(readQueue(dir)).toEqual([]);
    expect(successHistoryCount(dir)).toBe(1);
    scheduler.dispose();
  });

  it('process restart after crash before ack has no success history and stays recoverable (at-least-once)', async () => {
    const dir = tmp();
    let callsA = 0;
    const executeA: RetryExecuteRequest = async () => {
      callsA += 1;
      return okResult();
    };
    writeQueue(dir, [dueEntry('due-1')]);
    const crashed = new RetryScheduler({
      workspaceRootPath: dir,
      executeRequest: executeA,
      beforeAck: async () => {
        throw new Error('simulated process crash after effect before ack');
      },
      bootstrapDelayMs: 60_000,
    });
    await crashed.tick();
    crashed.dispose();
    expect(callsA).toBe(1);
    expect(readQueue(dir).map((e) => e.id)).toEqual(['due-1']);
    expect(successHistoryCount(dir)).toBe(0);

    let callsB = 0;
    const recovered = new RetryScheduler({
      workspaceRootPath: dir,
      executeRequest: async () => {
        callsB += 1;
        return okResult();
      },
      bootstrapDelayMs: 60_000,
    });
    await recovered.tick();
    expect(callsB).toBe(1);
    expect(readQueue(dir)).toEqual([]);
    expect(successHistoryCount(dir)).toBe(1);
    recovered.dispose();
  });

  it('ack crash after a failed effect does not re-fire HTTP and persists the deferred attempt', async () => {
    const dir = tmp();
    let calls = 0;
    const { beforeAck } = throwOnceBeforeAck();
    const executeRequest: RetryExecuteRequest = async () => {
      calls += 1;
      return failResult();
    };
    writeQueue(dir, [dueEntry('due-1')]);
    const scheduler = new RetryScheduler({
      workspaceRootPath: dir,
      executeRequest,
      beforeAck,
      bootstrapDelayMs: 60_000,
    });

    await scheduler.tick();
    expect(calls).toBe(1);
    const afterCrash = readQueue(dir);
    expect(afterCrash).toHaveLength(1);
    expect(afterCrash[0]?.id).toBe('due-1');
    expect(afterCrash[0]?.deferredAttempt).toBe(0);

    await scheduler.tick();
    expect(calls).toBe(1);
    const queued = readQueue(dir);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.id).toBe('due-1');
    expect(queued[0]?.deferredAttempt).toBe(1);
    expect(queued[0]?.nextRetryAt).toBeGreaterThan(Date.now());
    scheduler.dispose();
  });
});
