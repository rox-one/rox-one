import { describe, expect, it } from 'bun:test';
import { MemoryDaytonaClient } from '../daytona-client.ts';
import {
  BROKER_API_PREFIX,
  HANDOFF_ROOT,
  createHandoffBrokerHandler,
  ensureSessionRunning,
  normalizeBrokerUploadPath,
  runCloudHandoff,
  verifyRoxIdTokenAudience,
} from '../handoff/index.ts';

const enc = new TextEncoder();
const sso = { issuer: 'https://id.rox.one', clientId: 'rox-cloud' };
const base = (client: MemoryDaytonaClient, extra: Record<string, unknown> = {}) => ({
  client,
  apiKey: 'dtn_' + 'x'.repeat(40),
  handoffId: 'hf_review3_0001',
  sessionId: 's1',
  ownerSub: 'alice-sub',
  sources: [{ path: 'session/session.jsonl', size: 2, read: async () => enc.encode('{}') }],
  sso,
  sleep: async () => undefined,
  ...extra,
});

describe('production link mode (#8)', () => {
  it('refuses signed preview links without the explicit dev flag, before any spend', async () => {
    const client = new MemoryDaytonaClient();
    await expect(runCloudHandoff(base(client))).rejects.toMatchObject({ code: 'web_host_required' });
    expect(client.createCalls).toHaveLength(0);
  });

  it('uses the web host in production', async () => {
    const client = new MemoryDaytonaClient();
    const res = await runCloudHandoff(base(client, { webHost: 'https://cloud.rox.one' }));
    expect(res.linkMode).toBe('web_host');
    expect(client.signedPreviewCalls).toHaveLength(0);
  });

  it('broker refuses signed preview links unless dev mode', async () => {
    const daytona = new MemoryDaytonaClient();
    const handler = createHandoffBrokerHandler({ client: daytona, verifyToken: async () => 'alice-sub' });
    const created = await handler(new Request(`https://b${BROKER_API_PREFIX}/sandboxes`, {
      method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ handoffId: 'hf_review3_0002' }),
    }));
    const { id } = (await created!.json()) as { id: string };
    const res = await handler(new Request(`https://b${BROKER_API_PREFIX}/sandboxes/${id}/signed-preview-url?port=9100`, { headers: { Authorization: 'Bearer t' } }));
    expect(res!.status).toBe(403);
    expect(daytona.signedPreviewCalls).toHaveLength(0);
  });
});

describe('broker hardening (#4 #5 #6)', () => {
  it('normalises upload paths and allows only bundle/**, manifest.json and server.env', () => {
    expect(normalizeBrokerUploadPath(`${HANDOFF_ROOT}/server.env`)).toBe(`${HANDOFF_ROOT}/server.env`);
    expect(normalizeBrokerUploadPath(`${HANDOFF_ROOT}/manifest.json`)).toBe(`${HANDOFF_ROOT}/manifest.json`);
    expect(normalizeBrokerUploadPath(`${HANDOFF_ROOT}/bundle/session/session.jsonl`)).not.toBeNull();
    for (const bad of [
      `${HANDOFF_ROOT}//server.env`, `${HANDOFF_ROOT}/./server.env`, `${HANDOFF_ROOT}/bundle/../server.pid`,
      `${HANDOFF_ROOT}/server.pid`, `${HANDOFF_ROOT}/server.log`, `${HANDOFF_ROOT}/bundle`, `${HANDOFF_ROOT}/bundle/`,
      `${HANDOFF_ROOT}/bundle/a\\b`, `${HANDOFF_ROOT}/bundle/a\0`, '/etc/passwd', `${HANDOFF_ROOT}`,
    ]) expect(normalizeBrokerUploadPath(bad)).toBeNull();
  });

  const setup = (limits = {}, maxLiveTotal?: number) => {
    const daytona = new MemoryDaytonaClient();
    const subs: Record<string, string> = { a: 'alice-sub', b: 'bob-sub' };
    const handler = createHandoffBrokerHandler({ client: daytona, verifyToken: async (t) => subs[t] ?? null, limits, maxLiveTotal });
    const post = (tok: string, id: string) => handler(new Request(`https://b${BROKER_API_PREFIX}/sandboxes`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify({ handoffId: id }),
    })).then((r) => r!.status);
    return { daytona, handler, post };
  };

  it('a crafted //server.env cannot bypass the owner pin', async () => {
    const { handler, post, daytona } = setup();
    expect(await post('a', 'hf_review3_0003')).toBe(201);
    const id = [...daytona.files.keys()][0]!;
    const res = await handler(new Request(`https://b${BROKER_API_PREFIX}/sandboxes/${id}/files`, {
      method: 'PUT', headers: { Authorization: 'Bearer a' },
      body: JSON.stringify({ path: `${HANDOFF_ROOT}//server.env`, content: Buffer.from('ROX_WEBUI_OIDC_ALLOWED_SUBS=mallory\nROX_WEBUI_PASSWORD_LOGIN=0\n').toString('base64') }),
    }));
    expect(res!.status).toBe(400);
  });

  it('parallel creates cannot exceed the per-owner quota', async () => {
    const { post, daytona } = setup({ maxActivePerOwner: 2 });
    const statuses = await Promise.all(Array.from({ length: 6 }, (_, i) => post('a', `hf_par_${String(i).padStart(6, '0')}`)));
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
    expect(daytona.createCalls).toHaveLength(2);
  });

  it('enforces a global live cap across owners', async () => {
    const { post } = setup({ maxActivePerOwner: 5 }, 2);
    expect(await post('a', 'hf_glob_00001')).toBe(201);
    expect(await post('b', 'hf_glob_00002')).toBe(201);
    expect(await post('b', 'hf_glob_00003')).toBe(503);
  });

  it('rejects oversized bodies before parsing (Content-Length and streamed)', async () => {
    const { handler } = setup({ maxFileBytes: 1024 });
    const big = JSON.stringify({ handoffId: 'x'.repeat(10_000) });
    const declared = await handler(new Request(`https://b${BROKER_API_PREFIX}/sandboxes`, {
      method: 'POST', headers: { Authorization: 'Bearer a', 'Content-Length': String(big.length) }, body: big,
    }));
    expect(declared!.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < 10; i += 1) c.enqueue(enc.encode('x'.repeat(1000))); c.close(); },
    });
    const streamed = await handler(new Request(`https://b${BROKER_API_PREFIX}/sandboxes`, {
      method: 'POST', headers: { Authorization: 'Bearer a' }, body: stream, duplex: 'half',
    } as RequestInit));
    expect(streamed!.status).toBe(413);
  });
});

describe('resume a stopped session (#7)', () => {
  it('starts the sandbox, re-runs the start script and waits for health', async () => {
    const client = new MemoryDaytonaClient();
    const res = await runCloudHandoff(base(client, { webHost: 'https://cloud.rox.one' }));
    expect(await ensureSessionRunning(client, res.sandboxId, { sleep: async () => undefined })).toBe(false);
    await client.stopSandbox(res.sandboxId);
    const commands: string[] = [];
    client.execOverride = (command) => { commands.push(command); return undefined; };
    expect(await ensureSessionRunning(client, res.sandboxId, { sleep: async () => undefined })).toBe(true);
    expect((await client.getSandbox(res.sandboxId)).state).toBe('started');
    expect(commands).toEqual([
      `rox-handoff-start ${HANDOFF_ROOT}`, `rox-handoff-health ${HANDOFF_ROOT}`,
    ]);
  });
});

describe('token audience (#9)', () => {
  const jwt = (c: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(c)).toString('base64url')}.s`;
  const v = (token: string, extra: Record<string, unknown> = {}) =>
    verifyRoxIdTokenAudience({ issuer: 'https://id.rox.one', accessToken: token, allowedClientIds: ['rox-desktop'], ...extra }, 'u1');
  it('checks aud/azp/client_id, sub and iss', async () => {
    expect(await v(jwt({ sub: 'u1', azp: 'rox-desktop' }))).toBe(true);
    expect(await v(jwt({ sub: 'u1', aud: 'other' }))).toBe(false);
    expect(await v(jwt({ sub: 'u2', azp: 'rox-desktop' }))).toBe(false);
    expect(await v(jwt({ sub: 'u1', azp: 'rox-desktop' }), { allowedClientIds: [] })).toBe(false);
  });
  it('introspects opaque tokens and refuses them without credentials', async () => {
    expect(await v('opaque')).toBe(false);
    const fetchImpl = async (url: string) =>
      url.endsWith('openid-configuration')
        ? Response.json({ introspection_endpoint: 'https://id.rox.one/introspect' })
        : Response.json({ active: true, sub: 'u1', client_id: 'rox-desktop' });
    expect(await v('opaque', { introspection: { clientId: 'broker', clientSecret: 's' }, fetchImpl })).toBe(true);
    const inactive = async (url: string) =>
      url.endsWith('openid-configuration') ? Response.json({ introspection_endpoint: 'https://x/i' }) : Response.json({ active: false });
    expect(await v('opaque', { introspection: { clientId: 'broker', clientSecret: 's' }, fetchImpl: inactive })).toBe(false);
  });
});
