/**
 * ADR-0024 §3 limiter: at most n in flight, FIFO start order, a rejection
 * reaches only its caller and does not stall the queue.
 */
import { describe, expect, it } from 'bun:test';
import { limit } from '../limit.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('limit', () => {
  it('never runs more than n functions at once', async () => {
    const run = limit(2);
    const gates = Array.from({ length: 6 }, () => deferred<number>());
    let inFlight = 0;
    let maxInFlight = 0;
    const results = gates.map((gate, index) => run(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await gate.promise;
        return index;
      } finally {
        inFlight--;
      }
    }));

    await flush();
    expect(run.active).toBe(2);
    expect(run.pending).toBe(4);

    for (const gate of gates) {
      gate.resolve(0);
      await flush();
    }
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxInFlight).toBe(2);
    expect(run.active).toBe(0);
    expect(run.pending).toBe(0);
  });

  it('starts queued functions in FIFO order', async () => {
    const run = limit(1);
    const started: string[] = [];
    const first = deferred<void>();
    const all = ['a', 'b', 'c', 'd'].map((name, index) => run(async () => {
      started.push(name);
      if (index === 0) await first.promise;
    }));

    await flush();
    expect(started).toEqual(['a']);
    first.resolve();
    await Promise.all(all);
    expect(started).toEqual(['a', 'b', 'c', 'd']);
  });

  it('propagates a rejection to its caller without stalling the queue', async () => {
    const run = limit(1);
    const [failing, throwingSync, next] = await Promise.allSettled([
      run(async () => {
        throw new Error('boom');
      }),
      run(() => {
        throw new Error('sync boom');
      }),
      run(async () => 'next'),
    ]);

    expect(failing.status === 'rejected' && (failing.reason as Error).message).toBe('boom');
    expect(throwingSync.status === 'rejected' && (throwingSync.reason as Error).message).toBe('sync boom');
    expect(next).toEqual({ status: 'fulfilled', value: 'next' });
    expect(run.active).toBe(0);
  });

  it('rejects a non-positive limit', () => {
    expect(() => limit(0)).toThrow(RangeError);
    expect(() => limit(1.5)).toThrow(RangeError);
  });
});
