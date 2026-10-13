/**
 * Shared `worker_threads` pool (ADR-0024).
 *
 * Threads start lazily up to `size`, take tasks from one FIFO queue and retire
 * after `idleTimeoutMs` without work. A task error rejects only that task; a
 * crashed thread rejects its in-flight task and is replaced when work arrives.
 * Without `script` (headless, tests) tasks run in-process through
 * `inlineHandlers`, one at a time, yielding to the event loop before each.
 */
import { Worker } from 'worker_threads';
import { hasWorkerHandler, type WorkerHandlers, type WorkerReply } from './worker-runtime.ts';

export interface WorkerPoolOptions {
  /** Absolute path of the worker entry; absent means inline mode. */
  script?: string;
  size: number;
  idleTimeoutMs?: number;
  inlineHandlers?: WorkerHandlers;
}

export interface WorkerPoolRunOptions {
  /** Aborting removes a task that is still queued; a running task is not interrupted. */
  signal?: AbortSignal;
}

export interface WorkerPoolStats {
  size: number;
  threads: number;
  busy: number;
  queued: number;
  completed: number;
  failed: number;
}

interface Task {
  id: number;
  kind: string;
  payload: unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface Slot {
  worker: Worker;
  task: Task | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  gone: boolean;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function closedError(): Error {
  return new Error('WorkerPool is closed');
}

function replyError(error: { message: string; name: string }): Error {
  const result = new Error(error.message);
  result.name = error.name;
  return result;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

export class WorkerPool {
  private readonly script: string | undefined;
  private readonly size: number;
  private readonly idleTimeoutMs: number;
  private readonly inlineHandlers: WorkerHandlers;
  private readonly queue: Task[] = [];
  private readonly slots: Slot[] = [];
  private nextId = 1;
  private completed = 0;
  private failed = 0;
  private closed = false;
  private inlineDraining = false;
  private inlineBusy = false;

  constructor(options: WorkerPoolOptions) {
    if (!Number.isInteger(options.size) || options.size < 1) {
      throw new RangeError(`WorkerPool size must be a positive integer, got ${options.size}`);
    }
    this.script = options.script || undefined;
    this.size = options.size;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.inlineHandlers = options.inlineHandlers ?? {};
  }

  run<T>(kind: string, payload: unknown, options: WorkerPoolRunOptions = {}): Promise<T> {
    if (this.closed) return Promise.reject(closedError());
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      const task: Task = { id: this.nextId++, kind, payload, resolve: resolve as (value: unknown) => void, reject, signal };
      if (signal) {
        task.onAbort = () => {
          const index = this.queue.indexOf(task);
          if (index === -1) return;
          this.queue.splice(index, 1);
          this.detachAbort(task);
          task.reject(abortError());
        };
        signal.addEventListener('abort', task.onAbort, { once: true });
      }
      this.queue.push(task);
      this.pump();
    });
  }

  stats(): WorkerPoolStats {
    const busyThreads = this.slots.filter(slot => slot.task !== null).length;
    return {
      size: this.size,
      threads: this.slots.length,
      busy: busyThreads + (this.inlineBusy ? 1 : 0),
      queued: this.queue.length,
      completed: this.completed,
      failed: this.failed,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const task of this.queue.splice(0)) {
      this.detachAbort(task);
      task.reject(closedError());
    }
    const terminating: Promise<unknown>[] = [];
    for (const slot of this.slots.splice(0)) {
      slot.gone = true;
      this.clearIdleTimer(slot);
      if (slot.task) {
        this.failed++;
        slot.task.reject(closedError());
        slot.task = null;
      }
      terminating.push(slot.worker.terminate().catch(() => undefined));
    }
    await Promise.all(terminating);
  }

  private detachAbort(task: Task): void {
    if (task.signal && task.onAbort) task.signal.removeEventListener('abort', task.onAbort);
    task.onAbort = undefined;
  }

  private pump(): void {
    if (this.closed) return;
    if (!this.script) {
      void this.drainInline();
      return;
    }
    while (this.queue.length > 0) {
      const slot = this.slots.find(candidate => candidate.task === null)
        ?? (this.slots.length < this.size ? this.spawn(this.script) : null);
      if (!slot) return;
      this.dispatch(slot, this.queue.shift()!);
    }
  }

  private spawn(script: string): Slot {
    const slot: Slot = { worker: new Worker(script), task: null, idleTimer: null, gone: false };
    slot.worker.on('message', (message: WorkerReply) => this.onReply(slot, message));
    slot.worker.on('error', (error: Error) => this.onCrash(slot, error));
    slot.worker.on('exit', (code: number) => this.onCrash(slot, new Error(`Pool worker exited with code ${code}`)));
    this.slots.push(slot);
    return slot;
  }

  private dispatch(slot: Slot, task: Task): void {
    this.detachAbort(task);
    this.clearIdleTimer(slot);
    slot.task = task;
    slot.worker.ref?.();
    try {
      slot.worker.postMessage({ id: task.id, kind: task.kind, payload: task.payload });
    } catch (error) {
      slot.task = null;
      this.failed++;
      task.reject(error);
      this.markIdle(slot);
    }
  }

  private onReply(slot: Slot, message: WorkerReply): void {
    const task = slot.task;
    if (slot.gone || !task || !message || message.id !== task.id) return;
    slot.task = null;
    if (message.ok) {
      this.completed++;
      task.resolve(message.result);
    } else {
      this.failed++;
      task.reject(replyError(message.error));
    }
    this.pump();
    if (slot.task === null) this.markIdle(slot);
  }

  private onCrash(slot: Slot, error: Error): void {
    if (slot.gone) return;
    slot.gone = true;
    this.clearIdleTimer(slot);
    const index = this.slots.indexOf(slot);
    if (index !== -1) this.slots.splice(index, 1);
    const task = slot.task;
    slot.task = null;
    if (task) {
      this.failed++;
      task.reject(error);
    }
    void slot.worker.terminate().catch(() => undefined);
    this.pump();
  }

  private markIdle(slot: Slot): void {
    if (slot.gone) return;
    slot.worker.unref?.();
    this.clearIdleTimer(slot);
    slot.idleTimer = setTimeout(() => this.retire(slot), this.idleTimeoutMs);
    slot.idleTimer.unref?.();
  }

  private retire(slot: Slot): void {
    if (slot.gone || slot.task) return;
    slot.gone = true;
    slot.idleTimer = null;
    const index = this.slots.indexOf(slot);
    if (index !== -1) this.slots.splice(index, 1);
    void slot.worker.terminate().catch(() => undefined);
  }

  private clearIdleTimer(slot: Slot): void {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = null;
  }

  private async drainInline(): Promise<void> {
    if (this.inlineDraining) return;
    this.inlineDraining = true;
    try {
      while (this.queue.length > 0 && !this.closed) {
        await yieldToEventLoop();
        const task = this.queue.shift();
        if (!task) break;
        this.detachAbort(task);
        this.inlineBusy = true;
        try {
          if (!hasWorkerHandler(this.inlineHandlers, task.kind)) {
            throw new Error(`Unknown worker task kind: ${task.kind}`);
          }
          const result = await this.inlineHandlers[task.kind]!(task.payload);
          this.completed++;
          task.resolve(result);
        } catch (error) {
          this.failed++;
          task.reject(error);
        } finally {
          this.inlineBusy = false;
        }
      }
    } finally {
      this.inlineDraining = false;
    }
  }
}
