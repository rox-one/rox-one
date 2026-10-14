import { describe, expect, it } from 'bun:test';
import { MemoryDaytonaClient } from '../daytona-client.ts';
import {
  BROKER_API_PREFIX,
  BrokerDaytonaClient,
  HANDOFF_ROOT,
  createHandoffBrokerHandler,
  fetchRoxIdSubject,
  runCloudHandoff,
} from '../handoff/index.ts';

const enc = new TextEncoder();
const sso = { issuer: 'https://id.rox.one', clientId: 'rox-cloud' };
const TOKENS: Record<string, string> = { 'tok-alice': 'alice-sub', 'tok-bob': 'bob-sub' };

function setup() {
  const daytona = new MemoryDaytonaClient();
  const handler = createHandoffBrokerHandler({ client: daytona, verifyToken: async (t) => TOKENS[t] ?? null });
  const fetchImpl = async (input: string, init?: RequestInit) =>
    (await handler(new Request(input, init))) ?? new Response('nope', { status: 404 });
  const clientFor = (token: string) =>
    new BrokerDaytonaClient({ brokerUrl: 'https://broker.rox.one', getAccessToken: async () => token, fetchImpl });
  return { daytona, handler, fetchImpl, clientFor };
}

const input = (client: BrokerDaytonaClient, ownerSub: string, handoffId = 'hf_broker_0001') => ({
  client,
  apiKey: 'unused-no-key-on-desktop',
  handoffId,
  sessionId: 's1',
  ownerSub,
  sources: [{ path: 'session/session.jsonl', size: 2, read: async () => enc.encode('{}') }],
  sso,
  sleep: async () => undefined,
});

describe('cloud handoff broker', () => {
  it('runs a full handoff without the desktop ever holding the shared key', async () => {
    const { daytona, clientFor } = setup();
    const res = await runCloudHandoff(input(clientFor('tok-alice'), 'alice-sub'));
    expect(res.linkMode).toBe('signed');
    const files = daytona.files.get(res.sandboxId)!;
    const env = new TextDecoder().decode(files.get(`${HANDOFF_ROOT}/server.env`)!);
    expect(env).toContain('ROX_WEBUI_OIDC_ALLOWED_SUBS=alice-sub');
    expect(env).toContain('ROX_WEBUI_PASSWORD_LOGIN=0');
    expect(daytona.createCalls[0]).toMatchObject({ public: false, snapshot: 'rox-session-server-v1' });
    expect(daytona.signedPreviewCalls[0]!.expiresInSeconds).toBeLessThanOrEqual(3600);
  });

  it('refuses to pin a sandbox to someone other than the caller', async () => {
    const { clientFor } = setup();
    await expect(runCloudHandoff(input(clientFor('tok-alice'), 'bob-sub'))).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('requires a valid id.rox.one token', async () => {
    const { fetchImpl } = setup();
    const res = await fetchImpl(`https://broker.rox.one${BROKER_API_PREFIX}/sandboxes`, { headers: { Authorization: 'Bearer bad' } });
    expect(res.status).toBe(401);
  });

  it('isolates owners and allows only the two handoff commands and port', async () => {
    const { clientFor, daytona } = setup();
    const alice = clientFor('tok-alice');
    const bob = clientFor('tok-bob');
    const sbx = await alice.createSandbox({ name: 'x', labels: { 'rox.cloud-handoff.id': 'hf_iso_00001' }, autoDeleteIntervalMin: 1 });
    await expect(bob.getSandbox(sbx.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(bob.deleteSandbox(sbx.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await bob.listSandboxes()).toEqual([]);
    await expect(alice.exec(sbx.id, 'bash -c id')).rejects.toThrow('command_not_allowed');
    await expect(alice.writeFile(sbx.id, '/etc/passwd', enc.encode('x'))).rejects.toThrow('invalid_path');
    await expect(alice.getSignedPreviewUrl(sbx.id, 22222, 60)).rejects.toThrow('port_not_allowed');
    await alice.getSignedPreviewUrl(sbx.id, 9100, 999_999);
    expect(daytona.signedPreviewCalls.at(-1)!.expiresInSeconds).toBe(3600);
  });

  it('does not count stopped sandboxes against the quota', async () => {
    const { clientFor, daytona } = setup();
    const alice = clientFor('tok-alice');
    const a = await runCloudHandoff(input(alice, 'alice-sub', 'hf_quota_0001'));
    await runCloudHandoff(input(alice, 'alice-sub', 'hf_quota_0002'));
    await expect(runCloudHandoff(input(alice, 'alice-sub', 'hf_quota_0003'))).rejects.toMatchObject({ code: 'quota_exceeded' });
    await daytona.stopSandbox(a.sandboxId);
    await runCloudHandoff(input(alice, 'alice-sub', 'hf_quota_0004'));
  });
});

describe('fetchRoxIdSubject', () => {
  const mk = (sub: unknown, status = 200) => async (url: string) =>
    url.endsWith('/.well-known/openid-configuration')
      ? Response.json({ userinfo_endpoint: 'https://id.rox.one/userinfo' })
      : status === 200
        ? Response.json({ sub })
        : new Response('', { status });

  it('returns the OIDC sub reported by id.rox.one userinfo', async () => {
    expect(await fetchRoxIdSubject({ issuer: 'https://id.rox.one', accessToken: 't', fetchImpl: mk('oidc-sub-1') })).toBe('oidc-sub-1');
  });
  it('maps 401 to sign_in_required and rejects missing subs', async () => {
    await expect(fetchRoxIdSubject({ issuer: 'https://id.rox.one', accessToken: 't', fetchImpl: mk('x', 401) })).rejects.toMatchObject({ code: 'sign_in_required' });
    await expect(fetchRoxIdSubject({ issuer: 'https://id.rox.one', accessToken: 't', fetchImpl: mk('') })).rejects.toMatchObject({ code: 'sign_in_required' });
  });
});
