/**
 * Cloud handoff orchestrator: package → create sandbox → upload → start the
 * Rox session server → wait healthy → return an id.rox.one-gated URL.
 *
 * Pure w.r.t. I/O: Daytona is an injected `DaytonaClient` (tests use
 * `MemoryDaytonaClient`), local files are injected `SnapshotSource`s.
 */
import { createHash } from 'node:crypto';
import type { DaytonaClient } from '../daytona-client.ts';
import { packSnapshot, type SnapshotManifest, type SnapshotSource } from './snapshot.ts';
import {
  DEFAULT_HANDOFF_LIMITS,
  DEFAULT_HANDOFF_SNAPSHOT,
  HANDOFF_LABEL,
  HANDOFF_OWNER_LABEL,
  HANDOFF_ROOT,
  HANDOFF_SERVER_PORT,
  HandoffError,
  type HandoffLimits,
  type HandoffProgress,
} from './types.ts';

export interface HandoffSso {
  /** id.rox.one issuer, e.g. `https://id.rox.one`. */
  issuer: string;
  /** Public (PKCE) OIDC client registered at id.rox.one for cloud sessions. */
  clientId: string;
}

export interface RunHandoffInput {
  client: DaytonaClient;
  /** The resolved Daytona key — used only to scrub it from error text. */
  apiKey: string;
  handoffId: string;
  sessionId: string;
  /** id.rox.one subject that owns the cloud session; the only identity admitted. */
  ownerSub: string | null | undefined;
  sources: readonly SnapshotSource[];
  sso: HandoffSso | null;
  /** Stable https host fronting sessions (`https://cloud.rox.one`); else Daytona preview URL. */
  webHost?: string;
  snapshot?: string;
  region?: string;
  limits?: Partial<HandoffLimits>;
  knownSecrets?: readonly string[];
  onProgress?: (p: HandoffProgress) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RunHandoffResult {
  sandboxId: string;
  sessionUrl: string;
  manifest: SnapshotManifest;
}

const HANDOFF_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function ownerLabelValue(sub: string): string {
  return createHash('sha256').update(`rox-handoff-owner:${sub}`).digest('hex').slice(0, 32);
}

function scrub(text: string, secret: string): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('***REDACTED***');
}

function assertEnvValue(name: string, value: string): string {
  if (/[\r\n\0]/.test(value)) throw new HandoffError('provider_error', `invalid ${name}`);
  return value;
}

function normalizeHttpsBase(raw: string, what: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HandoffError('provider_error', `${what} is not a valid URL`);
  }
  if (url.protocol !== 'https:') throw new HandoffError('provider_error', `${what} must be https`);
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export async function runCloudHandoff(input: RunHandoffInput): Promise<RunHandoffResult> {
  const limits: HandoffLimits = { ...DEFAULT_HANDOFF_LIMITS, ...input.limits };
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = input.now ?? Date.now;
  const progress = (p: HandoffProgress) => input.onProgress?.(p);
  const checkAbort = () => {
    if (input.signal?.aborted) throw new HandoffError('cancelled', 'handoff cancelled');
  };

  if (!HANDOFF_ID_RE.test(input.handoffId)) throw new HandoffError('provider_error', 'invalid handoff id');
  const ownerSub = input.ownerSub?.trim();
  if (!ownerSub) throw new HandoffError('sign_in_required', 'sign in with Rox ID to continue in the cloud');
  if (!input.sso?.clientId?.trim() || !input.sso.issuer?.trim()) {
    throw new HandoffError('sso_not_configured', 'Rox ID SSO client for cloud sessions is not configured');
  }
  const issuer = normalizeHttpsBase(input.sso.issuer, 'SSO issuer');
  const webHost = input.webHost?.trim() ? normalizeHttpsBase(input.webHost, 'cloud web host') : undefined;
  const ownerLabel = ownerLabelValue(ownerSub);
  const { client } = input;
  let sandboxId: string | undefined;

  try {
    // Quota first: cheap, and refuses before any spend.
    const live = (await client.listSandboxes({ key: HANDOFF_OWNER_LABEL, value: ownerLabel }))
      .filter((s) => s.labels[HANDOFF_LABEL] === '1' && s.state !== 'destroyed' && s.state !== 'error');
    if (live.length >= limits.maxActivePerOwner) {
      throw new HandoffError('quota_exceeded', `already ${live.length} active cloud sessions (limit ${limits.maxActivePerOwner})`);
    }
    checkAbort();

    progress({ phase: 'creating_sandbox' });
    const created = await client.createSandbox({
      name: `rox-handoff-${input.handoffId}`.toLowerCase(),
      snapshot: input.snapshot ?? DEFAULT_HANDOFF_SNAPSHOT,
      region: input.region,
      labels: {
        [HANDOFF_LABEL]: '1',
        [HANDOFF_OWNER_LABEL]: ownerLabel,
        'rox.cloud-handoff.id': input.handoffId,
      },
      env: { ROX_HANDOFF_ID: input.handoffId },
      // Behind our own web host the sandbox stays private (the proxy holds the
      // Daytona credential); otherwise the preview is public and the in-app
      // id.rox.one owner gate is the only door — which is why SSO is mandatory.
      public: !webHost,
      autoStopIntervalMin: limits.autoStopIntervalMin,
      autoDeleteIntervalMin: limits.autoDeleteIntervalMin,
    });
    sandboxId = created.id;
    if (created.state !== 'started') await client.startSandbox(sandboxId);
    checkAbort();

    let publicUrl: string;
    if (webHost) {
      publicUrl = `${webHost}/s/${input.handoffId}`;
    } else {
      if (!client.getPreviewUrl) throw new HandoffError('provider_error', 'Daytona client cannot issue preview URLs');
      publicUrl = normalizeHttpsBase(await client.getPreviewUrl(sandboxId, HANDOFF_SERVER_PORT), 'preview URL');
    }

    progress({ phase: 'packaging' });
    const excluded: SnapshotManifest['excluded'] = [];
    const files: SnapshotManifest['files'] = [];
    const total = input.sources.length;
    let uploaded = 0;
    progress({ phase: 'uploading', uploaded, total });
    for await (const file of packSnapshot(input.sources, limits, excluded, {
      knownSecrets: [input.apiKey, ...(input.knownSecrets ?? [])],
      signal: input.signal,
    })) {
      await client.writeFile(sandboxId, `${HANDOFF_ROOT}/bundle/${file.path}`, file.bytes);
      files.push({ path: file.path, size: file.bytes.byteLength, sha256: file.sha256 });
      uploaded += 1;
      progress({ phase: 'uploading', uploaded, total });
      checkAbort();
    }

    const manifest: SnapshotManifest = {
      version: 1,
      handoffId: input.handoffId,
      sessionId: input.sessionId,
      createdAt: new Date(now()).toISOString(),
      files,
      excluded,
    };
    const enc = new TextEncoder();
    await client.writeFile(sandboxId, `${HANDOFF_ROOT}/manifest.json`, enc.encode(JSON.stringify(manifest, null, 2)));
    // Non-secret server config only. The web UI JWT secret is generated inside
    // the sandbox by rox-handoff-start and never crosses the wire.
    const serverEnv = [
      `ROX_WEBUI_OIDC_ISSUER=${assertEnvValue('issuer', issuer)}`,
      `ROX_WEBUI_OIDC_CLIENT_ID=${assertEnvValue('client id', input.sso.clientId.trim())}`,
      `ROX_WEBUI_PUBLIC_URL=${assertEnvValue('public url', publicUrl)}`,
      `ROX_WEBUI_OIDC_ALLOWED_SUBS=${assertEnvValue('owner', ownerSub)}`,
      `ROX_HANDOFF_SESSION_ID=${assertEnvValue('session id', input.sessionId)}`,
      `ROX_HANDOFF_PORT=${HANDOFF_SERVER_PORT}`,
      '',
    ].join('\n');
    await client.writeFile(sandboxId, `${HANDOFF_ROOT}/server.env`, enc.encode(serverEnv));
    checkAbort();

    progress({ phase: 'starting' });
    const started = await client.exec(sandboxId, `rox-handoff-start ${HANDOFF_ROOT}`, input.signal);
    if (started.exitCode !== 0) {
      throw new HandoffError('provider_error', `session server failed to start (exit ${started.exitCode})`);
    }

    progress({ phase: 'waiting_ready' });
    const deadline = now() + limits.readyTimeoutMs;
    for (;;) {
      checkAbort();
      const health = await client.exec(sandboxId, `rox-handoff-health ${HANDOFF_ROOT}`, input.signal);
      if (health.exitCode === 0) break;
      if (now() >= deadline) throw new HandoffError('start_timeout', 'cloud session did not become ready in time');
      await sleep(limits.readyPollMs);
    }

    progress({ phase: 'ready' });
    return { sandboxId, sessionUrl: `${publicUrl}/`, manifest };
  } catch (error) {
    if (sandboxId) {
      // No half-migrated sandboxes left running on anyone's bill.
      await client.deleteSandbox(sandboxId).catch(() => undefined);
    }
    if (error instanceof HandoffError) {
      throw new HandoffError(error.code, scrub(error.message, input.apiKey));
    }
    const aborted = input.signal?.aborted;
    const message = scrub(error instanceof Error ? error.message : String(error), input.apiKey);
    throw new HandoffError(aborted ? 'cancelled' : 'provider_error', message);
  }
}
