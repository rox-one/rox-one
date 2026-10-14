/**
 * Desktop-side Daytona client for default-key handoffs: every call goes to the
 * Rox-hosted broker (ROX_CLOUD_HANDOFF_BROKER_URL) authenticated with the
 * user's id.rox.one token. The shared Daytona key never reaches the desktop.
 */
import { CloudRunnerError } from '../types.ts';
import type { DaytonaClient, DaytonaExecResult, DaytonaFileMeta, DaytonaSandboxRecord } from '../daytona-client.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const BROKER_API_PREFIX = '/api/cloud-handoff/v1';

export interface BrokerClientOptions {
  brokerUrl: string;
  getAccessToken: () => Promise<string>;
  fetchImpl?: Fetch;
}

export class BrokerDaytonaClient implements DaytonaClient {
  private readonly base: string;
  private readonly http: Fetch;

  constructor(private readonly opts: BrokerClientOptions) {
    const url = new URL(opts.brokerUrl);
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new CloudRunnerError('cloud handoff broker must be https', 'provider_error');
    }
    this.base = `${url.origin}${url.pathname.replace(/\/+$/, '')}${BROKER_API_PREFIX}`;
    this.http = opts.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = await this.opts.getAccessToken();
    let res: Response;
    try {
      res = await this.http(`${this.base}${path}`, {
        method,
        signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new CloudRunnerError('cloud handoff broker unreachable', 'provider_error', { cause: error });
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      const code = typeof json?.error === 'string' ? json.error.slice(0, 64) : String(res.status);
      throw new CloudRunnerError(`broker ${method} ${path.split('?')[0]} failed: ${code}`, res.status === 404 ? 'not_found' : 'provider_error');
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }

  createSandbox(opts: Parameters<DaytonaClient['createSandbox']>[0]): Promise<DaytonaSandboxRecord> {
    // The broker owns snapshot/visibility/intervals; only name + handoff id travel.
    return this.call('POST', '/sandboxes', { name: opts.name, handoffId: opts.labels['rox.cloud-handoff.id'] });
  }
  getSandbox(id: string): Promise<DaytonaSandboxRecord> {
    return this.call('GET', `/sandboxes/${encodeURIComponent(id)}`);
  }
  startSandbox(id: string): Promise<DaytonaSandboxRecord> {
    return this.call('POST', `/sandboxes/${encodeURIComponent(id)}/start`);
  }
  async stopSandbox(id: string): Promise<void> {
    await this.call('POST', `/sandboxes/${encodeURIComponent(id)}/stop`);
  }
  async deleteSandbox(id: string): Promise<void> {
    await this.call('DELETE', `/sandboxes/${encodeURIComponent(id)}`);
  }
  async listSandboxes(): Promise<DaytonaSandboxRecord[]> {
    // The broker only ever lists the caller's own handoff sandboxes.
    const json = await this.call<{ items?: DaytonaSandboxRecord[] }>('GET', '/sandboxes');
    return json.items ?? [];
  }
  async writeFile(sandboxId: string, path: string, bytes: Uint8Array): Promise<void> {
    await this.call('PUT', `/sandboxes/${encodeURIComponent(sandboxId)}/files`, {
      path,
      content: Buffer.from(bytes).toString('base64'),
    });
  }
  async readFile(): Promise<Uint8Array> {
    throw new CloudRunnerError('broker does not expose file reads', 'provider_error');
  }
  async listFiles(): Promise<DaytonaFileMeta[]> {
    throw new CloudRunnerError('broker does not expose file listing', 'provider_error');
  }
  exec(sandboxId: string, command: string, signal?: AbortSignal): Promise<DaytonaExecResult> {
    return this.call('POST', `/sandboxes/${encodeURIComponent(sandboxId)}/exec`, { command }, signal);
  }
  async getSignedPreviewUrl(sandboxId: string, port: number, expiresInSeconds: number): Promise<string> {
    const json = await this.call<{ url?: string }>(
      'GET',
      `/sandboxes/${encodeURIComponent(sandboxId)}/signed-preview-url?port=${Math.trunc(port)}&expiresInSeconds=${Math.trunc(expiresInSeconds)}`,
    );
    if (typeof json.url !== 'string' || !json.url.startsWith('https://')) {
      throw new CloudRunnerError('broker returned no https preview url', 'provider_error');
    }
    return json.url;
  }
}
