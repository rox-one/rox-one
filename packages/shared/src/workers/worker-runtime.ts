/**
 * Message loop for worker scripts of the shared pool (ADR-0024). Keep this
 * module dependency-light: it is bundled into `dist/pool-worker.cjs`.
 */
import { parentPort } from 'worker_threads';

export type WorkerHandler = (payload: unknown) => unknown | Promise<unknown>;
export type WorkerHandlers = Record<string, WorkerHandler>;

export interface WorkerRequest {
  id: number;
  kind: string;
  payload: unknown;
}

export interface WorkerErrorInfo {
  message: string;
  name: string;
}

export type WorkerReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: WorkerErrorInfo };

export interface WorkerPort {
  on(event: 'message', listener: (message: unknown) => void): unknown;
  postMessage(message: WorkerReply): void;
}

export function hasWorkerHandler(handlers: WorkerHandlers, kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(handlers, kind) && typeof handlers[kind] === 'function';
}

export function toWorkerErrorInfo(error: unknown): WorkerErrorInfo {
  if (error instanceof Error) return { message: error.message, name: error.name };
  return { message: String(error), name: 'Error' };
}

async function handleRequest(port: WorkerPort, handlers: WorkerHandlers, request: WorkerRequest): Promise<void> {
  try {
    if (!hasWorkerHandler(handlers, request.kind)) throw new Error(`Unknown worker task kind: ${request.kind}`);
    const result = await handlers[request.kind]!(request.payload);
    port.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    port.postMessage({ id: request.id, ok: false, error: toWorkerErrorInfo(error) });
  }
}

export function runWorkerLoop(handlers: WorkerHandlers, port: WorkerPort | null = parentPort): void {
  if (!port) throw new Error('runWorkerLoop must run inside a worker_thread');
  port.on('message', (message) => {
    void handleRequest(port, handlers, message as WorkerRequest);
  });
}
