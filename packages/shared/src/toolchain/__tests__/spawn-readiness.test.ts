import { afterEach, describe, expect, it } from 'bun:test';
import { createLatchedGate, isSpawnEnvReady, registerSpawnEnvGate, resetSpawnEnvGatesForTests, whenSpawnEnvReady } from '../spawn-readiness';

afterEach(() => resetSpawnEnvGatesForTests());

function deferred() {
  let resolve!: () => void; let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('spawn-env readiness gates (PERF-03 review)', () => {
  it('is ready immediately with no gates registered', async () => {
    expect(isSpawnEnvReady()).toBe(true);
    const started = performance.now(); await whenSpawnEnvReady();
    expect(performance.now() - started).toBeLessThan(20);
  });

  it('waits for every unready gate and resolves when they settle', async () => {
    const a = deferred(); const b = deferred();
    registerSpawnEnvGate('a', createLatchedGate(a.promise, 5_000));
    registerSpawnEnvGate('b', createLatchedGate(b.promise, 5_000));
    let done = false; const waiting = whenSpawnEnvReady().then(() => { done = true; });
    a.resolve(); await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false); expect(isSpawnEnvReady()).toBe(false);
    b.reject(new Error('repair failed')); await waiting; // never rejects
    expect(done).toBe(true); expect(isSpawnEnvReady()).toBe(true);
  });

  it('bounds the wait and latches after the first timeout', async () => {
    const never = deferred(); const gate = createLatchedGate(never.promise, 30);
    registerSpawnEnvGate('slow', gate);
    const started = performance.now(); await whenSpawnEnvReady();
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
    expect(gate.timedOut).toBe(true); expect(isSpawnEnvReady()).toBe(true);
    const again = performance.now(); await whenSpawnEnvReady();
    expect(performance.now() - again).toBeLessThan(10);
  });

  it('unregister removes only the gate it registered', async () => {
    const pending = deferred();
    const off = registerSpawnEnvGate('x', createLatchedGate(pending.promise, 5_000));
    expect(isSpawnEnvReady()).toBe(false);
    off(); expect(isSpawnEnvReady()).toBe(true);
    const offOld = registerSpawnEnvGate('y', createLatchedGate(pending.promise, 5_000));
    registerSpawnEnvGate('y', { isReady: () => true, wait: async () => {} });
    offOld(); // replaced gate must stay registered
    expect(isSpawnEnvReady()).toBe(true);
  });

  it('a gate whose wait throws does not reject whenSpawnEnvReady', async () => {
    registerSpawnEnvGate('bad', { isReady: () => false, wait: () => Promise.reject(new Error('boom')) });
    await expect(whenSpawnEnvReady()).resolves.toBeUndefined();
  });
});
