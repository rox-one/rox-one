import { threadId } from 'worker_threads';
import { runWorkerLoop } from '../../worker-runtime.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

runWorkerLoop({
  double: (payload) => (payload as number) * 2,
  threadId: async (payload) => {
    await sleep((payload as { delayMs?: number } | undefined)?.delayMs ?? 0);
    return threadId;
  },
  wait: async (payload) => {
    await sleep(payload as number);
    return payload;
  },
  fail: (payload) => {
    const error = new Error(String(payload));
    error.name = 'FixtureError';
    throw error;
  },
  crash: () => process.exit(7),
});
