/**
 * Worker Thread entry for the Browser Intelligence unfurl stage.
 *
 * Bundled to `dist/browser-intel-worker.cjs` as CJS, so this file must not use
 * top-level `await`. All logic lives in `@rox/browser-intel`; here we only wire
 * `workerData` and `parentPort` to the package's message handler.
 */

import { parentPort, workerData } from 'node:worker_threads'

import { handleUnfurlWorkerMessage } from '@rox/browser-intel'
import type { UnfurlWorkerMessage, UnfurlWorkerOptions } from '@rox/browser-intel'

/** Structured-clone payload sent by `startUnfurlWorker`. */
interface UnfurlWorkerData {
  dbPath?: string
  options?: UnfurlWorkerOptions
}

const port = parentPort
if (port === null) {
  throw new Error('browser-intel unfurl worker must run inside a Worker thread (no parentPort)')
}

// `workerData` is `any`; the parent (startUnfurlWorker) owns this shape.
const data: UnfurlWorkerData = workerData ?? {}
const dbPath = typeof data.dbPath === 'string' ? data.dbPath : ''

const io = {
  post: (message: UnfurlWorkerMessage): void => port.postMessage(message),
  dbPathFromWorkerData: (): string => dbPath,
}

// Abort frames arrive while the start run is in flight; forward them so the
// package can cancel the loop it is running in this thread.
port.on('message', (message: UnfurlWorkerMessage) => {
  if (message?.type === 'abort') void handleUnfurlWorkerMessage({ type: 'abort' }, io)
})

void handleUnfurlWorkerMessage({ type: 'start', dbPath, options: data.options }, io).catch((error: unknown) => {
  const failure: UnfurlWorkerMessage = {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  }
  port.postMessage(failure)
})