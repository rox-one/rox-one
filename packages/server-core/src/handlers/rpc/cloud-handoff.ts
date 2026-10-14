/**
 * «В облако» — cloud handoff RPC (docs/cloud-handoff-design.md).
 *
 * Desktop-only (localElectron). Key policy: the user's own Daytona key talks
 * to Daytona directly; otherwise everything goes through the Rox-hosted broker
 * (ROX_CLOUD_HANDOFF_BROKER_URL) with the user's id.rox.one token. The shared
 * Daytona key is never present on the desktop. Flag `cloudHandoff.enabled`
 * defaults to off.
 */
import { randomBytes } from 'node:crypto';
import {
  BrokerDaytonaClient,
  HANDOFF_BROKER_URL_ENV,
  HandoffError,
  HttpDaytonaClient,
  fetchRoxIdSubject,
  isPlausibleDaytonaKey,
  ensureSessionRunning,
  issueSignedSessionLink,
  readPersonalHandoffKey,
  runCloudHandoff,
  type DaytonaClient,
  type HandoffStatus,
  type SnapshotSource,
} from '@rox/cloud-runner';
import { RPC_CHANNELS } from '@rox/shared/protocol';
import type { RpcServer } from '@rox/server-core/transport';
import { getWorkspaceByNameOrId, loadStoredConfig, type StoredConfig } from '@rox/shared/config/storage';
import type { HandlerDeps } from '../handler-deps';

export const DEFAULT_ROX_ID_ISSUER = 'https://id.rox.one';
export const HANDOFF_CLIENT_ID_ENV = 'ROX_CLOUD_HANDOFF_OIDC_CLIENT_ID';
export const HANDOFF_WEB_HOST_ENV = 'ROX_CLOUD_HANDOFF_WEB_HOST';
/** Dev only: allow signed Daytona preview links when no web host is configured. */
export const HANDOFF_DEV_SIGNED_LINKS_ENV = 'ROX_CLOUD_HANDOFF_DEV_SIGNED_LINKS';
const STATUS_RETENTION_MS = 60 * 60_000;
const SESSION_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

type HandoffConfig = NonNullable<StoredConfig['cloudHandoff']>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CloudHandoffServiceDeps {
  readConfig: () => HandoffConfig | undefined;
  env?: Record<string, string | undefined>;
  readUserKey: () => Promise<string | null>;
  writeUserKey: (key: string) => Promise<void>;
  deleteUserKey: () => Promise<void>;
  /** The signed-in Rox account's id.rox.one access token, or null when signed out. */
  getRoxIdAccessToken: () => Promise<string | null>;
  resolveSources: (sessionId: string) => Promise<SnapshotSource[]>;
  makeDirectClient: (key: string, apiUrl?: string) => DaytonaClient;
  makeBrokerClient: (brokerUrl: string, getAccessToken: () => Promise<string>) => DaytonaClient;
  fetchImpl?: Fetch;
  newId?: () => string;
  now?: () => number;
}

export interface CloudHandoffPublicConfig {
  enabled: boolean;
  userKeyConfigured: boolean;
  /** Default-key handoffs are available through the Rox broker. */
  brokerConfigured: boolean;
  ssoConfigured: boolean;
  webHostConfigured: boolean;
  /** Dev mode: signed Daytona preview links allowed without a web host. */
  devSignedLinks: boolean;
}

interface HandoffRecord extends HandoffStatus {
  mode?: 'user' | 'broker';
  /** Stable URL (web host mode only). Signed links are never stored. */
  stableUrl?: string;
}

interface ResolvedClient {
  client: DaytonaClient;
  mode: 'user' | 'broker';
  /** Personal key (scrubbed from errors); empty in broker mode. */
  apiKey: string;
}

export class CloudHandoffService {
  private readonly records = new Map<string, HandoffRecord>();
  private readonly controllers = new Map<string, AbortController>();
  /** Latest *accepted* handoff per chat (rejected starts never replace it). */
  private readonly bySession = new Map<string, string>();
  /** In-flight wake-ups of auto-stopped sandboxes, so concurrent status polls share one. */
  private readonly resuming = new Map<string, Promise<void>>();
  /** Settles once a handoff reaches a terminal phase (also a test seam). */
  readonly running = new Map<string, Promise<void>>();

  constructor(private readonly deps: CloudHandoffServiceDeps) {}

  private env(): Record<string, string | undefined> {
    return this.deps.env ?? process.env;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private sso(cfg: HandoffConfig | undefined) {
    const clientId = (cfg?.ssoClientId ?? this.env()[HANDOFF_CLIENT_ID_ENV])?.trim();
    if (!clientId) return null;
    return { issuer: this.issuer(cfg), clientId };
  }

  private issuer(cfg: HandoffConfig | undefined): string {
    return cfg?.ssoIssuer?.trim() || DEFAULT_ROX_ID_ISSUER;
  }

  private webHost(cfg: HandoffConfig | undefined): string | undefined {
    return (cfg?.webHost ?? this.env()[HANDOFF_WEB_HOST_ENV])?.trim() || undefined;
  }

  private devSignedLinks(): boolean {
    return this.env()[HANDOFF_DEV_SIGNED_LINKS_ENV] === '1';
  }

  private brokerUrl(cfg: HandoffConfig | undefined): string | undefined {
    return (cfg?.brokerUrl ?? this.env()[HANDOFF_BROKER_URL_ENV])?.trim() || undefined;
  }

  private async accessToken(): Promise<string> {
    const token = await this.deps.getRoxIdAccessToken().catch(() => null);
    if (!token) throw new HandoffError('sign_in_required', 'sign in with Rox ID to continue in the cloud');
    return token;
  }

  private async resolveClient(cfg: HandoffConfig | undefined, mode?: 'user' | 'broker'): Promise<ResolvedClient> {
    const personal = mode === 'broker' ? null : await readPersonalHandoffKey(this.deps.readUserKey);
    if (personal) return { client: this.deps.makeDirectClient(personal, cfg?.daytonaApiUrl), mode: 'user', apiKey: personal };
    const broker = mode === 'user' ? undefined : this.brokerUrl(cfg);
    if (broker) {
      return { client: this.deps.makeBrokerClient(broker, () => this.accessToken()), mode: 'broker', apiKey: '' };
    }
    throw new HandoffError('no_key', 'add your Daytona key to continue in the cloud');
  }

  async getConfig(): Promise<CloudHandoffPublicConfig> {
    const cfg = this.deps.readConfig();
    const userKey = await this.deps.readUserKey().catch(() => null);
    return {
      enabled: cfg?.enabled === true,
      userKeyConfigured: Boolean(userKey),
      brokerConfigured: Boolean(this.brokerUrl(cfg)),
      ssoConfigured: this.sso(cfg) !== null,
      webHostConfigured: Boolean(this.webHost(cfg)),
      devSignedLinks: this.devSignedLinks(),
    };
  }

  async setKey(key: unknown): Promise<{ ok: true }> {
    if (typeof key !== 'string' || !isPlausibleDaytonaKey(key)) throw new Error('cloudHandoff.invalidKey');
    await this.deps.writeUserKey(key.trim());
    return { ok: true };
  }

  async clearKey(): Promise<{ ok: true }> {
    await this.deps.deleteUserKey();
    return { ok: true };
  }

  private publicView(r: HandoffRecord): HandoffStatus {
    const { mode: _mode, stableUrl: _stable, ...rest } = r;
    return { ...rest };
  }

  /**
   * Status for a handoff. Passive reads (mount, polling) only report state:
   * they never wake a stopped sandbox and carry no link. `open: true` is the
   * explicit «Открыть в браузере» request: it wakes an auto-stopped sandbox
   * (start + idempotent start script + health) and then returns a link — a
   * freshly issued short-TTL signed link, or the stable web-host URL.
   */
  async status(handoffId: unknown, options: { open?: boolean } = {}): Promise<HandoffStatus | null> {
    this.prune();
    if (typeof handoffId !== 'string') return null;
    const r = this.records.get(handoffId);
    if (!r) return null;
    const view = this.publicView(r);
    if (options.open === true && r.phase === 'ready' && !r.ended && r.sandboxId) {
      try {
        const cfg = this.deps.readConfig();
        const { client } = await this.resolveClient(cfg, r.mode);
        await this.resume(r, client);
        view.sessionUrl = r.linkMode === 'web_host' ? r.stableUrl : await issueSignedSessionLink(client, r.sandboxId);
      } catch (error) {
        view.sessionUrl = undefined;
        view.failure = {
          code: error instanceof HandoffError ? error.code : 'provider_error',
          message: 'could not open the cloud session',
        };
      }
    }
    return view;
  }

  /** Latest accepted handoff for a chat (passive), so the UI can restore its state after reload. */
  async statusForSession(sessionId: unknown, options: { open?: boolean } = {}): Promise<HandoffStatus | null> {
    if (typeof sessionId !== 'string') return null;
    const id = this.bySession.get(sessionId);
    return id ? this.status(id, options) : null;
  }

  private resume(r: HandoffRecord, client: DaytonaClient): Promise<void> {
    const key = r.handoffId;
    let p = this.resuming.get(key);
    if (!p) {
      p = ensureSessionRunning(client, r.sandboxId!)
        .then(() => undefined)
        .finally(() => this.resuming.delete(key));
      this.resuming.set(key, p);
    }
    return p;
  }

  cancel(handoffId: unknown): { ok: boolean } {
    if (typeof handoffId !== 'string') return { ok: false };
    const ctrl = this.controllers.get(handoffId);
    ctrl?.abort();
    return { ok: Boolean(ctrl) };
  }

  private async destroy(r: HandoffRecord): Promise<void> {
    if (!r.sandboxId || r.ended) return;
    const { client } = await this.resolveClient(this.deps.readConfig(), r.mode);
    await client.deleteSandbox(r.sandboxId).catch((error: unknown) => {
      // Already gone is fine; anything else surfaces to the caller.
      if ((error as { code?: string })?.code !== 'not_found') throw error;
    });
    Object.assign(r, { ended: true, updatedAt: this.now() });
  }

  /** «Завершить облачную сессию»: delete the chat's sandbox now. */
  async end(sessionId: unknown): Promise<{ ok: boolean }> {
    if (typeof sessionId !== 'string') return { ok: false };
    const id = this.bySession.get(sessionId);
    const r = id ? this.records.get(id) : undefined;
    if (!r || this.controllers.has(r.handoffId)) return { ok: false };
    await this.destroy(r);
    return { ok: true };
  }

  /** Starts a handoff in the background; returns immediately with the initial status. */
  async start(sessionId: unknown): Promise<HandoffStatus> {
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) throw new Error('cloudHandoff.invalidSession');
    const cfg = this.deps.readConfig();
    const handoffId = this.deps.newId?.() ?? `hf_${randomBytes(12).toString('hex')}`;
    const startedAt = this.now();
    const record: HandoffRecord = { handoffId, sessionId, phase: 'resolving_key', startedAt, updatedAt: startedAt };
    const fail = (error: HandoffError): HandoffStatus => {
      Object.assign(record, {
        phase: error.code === 'cancelled' ? 'cancelled' : 'failed',
        failure: { code: error.code, message: error.message },
        updatedAt: this.now(),
      });
      return this.publicView(record);
    };

    const priorId = this.bySession.get(sessionId);
    const prior = priorId ? this.records.get(priorId) : undefined;
    if (prior && this.controllers.has(prior.handoffId)) return this.publicView(prior); // already in flight

    // Rejected starts are recorded by id only: they never hide the chat's last ready link.
    this.records.set(handoffId, record);
    if (cfg?.enabled !== true) return fail(new HandoffError('disabled', 'cloud handoff is disabled'));
    // One handoff at a time per app: the per-owner Daytona quota check is not
    // atomic, so parallel starts for different chats could overshoot it.
    if (this.controllers.size > 0) {
      return fail(new HandoffError('quota_exceeded', 'another cloud handoff is already running'));
    }

    this.bySession.set(sessionId, handoffId);
    const ctrl = new AbortController();
    this.controllers.set(handoffId, ctrl);
    const run = this.execute(record, cfg, ctrl, prior)
      .catch((error: unknown) => {
        fail(error instanceof HandoffError ? error : new HandoffError('provider_error', 'cloud handoff failed'));
      })
      .finally(() => this.controllers.delete(handoffId));
    this.running.set(handoffId, run);
    return this.publicView(record);
  }

  private async execute(
    record: HandoffRecord,
    cfg: HandoffConfig,
    ctrl: AbortController,
    prior: HandoffRecord | undefined,
  ): Promise<void> {
    const token = await this.accessToken();
    // Pin the owner to the id.rox.one OIDC subject — the same identifier the
    // sandbox's web UI receives in the id_token at browser login.
    const ownerSub = await fetchRoxIdSubject({ issuer: this.issuer(cfg), accessToken: token, fetchImpl: this.deps.fetchImpl });
    const resolved = await this.resolveClient(cfg);
    record.keySource = resolved.mode;
    record.mode = resolved.mode;

    const sources = await this.deps.resolveSources(record.sessionId);
    const result = await runCloudHandoff({
      client: resolved.client,
      apiKey: resolved.apiKey,
      handoffId: record.handoffId,
      sessionId: record.sessionId,
      ownerSub,
      sources,
      sso: this.sso(cfg),
      webHost: this.webHost(cfg),
      allowSignedLinks: this.devSignedLinks(),
      snapshot: cfg.daytonaSnapshot,
      region: cfg.daytonaRegion,
      signal: ctrl.signal,
      now: this.deps.now,
      onProgress: (p) => {
        Object.assign(record, p, { updatedAt: this.now() });
      },
    });
    Object.assign(record, {
      phase: 'ready',
      sandboxId: result.sandboxId,
      linkMode: result.linkMode,
      stableUrl: result.linkMode === 'web_host' ? result.sessionUrl : undefined,
      excludedCount: result.manifest.excluded.length,
      updatedAt: this.now(),
    });
    // Replace the chat's previous cloud session only now that the new one is
    // ready; if this handoff failed above, the old one is left untouched.
    if (prior && prior.phase === 'ready' && !prior.ended) {
      await this.destroy(prior).catch(() => undefined);
    }
  }

  private prune(): void {
    const cutoff = this.now() - STATUS_RETENTION_MS;
    for (const [id, r] of this.records) {
      // Keep ready, un-ended sessions: they back the chat's link and «Завершить».
      const live = r.phase === 'ready' && !r.ended;
      if (r.updatedAt < cutoff && !live && !this.controllers.has(id)) {
        this.records.delete(id);
        this.running.delete(id);
        if (this.bySession.get(r.sessionId) === id) this.bySession.delete(r.sessionId);
      }
    }
  }
}

const KEY_CREDENTIAL_ID = { type: 'service_oauth', workspaceId: 'global', name: 'daytona-cloud-handoff' } as const;

export function registerCloudHandoffHandlers(server: RpcServer, deps: HandlerDeps): void {
  const service = new CloudHandoffService({
    readConfig: () => loadStoredConfig()?.cloudHandoff,
    readUserKey: async () => {
      const { getCredentialManager } = await import('@rox/shared/credentials');
      return (await getCredentialManager().get(KEY_CREDENTIAL_ID))?.value ?? null;
    },
    writeUserKey: async (key) => {
      const { getCredentialManager } = await import('@rox/shared/credentials');
      await getCredentialManager().set(KEY_CREDENTIAL_ID, { value: key });
    },
    deleteUserKey: async () => {
      const { getCredentialManager } = await import('@rox/shared/credentials');
      await getCredentialManager().delete(KEY_CREDENTIAL_ID);
    },
    getRoxIdAccessToken: async () => {
      const { peekRoxAccountAuthority, LOCAL_ROX_CALLER } = await import('@rox/shared/auth');
      const authority = peekRoxAccountAuthority();
      return authority ? await authority.accessToken(LOCAL_ROX_CALLER) : null;
    },
    resolveSources: async (sessionId) => {
      const session = await deps.sessionManager.getSession(sessionId);
      if (!session?.workspaceId) throw new HandoffError('provider_error', 'session not found');
      const { getSessionPath } = await import('@rox/shared/sessions');
      const workspace = getWorkspaceByNameOrId(session.workspaceId);
      if (!workspace) throw new HandoffError('provider_error', 'workspace not found');
      const { collectHandoffSources } = await import('./cloud-handoff-sources.ts');
      return collectHandoffSources({
        sessionDir: getSessionPath(workspace.rootPath, sessionId),
        workingDirectory: session.workingDirectory,
      });
    },
    makeDirectClient: (key, apiUrl) => new HttpDaytonaClient({ apiUrl, resolveApiKey: async () => key }),
    makeBrokerClient: (brokerUrl, getAccessToken) => new BrokerDaytonaClient({ brokerUrl, getAccessToken }),
  });

  const opts = { access: 'localElectron' } as const;
  server.handle(RPC_CHANNELS.cloudHandoff.GET_CONFIG, () => service.getConfig(), opts);
  server.handle(RPC_CHANNELS.cloudHandoff.START, (_ctx, args: { sessionId?: unknown }) => service.start(args?.sessionId), opts);
  server.handle(
    RPC_CHANNELS.cloudHandoff.STATUS,
    (_ctx, args: { handoffId?: unknown; sessionId?: unknown; open?: unknown }) => {
      const options = { open: args?.open === true };
      return args?.handoffId !== undefined ? service.status(args.handoffId, options) : service.statusForSession(args?.sessionId, options);
    },
    opts,
  );
  server.handle(RPC_CHANNELS.cloudHandoff.END, (_ctx, args: { sessionId?: unknown }) => service.end(args?.sessionId), opts);
  server.handle(RPC_CHANNELS.cloudHandoff.CANCEL, (_ctx, args: { handoffId?: unknown }) => service.cancel(args?.handoffId), opts);
  server.handle(RPC_CHANNELS.cloudHandoff.SET_KEY, (_ctx, args: { key?: unknown }) => service.setKey(args?.key), opts);
  server.handle(RPC_CHANNELS.cloudHandoff.CLEAR_KEY, () => service.clearKey(), opts);
}

