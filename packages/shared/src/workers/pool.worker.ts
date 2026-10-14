/**
 * Shared pool worker entry (ADR-0024). Bundled to
 * `apps/electron/dist/pool-worker.cjs` by scripts/electron-build-main.ts and
 * scripts/electron-dev.ts. Import only dependency-light handler modules here.
 */
import { defaultWorkerHandlers } from './handlers.ts';
import { runWorkerLoop } from './worker-runtime.ts';
import '../browser/history-worker.ts';
import '../skills/skill-index-worker.ts';

runWorkerLoop(defaultWorkerHandlers);
