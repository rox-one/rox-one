/**
 * Spawn-environment readiness (PERF-03 follow-up).
 *
 * Startup no longer blocks on environment preparation (macOS login-shell
 * capture, Windows offline prerequisite repair). Code that is about to spawn
 * a child which needs the user's full PATH / prerequisites awaits
 * {@link whenSpawnEnvReady}: hosts register gates, each of which bounds its own
 * wait and *latches* once that bound elapses, so only the first caller can
 * ever pay the timeout. With no gates registered (headless, Linux, tests) it
 * resolves synchronously-fast and {@link isSpawnEnvReady} is true.
 *
 * Dependency-free on purpose: imported from shared, server-core and Electron.
 */

export interface SpawnEnvGate {
  /** True once the environment is prepared, or once the bounded wait elapsed. */
  isReady(): boolean;
  /** Bounded wait; never rejects. */
  wait(): Promise<void>;
}

const gates = new Map<string, SpawnEnvGate>();

/** Register (or replace) a named gate. Returns an unregister function. */
export function registerSpawnEnvGate(name: string, gate: SpawnEnvGate): () => void {
  gates.set(name, gate);
  return () => { if (gates.get(name) === gate) gates.delete(name); };
}

export function isSpawnEnvReady(): boolean {
  for (const gate of gates.values()) if (!gate.isReady()) return false;
  return true;
}

/** Resolves when every registered gate is ready or has hit its bound. Never rejects. */
export function whenSpawnEnvReady(): Promise<void> {
  const pending = [...gates.values()].filter((gate) => !gate.isReady());
  if (pending.length === 0) return Promise.resolve();
  return Promise.all(pending.map((gate) => gate.wait().catch(() => undefined))).then(() => undefined);
}

/**
 * Gate over a one-shot promise with a bounded wait. The first wait that times
 * out latches the gate as ready, so later spawns never pay the bound again.
 */
export function createLatchedGate(promise: Promise<unknown>, timeoutMs: number): SpawnEnvGate & { readonly timedOut: boolean } {
  let settled = false;
  let timedOut = false;
  const done = promise.then(() => { settled = true; }, () => { settled = true; });
  return {
    get timedOut() { return timedOut; },
    isReady: () => settled || timedOut,
    wait(): Promise<void> {
      if (settled || timedOut) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs);
        (timer as { unref?: () => void }).unref?.();
        void done.then(() => { clearTimeout(timer); resolve(); });
      });
    },
  };
}

/** Test hook. */
export function resetSpawnEnvGatesForTests(): void {
  gates.clear();
}
