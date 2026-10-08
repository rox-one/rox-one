/**
 * Native Windows prerequisite handoff (gh/git/node/jq/yq + optional Git Bash).
 *
 * Boot (PERF-03): `initializeWindowsBootstrap` reads the installer receipt,
 * resolves tools with parallel, cached `--version` probes and registers the
 * runtime/PATH *before* any local source/agent/MCP initialization — but it
 * never runs bootstrap.ps1 inline. When a packaged install is missing
 * prerequisites it returns `repairNeeded`; the host then schedules
 * {@link scheduleWindowsBootstrapRepair} after first paint (at most once per
 * launch, recorded backoff) and registers the repair promise as a spawn-env
 * gate (`@rox/shared/toolchain/spawn-readiness`, see
 * {@link createWindowsRepairSpawnGate}). Agent creation, builtin MCP startup,
 * MCP validation, git and siyuan spawns await that gate: the first waiter
 * releases the first-paint gate so the repair starts at once, the repair
 * budget (6 s) is counted from the moment bootstrap.ps1 starts, and an overall
 * bound (12 s) caps every wait; the first timeout latches. A successful repair
 * re-applies PATH for every child spawned afterwards.
 */
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { createFileProbeCache, pathEnvKey, prependPath, readWindowsBootstrap, setWindowsBootstrapRuntime } from '@rox/shared/toolchain';
import type { WindowsBootstrapRuntime, WindowsDependencyMode } from '@rox/shared/toolchain';
import type { SpawnEnvGate } from '@rox/shared/toolchain/spawn-readiness';

export async function runNativeBootstrap(script: string, mode: WindowsDependencyMode, env: NodeJS.ProcessEnv): Promise<number> {
  const windows = env.SystemRoot ?? env.SYSTEMROOT;
  if (!windows) return 1;
  // Sysnative crosses WOW64 to the required 64-bit PowerShell, never WSL.
  const powershell = join(windows, process.arch === 'ia32' ? 'Sysnative' : 'System32',
    'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode],
      { env, timeout: 120_000, maxBuffer: 256 * 1024, windowsHide: true }, (error) => {
        resolve(!error ? 0 : typeof error.code === 'number' ? error.code : 1);
      });
  });
}

const ALL_TOOLS = ['gh', 'git', 'node', 'jq', 'yq'];

export interface WindowsBootstrapInitOptions {
  isPackaged: boolean;
  resourcesPath: string;
  managedRoot: string;
  preference?: WindowsDependencyMode;
  /** User Git Bash selection always wins over the optional installer path. */
  gitBashPreference?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  read?: typeof readWindowsBootstrap;
  /** Persist successful `--version` probes under managedRoot (default true). */
  probeCache?: boolean;
  /** App version folded into the probe-cache key (an update re-probes). */
  appVersion?: string | null;
}

function probeCachePath(managedRoot: string): string {
  return join(managedRoot, 'probe-cache.json');
}

function readOptionsFor(options: WindowsBootstrapInitOptions, env: NodeJS.ProcessEnv, inheritedPath: string,
  probeCache: ReturnType<typeof createFileProbeCache> | undefined) {
  return { platform: 'win32' as const, localAppData: env.LOCALAPPDATA,
    preference: options.preference, pathEnv: inheritedPath, excludedRoots: [options.resourcesPath, options.managedRoot],
    ...(probeCache ? { probeCache } : {}) };
}

async function applyRuntime(runtime: WindowsBootstrapRuntime | null, env: NodeJS.ProcessEnv, basePath: string,
  gitBashPreference: string | null | undefined): Promise<void> {
  setWindowsBootstrapRuntime(runtime);
  if (!runtime) return;
  const key = pathEnvKey(env, true);
  // Remove previously injected prerequisite bins, preserving all unrelated PATH,
  // managed tools and the separate vendored rg/Bun/uv locations.
  const [filtered, entries] = await Promise.all([runtime.filterPath(basePath), runtime.pathEntries()]);
  const next = prependPath({ ...env, [key]: filtered }, entries.join(';'), true);
  for (const name of Object.keys(env)) if (name.toUpperCase() === 'PATH') delete env[name];
  env[key] = next[key];
  if (!gitBashPreference && !env.CLAUDE_CODE_GIT_BASH_PATH) {
    const bash = await runtime.gitBashPath();
    if (bash) env.CLAUDE_CODE_GIT_BASH_PATH = bash;
  }
}

function summary(runtime: WindowsBootstrapRuntime | null, preference: WindowsDependencyMode | undefined) {
  return runtime ? { mode: runtime.mode, receiptState: runtime.receiptState, missingTools: [...runtime.missingTools] as string[] }
    : { mode: preference ?? 'auto', receiptState: 'absent' as const, missingTools: [...ALL_TOOLS] };
}

/**
 * Startup handoff. PERF-03: never runs the PowerShell repair inline — when a
 * packaged install is missing prerequisites it reports `repairNeeded` and the
 * host schedules {@link scheduleWindowsBootstrapRepair} after first paint.
 * Tool probes run in parallel and successful probes are cached on disk.
 */
export async function initializeWindowsBootstrap(options: WindowsBootstrapInitOptions) {
  const env = options.env ?? process.env;
  if ((options.platform ?? process.platform) !== 'win32') return null;
  const key = pathEnvKey(env, true);
  const inheritedPath = env[key] ?? '';
  const probeCache = options.probeCache === false ? undefined : createFileProbeCache(probeCachePath(options.managedRoot), { appVersion: options.appVersion });
  await probeCache?.load();
  const read = options.read ?? readWindowsBootstrap;
  const readOptions = readOptionsFor(options, env, inheritedPath, probeCache);
  let runtime = await read(readOptions);
  // A damaged/missing receipt on a packaged install must not restore legacy
  // downloads or permit private bins to masquerade as system executables.
  if (!runtime && options.isPackaged) {
    readOptions.preference = options.preference ?? 'auto';
    runtime = await read(readOptions);
  }
  const script = join(options.resourcesPath, 'windows-bootstrap', 'bootstrap.ps1');
  const repairNeeded = options.isPackaged && (!runtime || runtime.missingTools.length > 0) && existsSync(script);
  await applyRuntime(runtime, env, inheritedPath, options.gitBashPreference);
  void probeCache?.flush();
  return { ...summary(runtime, options.preference), repairNeeded };
}

/** Persisted, non-secret record of background repair attempts. */
export interface WindowsRepairState {
  attempts: number;
  lastAttemptAt: number;
  lastCode: number;
  missingKey: string;
  mode: WindowsDependencyMode;
}

export const REPAIR_BACKOFF_BASE_MS = 60 * 60 * 1000;
export const REPAIR_BACKOFF_MAX_MS = 7 * 24 * 60 * 60 * 1000;

export function repairBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(REPAIR_BACKOFF_MAX_MS, REPAIR_BACKOFF_BASE_MS * 2 ** Math.min(attempts - 1, 30));
}

export function repairStatePath(managedRoot: string): string {
  return join(managedRoot, 'windows-bootstrap-repair.json');
}

async function readRepairState(file: string): Promise<WindowsRepairState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as WindowsRepairState;
    if (typeof parsed?.attempts !== 'number' || typeof parsed.lastAttemptAt !== 'number' || typeof parsed.missingKey !== 'string') return null;
    return parsed;
  } catch { return null; }
}

async function writeRepairState(file: string, state: WindowsRepairState): Promise<void> {
  try {
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(state), 'utf8');
  } catch { /* best effort */ }
}

export type WindowsRepairOutcome =
  | { ran: false; reason: 'not-needed' | 'no-script' | 'backoff' | 'already-ran'; nextAttemptAt?: number }
  | { ran: true; recoveryCode: number; attempts: number; missingTools: string[] };

let repairScheduled = false;
export function resetWindowsBootstrapRepairForTests(): void { repairScheduled = false; }

/**
 * Spawn-gate budget for the repair itself, counted from the moment
 * bootstrap.ps1 starts (mirrors the macOS shell-env bound). The offline
 * installer typically finishes well within it; a slower run keeps going in
 * the background and re-applies PATH when done.
 */
export const WINDOWS_REPAIR_SPAWN_WAIT_MS = 6_000;
/**
 * Hard cap on any single wait on the repair gate, from the moment the waiter
 * started waiting: covers the pre-start phase (state read, backoff check;
 * normally milliseconds once a waiter released the first-paint gate) plus the
 * repair budget, so nothing can hang on a repair that never starts.
 */
export const WINDOWS_REPAIR_SPAWN_MAX_WAIT_MS = 12_000;

/** Signals between the repair scheduler and its spawn gate. */
export interface WindowsRepairSignals {
  /** Resolves when a spawner needs the prerequisites now: skip the first-paint wait. */
  expedite: Promise<void>;
  /** Called right before bootstrap.ps1 is launched. */
  onStarted(): void;
}

/**
 * Spawn-env gate for a background Windows repair.
 *
 * - `wait()` releases the scheduler's first-paint gate (`signals.expedite`).
 * - The repair budget (`repairBudgetMs`) runs from `signals.onStarted()`,
 *   i.e. when bootstrap.ps1 actually begins — not from the first wait.
 * - Every wait is also capped at `maxWaitMs` from its own start.
 * - `settle()` (repair finished, skipped, backed off or failed) releases all
 *   waiters; the first timeout latches the gate so later spawns never wait.
 */
export function createWindowsRepairSpawnGate(options: { repairBudgetMs?: number; maxWaitMs?: number; now?: () => number } = {}) {
  const repairBudgetMs = options.repairBudgetMs ?? WINDOWS_REPAIR_SPAWN_WAIT_MS;
  const maxWaitMs = options.maxWaitMs ?? WINDOWS_REPAIR_SPAWN_MAX_WAIT_MS;
  const now = options.now ?? Date.now;
  let settled = false;
  let latched = false;
  let startedAt: number | null = null;
  let expedite!: () => void;
  const expedited = new Promise<void>((resolve) => { expedite = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let markSettled!: () => void;
  const settledPromise = new Promise<void>((resolve) => { markSettled = resolve; });
  const unref = (timer: ReturnType<typeof setTimeout>) => { (timer as { unref?: () => void }).unref?.(); return timer; };

  const gate: SpawnEnvGate & { readonly latched: boolean; readonly settled: boolean } = {
    get latched() { return latched; },
    get settled() { return settled; },
    isReady: () => settled || latched,
    wait(): Promise<void> {
      if (settled || latched) return Promise.resolve();
      expedite();
      return new Promise<void>((resolve) => {
        let done = false;
        let budgetTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (timedOut: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(overall);
          if (budgetTimer) clearTimeout(budgetTimer);
          if (timedOut && !settled) latched = true;
          resolve();
        };
        const overall = unref(setTimeout(() => finish(true), maxWaitMs));
        void settledPromise.then(() => finish(false));
        void started.then(() => {
          if (done) return;
          const remaining = Math.max(0, repairBudgetMs - (now() - (startedAt ?? now())));
          budgetTimer = unref(setTimeout(() => finish(true), remaining));
        });
      });
    },
  };
  return {
    gate,
    signals: {
      expedite: expedited,
      onStarted() { if (startedAt === null) { startedAt = now(); markStarted(); } },
    } satisfies WindowsRepairSignals,
    settle(): void { if (!settled) { settled = true; markSettled(); } },
  };
}

/**
 * Run the offline bootstrap.ps1 repair in the background, at most once per
 * launch and at most once per backoff window (1 h doubling, capped at 7 d,
 * reset when the set of missing tools changes). The result is recorded in
 * `<managedRoot>/windows-bootstrap-repair.json`; a successful repair re-reads
 * the receipt and re-applies PATH for children spawned afterwards.
 */
export async function scheduleWindowsBootstrapRepair(options: WindowsBootstrapInitOptions & {
  missingTools: string[];
  mode?: WindowsDependencyMode;
  /** Gate (e.g. renderer first paint). Waited for at most `maxGateWaitMs`. */
  after?: Promise<unknown>;
  maxGateWaitMs?: number;
  /** Spawn-gate signals: `expedite` skips the `after` wait, `onStarted` marks bootstrap.ps1 start. */
  signals?: WindowsRepairSignals;
  now?: () => number;
  run?: typeof runNativeBootstrap;
}): Promise<WindowsRepairOutcome> {
  if (repairScheduled) return { ran: false, reason: 'already-ran' };
  repairScheduled = true;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  if (!options.isPackaged || options.missingTools.length === 0) return { ran: false, reason: 'not-needed' };
  const script = join(options.resourcesPath, 'windows-bootstrap', 'bootstrap.ps1');
  if (!existsSync(script)) return { ran: false, reason: 'no-script' };

  const missingKey = [...options.missingTools].sort().join(',');
  const stateFile = repairStatePath(options.managedRoot);
  const previous = await readRepairState(stateFile);
  const priorAttempts = previous && previous.missingKey === missingKey ? previous.attempts : 0;
  if (previous && priorAttempts > 0) {
    const nextAttemptAt = previous.lastAttemptAt + repairBackoffMs(priorAttempts);
    if (now() < nextAttemptAt) return { ran: false, reason: 'backoff', nextAttemptAt };
  }

  if (options.after) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      options.after.catch(() => undefined),
      // A spawner that needs the prerequisites does not wait for first paint.
      ...(options.signals ? [options.signals.expedite] : []),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, options.maxGateWaitMs ?? 15_000); }),
    ]);
    if (timer) clearTimeout(timer);
  }

  const mode = options.mode ?? options.preference ?? 'auto';
  options.signals?.onStarted();
  // Only native offline provisioning. WSL consent is installer-only.
  const recoveryCode = await (options.run ?? runNativeBootstrap)(script, mode, env);
  const probeCache = options.probeCache === false ? undefined : createFileProbeCache(probeCachePath(options.managedRoot), { appVersion: options.appVersion });
  await probeCache?.load();
  const key = pathEnvKey(env, true);
  const readOptions = readOptionsFor(options, env, env[key] ?? '', probeCache);
  const read = options.read ?? readWindowsBootstrap;
  let runtime = await read(readOptions);
  if (!runtime) {
    readOptions.preference = options.preference ?? 'auto';
    runtime = await read(readOptions);
  }
  const after = summary(runtime, options.preference);
  if (runtime) await applyRuntime(runtime, env, env[key] ?? '', options.gitBashPreference);
  void probeCache?.flush();
  const fixed = after.missingTools.length === 0;
  // Key the backoff on what is still missing, so the next launch backs off
  // unless the missing set changes again.
  const stillMissingKey = [...after.missingTools].sort().join(',');
  const attempts = fixed ? 0 : stillMissingKey === missingKey ? priorAttempts + 1 : 1;
  await writeRepairState(stateFile, { attempts, lastAttemptAt: now(), lastCode: recoveryCode,
    missingKey: stillMissingKey, mode });
  return { ran: true, recoveryCode, attempts, missingTools: after.missingTools };
}
