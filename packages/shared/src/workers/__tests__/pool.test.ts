/**
 * ADR-0024 WorkerPool, exercised with a real worker_thread fixture
 * (`fixtures/pool-test.worker.ts`, loaded as TS under bun test) and in inline
 * mode. Thread usage is observed through `stats()` and worker `threadId`s.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { join } from 'path';
import { WorkerPool, type WorkerPoolOptions } from '../pool.ts';

const fixture = join(import.meta.dir, 'fixtures', 'pool-test.worker.ts');

let pools: WorkerPool[] = [];

function createPool(options: Partial<WorkerPoolOptions> & { size: number }): WorkerPool {
  const pool = new WorkerPool({ script: fixture, ...options });
  pools.push(pool);
  return pool;
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

afterEach(async () => {
  await Promise.all(pools.map(pool => pool.close()));
  pools = [];
});

describe('WorkerPool (worker threads)', () => {
  it('starts no thread before the first task and returns results', async () => {
    const pool = createPool({ size: 2 });
    expect(pool.stats().threads).toBe(0);
    expect(await Promise.all([pool.run<number>('double', 21), pool.run<number>('double', 5)])).toEqual([42, 10]);
    expect(pool.stats()).toMatchObject({ size: 2, busy: 0, queued: 0, completed: 2, failed: 0 });
  });

  it('never uses more threads than its size', async () => {
    const pool = createPool({ size: 2 });
    const pending = Array.from({ length: 6 }, () => pool.run<number>('threadId', { delayMs: 20 }));
    expect(pool.stats().threads).toBe(2);
    expect(pool.stats().busy).toBe(2);
    expect(pool.stats().queued).toBe(4);
    const ids = await Promise.all(pending);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(0);
    expect(pool.stats().threads).toBe(2);
    expect(pool.stats().completed).toBe(6);
  });

  it('rejects only the failing task', async () => {
    const pool = createPool({ size: 1 });
    const failing = pool.run('fail', 'bad input');
    const next = pool.run<number>('double', 4);
    const error = await failing.catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('FixtureError');
    expect((error as Error).message).toBe('bad input');
    expect(await next).toBe(8);
    expect(pool.stats()).toMatchObject({ threads: 1, completed: 1, failed: 1 });
  });

  it('rejects an unknown kind with an error reply', async () => {
    const pool = createPool({ size: 1 });
    await expect(pool.run('missing', null)).rejects.toThrow('Unknown worker task kind: missing');
    expect(await pool.run<number>('double', 1)).toBe(2);
  });

  it('a crashed worker rejects only its task and is replaced on demand', async () => {
    const pool = createPool({ size: 2 });
    const survivor = pool.run<number>('wait', 100);
    const crashed = pool.run('crash', null);
    await expect(crashed).rejects.toThrow();
    expect(pool.stats().threads).toBe(1);
    expect(await survivor).toBe(100);

    const solo = createPool({ size: 1 });
    await expect(solo.run('crash', null)).rejects.toThrow();
    expect(solo.stats().threads).toBe(0);
    expect(await solo.run<number>('double', 3)).toBe(6);
    expect(solo.stats()).toMatchObject({ threads: 1, completed: 1, failed: 1 });
  });

  it('close() rejects queued tasks and later runs', async () => {
    const pool = createPool({ size: 1 });
    const running = pool.run('wait', 1_000);
    const queuedA = pool.run('double', 1);
    const queuedB = pool.run('double', 2);
    expect(pool.stats().queued).toBe(2);
    const settled = Promise.allSettled([running, queuedA, queuedB]);

    await pool.close();
    const outcomes = await settled;
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      expect(((outcome as PromiseRejectedResult).reason as Error).message).toBe('WorkerPool is closed');
    }
    expect(pool.stats()).toMatchObject({ threads: 0, queued: 0 });
    await expect(pool.run('double', 3)).rejects.toThrow('WorkerPool is closed');
  });

  it('abort removes a queued task', async () => {
    const pool = createPool({ size: 1 });
    const running = pool.run<number>('wait', 30);
    const controller = new AbortController();
    const aborted = pool.run('double', 2, { signal: controller.signal });
    const after = pool.run<number>('double', 5);
    expect(pool.stats().queued).toBe(2);

    controller.abort();
    expect(pool.stats().queued).toBe(1);
    const error = await aborted.catch((caught: Error) => caught);
    expect((error as Error).name).toBe('AbortError');
    expect(await running).toBe(30);
    expect(await after).toBe(10);
    expect(pool.stats()).toMatchObject({ completed: 2, failed: 0 });

    const preAborted = new AbortController();
    preAborted.abort();
    const early = await pool.run('double', 1, { signal: preAborted.signal }).catch((caught: Error) => caught);
    expect((early as Error).name).toBe('AbortError');
  });

  it('terminates idle threads after idleTimeoutMs', async () => {
    const pool = createPool({ size: 2, idleTimeoutMs: 20 });
    await Promise.all([pool.run('double', 1), pool.run('double', 2)]);
    expect(pool.stats().threads).toBe(2);
    await waitFor(() => pool.stats().threads === 0);
    expect(await pool.run<number>('double', 7)).toBe(14);
    expect(pool.stats().threads).toBe(1);
  });
});

describe('WorkerPool (inline mode)', () => {
  it('runs inline handlers without threads and isolates errors', async () => {
    const pool = new WorkerPool({
      size: 4,
      inlineHandlers: {
        double: (payload) => (payload as number) * 2,
        fail: () => {
          throw new Error('inline failure');
        },
      },
    });
    pools.push(pool);
    const failing = pool.run('fail', null);
    const ok = pool.run<number>('double', 9);
    await expect(failing).rejects.toThrow('inline failure');
    expect(await ok).toBe(18);
    await expect(pool.run('missing', null)).rejects.toThrow('Unknown worker task kind: missing');
    expect(pool.stats()).toMatchObject({ threads: 0, completed: 1, failed: 2 });
  });

  it('runs one task at a time and yields to the event loop between tasks', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const pool = new WorkerPool({
      size: 4,
      inlineHandlers: {
        step: async (payload) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          order.push(payload as string);
          await Promise.resolve();
          inFlight--;
        },
      },
    });
    pools.push(pool);

    const first = pool.run('step', 'a');
    const second = pool.run('step', 'b');
    setImmediate(() => order.push('tick'));
    expect(order).toEqual([]);
    await Promise.all([first, second]);

    expect(order.indexOf('tick')).toBeLessThan(order.indexOf('b'));
    expect(order.filter(entry => entry !== 'tick')).toEqual(['a', 'b']);
    expect(maxInFlight).toBe(1);
  });

  it('abort removes a queued inline task', async () => {
    const ran: string[] = [];
    const pool = new WorkerPool({ size: 1, inlineHandlers: { step: (payload) => { ran.push(payload as string); } } });
    pools.push(pool);
    const controller = new AbortController();
    const kept = pool.run('step', 'kept');
    const aborted = pool.run('step', 'aborted', { signal: controller.signal }).catch((caught: Error) => caught);
    controller.abort();
    await kept;
    expect(((await aborted) as Error).name).toBe('AbortError');
    expect(ran).toEqual(['kept']);
  });
});
