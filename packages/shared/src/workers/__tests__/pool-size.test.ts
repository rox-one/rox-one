/**
 * ADR-0024 sizing: half the logical cores clamped to 1..8, one thread on the
 * low-power profile, a positive ROX_WORKER_POOL_SIZE override wins.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { parseWorkerPoolSizeOverride, resolveWorkerPoolSize } from '../pool-size.ts';
import { configureWorkerPool, getWorkerPool, resetWorkerPoolForTests } from '../index.ts';

describe('resolveWorkerPoolSize', () => {
  const table: Array<[string, { availableParallelism: number; lowPower: boolean; override?: number | null }, number]> = [
    ['10 cores', { availableParallelism: 10, lowPower: false }, 5],
    ['4 cores', { availableParallelism: 4, lowPower: false }, 2],
    ['1 core', { availableParallelism: 1, lowPower: false }, 1],
    ['3 cores', { availableParallelism: 3, lowPower: false }, 1],
    ['16 cores', { availableParallelism: 16, lowPower: false }, 8],
    ['32 cores', { availableParallelism: 32, lowPower: false }, 8],
    ['low power on 10 cores', { availableParallelism: 10, lowPower: true }, 1],
    ['override 3 on 10 cores', { availableParallelism: 10, lowPower: false, override: 3 }, 3],
    ['override 3 beats low power', { availableParallelism: 10, lowPower: true, override: 3 }, 3],
    ['override 12 beats the cap', { availableParallelism: 32, lowPower: false, override: 12 }, 12],
    ['override 0 is ignored', { availableParallelism: 10, lowPower: false, override: 0 }, 5],
    ['override 2.5 is ignored', { availableParallelism: 10, lowPower: false, override: 2.5 }, 5],
    ['override null is ignored', { availableParallelism: 8, lowPower: false, override: null }, 4],
    ['0 cores (unknown)', { availableParallelism: 0, lowPower: false }, 1],
    ['NaN cores (unknown)', { availableParallelism: Number.NaN, lowPower: false }, 1],
  ];

  for (const [name, input, expected] of table) {
    it(`${name} → ${expected}`, () => {
      expect(resolveWorkerPoolSize(input)).toBe(expected);
    });
  }
});

describe('parseWorkerPoolSizeOverride', () => {
  it('accepts positive integers only', () => {
    expect(parseWorkerPoolSizeOverride('3')).toBe(3);
    expect(parseWorkerPoolSizeOverride(' 6 ')).toBe(6);
    expect(parseWorkerPoolSizeOverride(undefined)).toBeNull();
    expect(parseWorkerPoolSizeOverride('')).toBeNull();
    expect(parseWorkerPoolSizeOverride('0')).toBeNull();
    expect(parseWorkerPoolSizeOverride('-2')).toBeNull();
    expect(parseWorkerPoolSizeOverride('2.5')).toBeNull();
    expect(parseWorkerPoolSizeOverride('four')).toBeNull();
  });
});

describe('default pool', () => {
  const savedOverride = process.env.ROX_WORKER_POOL_SIZE;

  afterEach(async () => {
    if (savedOverride === undefined) delete process.env.ROX_WORKER_POOL_SIZE;
    else process.env.ROX_WORKER_POOL_SIZE = savedOverride;
    await resetWorkerPoolForTests();
  });

  it('sizes the lazily created pool from the configured hardware', () => {
    delete process.env.ROX_WORKER_POOL_SIZE;
    configureWorkerPool({ lowPower: false, availableParallelism: 10 });
    const pool = getWorkerPool();
    expect(pool.stats().size).toBe(5);
    expect(pool.stats().threads).toBe(0);
    expect(getWorkerPool()).toBe(pool);
  });

  it('caps the pool at one thread on the low-power profile', () => {
    delete process.env.ROX_WORKER_POOL_SIZE;
    configureWorkerPool({ lowPower: true, availableParallelism: 10 });
    expect(getWorkerPool().stats().size).toBe(1);
  });

  it('reads ROX_WORKER_POOL_SIZE and ignores invalid values', async () => {
    process.env.ROX_WORKER_POOL_SIZE = '3';
    configureWorkerPool({ lowPower: true, availableParallelism: 10 });
    expect(getWorkerPool().stats().size).toBe(3);

    await resetWorkerPoolForTests();
    process.env.ROX_WORKER_POOL_SIZE = 'lots';
    configureWorkerPool({ lowPower: false, availableParallelism: 4 });
    expect(getWorkerPool().stats().size).toBe(2);
  });

  it('runs inline without a script and rejects unknown kinds', async () => {
    configureWorkerPool({ lowPower: false, availableParallelism: 4 });
    await expect(getWorkerPool().run('no.such.kind', null)).rejects.toThrow('Unknown worker task kind: no.such.kind');
    expect(getWorkerPool().stats().threads).toBe(0);
  });
});
