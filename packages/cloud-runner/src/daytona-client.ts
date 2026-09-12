/**
 * Daytona sandbox client — injectable so tests never need live credentials.
 *
 * HTTP impl resolves the API key per request via a getter. The key is
 * never stored on the run record and is stripped from error strings.
 */
import { CloudRunnerError } from './types.ts';

function redactSecret(text: string, secret: string): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('***REDACTED***');
}

export const DAYTONA_RUN_LABEL = 'rox.cloud-run';

export interface DaytonaSandboxRecord {
  id: string;
  state: 'creating' | 'started' | 'stopping' | 'stopped' | 'destroyed' | 'error';
  labels: Record<string, string>;
  createdAt: number;
}

export interface DaytonaFileMeta {
  path: string;
  size: number;
}

export interface DaytonaExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DaytonaClient {
  createSandbox(opts: {
    name: string;
    snapshot?: string;
    image?: string;
    region?: string;
    projectId?: string;
    labels: Record<string, string>;
    autoDeleteIntervalMin: number;
  }): Promise<DaytonaSandboxRecord>;
  getSandbox(id: string): Promise<DaytonaSandboxRecord>;
  startSandbox(id: string): Promise<DaytonaSandboxRecord>;
  stopSandbox(id: string): Promise<void>;
  deleteSandbox(id: string): Promise<void>;
  listSandboxes(label?: { key: string; value: string }): Promise<DaytonaSandboxRecord[]>;
  writeFile(sandboxId: string, path: string, bytes: Uint8Array): Promise<void>;
  readFile(sandboxId: string, path: string): Promise<Uint8Array>;
  listFiles(sandboxId: string, path: string): Promise<DaytonaFileMeta[]>;
  exec(sandboxId: string, command: string, signal?: AbortSignal): Promise<DaytonaExecResult>;
}

function posixJoin(...parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/');
}

function assertSafeSandboxPath(path: string): void {
  if (!path.startsWith('/') || path.split('/').includes('..')) {
    throw new CloudRunnerError(`unsafe sandbox path: ${path}`, 'path_traversal');
  }
}

/** In-memory Daytona stand-in for conformance and unit tests. */
export class MemoryDaytonaClient implements DaytonaClient {
  readonly sandboxes = new Map<string, DaytonaSandboxRecord>();
  readonly files = new Map<string, Map<string, Uint8Array>>();
  /** Delay applied to `rox-run` so cancel can win in conformance. */
  execDelayMs: number;
  lastExecCommand = '';
  private seq = 0;

  constructor(opts?: { execDelayMs?: number }) {
    this.execDelayMs = opts?.execDelayMs ?? 80;
  }

  async createSandbox(opts: {
    name: string;
    snapshot?: string;
    image?: string;
    region?: string;
    projectId?: string;
    labels: Record<string, string>;
    autoDeleteIntervalMin: number;
  }): Promise<DaytonaSandboxRecord> {
    const id = `sbx-${Date.now().toString(36)}-${(this.seq += 1)}`;
    const record: DaytonaSandboxRecord = {
      id,
      state: 'creating',
      labels: { ...opts.labels, name: opts.name },
      createdAt: Date.now(),
    };
    this.sandboxes.set(id, record);
    this.files.set(id, new Map());
    return record;
  }

  async getSandbox(id: string): Promise<DaytonaSandboxRecord> {
    const record = this.sandboxes.get(id);
    if (!record || record.state === 'destroyed') {
      throw new CloudRunnerError(`sandbox not found: ${id}`, 'not_found');
    }
    return record;
  }

  async startSandbox(id: string): Promise<DaytonaSandboxRecord> {
    const record = await this.getSandbox(id);
    record.state = 'started';
    return record;
  }

  async stopSandbox(id: string): Promise<void> {
    const record = await this.getSandbox(id);
    record.state = 'stopped';
  }

  async deleteSandbox(id: string): Promise<void> {
    const record = this.sandboxes.get(id);
    if (!record) throw new CloudRunnerError(`sandbox not found: ${id}`, 'not_found');
    record.state = 'destroyed';
    this.files.delete(id);
  }

  async listSandboxes(label?: { key: string; value: string }): Promise<DaytonaSandboxRecord[]> {
    const all = [...this.sandboxes.values()].filter((s) => s.state !== 'destroyed');
    if (!label) return all;
    return all.filter((s) => s.labels[label.key] === label.value);
  }

  async writeFile(sandboxId: string, path: string, bytes: Uint8Array): Promise<void> {
    assertSafeSandboxPath(path);
    await this.getSandbox(sandboxId);
    this.files.get(sandboxId)!.set(path, bytes);
  }

  async readFile(sandboxId: string, path: string): Promise<Uint8Array> {
    assertSafeSandboxPath(path);
    await this.getSandbox(sandboxId);
    const bytes = this.files.get(sandboxId)?.get(path);
    if (!bytes) throw new CloudRunnerError(`file not found: ${path}`, 'not_found');
    return bytes;
  }

  async listFiles(sandboxId: string, root: string): Promise<DaytonaFileMeta[]> {
    assertSafeSandboxPath(root);
    await this.getSandbox(sandboxId);
    const prefix = root.endsWith('/') ? root : `${root}/`;
    const out: DaytonaFileMeta[] = [];
    for (const [path, bytes] of this.files.get(sandboxId) ?? []) {
      if (path === root || path.startsWith(prefix)) {
        out.push({ path, size: bytes.byteLength });
      }
    }
    return out;
  }

  async exec(sandboxId: string, command: string, signal?: AbortSignal): Promise<DaytonaExecResult> {
    this.lastExecCommand = command;
    await this.getSandbox(sandboxId);
    if (command === 'rox-run' || command.startsWith('rox-run ')) {
      if (this.execDelayMs > 0) {
        await abortableSleep(this.execDelayMs, signal);
      }
      await this.materializeRun(sandboxId);
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  private async materializeRun(sandboxId: string): Promise<void> {
    const specBytes = this.files.get(sandboxId)?.get('/run/spec.json');
    if (!specBytes) return;
    const spec = JSON.parse(new TextDecoder().decode(specBytes)) as {
      id: string;
      subtasks: { id: string; title?: string; prompt: string }[];
    };
    const files = this.files.get(sandboxId)!;
    for (const subtask of spec.subtasks) {
      const marker = posixJoin('/run/artifacts', subtask.id, 'done.marker');
      if (files.has(marker)) continue;
      const notePath = posixJoin('/run/artifacts', subtask.id, 'notes.md');
      const note = [
        `# ${subtask.title ?? subtask.id}`,
        '',
        `> Daytona artifact for run ${spec.id}.`,
        '',
        '## Prompt',
        '',
        subtask.prompt,
        '',
      ].join('\n');
      files.set(notePath, new TextEncoder().encode(note));
      files.set(marker, new TextEncoder().encode(`${new Date().toISOString()}\n`));
    }
  }
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new CloudRunnerError('exec aborted', 'cancelled');
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(new CloudRunnerError('exec aborted', 'cancelled'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await promise;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

type DaytonaFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpDaytonaClientOptions {
  apiUrl?: string;
  resolveApiKey: () => Promise<string>;
  fetchImpl?: DaytonaFetch;
}

/** Thin REST client against the Daytona control plane. */
export class HttpDaytonaClient implements DaytonaClient {
  private readonly apiUrl: string;
  private readonly resolveApiKey: () => Promise<string>;
  private readonly http: DaytonaFetch;

  constructor(opts: HttpDaytonaClientOptions) {
    this.apiUrl = (opts.apiUrl ?? 'https://app.daytona.io/api').replace(/\/+$/, '');
    this.resolveApiKey = opts.resolveApiKey;
    this.http = opts.fetchImpl ?? fetch;
  }

  async createSandbox(opts: {
    name: string;
    snapshot?: string;
    image?: string;
    region?: string;
    projectId?: string;
    labels: Record<string, string>;
    autoDeleteIntervalMin: number;
  }): Promise<DaytonaSandboxRecord> {
    const body: Record<string, unknown> = {
      name: opts.name,
      labels: opts.labels,
      autoDeleteInterval: opts.autoDeleteIntervalMin,
    };
    if (opts.snapshot) body.snapshot = opts.snapshot;
    if (opts.image) body.image = opts.image;
    if (opts.region) body.target = opts.region;
    if (opts.projectId) body.projectId = opts.projectId;
    const json = await this.request<Record<string, unknown>>('POST', '/sandbox', body);
    return this.parseSandbox(json);
  }

  async getSandbox(id: string): Promise<DaytonaSandboxRecord> {
    return this.parseSandbox(await this.request<Record<string, unknown>>('GET', `/sandbox/${id}`));
  }

  async startSandbox(id: string): Promise<DaytonaSandboxRecord> {
    return this.parseSandbox(await this.request<Record<string, unknown>>('POST', `/sandbox/${id}/start`));
  }

  async stopSandbox(id: string): Promise<void> {
    await this.request('POST', `/sandbox/${id}/stop`);
  }

  async deleteSandbox(id: string): Promise<void> {
    await this.request('DELETE', `/sandbox/${id}`);
  }

  async listSandboxes(label?: { key: string; value: string }): Promise<DaytonaSandboxRecord[]> {
    const json = await this.request<unknown>('GET', '/sandbox');
    const rows = Array.isArray(json) ? json : (json as { items?: unknown[] })?.items ?? [];
    const parsed = (rows as Record<string, unknown>[]).map((row) => this.parseSandbox(row));
    if (!label) return parsed;
    return parsed.filter((s) => s.labels[label.key] === label.value);
  }

  async writeFile(sandboxId: string, path: string, bytes: Uint8Array): Promise<void> {
    assertSafeSandboxPath(path);
    await this.request('POST', `/toolbox/${sandboxId}/files`, {
      path,
      content: Buffer.from(bytes).toString('base64'),
    });
  }

  async readFile(sandboxId: string, path: string): Promise<Uint8Array> {
    assertSafeSandboxPath(path);
    const json = await this.request<{ content?: string }>('GET', `/toolbox/${sandboxId}/files/download?path=${encodeURIComponent(path)}`);
    return Uint8Array.from(Buffer.from(String(json.content ?? ''), 'base64'));
  }

  async listFiles(sandboxId: string, path: string): Promise<DaytonaFileMeta[]> {
    assertSafeSandboxPath(path);
    const json = await this.request<unknown>('GET', `/toolbox/${sandboxId}/files?path=${encodeURIComponent(path)}`);
    const rows = Array.isArray(json) ? json : [];
    return (rows as { name?: string; path?: string; size?: number }[]).map((row) => ({
      path: String(row.path ?? row.name ?? '').replace(/^\//, ''),
      size: Number(row.size ?? 0),
    }));
  }

  async exec(sandboxId: string, command: string, signal?: AbortSignal): Promise<DaytonaExecResult> {
    const json = await this.request<{ exitCode?: number; stdout?: string; stderr?: string }>(
      'POST',
      `/toolbox/${sandboxId}/process/execute`,
      { command, timeout: 600 },
      signal,
    );
    return {
      exitCode: Number(json.exitCode ?? 0),
      stdout: String(json.stdout ?? ''),
      stderr: String(json.stderr ?? ''),
    };
  }

  private parseSandbox(json: Record<string, unknown>): DaytonaSandboxRecord {
    return {
      id: String(json.id ?? json.sandboxId ?? ''),
      state: this.mapState(json.state ?? json.stateName),
      labels: (json.labels as Record<string, string> | undefined) ?? {},
      createdAt: typeof json.createdAt === 'number' ? json.createdAt : Date.now(),
    };
  }

  private mapState(raw: unknown): DaytonaSandboxRecord['state'] {
    const value = String(raw ?? '').toLowerCase();
    if (value === 'started' || value === 'running') return 'started';
    if (value === 'stopped') return 'stopped';
    if (value === 'stopping') return 'stopping';
    if (value === 'destroyed' || value === 'deleted') return 'destroyed';
    if (value === 'error' || value === 'failed') return 'error';
    return 'creating';
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const key = await this.resolveApiKey();
    let res: Response;
    try {
      res = await this.http(`${this.apiUrl}${path}`, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new CloudRunnerError(
        redactSecret(error instanceof Error ? error.message : String(error), key),
        'provider_error',
        { cause: error },
      );
    }
    if (!res.ok) {
      const text = redactSecret(await res.text().catch(() => ''), key);
      throw new CloudRunnerError(`daytona ${method} ${path} failed: ${res.status} ${text}`.trim(), 'provider_error');
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }
}
