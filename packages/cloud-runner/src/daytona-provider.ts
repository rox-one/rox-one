/**
 * DaytonaProvider — sole cloud CloudRunProvider (Rox tracker issue 25).
 *
 * Lifecycle: start → ready → running → done|failed|cancelled|expired.
 * Credentials arrive only through resolveApiKey / an injected client.
 * A Daytona failure never selects another provider.
 */
import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
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

function boundLimits(spec: RunSpec): { maxWallClockSec: number; maxLlmTokens: number; maxArtifactsBytes: number; ttlSec: number } {
  const limits = resolveLimits(spec.limits);
  return {
    maxWallClockSec: Math.min(limits.maxWallClockSec, DAYTONA_MAX_WALL_CLOCK_SEC),
    maxLlmTokens: limits.maxLlmTokens,
    maxArtifactsBytes: limits.maxArtifactsBytes,
    ttlSec: boundTtl(spec.ttlSec),
  };
}

async function readJson<T>(path: string): Promise<T | null> {
  const raw = await readFile(path, 'utf8').catch(() => null);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

let atomicSeq = 0;

/**
 * Запись через временный файл рядом + rename. `rename` в пределах одной ФС атомарен,
 * поэтому читатель видит либо прежнее содержимое, либо новое, но НИКОГДА не усечённое.
 *
 * Это не косметика. `readJson` выше глотает ЛЮБУЮ ошибку чтения и возвращает `null`,
 * а `getStatus` превращает `null` в `run not found`. При неатомарной записи
 * (`writeFile` = truncate + write) читатель, попавший в окно между усечением и
 * записью, объявляет СУЩЕСТВУЮЩИЙ запуск пропавшим. Воспроизводилось как флак
 * `cancel terminates the sandbox and reads cancelled back`: замер на точных копиях
 * readJson/setState дал 1 `null` на 58 531 чтений при 7 041 записи — отсюда
 * «падает примерно раз на шесть прогонов».
 */
async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${atomicSeq++}.tmp`;
  await writeFile(tmp, contents);
  await rename(tmp, path);
}

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
  private readonly runLocks = new Map<string, Promise<unknown>>();

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

  /**
   * Сериализует переходы состояния ОДНОГО запуска. Без этого `pump` и `cancel`
   * перетирают друг друга: `pump` успевает прочитать `state.json`, пока там ещё
   * `start`, затем `cancel` пишет `cancelled`, а затем `pump` дописывает свой
   * `ready` — и отменённый запуск навсегда остаётся в НЕТЕРМИНАЛЬНОМ состоянии,
   * то есть превращается в зомби, которого никто не уберёт.
   *
   * Замер на точной последовательности createRun → cancel: 20 из 300 отмен
   * (6.7 %) терялись именно так; 4 из 300 давали `state: 'ready'` без
   * `failureReason` — ровно то, на чём падала проверка
   * «cancel kills a running run: expected cancelled reason, got none».
   */
  private withRunLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.runLocks.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail: Promise<unknown> = run.catch(() => undefined);
    this.runLocks.set(id, tail);
    void tail.then(() => {
      if (this.runLocks.get(id) === tail) this.runLocks.delete(id);
    });
    return run;
  }

  /**
   * Переход состояния, который ОТКАЗЫВАЕТСЯ затирать терминальное состояние.
   * Возвращает `false`, если запуск уже терминален: вызывающий не должен считать
   * такой переход применённым. Вызывать только под `withRunLock`.
   */
  private async transition(
    dir: string,
    patch: Partial<RunRecord> & Pick<RunRecord, 'state'>,
  ): Promise<boolean> {
    const current = await readJson<RunRecord>(join(dir, 'state.json'));
    if (!current) return false;
    if (isTerminalRunState(current.state)) return false;
    await this.setState(dir, { ...current, ...patch });
    return true;
  }

  async createRun(spec: RunSpec): Promise<RunHandle> {
    if (!spec.id || spec.id.includes('..') || spec.id.includes('/') || spec.id.includes('\\')) {
      throw new CloudRunnerError(`invalid run id: ${JSON.stringify(spec.id)}`, 'invalid_spec');
    }
    if (spec.subtasks.length === 0) {
      throw new CloudRunnerError('spec.subtasks must not be empty', 'invalid_spec');
    }
    const dir = this.runDir(spec.id);
    const existing = await readJson<RunRecord>(join(dir, 'state.json'));
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
    await this.setState(dir, { id: spec.id, state: 'start', startedAt });

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
    const pump = this.pump(spec.id, dir, sandbox.id, bounds, abort.signal);
    this.pumps.set(spec.id, pump);
    void pump.finally(() => {
      this.aborts.delete(spec.id);
      this.pumps.delete(spec.id);
    });

    return { id: spec.id, provider: this.providerId, createdAt: startedAt };
  }

  async getStatus(id: string): Promise<RunStatus> {
    const state = await readJson<RunRecord>(join(this.runDir(id), 'state.json'));
    if (!state) throw new CloudRunnerError(`run not found: ${id}`, 'not_found');
    return state;
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
      const record = runId ? await readJson<RunRecord>(join(this.runDir(runId), 'state.json')) : null;
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

  private async setState(dir: string, status: RunRecord): Promise<void> {
    await writeFileAtomic(join(dir, 'state.json'), JSON.stringify(status, null, 2));
    await appendFile(join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'state', status })}\n`);
  }

  private async terminate(
    id: string,
    state: 'cancelled' | 'expired' | 'failed',
    reason: RunRecord['failureReason'],
  ): Promise<void> {
    const dir = this.runDir(id);
    await this.withRunLock(id, async () => {
      const current = await readJson<RunRecord>(join(dir, 'state.json'));
      if (!current) throw new CloudRunnerError(`run not found: ${id}`, 'not_found');
      if (isTerminalRunState(current.state)) return;
      this.aborts.get(id)?.abort();
      const meta = await readJson<SandboxMeta>(join(dir, 'sandbox.json'));
      if (meta?.sandboxId) {
        try {
          await this.client.deleteSandbox(meta.sandboxId);
        } catch {
          /* already gone */
        }
      }
      await this.setState(dir, {
        ...current,
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
    bounds: ReturnType<typeof boundLimits>,
    signal: AbortSignal,
  ): Promise<void> {
    const watchdog = setTimeout(() => {
      void this.terminate(id, 'expired', 'expired');
    }, bounds.maxWallClockSec * 1000);
    watchdog.unref();
    try {
      if (signal.aborted) return;
      await this.client.startSandbox(sandboxId);
      // Переход под замком и с отказом затирать терминальное состояние: иначе
      // параллельный cancel() будет потерян, и запуск останется зомби в 'ready'.
      if (!(await this.withRunLock(id, () => this.transition(dir, { state: 'ready' })))) return;

      const specBytes = await readFile(join(dir, 'spec.json'));
      await this.client.writeFile(sandboxId, '/run/spec.json', specBytes);
      await this.seedSandboxFromHost(dir, sandboxId);
      if (signal.aborted) return;
      if (!(await this.withRunLock(id, () => this.transition(dir, { state: 'running' })))) return;
      const spec = JSON.parse(specBytes.toString('utf8')) as RunSpec;
      const concurrency = boundConcurrency(spec.concurrency);
      const mode = spec.agenticMode === 'omp' ? 'omp' : 'loop';
      await this.client.exec(sandboxId, `rox-run --concurrency ${concurrency} --mode ${mode}`, signal);

      await this.importArtifacts(dir, sandboxId, bounds.maxArtifactsBytes);
      if (signal.aborted) return;
      // Отменённый запуск не должен становиться 'done': transition() откажет,
      // если состояние уже терминальное, а песочницу всё равно убираем.
      await this.withRunLock(id, () =>
        this.transition(dir, {
          state: 'done',
          finishedAt: Date.now(),
          progress: { completed: 1, total: 1 },
        }),
      );
      try {
        await this.client.deleteSandbox(sandboxId);
      } catch {
        /* imported; sandbox delete is best-effort */
      }
    } catch (error) {
      if (signal.aborted) return;
      const reason = error instanceof CloudRunnerError && error.code === 'cancelled' ? 'cancelled' : 'provider_error';
      await this.withRunLock(id, () =>
        this.transition(dir, {
          state: reason === 'cancelled' ? 'cancelled' : 'failed',
          failureReason: reason,
          finishedAt: Date.now(),
        }),
      );
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
