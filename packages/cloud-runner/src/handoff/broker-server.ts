/**
 * Rox-hosted cloud handoff broker (server side). Holds the shared Daytona key
 * and performs only the narrow set of operations a handoff needs, on behalf of
 * an id.rox.one-authenticated user, on that user's own sandboxes.
 *
 * Mounted by server-core only in hosted/server mode — never inside Electron.
 */
import type { DaytonaClient, DaytonaSandboxRecord } from '../daytona-client.ts';
import { BROKER_API_PREFIX } from './broker-client.ts';
import { isLiveSandbox, ownerLabelValue } from './orchestrator.ts';
import {
  DEFAULT_HANDOFF_LIMITS,
  DEFAULT_HANDOFF_SNAPSHOT,
  HANDOFF_LABEL,
  HANDOFF_OWNER_LABEL,
  HANDOFF_ROOT,
  HANDOFF_SERVER_PORT,
  MAX_SIGNED_LINK_TTL_SEC,
  type HandoffLimits,
} from './types.ts';

export interface BrokerHandlerOptions {
  /** Daytona client bound to the shared key. */
  client: DaytonaClient;
  /** Verifies a bearer id.rox.one token, returning its `sub` or null. */
  verifyToken: (token: string) => Promise<string | null>;
  snapshot?: string;
  region?: string;
  limits?: Partial<HandoffLimits>;
  /** Max live handoff sandboxes across all owners on the shared key (default 200). */
  maxLiveTotal?: number;
  /**
   * Dev only: serve signed Daytona preview links. Off in production, where
   * sessions are fronted by the web host (cloud.rox.one).
   */
  allowSignedPreview?: boolean;
}

/** Upload targets a desktop may write; everything else (server.pid, logs, …) is off limits. */
export function normalizeBrokerUploadPath(raw: string): string | null {
  if (typeof raw !== 'string' || raw.includes('\0') || raw.includes('\\')) return null;
  const prefix = `${HANDOFF_ROOT}/`;
  if (!raw.startsWith(prefix)) return null;
  const segments = raw.slice(prefix.length).split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  const rel = segments.join('/');
  if (rel === 'manifest.json' || rel === 'server.env') return `${prefix}${rel}`;
  if (segments[0] === 'bundle' && segments.length >= 2) return `${prefix}${rel}`;
  return null;
}

class BodyTooLarge extends Error {}

/** Parse a JSON body, refusing (before buffering) anything above `cap` bytes. */
export async function readJsonCapped(req: Request, cap: number): Promise<unknown> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) throw new BodyTooLarge();
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

const ALLOWED_COMMANDS = new Set([`rox-handoff-start ${HANDOFF_ROOT}`, `rox-handoff-health ${HANDOFF_ROOT}`]);
const HANDOFF_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SANDBOX_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error: string, status: number) => json({ error }, status);


/** Parse a KEY=VALUE env file; returns null for malformed content. */
export function parseEnvFile(text: string): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const eq = line.indexOf('=');
    if (eq <= 0) return null;
    const key = line.slice(0, eq);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || out.has(key)) return null;
    out.set(key, line.slice(eq + 1));
  }
  return out;
}

export function createHandoffBrokerHandler(options: BrokerHandlerOptions): (req: Request) => Promise<Response | null> {
  const limits: HandoffLimits = { ...DEFAULT_HANDOFF_LIMITS, ...options.limits };
  const { client } = options;
  const maxB64 = Math.ceil((limits.maxFileBytes * 4) / 3) + 16;
  const maxBody = maxB64 + 1024;
  const smallBody = 4096;
  const maxLiveTotal = options.maxLiveTotal ?? 200;
  // Serialises quota check + create per owner, and globally caps creates in flight.
  const ownerLocks = new Map<string, Promise<unknown>>();
  let creatingTotal = 0;
  const withOwnerLock = async <T>(owner: string, fn: () => Promise<T>): Promise<T> => {
    const prev = ownerLocks.get(owner) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    ownerLocks.set(owner, run);
    try {
      return await run;
    } finally {
      if (ownerLocks.get(owner) === run) ownerLocks.delete(owner);
    }
  };

  async function ownSandbox(id: string, owner: string): Promise<DaytonaSandboxRecord | null> {
    if (!SANDBOX_ID_RE.test(id)) return null;
    try {
      const s = await client.getSandbox(id);
      return s.labels[HANDOFF_LABEL] === '1' && s.labels[HANDOFF_OWNER_LABEL] === owner ? s : null;
    } catch {
      return null;
    }
  }

  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(`${BROKER_API_PREFIX}/`)) return null;
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const sub = token ? await options.verifyToken(token).catch(() => null) : null;
    if (!sub) return fail('unauthorized', 401);
    const owner = ownerLabelValue(sub);
    const parts = url.pathname.slice(BROKER_API_PREFIX.length + 1).split('/').map(decodeURIComponent);

    try {
      if (parts[0] !== 'sandboxes') return fail('not_found', 404);

      if (parts.length === 1 && req.method === 'GET') {
        const items = (await client.listSandboxes({ key: HANDOFF_OWNER_LABEL, value: owner }))
          .filter((s) => s.labels[HANDOFF_LABEL] === '1' && s.labels[HANDOFF_OWNER_LABEL] === owner);
        return json({ items });
      }

      if (parts.length === 1 && req.method === 'POST') {
        const body = (await readJsonCapped(req, smallBody)) as { handoffId?: unknown } | null;
        const handoffId = typeof body?.handoffId === 'string' ? body.handoffId : '';
        if (!HANDOFF_ID_RE.test(handoffId)) return fail('invalid_handoff_id', 400);
        return await withOwnerLock(owner, async () => {
          if (creatingTotal >= maxLiveTotal) return fail('capacity_exceeded', 503);
          creatingTotal += 1;
          try {
            const live = (await client.listSandboxes({ key: HANDOFF_OWNER_LABEL, value: owner }))
              .filter((s) => s.labels[HANDOFF_OWNER_LABEL] === owner && isLiveSandbox(s));
            if (live.length >= limits.maxActivePerOwner) return fail('quota_exceeded', 429);
            const liveTotal = (await client.listSandboxes({ key: HANDOFF_LABEL, value: '1' })).filter(isLiveSandbox).length;
            if (liveTotal + creatingTotal - 1 >= maxLiveTotal) return fail('capacity_exceeded', 503);
            const created = await client.createSandbox({
              name: `rox-handoff-${handoffId}`.toLowerCase(),
              snapshot: options.snapshot ?? DEFAULT_HANDOFF_SNAPSHOT,
              region: options.region,
              labels: { [HANDOFF_LABEL]: '1', [HANDOFF_OWNER_LABEL]: owner, 'rox.cloud-handoff.id': handoffId, 'rox.cloud-handoff.broker': '1' },
              env: { ROX_HANDOFF_ID: handoffId },
              public: false,
              autoStopIntervalMin: limits.autoStopIntervalMin,
              autoDeleteIntervalMin: limits.autoDeleteIntervalMin,
            });
            return json(created, 201);
          } finally {
            creatingTotal -= 1;
          }
        });
      }

      const sandbox = parts[1] ? await ownSandbox(parts[1], owner) : null;
      if (!sandbox) return fail('not_found', 404);
      const id = sandbox.id;
      const action = parts.slice(2).join('/');

      if (action === '' && req.method === 'GET') return json(sandbox);
      if (action === '' && req.method === 'DELETE') {
        await client.deleteSandbox(id);
        return new Response(null, { status: 204 });
      }
      if (action === 'start' && req.method === 'POST') return json(await client.startSandbox(id));
      if (action === 'stop' && req.method === 'POST') {
        await client.stopSandbox(id);
        return new Response(null, { status: 204 });
      }

      if (action === 'files' && req.method === 'PUT') {
        const body = (await readJsonCapped(req, maxBody)) as { path?: unknown; content?: unknown } | null;
        const path = normalizeBrokerUploadPath(typeof body?.path === 'string' ? body.path : '');
        const content = typeof body?.content === 'string' ? body.content : '';
        if (!path) return fail('invalid_path', 400);
        if (content.length > maxB64) return fail('too_large', 413);
        const bytes = Uint8Array.from(Buffer.from(content, 'base64'));
        if (path === `${HANDOFF_ROOT}/server.env`) {
          // The broker pays for this sandbox: it must stay pinned to the caller
          // and keep password login off, whatever the desktop sends.
          const env = parseEnvFile(new TextDecoder().decode(bytes));
          if (!env || env.get('ROX_WEBUI_OIDC_ALLOWED_SUBS') !== sub || env.get('ROX_WEBUI_PASSWORD_LOGIN') !== '0') {
            return fail('invalid_server_env', 400);
          }
        }
        await client.writeFile(id, path, bytes);
        return new Response(null, { status: 204 });
      }

      if (action === 'exec' && req.method === 'POST') {
        const body = (await readJsonCapped(req, smallBody)) as { command?: unknown } | null;
        const command = typeof body?.command === 'string' ? body.command : '';
        if (!ALLOWED_COMMANDS.has(command)) return fail('command_not_allowed', 403);
        return json(await client.exec(id, command, req.signal));
      }

      if (action === 'signed-preview-url' && req.method === 'GET') {
        if (options.allowSignedPreview !== true) return fail('web_host_required', 403);
        if (Number(url.searchParams.get('port')) !== HANDOFF_SERVER_PORT) return fail('port_not_allowed', 403);
        const requested = Number(url.searchParams.get('expiresInSeconds')) || limits.linkTtlSec;
        const ttl = Math.max(60, Math.min(requested, limits.linkTtlSec, MAX_SIGNED_LINK_TTL_SEC));
        if (!client.getSignedPreviewUrl) return fail('unsupported', 501);
        return json({ url: await client.getSignedPreviewUrl(id, HANDOFF_SERVER_PORT, ttl) });
      }

      return fail('not_found', 404);
    } catch (error) {
      if (error instanceof BodyTooLarge) return fail('too_large', 413);
      // Never echo provider errors: they may describe the shared account.
      return fail('provider_error', 502);
    }
  };
}
