/**
 * DaytonaProvider — sole cloud CloudRunProvider (Rox tracker issue 25).
 *
 * Lifecycle: start → ready → running → done|failed|cancelled|expired.
 * Credentials arrive only through resolveApiKey / an injected client.
 * A Daytona failure never selects another provider.
 */
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  ArtifactMeta,
  CloudRunProvider,
  RunEvent,
  RunHandle,
  RunSpec,
  RunStatus,
} from './types.ts';
import {
  CloudRunnerError,
  assertSafeArtifactPath,
  isActiveRunState,
  isTerminalRunState,
  resolveLimits,
} from './types.ts';
import {
  DAYTONA_RUN_LABEL,
  HttpDaytonaClient,
  MemoryDaytonaClient,
  type DaytonaClient,
} from './daytona-client.ts';

export const DAYTONA_MAX_WALL_CLOCK_SEC = 6 * 60 * 60;
export const DAYTONA_MAX_TTL_SEC = 24 * 60 * 60;
export const DAYTONA_MAX_CONCURRENCY = 4;
export const DAYTONA_DEFAULT_CONCURRENCY = 2;
export const DAYTONA_DEFAULT_TTL_SEC = 60 * 60;

export interface DaytonaProviderOptions {
  baseDir: string;
  client?: DaytonaClient;
  resolveApiKey?: () => Promise<string>;
  apiUrl?: string;
  projectId?: string;
  snapshot?: string;
  sandboxName?: string;
  region?: string;
  image?: string;
  ttlSec?: number;
  pollMs?: number;
}

interface RunRecord extends RunStatus {
  sandboxId?: string;
}

interface SandboxMeta {
  sandboxId: string;
}

function boundTtl(ttlSec?: number): number {
  const ttl = ttlSec && ttlSec > 0 ? ttlSec : DAYTONA_DEFAULT_TTL_SEC;
  return Math.min(ttl, DAYTONA_MAX_TTL_SEC);
}

export function boundConcurrency(value?: number): number {
  if (!value || !Number.isFinite(value) || value < 1) return DAYTONA_DEFAULT_CONCURRENCY;
  return Math.min(DAYTONA_MAX_CONCURRENCY, Math.floor(value));
}

/** Clamped budgets the provider actually enforces for one run. */
export interface RunBounds {
  maxWallClockSec: number;
  maxLlmTokens: number;
  maxArtifactsBytes: number;
  ttlSec: number;
}

function boundLimits(spec: RunSpec): RunBounds {
  const limits = resolveLimits(spec.limits);
  return {
    maxWallClockSec: Math.min(limits.maxWallClockSec, DAYTONA_MAX_WALL_CLOCK_SEC),
    maxLlmTokens: limits.maxLlmTokens,
    maxArtifactsBytes: limits.maxArtifactsBytes,
    ttlSec: boundTtl(spec.ttlSec),
  };
}

/**
 * A JSON read where "the file is not there" and "the file is there but
 * unreadable" are different answers. Collapsing both into `null` is how a
 * torn/corrupt `state.json` used to surface as `run not found` for a run that
 * is alive, which callers (and the UI) treat as a deletion.
 */
type JsonRead<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'corrupt'; detail: string };

async function readJsonResult<T>(path: string): Promise<JsonRead<T>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    // Only "there is no such file" means missing; any other read failure is a
    // real filesystem problem and must not be reported as a deleted run.
    const missing =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code === 'ENOENT';
    if (missing) return { status: 'missing' };
    throw error;
  }
  try {
    return { status: 'ok', value: JSON.parse(raw) as T };
  } catch (error) {
    return { status: 'corrupt', detail: error instanceof Error ? error.message : String(error) };
  }
}

function corruptStateError(id: string, detail: string): CloudRunnerError {
  return new CloudRunnerError(`run state is unreadable: ${id} (${detail})`, 'provider_error');
}

/**
 * Monotonic generation counter. Every `createRun` claims a fresh value, so a
 * pump or watchdog left over from a superseded lifecycle compares unequal and
 * is refused by `advanceState` instead of writing into the new run's state.
 */
let runGenerationSeq = 0;

export class DaytonaProvider implements CloudRunProvider {
  readonly providerId = 'daytona';
  private readonly baseDir: string;
  private readonly client: DaytonaClient;
  private readonly projectId?: string;
  private readonly snapshot?: string;
  private readonly sandboxName?: string;
  private readonly region?: string;
  private readonly image?: string;
  private readonly ttlSec: number;
  private readonly pollMs: number;
  private readonly aborts = new Map<string, AbortController>();
  private readonly pumps = new Map<string, Promise<void>>();
  /** One async mutex per run: serializes every read-modify-write of state.json. */
  private readonly stateLocks = new Map<string, Promise<void>>();
  /** Generation of the lifecycle that currently owns each run id. */
  private readonly generations = new Map<string, number>();

  constructor(opts: DaytonaProviderOptions) {
    this.baseDir = resolve(opts.baseDir);
    this.client =
      opts.client ??
      new HttpDaytonaClient({
        apiUrl: opts.apiUrl,
        resolveApiKey:
          opts.resolveApiKey ??
          (async () => {
            throw new CloudRunnerError('daytona secret reference is missing', 'provider_error');
          }),
      });
    this.projectId = opts.projectId;
    this.snapshot = opts.snapshot;
    this.sandboxName = opts.sandboxName;
    this.region = opts.region;
    this.image = opts.image;
    this.ttlSec = boundTtl(opts.ttlSec);
    this.pollMs = opts.pollMs ?? 50;
  }

  async createRun(spec: RunSpec): Promise<RunHandle> {
    if (!spec.id || spec.id.includes('..') || spec.id.includes('/') || spec.id.includes('\\')) {
      throw new CloudRunnerError(`invalid run id: ${JSON.stringify(spec.id)}`, 'invalid_spec');
    }
    if (spec.subtasks.length === 0) {
      throw new CloudRunnerError('spec.subtasks must not be empty', 'invalid_spec');
    }
    const dir = this.runDir(spec.id);
    const existingRead = await readJsonResult<RunRecord>(join(dir, 'state.json'));
    if (existingRead.status === 'corrupt') throw corruptStateError(spec.id, existingRead.detail);
    const existing = existingRead.status === 'ok' ? existingRead.value : null;
    if (existing && isActiveRunState(existing.state)) {
      return { id: spec.id, provider: this.providerId, createdAt: existing.startedAt ?? Date.now() };
    }
    if (existing && existing.state === 'done') {
      return { id: spec.id, provider: this.providerId, createdAt: existing.startedAt ?? Date.now() };
    }

    const bounds = boundLimits({ ...spec, ttlSec: spec.ttlSec ?? this.ttlSec });
    await mkdir(join(dir, 'artifacts'), { recursive: true });
    const safeSpec: RunSpec = {
      ...spec,
      limits: {
        maxWallClockSec: bounds.maxWallClockSec,
        maxLlmTokens: bounds.maxLlmTokens,
        maxArtifactsBytes: bounds.maxArtifactsBytes,
      },
      ttlSec: bounds.ttlSec,
      concurrency: boundConcurrency(spec.concurrency),
      agenticMode: spec.agenticMode === 'omp' ? 'omp' : 'loop',
    };
    await writeFile(join(dir, 'spec.json'), JSON.stringify(safeSpec, null, 2));
    const startedAt = Date.now();
    // A resubmitted (or resumed) run id starts a new lifecycle: this write is
    // allowed to replace a terminal state, and the fresh generation makes any
    // writer left over from the previous lifecycle unable to touch this run.
    const generation = (runGenerationSeq += 1);
    this.generations.set(spec.id, generation);
    await this.withStateLock(spec.id, () =>
      this.writeState(dir, { id: spec.id, state: 'start', startedAt }),
    );

    const sandbox = await this.client.createSandbox({
      name: this.sandboxName ? `${this.sandboxName}-${spec.id}` : `rox-${spec.id}`.slice(0, 63),
      snapshot: this.snapshot,
      image: this.image,
      region: this.region,
      projectId: this.projectId,
      labels: {
        [DAYTONA_RUN_LABEL]: '1',
        'rox.runId': spec.id,
      },
      autoDeleteIntervalMin: Math.max(1, Math.ceil(bounds.ttlSec / 60)),
    });
    await writeFile(join(dir, 'sandbox.json'), JSON.stringify({ sandboxId: sandbox.id } satisfies SandboxMeta));

    const abort = new AbortController();
    this.aborts.set(spec.id, abort);
    const pump = this.pump(spec.id, dir, sandbox.id, bounds, abort.signal, generation);
    this.pumps.set(spec.id, pump);
    void pump.finally(() => {
      // Only the newest lifecycle may retire the run's abort handle: a pump
      // that lost its generation must not disown its successor's controller.
      if (this.pumps.get(spec.id) !== pump) return;
      this.aborts.delete(spec.id);
      this.pumps.delete(spec.id);
      this.generations.delete(spec.id);
    });

    return { id: spec.id, provider: this.providerId, createdAt: startedAt };
  }

  async getStatus(id: string): Promise<RunStatus> {
    const read = await readJsonResult<RunRecord>(join(this.runDir(id), 'state.json'));
    if (read.status === 'missing') throw new CloudRunnerError(`run not found: ${id}`, 'not_found');
    // A record we cannot parse is an anomaly, not a deleted run: reporting it
    // as `not_found` made a live run look cancelled to the UI.
    if (read.status === 'corrupt') throw corruptStateError(id, read.detail);
    return read.value;
  }

  async cancel(id: string): Promise<void> {
    await this.terminate(id, 'cancelled', 'cancelled');
  }

  async kill(id: string): Promise<void> {
    await this.terminate(id, 'cancelled', 'cancelled');
  }

  async sweepZombies(): Promise<{ deletedSandboxIds: string[] }> {
    const now = Date.now();
    const deletedSandboxIds: string[] = [];
    const sandboxes = await this.client.listSandboxes({ key: DAYTONA_RUN_LABEL, value: '1' });
    for (const sandbox of sandboxes) {
      const ageSec = (now - sandbox.createdAt) / 1000;
      const runId = sandbox.labels['rox.runId'];
      const read = runId ? await readJsonResult<RunRecord>(join(this.runDir(runId), 'state.json')) : null;
      const record = read?.status === 'ok' ? read.value : null;
      const ttl = record ? boundTtl(undefined) : this.ttlSec;
      const terminal = record ? isTerminalRunState(record.state) : true;
      if (ageSec > ttl || terminal) {
        try {
          await this.client.deleteSandbox(sandbox.id);
          deletedSandboxIds.push(sandbox.id);
        } catch {
          /* best-effort */
        }
      }
    }
    return { deletedSandboxIds };
  }

  async listArtifacts(id: string): Promise<ArtifactMeta[]> {
    const root = join(this.runDir(id), 'artifacts');
    if (!existsSync(root)) {
      await this.getStatus(id);
      return [];
    }
    const out: ArtifactMeta[] = [];
    const walk = async (rel: string): Promise<void> => {
      const abs = join(root, rel);
      for (const entry of await readdir(abs, { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(childRel);
        else if (entry.isFile()) out.push({ path: childRel, size: (await stat(join(abs, entry.name))).size });
      }
    };
    await walk('');
    return out;
  }

  async fetchArtifact(id: string, path: string): Promise<Uint8Array> {
    assertSafeArtifactPath(path);
    await this.getStatus(id);
    const abs = resolve(join(this.runDir(id), 'artifacts', path));
    const root = resolve(join(this.runDir(id), 'artifacts'));
    if (!abs.startsWith(root)) throw new CloudRunnerError(`unsafe artifact path: ${path}`, 'path_traversal');
    const bytes = await readFile(abs).catch(() => null);
    if (bytes === null) throw new CloudRunnerError(`artifact not found: ${path}`, 'not_found');
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  async *subscribeEvents(id: string): AsyncIterable<RunEvent> {
    const path = join(this.runDir(id), 'events.jsonl');
    if (!existsSync(join(this.runDir(id), 'state.json'))) {
      throw new CloudRunnerError(`run not found: ${id}`, 'not_found');
    }
    let offset = 0;
    for (;;) {
      const raw = await readFile(path, 'utf8').catch(() => '');
      if (raw.length > offset) {
        const chunk = raw.slice(offset);
        offset = raw.length;
        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;
          try {
            yield JSON.parse(line) as RunEvent;
          } catch {
            /* skip */
          }
        }
      }
      const status = await this.getStatus(id);
      if (isTerminalRunState(status.state)) return;
      const { promise, resolve: wake } = Promise.withResolvers<void>();
      setTimeout(wake, this.pollMs);
      await promise;
    }
  }

  private runDir(id: string): string {
    return join(this.baseDir, id);
  }

  /**
   * Per-run async mutex. Every state transition is a read-modify-write, so
   * `terminate` and the pump must not interleave: without it the pump can read
   * a non-terminal record, lose the race to `terminate`, and then rename its
   * stale record over the terminal one — resurrecting a cancelled run.
   */
  private async withStateLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.stateLocks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => gate, () => gate);
    this.stateLocks.set(id, tail);
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.stateLocks.get(id) === tail) this.stateLocks.delete(id);
    }
  }

  /**
   * Atomic write: a plain `writeFile` truncates in place, so a reader racing
   * the write sees a half-written file. Writing a sibling temp file and
   * renaming it over the target means readers only ever observe one complete
   * version or the other.
   */
  private async writeState(dir: string, status: RunRecord): Promise<void> {
    const target = join(dir, 'state.json');
    const temp = join(dir, `.state.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    await writeFile(temp, JSON.stringify(status, null, 2));
    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    await appendFile(join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'state', status })}\n`);
  }

  /**
   * The only way the pump may move a run forward. Read, decision and write all
   * happen while holding the run's lock, so the `isActiveRunState` check can no
   * longer be stale by the time the write lands, and a record that already
   * reached a terminal state is never overwritten. Returns the record now in
   * force, or `null` when this writer no longer owns the run and must stop.
   */
  private async advanceState(
    id: string,
    dir: string,
    generation: number,
    mutate: (current: RunRecord) => RunRecord,
  ): Promise<RunRecord | null> {
    return this.withStateLock(id, async () => {
      if (this.generations.get(id) !== generation) return null;
      const read = await readJsonResult<RunRecord>(join(dir, 'state.json'));
      // Never rewrite a record we cannot parse: the previous transition's
      // content is unknown, so overwriting could destroy a terminal outcome.
      if (read.status !== 'ok' || isTerminalRunState(read.value.state)) return null;
      const next = mutate(read.value);
      await this.writeState(dir, next);
      return next;
    });
  }

  private async terminate(
    id: string,
    state: 'cancelled' | 'expired' | 'failed',
    reason: RunRecord['failureReason'],
    generation?: number,
  ): Promise<void> {
    const dir = this.runDir(id);
    await this.withStateLock(id, async () => {
      const read = await readJsonResult<RunRecord>(join(dir, 'state.json'));
      if (read.status === 'missing') throw new CloudRunnerError(`run not found: ${id}`, 'not_found');
      if (read.status === 'corrupt') throw corruptStateError(id, read.detail);
      // Terminal outcomes are absorbing: a second cancel/expiry keeps the first
      // one, and an already-finished run is never reopened.
      if (isTerminalRunState(read.value.state)) return;
      // A watchdog from a superseded lifecycle must not kill the new run.
      if (generation !== undefined && this.generations.get(id) !== generation) return;
      this.aborts.get(id)?.abort();
      const meta = await readJsonResult<SandboxMeta>(join(dir, 'sandbox.json'));
      if (meta.status === 'ok' && meta.value.sandboxId) {
        try {
          await this.client.deleteSandbox(meta.value.sandboxId);
        } catch {
          /* already gone */
        }
      }
      await this.writeState(dir, {
        ...read.value,
        state,
        failureReason: reason,
        finishedAt: Date.now(),
      });
    });
  }

  private async pump(
    id: string,
    dir: string,
    sandboxId: string,
    bounds: RunBounds,
    signal: AbortSignal,
    generation: number,
  ): Promise<void> {
    const watchdog = setTimeout(() => {
      void this.terminate(id, 'expired', 'expired', generation);
    }, bounds.maxWallClockSec * 1000);
    watchdog.unref();
    try {
      if (signal.aborted) return;
      await this.client.startSandbox(sandboxId);
      // Each phase is a serialized compare-and-write: if `cancel` committed a
      // terminal state first, the phase is refused and the pump stops instead
      // of renaming its stale non-terminal record over the terminal one.
      if (!(await this.advanceState(id, dir, generation, (current) => ({ ...current, state: 'ready' })))) return;

      const specBytes = await readFile(join(dir, 'spec.json'));
      await this.client.writeFile(sandboxId, '/run/spec.json', specBytes);
      await this.seedSandboxFromHost(dir, sandboxId);
      if (signal.aborted) return;
      if (!(await this.advanceState(id, dir, generation, (current) => ({ ...current, state: 'running' })))) return;

      const spec = JSON.parse(specBytes.toString('utf8')) as RunSpec;
      const concurrency = boundConcurrency(spec.concurrency);
      const mode = spec.agenticMode === 'omp' ? 'omp' : 'loop';
      await this.client.exec(sandboxId, `rox-run --concurrency ${concurrency} --mode ${mode}`, signal);

      await this.importArtifacts(dir, sandboxId, bounds.maxArtifactsBytes);
      if (signal.aborted) return;
      const done = await this.advanceState(id, dir, generation, (current) => ({
        id,
        state: 'done',
        startedAt: current.startedAt,
        finishedAt: Date.now(),
        progress: { completed: 1, total: 1 },
      }));
      if (!done) return;
      try {
        await this.client.deleteSandbox(sandboxId);
      } catch {
        /* imported; sandbox delete is best-effort */
      }
    } catch (error) {
      if (signal.aborted) return;
      const reason = error instanceof CloudRunnerError && error.code === 'cancelled' ? 'cancelled' : 'provider_error';
      await this.advanceState(id, dir, generation, (current) => ({
        ...current,
        state: reason === 'cancelled' ? 'cancelled' : 'failed',
        failureReason: reason,
        finishedAt: Date.now(),
      }));
      try {
        await this.client.deleteSandbox(sandboxId);
      } catch {
        /* */
      }
    } finally {
      clearTimeout(watchdog);
    }
  }

  private async seedSandboxFromHost(dir: string, sandboxId: string): Promise<void> {
    const root = join(dir, 'artifacts');
    if (!existsSync(root)) return;
    const walk = async (rel: string): Promise<void> => {
      const abs = join(root, rel);
      for (const entry of await readdir(abs, { withFileTypes: true })) {
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(child);
          continue;
        }
        assertSafeArtifactPath(child);
        const bytes = new Uint8Array(await readFile(join(root, child)));
        await this.client.writeFile(sandboxId, `/run/artifacts/${child}`, bytes);
      }
    };
    await walk('');
  }

  private async importArtifacts(dir: string, sandboxId: string, maxBytes: number): Promise<void> {
    const listed = await this.client.listFiles(sandboxId, '/run/artifacts');
    let used = 0;
    for (const file of listed) {
      const posix = file.path.replace(/\\/g, '/');
      const rel = posix.replace(/^\/?run\/artifacts\/?/, '');
      if (!rel || rel.endsWith('/') || rel.split('/').includes('..')) continue;
      assertSafeArtifactPath(rel);
      const sandboxPath = posix.startsWith('/') ? posix : `/${posix}`;
      const bytes = await this.client.readFile(sandboxId, sandboxPath);
      used += bytes.byteLength;
      if (used > maxBytes) {
        throw new CloudRunnerError('artifact budget exceeded', 'artifact_too_large');
      }
      const target = join(dir, 'artifacts', rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
}

export function createMemoryDaytonaProvider(baseDir: string, client?: MemoryDaytonaClient): DaytonaProvider {
  return new DaytonaProvider({
    baseDir,
    client: client ?? new MemoryDaytonaClient(),
  });
}
