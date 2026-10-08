/**
 * Bundled skills sync off the startup critical path (PERF-02).
 *
 * `ensureBundledSkills()` used to run synchronously before the first window:
 * it hashed every bundled file (~5.7k files / ~95 MB) plus every installed copy
 * on every launch. This scheduler:
 *
 * 1. claims the once-per-process ambient sync immediately (so a second host —
 *    the server bootstrap inside Electron — does not run it again),
 * 2. waits for a caller-provided gate (Electron: first paint) and yields,
 * 3. runs the O(1) stamp check, and only when something changed runs the full
 *    hash-merge — in a `worker_thread` when a worker script is available,
 *    otherwise inline as a deferred step,
 * 4. invalidates the skills caches on the calling thread and reports the
 *    outcome so the host can push `skills`/`bundledSkills` CHANGED events.
 *
 * Merge semantics are untouched: the worker runs the same merge engine
 * (bundled-core.ts) that `ensureBundledSkills` uses, with fully resolved
 * explicit options. The stamp check itself runs on the calling thread so an
 * unchanged install never pays for a worker spawn.
 */
import { existsSync } from 'fs';
import { Worker } from 'worker_threads';
import { claimAmbientBundledSkillsSync, resolveBundledSkillsTarget } from './bundled.ts';
import {
  isBundledSkillsSyncCurrent,
  runBundledSkillsSyncJob,
  type BundledSkillsJobResult,
  type ResolvedBundledSkillsTarget,
} from './bundled-core.ts';
import { invalidateSkillsCache } from './storage.ts';
import { invalidateOmpSkillsCache } from './omp-discovery.ts';

export type { BundledSkillsJobResult } from './bundled-core.ts';

export interface BundledSkillsBackgroundOutcome extends BundledSkillsJobResult {
  via: 'worker' | 'inline' | 'none';
  /** Wall time from the gate opening to completion. */
  durationMs: number;
  /** True when this call did not start a sync because another one owns it. */
  joined?: boolean;
}

export interface BundledSkillsBackgroundOptions {
  /** Absolute path of a bundled worker entry (`bundled-skills-worker.cjs`). */
  workerScript?: string | null;
  /** Gate to wait for before any filesystem work (e.g. renderer first paint). */
  after?: Promise<unknown>;
  /** Upper bound on waiting for `after` (default 15 s) so a stuck gate cannot starve the sync. */
  maxGateWaitMs?: number;
  /** Optional structured logger; never receives file contents. */
  log?: (level: 'info' | 'warn', message: string, data?: Record<string, unknown>) => void;
  /** Called after caches are invalidated when the job finished (any status). */
  onComplete?: (outcome: BundledSkillsBackgroundOutcome) => void;
  /** Explicit inputs (tests/tools); default resolves the ambient startup target. */
  target?: ResolvedBundledSkillsTarget;
  /** Test hook: replaces worker spawning. */
  runInWorker?: (script: string, target: ResolvedBundledSkillsTarget) => Promise<BundledSkillsJobResult>;
}

function defaultRunInWorker(script: string, target: ResolvedBundledSkillsTarget): Promise<BundledSkillsJobResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(script, { workerData: { target } });
    worker.once('message', (message: unknown) => {
      settled = true;
      const result = message as BundledSkillsJobResult | null;
      if (result && typeof result.status === 'string') resolve(result);
      else reject(new Error('bundled skills worker returned an invalid result'));
    });
    worker.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      reject(new Error(`bundled skills worker exited before reporting (code ${code})`));
    });
  });
}

let inflight: Promise<BundledSkillsBackgroundOutcome> | null = null;

/** Resolves once the current background sync (if any) has finished. Never rejects. */
export function whenBundledSkillsSettled(): Promise<void> {
  return inflight ? inflight.then(() => undefined, () => undefined) : Promise.resolve();
}

/** Test hook. */
export function resetBundledSkillsBackgroundForTests(): void {
  inflight = null;
}

function gateWithTimeout(after: Promise<unknown> | undefined, maxMs: number): Promise<void> {
  if (!after) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, maxMs);
    (timer as { unref?: () => void }).unref?.();
    after.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
  });
}

/**
 * Schedule the ambient bundled-skills sync off the critical path. Idempotent:
 * later callers join the in-flight job (and get its outcome) instead of
 * starting another one. Never rejects.
 */
export function ensureBundledSkillsInBackground(options: BundledSkillsBackgroundOptions = {}): Promise<BundledSkillsBackgroundOutcome> {
  if (inflight) return inflight.then(outcome => ({ ...outcome, joined: true }));
  if (!claimAmbientBundledSkillsSync()) {
    // An ambient synchronous sync already ran in this process.
    return Promise.resolve({ status: 'up-to-date', packs: 0, failedPacks: 0, localModifiedPacks: 0, via: 'none', durationMs: 0, joined: true });
  }
  const log = options.log ?? (() => {});
  inflight = (async (): Promise<BundledSkillsBackgroundOutcome> => {
    await gateWithTimeout(options.after, options.maxGateWaitMs ?? 15_000);
    // Yield once more so the gate's own continuation (paint/IPC) runs first.
    await new Promise<void>(resolve => setImmediate(resolve));
    const started = Date.now();
    const target = options.target ?? resolveBundledSkillsTarget();
    const finish = (result: BundledSkillsJobResult, via: BundledSkillsBackgroundOutcome['via']): BundledSkillsBackgroundOutcome => {
      if (result.status === 'synced') {
        // Workers have their own module instances; drop this thread's caches.
        invalidateSkillsCache();
        invalidateOmpSkillsCache();
      }
      const outcome: BundledSkillsBackgroundOutcome = { ...result, via, durationMs: Date.now() - started };
      log(result.status === 'failed' || result.failedPacks > 0 ? 'warn' : 'info', '[bundled-skills] background sync finished', { ...outcome });
      try { options.onComplete?.(outcome); } catch { /* host callbacks must not break the job */ }
      return outcome;
    };
    if (!target.bundleRoot) return finish({ status: 'no-bundle', packs: 0, failedPacks: 0, localModifiedPacks: 0 }, 'none');
    // O(1)-ish on packaged builds (build-time fingerprint + stat of state files).
    if (isBundledSkillsSyncCurrent(target)) return finish({ status: 'up-to-date', packs: 0, failedPacks: 0, localModifiedPacks: 0 }, 'none');
    const script = options.workerScript;
    if (script && (options.runInWorker || existsSync(script))) {
      try {
        const result = await (options.runInWorker ?? defaultRunInWorker)(script, target);
        if (result.status !== 'failed') return finish(result, 'worker');
        log('warn', '[bundled-skills] worker sync failed, retrying inline', { error: result.error });
      } catch (error) {
        log('warn', '[bundled-skills] worker unavailable, running deferred inline sync', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Inline fallback, deferred past the gate (also covers a worker that crashed
    // mid-merge: the hash-merge is idempotent and never overwrites user edits).
    return finish(runBundledSkillsSyncJob(target), 'inline');
  })();
  return inflight;
}
