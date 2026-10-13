/**
 * Task registry of the shared pool worker (ADR-0024).
 *
 * A feature adds a task kind by augmenting `WorkerTaskMap` and registering
 * its handler from a module that `pool.worker.ts` imports, so the same
 * handler runs in the worker and in inline mode:
 *
 *   declare module '../workers/handlers.ts' {
 *     interface WorkerTaskMap { 'skills.scan': { payload: ScanInput; result: SkillSummary[] } }
 *   }
 *   registerWorkerHandler('skills.scan', scanSkills);
 *
 * Payloads and results cross threads by structured clone.
 */
import type { WorkerHandlers } from './worker-runtime.ts';

export interface WorkerTaskMap {}

export type WorkerTaskKind = keyof WorkerTaskMap & string;
export type WorkerTaskPayload<K extends WorkerTaskKind> = WorkerTaskMap[K] extends { payload: infer P } ? P : never;
export type WorkerTaskResult<K extends WorkerTaskKind> = WorkerTaskMap[K] extends { result: infer R } ? R : never;

export const defaultWorkerHandlers: WorkerHandlers = {};

export function registerWorkerHandler<K extends WorkerTaskKind>(
  kind: K,
  handler: (payload: WorkerTaskPayload<K>) => WorkerTaskResult<K> | Promise<WorkerTaskResult<K>>,
): void {
  if (Object.prototype.hasOwnProperty.call(defaultWorkerHandlers, kind)) {
    throw new Error(`Worker task kind already registered: ${kind}`);
  }
  defaultWorkerHandlers[kind] = handler as (payload: unknown) => unknown;
}
