import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryDaytonaClient } from '../daytona-client.ts';
import { HANDOFF_ROOT, ensureSessionRunning, runCloudHandoff } from '../handoff/index.ts';

const enc = new TextEncoder();
const noSleep = { sleep: async () => undefined };

async function readySandbox() {
  const client = new MemoryDaytonaClient({ execDelayMs: 0 });
  const res = await runCloudHandoff({
    client, apiKey: 'dtn_' + 'x'.repeat(40), handoffId: 'hf_review4_0001', sessionId: 's1', ownerSub: 'alice',
    sources: [{ path: 'session/session.jsonl', size: 2, read: async () => enc.encode('{}') }],
    sso: { issuer: 'https://id.rox.one', clientId: 'c' }, webHost: 'https://cloud.rox.one', ...noSleep,
  });
  const commands: string[] = [];
  return { client, id: res.sandboxId, commands, record: (fail?: (c: string) => number | undefined) => {
    client.execOverride = (c) => { commands.push(c); const code = fail?.(c); return code === undefined ? undefined : { exitCode: code, stdout: '', stderr: '' }; };
  } };
}

describe('ensureSessionRunning (review4 #3)', () => {
  it('health-checks a started sandbox and does nothing else when healthy', async () => {
    const t = await readySandbox();
    t.record();
    expect(await ensureSessionRunning(t.client, t.id, noSleep)).toBe(false);
    expect(t.commands).toEqual([`rox-handoff-health ${HANDOFF_ROOT}`]);
  });

  it('restarts the server when a started sandbox is unhealthy (crashed server)', async () => {
    const t = await readySandbox();
    let healthCalls = 0;
    t.record((c) => (c.startsWith('rox-handoff-health') && (healthCalls += 1) === 1 ? 1 : undefined));
    expect(await ensureSessionRunning(t.client, t.id, noSleep)).toBe(true);
    expect(t.commands.map((c) => c.split(' ')[0])).toEqual(['rox-handoff-health', 'rox-handoff-start', 'rox-handoff-health']);
  });

  it('waits out transitional states before running any command', async () => {
    const t = await readySandbox();
    const rec = t.client.sandboxes.get(t.id)!;
    rec.state = 'stopping';
    let polls = 0;
    const sleep = async () => {
      polls += 1;
      expect(t.commands).toHaveLength(0); // nothing exec'd while transitional
      if (polls === 2) rec.state = 'stopped';
    };
    t.record();
    expect(await ensureSessionRunning(t.client, t.id, { sleep })).toBe(true);
    expect(polls).toBe(2);
    expect(rec.state as string).toBe('started');
    expect(t.commands[0]).toMatch(/^rox-handoff-start/); // freshly started: no pre-check, straight to start script
  });

  it('times out instead of exec-ing into a sandbox stuck in a transitional state', async () => {
    const t = await readySandbox();
    t.client.sandboxes.get(t.id)!.state = 'creating';
    let clock = 0;
    t.record();
    await expect(ensureSessionRunning(t.client, t.id, { sleep: async () => { clock += 10_000; }, now: () => clock, limits: { readyTimeoutMs: 30_000 } }))
      .rejects.toMatchObject({ code: 'start_timeout' });
    expect(t.commands).toHaveLength(0);
  });
});

describe('rox-handoff-start server.pid handling (review4 #2)', () => {
  const temps: string[] = [];
  const procs: { kill: () => void }[] = [];
  afterEach(() => {
    for (const p of procs.splice(0)) p.kill();
    for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** Run a copy of the real script with its fixed paths pointed at a temp dir and `bun`/`openssl` stubbed. */
  async function runStart(setup: (root: string) => void) {
    const base = mkdtempSync(join(tmpdir(), 'rox-start-'));
    temps.push(base);
    const root = join(base, 'rox-handoff');
    const bin = join(base, 'bin');
    const app = join(base, 'app');
    mkdirSync(join(root, 'bundle', 'session'), { recursive: true });
    mkdirSync(bin);
    mkdirSync(app);
    writeFileSync(join(root, 'bundle', 'session', 'session.jsonl'), '{}\n');
    writeFileSync(join(root, 'server.env'), [
      'ROX_WEBUI_OIDC_ISSUER=https://id.rox.one', 'ROX_WEBUI_OIDC_CLIENT_ID=c', 'ROX_WEBUI_PUBLIC_URL=https://cloud.rox.one/s/x',
      'ROX_WEBUI_OIDC_ALLOWED_SUBS=alice', 'ROX_WEBUI_PASSWORD_LOGIN=0', 'ROX_HANDOFF_SESSION_ID=s1', '',
    ].join('\n'));
    writeFileSync(join(bin, 'bun'), `#!/usr/bin/env bash\necho started > "${base}/bun-ran"\n`);
    writeFileSync(join(bin, 'openssl'), '#!/usr/bin/env bash\necho deadbeef\n');
    chmodSync(join(bin, 'bun'), 0o755);
    chmodSync(join(bin, 'openssl'), 0o755);
    const src = readFileSync(join(import.meta.dir, '../../../../cloud/handoff-image/rox-handoff-start'), 'utf8')
      .replaceAll('/home/daytona/rox-handoff', root)
      .replaceAll('/home/daytona/rox-workspace', join(base, 'ws'))
      .replaceAll('/home/daytona/.rox', join(base, 'cfg'))
      .replace('cd /app', `cd "${app}"`);
    const script = join(base, 'start.sh');
    writeFileSync(script, src);
    chmodSync(script, 0o755);
    setup(root);
    const proc = Bun.spawn({ cmd: ['bash', script, root], env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stderr: 'pipe' });
    const code = await proc.exited;
    for (let i = 0; i < 50 && !existsSync(join(base, 'bun-ran')); i += 1) await Bun.sleep(20);
    return { code, ran: existsSync(join(base, 'bun-ran')), pid: readFileSync(join(root, 'server.pid'), 'utf8').trim(), base };
  }

  it('ignores a server.pid that points at an unrelated live process (recycled PID) and starts the server', async () => {
    const other = Bun.spawn({ cmd: ['sleep', '30'] });
    procs.push(other);
    const r = await runStart((root) => writeFileSync(join(root, 'server.pid'), `${other.pid}\n`));
    expect(r.code).toBe(0);
    expect(r.ran).toBe(true);
    expect(r.pid).not.toBe(String(other.pid));
  });

  it('treats a live Rox server process as already running (idempotent)', async () => {
    const ours = Bun.spawn({ cmd: ['bash', '-c', 'exec -a "bun run packages/server/src/index.ts" sleep 30'] });
    procs.push(ours);
    await Bun.sleep(100);
    const r = await runStart((root) => writeFileSync(join(root, 'server.pid'), `${ours.pid}\n`));
    expect(r.code).toBe(0);
    expect(r.ran).toBe(false);
    expect(r.pid).toBe(String(ours.pid));
  });

  it('unpacks the snapshot and writes the unpack-once marker', async () => {
    const first = await runStart(() => undefined);
    const ws = join(first.base, 'ws');
    expect(readFileSync(join(ws, 'sessions', 's1', 'session.jsonl'), 'utf8')).toBe('{}\n');
    expect(existsSync(join(ws, '.rox-handoff-unpacked'))).toBe(true);
  });
});
