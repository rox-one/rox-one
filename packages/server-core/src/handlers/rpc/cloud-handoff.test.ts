import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryDaytonaClient, HANDOFF_DEFAULT_KEY_ENV, type SnapshotSource } from '@rox/cloud-runner';
import { CloudHandoffService, HANDOFF_CLIENT_ID_ENV } from './cloud-handoff';
import { collectHandoffSources, extractReferencedPaths } from './cloud-handoff-sources';

const enc = new TextEncoder();
const sources: SnapshotSource[] = [
  { path: 'session/session.jsonl', size: 3, read: async () => enc.encode('{}\n') },
];

function makeService(over: Partial<ConstructorParameters<typeof CloudHandoffService>[0]> = {}) {
  const client = new MemoryDaytonaClient();
  let userKey: string | null = null;
  const keysUsed: string[] = [];
  let n = 0;
  const service = new CloudHandoffService({
    readConfig: () => ({ enabled: true }),
    env: { [HANDOFF_CLIENT_ID_ENV]: 'rox-cloud', [HANDOFF_DEFAULT_KEY_ENV]: 'server-default-key-123456' },
    readUserKey: async () => userKey,
    writeUserKey: async (k) => { userKey = k; },
    deleteUserKey: async () => { userKey = null; },
    resolveOwnerSub: async () => 'owner-1',
    resolveSources: async () => sources,
    makeClient: (key) => { keysUsed.push(key); return client; },
    newId: () => `hf_test_${String((n += 1)).padStart(6, '0')}`,
    ...over,
  });
  return { service, client, keysUsed };
}

describe('CloudHandoffService', () => {
  it('is off by default (flag)', async () => {
    const { service, keysUsed } = makeService({ readConfig: () => undefined });
    const s = await service.start('sess-1');
    expect(s.phase).toBe('failed');
    expect(s.failure?.code).toBe('disabled');
    expect(keysUsed).toHaveLength(0);
    expect((await service.getConfig()).enabled).toBe(false);
  });

  it('runs to ready with the server default key and never exposes it', async () => {
    const { service, keysUsed } = makeService();
    const started = await service.start('sess-1');
    await service.running.get(started.handoffId);
    const done = service.status(started.handoffId)!;
    expect(done.phase).toBe('ready');
    expect(done.sessionUrl).toMatch(/^https:\/\/9100-signed/);
    expect(done.keySource).toBe('server_default');
    expect(keysUsed).toEqual(['server-default-key-123456']);
    expect(JSON.stringify(done)).not.toContain('server-default-key');
    const cfg = await service.getConfig();
    expect(JSON.stringify(cfg)).not.toContain('server-default-key');
    expect(cfg).toMatchObject({ enabled: true, serverDefaultKeyAvailable: true, userKeyConfigured: false, ssoConfigured: true });
    expect(service.statusForSession('sess-1')?.handoffId).toBe(started.handoffId);
  });

  it('prefers the user key once saved, and validates input', async () => {
    const { service, keysUsed } = makeService();
    await expect(service.setKey('short')).rejects.toThrow('cloudHandoff.invalidKey');
    await service.setKey('  user-daytona-key-abcdef  ');
    const s = await service.start('sess-2');
    await service.running.get(s.handoffId);
    expect(keysUsed).toEqual(['user-daytona-key-abcdef']);
    expect(service.status(s.handoffId)?.keySource).toBe('user');
  });

  it('reports sign-in required when no Rox ID account', async () => {
    const { service } = makeService({ resolveOwnerSub: async () => null });
    const s = await service.start('sess-1');
    await service.running.get(s.handoffId);
    expect(service.status(s.handoffId)?.failure?.code).toBe('sign_in_required');
  });

  it('reports no_key without user or default key', async () => {
    const { service } = makeService({ env: { [HANDOFF_CLIENT_ID_ENV]: 'c' } });
    const s = await service.start('sess-1');
    await service.running.get(s.handoffId);
    expect(service.status(s.handoffId)?.failure?.code).toBe('no_key');
  });

  it('dedupes concurrent starts per session and rejects bad ids', async () => {
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
