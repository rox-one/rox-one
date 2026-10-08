/**
 * worker_thread entry for the bundled skills hash-merge (PERF-02).
 * Bundled to `apps/electron/dist/bundled-skills-worker.cjs` by
 * scripts/electron-build-main.ts. Receives fully resolved, plain-data options
 * and runs the same `ensureBundledSkills` merge as the main thread would.
 */
import { parentPort, workerData } from 'worker_threads';
// Import the dependency-light merge engine only (keeps the worker bundle small).
import { runBundledSkillsSyncJob, type ResolvedBundledSkillsTarget } from './bundled-core.ts';

const target = (workerData as { target?: ResolvedBundledSkillsTarget } | undefined)?.target;
if (!parentPort) throw new Error('bundled-sync.worker must run inside a worker_thread');
parentPort.postMessage(target
  ? runBundledSkillsSyncJob(target)
  : { status: 'failed', packs: 0, failedPacks: 0, localModifiedPacks: 0, error: 'missing target' });
