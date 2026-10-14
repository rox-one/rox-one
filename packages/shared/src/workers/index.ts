/**
 * Shared worker pool and concurrency limiter (ADR-0024).
 *
 * The host calls `configureWorkerPool` once at startup (Electron passes the
 * bundled `pool-worker.cjs`); `getWorkerPool` creates the process-wide pool on
 * first use. Without a script the pool runs tasks inline.
 */
// Namespace import: tolerate partial `os` mocks and missing APIs.
import * as os from 'os';
import { defaultWorkerHandlers } from './handlers.ts';
import { WorkerPool } from './pool.ts';
import { parseWorkerPoolSizeOverride, resolveWorkerPoolSize } from './pool-size.ts';

export { limit, type Limiter } from './limit.ts';
export {
  MAX_WORKER_POOL_SIZE,
  parseWorkerPoolSizeOverride,
  resolveWorkerPoolSize,
  type WorkerPoolSizeInput,
} from './pool-size.ts';
export { WorkerPool, type WorkerPoolOptions, type WorkerPoolRunOptions, type WorkerPoolStats } from './pool.ts';
export {
  runWorkerLoop,
  type WorkerHandler,
  type WorkerHandlers,
  type WorkerReply,
  type WorkerRequest,
} from './worker-runtime.ts';
export {
  defaultWorkerHandlers,
  registerWorkerHandler,
  type WorkerTaskKind,
  type WorkerTaskMap,
  type WorkerTaskPayload,
  type WorkerTaskResult,
} from './handlers.ts';

export interface WorkerPoolConfig {
  /** Absolute path of the bundled pool worker; absent means inline mode. */
  script?: string;
  lowPower: boolean;
  /** Defaults to `os.availableParallelism()`. */
  availableParallelism?: number;
}

let config: WorkerPoolConfig = { lowPower: false };
let defaultPool: WorkerPool | null = null;

function hostParallelism(): number {
  try {
    if (typeof os.availableParallelism === 'function') return os.availableParallelism();
    if (typeof os.cpus === 'function') return os.cpus().length;
  } catch {
    // unknown
  }
  return 1;
}

/**
 * Sets the process-wide pool configuration. A pool created earlier is
 * detached: it finishes its queue and its threads retire on idle.
 */
export function configureWorkerPool(next: WorkerPoolConfig): void {
  config = { ...next };
  defaultPool = null;
}

export function getWorkerPool(): WorkerPool {
  if (defaultPool) return defaultPool;
  const size = resolveWorkerPoolSize({
    availableParallelism: config.availableParallelism ?? hostParallelism(),
    lowPower: config.lowPower,
    override: parseWorkerPoolSizeOverride(process.env.ROX_WORKER_POOL_SIZE),
  });
  defaultPool = new WorkerPool({ script: config.script, size, inlineHandlers: defaultWorkerHandlers });
  return defaultPool;
}

/** Test hook: closes the default pool and forgets the configuration. */
export async function resetWorkerPoolForTests(): Promise<void> {
  const pool = defaultPool;
  defaultPool = null;
  config = { lowPower: false };
  await pool?.close();
}
