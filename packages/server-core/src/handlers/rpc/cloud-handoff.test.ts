import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HANDOFF_BROKER_URL_ENV, HANDOFF_DEFAULT_KEY_ENV, MemoryDaytonaClient, type SnapshotSource } from '@rox/cloud-runner';
import { CloudHandoffService, HANDOFF_CLIENT_ID_ENV } from './cloud-handoff';
import { collectHandoffSources, extractReferencedPaths, isContained } from './cloud-handoff-sources';

const enc = new TextEncoder();
const sources: SnapshotSource[] = [
  { path: 'session/session.jsonl', size: 3, read: async () => enc.encode('{}\n') },
];
const OIDC_SUB = 'oidc-sub-from-id-rox-one';

/** id.rox.one stand-in: userinfo returns OIDC_SUB for the account token. */
const fetchImpl = async (url: string, init?: RequestInit) => {
  if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ userinfo_endpoint: 'https://id.rox.one/userinfo' });
  const auth = new Headers(init?.headers).get('authorization');
  return auth === 'Bearer rox-token' ? Response.json({ sub: OIDC_SUB }) : new Response('', { status: 401 });
};

function makeService(over: Partial<ConstructorParameters<typeof CloudHandoffService>[0]> = {}) {
  const daytona = new MemoryDaytonaClient();
  let userKey: string | null = null;
  const used: string[] = [];
  let n = 0;
  const service = new CloudHandoffService({
    readConfig: () => ({ enabled: true }),
    env: {
      [HANDOFF_CLIENT_ID_ENV]: 'rox-cloud',
      [HANDOFF_BROKER_URL_ENV]: 'https://broker.rox.one',
      [HANDOFF_DEFAULT_KEY_ENV]: 'shared-key-must-never-be-used',
    },
    readUserKey: async () => userKey,
    writeUserKey: async (k) => { userKey = k; },
    deleteUserKey: async () => { userKey = null; },
    getRoxIdAccessToken: async () => 'rox-token',
    resolveSources: async () => sources,
    makeDirectClient: (key) => { used.push(`direct:${key}`); return daytona; },
    makeBrokerClient: (url) => { used.push(`broker:${url}`); return daytona; },
    fetchImpl,
    newId: () => `hf_test_${String((n += 1)).padStart(6, '0')}`,
    ...over,
  });
  return { service, daytona, used };
}

async function settle(service: CloudHandoffService, id: string) {
  await service.running.get(id);
  return (await service.status(id))!;
}

describe('CloudHandoffService', () => {
  it('is off by default (flag)', async () => {
    const { service, used } = makeService({ readConfig: () => undefined });
    const s = await service.start('sess-1');
    expect(s.failure?.code).toBe('disabled');
    expect(used).toHaveLength(0);
    expect((await service.getConfig()).enabled).toBe(false);
  });

  it('without a personal key goes through the broker and never touches the shared key env', async () => {
    const { service, used, daytona } = makeService();
    const started = await service.start('sess-1');
    const done = await settle(service, started.handoffId);
    expect(done.phase).toBe('ready');
    expect(done.keySource).toBe('broker');
    expect(used.every((u) => u.startsWith('broker:'))).toBe(true);
    expect(JSON.stringify(used)).not.toContain('shared-key');
    expect(JSON.stringify(done)).not.toContain('shared-key');
    // Owner is the id.rox.one OIDC sub (userinfo), the same value the browser id_token carries.
    const env = new TextDecoder().decode(daytona.files.get(done.sandboxId!)!.get('/home/daytona/rox-handoff/server.env')!);
    expect(env).toContain(`ROX_WEBUI_OIDC_ALLOWED_SUBS=${OIDC_SUB}`);
    expect((await service.getConfig())).toMatchObject({ enabled: true, brokerConfigured: true, userKeyConfigured: false });
  });

  it('asks for a personal key when there is neither a key nor a broker', async () => {
    const { service, used } = makeService({ env: { [HANDOFF_CLIENT_ID_ENV]: 'c', [HANDOFF_DEFAULT_KEY_ENV]: 'shared' } });
    const s = await service.start('sess-1');
    expect((await settle(service, s.handoffId)).failure?.code).toBe('no_key');
    expect(used).toHaveLength(0);
    expect((await service.getConfig()).brokerConfigured).toBe(false);
  });

  it('uses the personal key directly once saved', async () => {
    const { service, used } = makeService();
    await expect(service.setKey('short')).rejects.toThrow('cloudHandoff.invalidKey');
    await service.setKey('  user-daytona-key-abcdef  ');
    const s = await service.start('sess-2');
    expect((await settle(service, s.handoffId)).keySource).toBe('user');
    expect(used[0]).toBe('direct:user-daytona-key-abcdef');
  });

  it('reports sign-in required without a Rox ID token or when id.rox.one rejects it', async () => {
    const a = makeService({ getRoxIdAccessToken: async () => null });
    const s1 = await a.service.start('sess-1');
    expect((await settle(a.service, s1.handoffId)).failure?.code).toBe('sign_in_required');
    const b = makeService({ getRoxIdAccessToken: async () => 'stale-token' });
    const s2 = await b.service.start('sess-1');
    expect((await settle(b.service, s2.handoffId)).failure?.code).toBe('sign_in_required');
  });

  it('issues a fresh short-lived link on every status read and never stores it', async () => {
    const { service, daytona } = makeService();
    const s = await service.start('sess-1');
    const first = await settle(service, s.handoffId);
    const second = (await service.status(s.handoffId))!;
    expect(first.sessionUrl).toMatch(/^https:\/\/9100-signed/);
    expect(second.sessionUrl).not.toBe(first.sessionUrl);
    expect(daytona.signedPreviewCalls.every((c) => c.expiresInSeconds <= 3600)).toBe(true);
  });

  it('ends a cloud session and replaces the previous one for the same chat', async () => {
    const { service, daytona } = makeService();
    const a = await settle(service, (await service.start('sess-1')).handoffId);
    const b = await settle(service, (await service.start('sess-1')).handoffId);
    expect(b.handoffId).not.toBe(a.handoffId);
    expect(daytona.sandboxes.get(a.sandboxId!)!.state).toBe('destroyed');
    expect((await service.status(a.handoffId))!.ended).toBe(true);
    expect(await service.end('sess-1')).toEqual({ ok: true });
    expect(daytona.sandboxes.get(b.sandboxId!)!.state).toBe('destroyed');
    const after = (await service.statusForSession('sess-1'))!;
    expect(after.ended).toBe(true);
    expect(after.sessionUrl).toBeUndefined();
  });

  it('a rejected start does not hide the last ready link for the chat', async () => {
    let enabled = true;
    const { service } = makeService({ readConfig: () => ({ enabled }) });
    const ready = await settle(service, (await service.start('sess-1')).handoffId);
    enabled = false;
    const rejected = await service.start('sess-1');
    expect(rejected.failure?.code).toBe('disabled');
    expect((await service.statusForSession('sess-1'))!.handoffId).toBe(ready.handoffId);
  });

  it('dedupes concurrent starts per chat, serializes across chats, rejects bad ids', async () => {
    const { service } = makeService();
    const a = await service.start('sess-1');
    const b = await service.start('sess-1');
    expect(b.handoffId).toBe(a.handoffId);
    const other = await service.start('sess-2');
    expect(other.failure?.code).toBe('quota_exceeded');
    await expect(service.start('../etc')).rejects.toThrow('cloudHandoff.invalidSession');
  });
});

describe('collectHandoffSources', () => {
  it('walks the session dir, follows no symlinks, and adds referenced workspace files only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-handoff-'));
    const wd = join(root, 'proj');
    const sessionDir = join(root, 'sess');
    mkdirSync(join(sessionDir, 'attachments'), { recursive: true });
    mkdirSync(join(wd, 'src'), { recursive: true });
    writeFileSync(join(wd, 'src', 'a.ts'), 'export {}');
    writeFileSync(join(wd, 'unreferenced.ts'), 'x');
    writeFileSync(join(root, 'outside.txt'), 'nope');
    symlinkSync(join(root, 'outside.txt'), join(wd, 'link.txt'));
    symlinkSync(join(root, 'outside.txt'), join(sessionDir, 'attachments', 'evil'));
    writeFileSync(join(sessionDir, 'attachments', 'pic.png'), 'png');
    writeFileSync(
      join(sessionDir, 'session.jsonl'),
      JSON.stringify({ tool: 'Read', path: `${wd}/src/a.ts` }) + '\n' + JSON.stringify({ path: `${wd}/link.txt` }) + '\n'
        + JSON.stringify({ path: `${wd}/../outside.txt` }) + '\n',
    );
    const out = await collectHandoffSources({ sessionDir, workingDirectory: wd });
    expect(out.map((s) => s.path).sort()).toEqual(['session/attachments/pic.png', 'session/session.jsonl', 'workspace/src/a.ts']);
  });

  it('extracts referenced paths under the working dir', () => {
    expect(extractReferencedPaths('see /w/p/x.ts, and /w/other/y', '/w/p')).toEqual(['/w/p/x.ts']);
  });
});

describe('isContained', () => {
  it('accepts ..-prefixed names and rejects escapes', () => {
    expect(isContained('/w/p', '/w/p/..cache/x')).toBe(true);
    expect(isContained('/w/p', '/w/p/../q')).toBe(false);
    expect(isContained('/w/p', '/w/p')).toBe(false);
    expect(isContained('/w/p', '/other')).toBe(false);
  });
});
