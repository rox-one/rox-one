import { describe, expect, it } from 'bun:test';
import { HttpDaytonaClient, MemoryDaytonaClient } from '../daytona-client.ts';
import {
  HANDOFF_DEFAULT_KEY_ENV,
  HANDOFF_ROOT,
  HandoffError,
  normalizeSnapshotPath,
  packSnapshot,
  resolveHandoffKey,
  runCloudHandoff,
  type SnapshotSource,
} from '../handoff/index.ts';

const enc = new TextEncoder();
const src = (path: string, text: string): SnapshotSource => {
  const bytes = enc.encode(text);
  return { path, size: bytes.byteLength, read: async () => bytes };
};
const KEY = 'dtn_test_key_value_1234567890abcdef';
const sso = { issuer: 'https://id.rox.one', clientId: 'rox-cloud-sessions' };

function baseInput(client: MemoryDaytonaClient, extra: Partial<Parameters<typeof runCloudHandoff>[0]> = {}) {
  return {
    client,
    apiKey: KEY,
    handoffId: 'hf_abcdef123456',
    sessionId: 'sess-1',
    ownerSub: 'user-sub-42',
    sources: [
      src('session/session.jsonl', '{"role":"user","text":"hi"}\n'),
      src('attachments/pic.txt', 'image-ish'),
      src('workspace/.env', 'SECRET=1'),
      src('workspace/notes.md', 'my key is sk-ant-abcdefghijklmnopqrstuvwxyz'),
      src('../escape.txt', 'x'),
    ],
    sso,
    sleep: async () => undefined,
    ...extra,
  };
}

describe('snapshot packaging', () => {
  it('normalizes and rejects unsafe paths', () => {
    expect(normalizeSnapshotPath('a/./b//c')).toBe('a/b/c');
    expect(normalizeSnapshotPath('/etc/passwd')).toBeNull();
    expect(normalizeSnapshotPath('a/../b')).toBeNull();
    expect(normalizeSnapshotPath('C:/x')).toBeNull();
    expect(normalizeSnapshotPath('a\\b')).toBeNull();
  });

  it('drops secrets by path and content, keeps the rest', async () => {
    const excluded: { path: string; reason: string }[] = [];
    const out: string[] = [];
    for await (const f of packSnapshot(
      [src('a.txt', 'ok'), src('.git/config', 'x'), src('id_ed25519', 'k'), src('b.txt', `token ${KEY}`)],
      { maxFileBytes: 100, maxTotalBytes: 1000, maxFiles: 10 },
      excluded,
      { knownSecrets: [KEY] },
    )) out.push(f.path);
    expect(out).toEqual(['a.txt']);
    expect(excluded.map((e) => e.reason).sort()).toEqual(['ignored_dir', 'secret_content', 'secret_path']);
  });

  it('refuses oversize sessions instead of partial upload', async () => {
    const gen = packSnapshot([src('a', 'xxxx'), src('b', 'yyyy')], { maxFileBytes: 10, maxTotalBytes: 6, maxFiles: 10 }, []);
    await expect(gen.next()).rejects.toMatchObject({ code: 'too_large' });
  });

  it('re-checks real byte size, not the claimed stat', async () => {
    const lying: SnapshotSource = { path: 'big', size: 1, read: async () => new Uint8Array(50) };
    const excluded: { path: string; reason: string }[] = [];
    const out = [];
    for await (const f of packSnapshot([lying], { maxFileBytes: 10, maxTotalBytes: 100, maxFiles: 10 }, excluded)) out.push(f);
    expect(out).toHaveLength(0);
    expect(excluded[0]).toEqual({ path: 'big', reason: 'file_too_large' });
  });
});

describe('key resolution', () => {
  it('prefers the user key', async () => {
    const r = await resolveHandoffKey({ readUserKey: async () => ' user-key ', env: { [HANDOFF_DEFAULT_KEY_ENV]: 'srv' } });
    expect(r).toEqual({ key: 'user-key', source: 'user' });
  });
  it('falls back to the server default', async () => {
    const r = await resolveHandoffKey({ readUserKey: async () => null, env: { [HANDOFF_DEFAULT_KEY_ENV]: 'srv' } });
    expect(r.source).toBe('server_default');
  });
  it('fails closed without any key, or when default is disallowed', async () => {
    await expect(resolveHandoffKey({ readUserKey: async () => '', env: {} })).rejects.toMatchObject({ code: 'no_key' });
    await expect(
      resolveHandoffKey({ readUserKey: async () => null, env: { [HANDOFF_DEFAULT_KEY_ENV]: 'srv' }, allowServerDefault: false }),
    ).rejects.toMatchObject({ code: 'no_key' });
  });
  it('does not silently bill the shared key when the store is unreadable', async () => {
    await expect(
      resolveHandoffKey({ readUserKey: async () => { throw new Error('locked'); }, env: { [HANDOFF_DEFAULT_KEY_ENV]: 'srv' } }),
    ).rejects.toMatchObject({ code: 'no_key' });
  });
});

describe('runCloudHandoff', () => {
  it('migrates the session and returns an owner-gated preview URL', async () => {
    const client = new MemoryDaytonaClient();
    const phases: string[] = [];
    const res = await runCloudHandoff(baseInput(client, { onProgress: (p) => phases.push(p.phase) }));
    expect(res.sessionUrl).toBe(`https://9100-${res.sandboxId}.proxy.memory.daytona.test/`);
    const files = client.files.get(res.sandboxId)!;
    expect([...files.keys()].sort()).toEqual([
      `${HANDOFF_ROOT}/bundle/attachments/pic.txt`,
      `${HANDOFF_ROOT}/bundle/session/session.jsonl`,
      `${HANDOFF_ROOT}/manifest.json`,
      `${HANDOFF_ROOT}/server.env`,
    ].sort());
    const env = new TextDecoder().decode(files.get(`${HANDOFF_ROOT}/server.env`)!);
    expect(env).toContain('ROX_WEBUI_OIDC_ALLOWED_SUBS=user-sub-42');
    expect(env).toContain('ROX_WEBUI_OIDC_ISSUER=https://id.rox.one');
    expect(env).not.toContain(KEY);
    expect(res.manifest.excluded.map((e) => e.reason).sort()).toEqual(['secret_content', 'secret_path', 'unsafe_path']);
    const call = client.createCalls[0]!;
    expect(call.public).toBe(true);
    expect(call.autoStopIntervalMin).toBe(30);
    expect((call.labels as Record<string, string>)['rox.cloud-handoff.owner']).not.toContain('user-sub-42');
    expect(phases).toContain('ready');
  });

  it('keeps the sandbox private behind a configured web host', async () => {
    const client = new MemoryDaytonaClient();
    const res = await runCloudHandoff(baseInput(client, { webHost: 'https://cloud.rox.one/' }));
    expect(res.sessionUrl).toBe('https://cloud.rox.one/s/hf_abcdef123456/');
    expect(client.createCalls[0]!.public).toBe(false);
  });

  it('requires Rox ID sign-in and SSO config before any spend', async () => {
    const client = new MemoryDaytonaClient();
    await expect(runCloudHandoff(baseInput(client, { ownerSub: null }))).rejects.toMatchObject({ code: 'sign_in_required' });
    await expect(runCloudHandoff(baseInput(client, { sso: null }))).rejects.toMatchObject({ code: 'sso_not_configured' });
    expect(client.createCalls).toHaveLength(0);
  });

  it('enforces the per-owner quota', async () => {
    const client = new MemoryDaytonaClient();
    await runCloudHandoff(baseInput(client, { handoffId: 'hf_one_000001' }));
    await runCloudHandoff(baseInput(client, { handoffId: 'hf_two_000002' }));
    await expect(runCloudHandoff(baseInput(client, { handoffId: 'hf_three_00003' }))).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(client.createCalls).toHaveLength(2);
  });

  it('deletes the sandbox when the server never becomes healthy', async () => {
    const client = new MemoryDaytonaClient();
    client.execOverride = (cmd) => (cmd.startsWith('rox-handoff-health') ? { exitCode: 1, stdout: '', stderr: '' } : undefined);
    let t = 0;
    await expect(
      runCloudHandoff(baseInput(client, { now: () => (t += 50_000), limits: { readyTimeoutMs: 100_000 } })),
    ).rejects.toMatchObject({ code: 'start_timeout' });
    expect([...client.sandboxes.values()].every((s) => s.state === 'destroyed')).toBe(true);
  });

  it('cleans up and reports cancellation', async () => {
    const client = new MemoryDaytonaClient();
    const ac = new AbortController();
    const promise = runCloudHandoff(
      baseInput(client, { signal: ac.signal, onProgress: (p) => { if (p.phase === 'uploading') ac.abort(); } }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect([...client.sandboxes.values()].every((s) => s.state === 'destroyed')).toBe(true);
  });

  it('never leaks the API key in errors', async () => {
    const client = new MemoryDaytonaClient();
    client.listSandboxes = async () => { throw new Error(`boom ${KEY}`); };
    const err = await runCloudHandoff(baseInput(client)).catch((e) => e as HandoffError);
    expect(err.code).toBe('provider_error');
    expect(err.message).not.toContain(KEY);
  });

  it('rejects non-https hosts and bad handoff ids', async () => {
    const client = new MemoryDaytonaClient();
    await expect(runCloudHandoff(baseInput(client, { webHost: 'http://cloud.rox.one' }))).rejects.toBeInstanceOf(HandoffError);
    await expect(runCloudHandoff(baseInput(client, { handoffId: '../x' }))).rejects.toMatchObject({ code: 'provider_error' });
  });
});

describe('HttpDaytonaClient handoff extensions', () => {
  it('sends env/public/autoStop and reads preview URL', async () => {
    const calls: { url: string; body?: string }[] = [];
    const client = new HttpDaytonaClient({
      resolveApiKey: async () => KEY,
      fetchImpl: async (url, init) => {
        calls.push({ url, body: init?.body as string | undefined });
        if (url.endsWith('/preview-url')) return new Response(JSON.stringify({ url: 'https://9100-x.proxy.daytona.works' }));
        return new Response(JSON.stringify({ id: 'x', state: 'started' }));
      },
    });
    await client.createSandbox({ name: 'n', labels: {}, autoDeleteIntervalMin: 5, env: { A: 'b' }, public: false, autoStopIntervalMin: 30 });
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ env: { A: 'b' }, public: false, autoStopInterval: 30 });
    expect(await client.getPreviewUrl('x', 9100)).toBe('https://9100-x.proxy.daytona.works');
    expect(calls[1]!.url).toBe('https://app.daytona.io/api/sandbox/x/ports/9100/preview-url');
  });
});
