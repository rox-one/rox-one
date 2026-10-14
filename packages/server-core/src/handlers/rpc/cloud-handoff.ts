/**
 * «В облако» — cloud handoff RPC (docs/cloud-handoff-design.md).
 *
 * Desktop-only (localElectron): packages the chat, resolves the Daytona key
 * (user's own → server default), runs the orchestrator in the background and
 * exposes polled status with the resulting id.rox.one-gated session URL.
 * Feature flag `cloudHandoff.enabled` defaults to off.
 */
import { randomBytes } from 'node:crypto';
import {
  HandoffError,
  HttpDaytonaClient,
  isPlausibleDaytonaKey,
  resolveHandoffKey,
  runCloudHandoff,
  serverDefaultKeyAvailable,
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
const STATUS_RETENTION_MS = 60 * 60_000;
const SESSION_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

type HandoffConfig = NonNullable<StoredConfig['cloudHandoff']>;

export interface CloudHandoffServiceDeps {
  readConfig: () => HandoffConfig | undefined;
  env?: Record<string, string | undefined>;
  readUserKey: () => Promise<string | null>;
  writeUserKey: (key: string) => Promise<void>;
  deleteUserKey: () => Promise<void>;
  /** id.rox.one subject of the signed-in Rox account, or null when signed out. */
  resolveOwnerSub: () => Promise<string | null>;
  resolveSources: (sessionId: string) => Promise<SnapshotSource[]>;
  makeClient: (key: string, apiUrl?: string) => DaytonaClient;
  newId?: () => string;
  now?: () => number;
}

export interface CloudHandoffPublicConfig {
  enabled: boolean;
  userKeyConfigured: boolean;
  serverDefaultKeyAvailable: boolean;
  ssoConfigured: boolean;
  webHostConfigured: boolean;
}

export class CloudHandoffService {
  private readonly statuses = new Map<string, HandoffStatus>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly bySession = new Map<string, string>();

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
    return { issuer: cfg?.ssoIssuer?.trim() || DEFAULT_ROX_ID_ISSUER, clientId };
  }

  private webHost(cfg: HandoffConfig | undefined): string | undefined {
    return (cfg?.webHost ?? this.env()[HANDOFF_WEB_HOST_ENV])?.trim() || undefined;
  }

  async getConfig(): Promise<CloudHandoffPublicConfig> {
    const cfg = this.deps.readConfig();
    const userKey = await this.deps.readUserKey().catch(() => null);
    return {
      enabled: cfg?.enabled === true,
      userKeyConfigured: Boolean(userKey),
      serverDefaultKeyAvailable: cfg?.allowServerDefaultKey !== false && serverDefaultKeyAvailable(this.env()),
      ssoConfigured: this.sso(cfg) !== null,
      webHostConfigured: Boolean(this.webHost(cfg)),
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

  status(handoffId: unknown): HandoffStatus | null {
    this.prune();
    if (typeof handoffId !== 'string') return null;
    const s = this.statuses.get(handoffId);
    return s ? { ...s } : null;
  }

  /** Latest handoff for a chat, so the UI can restore the link after reload. */
  statusForSession(sessionId: unknown): HandoffStatus | null {
    if (typeof sessionId !== 'string') return null;
    const id = this.bySession.get(sessionId);
    return id ? this.status(id) : null;
  }

  cancel(handoffId: unknown): { ok: boolean } {
    if (typeof handoffId !== 'string') return { ok: false };
    const ctrl = this.controllers.get(handoffId);
    ctrl?.abort();
    return { ok: Boolean(ctrl) };
  }

  /** Starts a handoff in the background; returns immediately with the initial status. */
  async start(sessionId: unknown): Promise<HandoffStatus> {
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) throw new Error('cloudHandoff.invalidSession');
    const cfg = this.deps.readConfig();
    const handoffId = this.deps.newId?.() ?? `hf_${randomBytes(12).toString('hex')}`;
    const startedAt = this.now();
    const status: HandoffStatus = { handoffId, sessionId, phase: 'resolving_key', startedAt, updatedAt: startedAt };
    const fail = (error: HandoffError): HandoffStatus => {
      Object.assign(status, {
        phase: error.code === 'cancelled' ? 'cancelled' : 'failed',
        failure: { code: error.code, message: error.message },
        updatedAt: this.now(),
      });
      return { ...status };
    };

    const existing = this.bySession.get(sessionId);
    const prior = existing ? this.statuses.get(existing) : undefined;
    if (prior && this.controllers.has(prior.handoffId)) return { ...prior }; // already in flight
    this.statuses.set(handoffId, status);
    this.bySession.set(sessionId, handoffId);

    if (cfg?.enabled !== true) return fail(new HandoffError('disabled', 'cloud handoff is disabled'));
    // One handoff at a time per app: the per-owner Daytona quota check is not
    // atomic, so parallel starts for different chats could overshoot it.
    if (this.controllers.size > 0) {
      return fail(new HandoffError('quota_exceeded', 'another cloud handoff is already running'));
    }

    const ctrl = new AbortController();
    this.controllers.set(handoffId, ctrl);
    const run = this.execute(status, cfg, ctrl)
      .catch((error: unknown) => {
        fail(error instanceof HandoffError ? error : new HandoffError('provider_error', 'cloud handoff failed'));
      })
      .finally(() => this.controllers.delete(handoffId));
    this.running.set(handoffId, run);
    return { ...status };
  }

  /** Settles once a handoff reaches a terminal phase (also a test seam). */
  readonly running = new Map<string, Promise<void>>();

  private async execute(status: HandoffStatus, cfg: HandoffConfig, ctrl: AbortController): Promise<void> {
    {
      const ownerSub = await this.deps.resolveOwnerSub().catch(() => null);
      if (!ownerSub) throw new HandoffError('sign_in_required', 'sign in with Rox ID to continue in the cloud');
      const resolved = await resolveHandoffKey({
        readUserKey: this.deps.readUserKey,
        env: this.env(),
        allowServerDefault: cfg.allowServerDefaultKey !== false,
      });
      status.keySource = resolved.source;
      const sources = await this.deps.resolveSources(status.sessionId);
      const result = await runCloudHandoff({
        client: this.deps.makeClient(resolved.key, cfg.daytonaApiUrl),
        apiKey: resolved.key,
        handoffId: status.handoffId,
        sessionId: status.sessionId,
        ownerSub,
        sources,
        sso: this.sso(cfg),
        webHost: this.webHost(cfg),
        snapshot: cfg.daytonaSnapshot,
        region: cfg.daytonaRegion,
        signal: ctrl.signal,
        now: this.deps.now,
        onProgress: (p) => {
          Object.assign(status, p, { updatedAt: this.now() });
        },
      });
      Object.assign(status, {
        phase: 'ready',
        sessionUrl: result.sessionUrl,
        sandboxId: result.sandboxId,
        excludedCount: result.manifest.excluded.length,
        updatedAt: this.now(),
      });
    }
  }

  private prune(): void {
    const cutoff = this.now() - STATUS_RETENTION_MS;
    for (const [id, s] of this.statuses) {
      if (s.updatedAt < cutoff && !this.controllers.has(id)) {
        this.statuses.delete(id);
        this.running.delete(id);
        if (this.bySession.get(s.sessionId) === id) this.bySession.delete(s.sessionId);
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
    resolveOwnerSub: async () => {
      const { peekRoxAccountAuthority, LOCAL_ROX_CALLER } = await import('@rox/shared/auth');
      const authority = peekRoxAccountAuthority();
      if (!authority) return null;
      const state = await authority.state(LOCAL_ROX_CALLER);
      return state.connected ? (state.account?.user.id ?? null) : null;
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
    makeClient: (key, apiUrl) => new HttpDaytonaClient({ apiUrl, resolveApiKey: async () => key }),
  });

  const opts = { access: 'localElectron' } as const;
  server.handle(RPC_CHANNELS.cloudHandoff.GET_CONFIG, () => service.getConfig(), opts);
  server.handle(RPC_CHANNELS.cloudHandoff.START, (_ctx, args: { sessionId?: unknown }) => service.start(args?.sessionId), opts);
  server.handle(
    RPC_CHANNELS.cloudHandoff.STATUS,
    (_ctx, args: { handoffId?: unknown; sessionId?: unknown }) =>
      args?.handoffId !== undefined ? service.status(args.handoffId) : service.statusForSession(args?.sessionId),
    opts,
  );
  server.handle(RPC_CHANNELS.cloudHandoff.CANCEL, (_ctx, args: { handoffId?: unknown }) => service.cancel(args?.handoffId), opts);
  server.handle(RPC_CHANNELS.cloudHandoff.SET_KEY, (_ctx, args: { key?: unknown }) => service.setKey(args?.key), opts);
  server.handle(RPC_CHANNELS.cloudHandoff.CLEAR_KEY, () => service.clearKey(), opts);
}

