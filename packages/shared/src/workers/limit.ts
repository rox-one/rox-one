/**
 * FIFO concurrency limiter for IO-bound work (ADR-0024 §3): at most `n`
 * functions in flight; a rejection reaches its own caller and frees the slot.
 */

export interface Limiter {
  <T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly pending: number;
}

export function limit(n: number): Limiter {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`limit(n) needs a positive integer, got ${n}`);
  const queue: Array<() => void> = [];
  let active = 0;

  const next = (): void => {
    if (active >= n) return;
    const start = queue.shift();
    if (start) start();
  };

  const run = <T>(fn: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      active++;
      let task: Promise<T>;
      try {
        task = Promise.resolve(fn());
      } catch (error) {
        task = Promise.reject(error);
      }
      void task.then(resolve, reject).finally(() => {
        active--;
        next();
      });
    });
    next();
  });

  Object.defineProperties(run, {
    active: { get: () => active },
    pending: { get: () => queue.length },
  });
  return run as Limiter;
}
