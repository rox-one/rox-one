import { expect, spyOn, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dir, '../../../../../apps/electron/resources/skills/gstack');
const sessions = await import(join(root, 'gstack/design/src/session.ts'));
const states = await import(join(root, 'gstack/design/src/daemon-state.ts'));
function requiredArgument(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`Fixture command requires ${flag}`);
  return value;
}
test('design sessions use validated IDs, exclusive publication and private atomic updates', () => {
  expect(sessions.createSessionId()).toMatch(/^[a-f0-9-]{36}$/);
  expect(() => sessions.sessionPath('../victim')).toThrow();
  expect(sessions.sessionPath('123-456')).toBe(join(tmpdir(), 'design-session-123-456.json'));
  const s = sessions.createSession('response', 'brief', 'artifact');
  const filename = sessions.sessionPath(s.id);
  try {
    expect(sessions.readSession(filename)).toEqual(s);
    const victim = filename + '.victim'; writeFileSync(victim, 'untouched');
    rmSync(filename); symlinkSync(victim, filename);
    sessions.updateSession(s, 'response2', 'change', 'artifact2');
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(sessions.readSession(filename).feedbackHistory).toEqual(['change']);
    if (process.platform !== 'win32') expect(statSync(filename).mode & 0o777).toBe(0o600);
    rmSync(victim);
  } finally { rmSync(filename, { force: true }); }
});
test('design state rejects authority injection and reads bounded stable regular files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rox-design-state-'));
  const file = join(dir, 'state.json');
  const s = { pid: 123, port: 9999, startedAt: new Date().toISOString(), version: 'test', serverPath: '/design', cmdlineMarker: 'gstack-design-daemon' };
  try {
    states.writeStateFile(s, file); expect(states.readStateFile(file)).toEqual(s);
    for (const port of ['9999@invalid.test', 0, -1, 65536, 1.5]) {
      expect(states.isDaemonState({ ...s, port })).toBe(false);
      expect(await states.healthCheck(port as number)).toBeNull();
    }
    expect(states.isDaemonState({ ...s, pid: 1.5 })).toBe(false);
    rmSync(file); symlinkSync(join(dir, 'victim'), file);
    writeFileSync(join(dir, 'victim'), JSON.stringify(s));
    expect(states.readStateFile(file)).toBeNull();
    states.writeStateFile(s, file); expect(readFileSync(join(dir, 'victim'), 'utf8')).toBe(JSON.stringify(s));
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
for (const copy of ['', 'gstack']) {
  const audit = await import(join(root, copy, 'ios-qa/daemon/src/audit.ts'));
  const device = await import(join(root, copy, 'ios-qa/daemon/src/devicectl.ts'));
  const bootstrap = await import(join(root, copy, 'ios-qa/daemon/src/tunnel-bootstrap.ts'));
  test(`private audit append rejects aliases ${copy || 'flat'}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-audit-')); const file = join(dir, 'audit'); const victim = join(dir, 'victim');
    try {
      writeFileSync(victim, 'untouched'); symlinkSync(victim, file);
      await expect(audit.writeAudit({ ts: 'now' } as any, file)).rejects.toThrow();
      expect(readFileSync(victim, 'utf8')).toBe('untouched'); rmSync(file);
      await audit.writeAudit({ ts: 'now' } as any, file);
      expect(JSON.parse(readFileSync(file, 'utf8')).ts).toBe('now');
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test(`bootstrap authority and bearer redirects guarded with injected fixtures ${copy || 'flat'}`, async () => {
    const generated: string[] = [];
    const spawn = (_cmd: string, args: string[]) => {
      if (args.includes('--json-output')) {
        const output = requiredArgument(args, '--json-output');
        generated.push(output);
        let data: any;
        if (args.includes('list')) data = { result: { devices: [{ identifier: 'fixture', connectionProperties: { pairingState: 'paired', tunnelState: 'connected', transportType: 'wired' }, deviceProperties: { name: 'fixture' }, hardwareProperties: { platform: 'iOS', deviceType: 'iPhone', productType: 'iPhone' } }] } };
        else if (args.includes('details')) data = { result: { connectionProperties: { tunnelIPAddress: 'fd00::1' } } };
        else data = '/test.app/';
        writeFileSync(output, typeof data === 'string' ? data : JSON.stringify(data));
      }
      if (args.includes('--destination')) writeFileSync(requiredArgument(args, '--destination'), 'fixture-boot-token');
      return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } as any;
    };
    let calls = 0;
    const fetchImpl = (async (url: string, opts: RequestInit) => {
      calls++; expect(url).toMatch(/^http:\/\/\[fd00::1\]:9999\//); expect(opts.redirect).toBe('manual');
      if (url.endsWith('/auth/rotate')) { expect(new Headers(opts.headers).get('Authorization')).toBe('Bearer fixture-boot-token'); return new Response('', { status: 302, headers: { Location: 'https://invalid.test' } }); }
      return Response.json({ bundle_id: 'test' });
    }) as typeof fetch;
    expect((await bootstrap.bootstrapTunnel({ bundleId: 'test', port: 65536, spawnImpl: () => { throw new Error('must not spawn'); } })).ok).toBe(false);
    const result = await bootstrap.bootstrapTunnel({ bundleId: 'test', spawnImpl: spawn, fetchImpl, resolveImpl: async () => ['fd00::1'] });
    expect(result).toMatchObject({ ok: false, error: 'rotate_failed' }); expect(calls).toBe(2);
    expect(generated.length).toBe(3);
    for (const p of generated) { expect(p).not.toMatch(/devicectl-(?:list|details|procs)-\d+-\d+\.json$/); expect(() => statSync(p)).toThrow(); }
    const invalidSpawn = (_cmd: string, args: string[]) => {
      const r = spawn(_cmd, args);
      if (args.includes('details')) writeFileSync(requiredArgument(args, '--json-output'), JSON.stringify({ result: { connectionProperties: { tunnelIPAddress: 'fd00::1]:9999@invalid.test:[' } } }));
      return r;
    };
    expect(await bootstrap.bootstrapTunnel({ bundleId: 'test', spawnImpl: invalidSpawn, fetchImpl: (() => { throw new Error('must not fetch'); }) as any })).toMatchObject({ ok: false, error: 'resolve_failed' });
    expect(device.listDevices(spawn)).toHaveLength(1);
  });
}
test('stable control read preserves full-width file IDs and rejects invalid caps', async () => {
  const fs = await import('node:fs');
  const { readBoundedStable } = await import(join(root, 'gstack/lib/cso/bounded-file.ts'));
  const dir = mkdtempSync(join(tmpdir(), 'rox-stable-identity-'));
  const file = join(dir, 'input'); writeFileSync(file, 'data');
  const fstat = fs.default.fstatSync, lstat = fs.default.lstatSync;
  const lstatMock = spyOn(fs.default, 'lstatSync');
  try {
    const identity = 9007199254740992n; let sawBigint = false;
    fs.default.fstatSync = ((fd: any, opts: any) => {
      sawBigint = opts?.bigint === true;
      const s = (fstat as any)(fd, opts);
      return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { ino: identity });
    }) as any;
    lstatMock.mockImplementation(((p: any, opts: any) => {
      const s = (lstat as any)(p, opts);
      return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { ino: identity + 1n });
    }) as typeof fs.default.lstatSync);
    expect(Number(identity)).toBe(Number(identity + 1n));
    expect(() => readBoundedStable(file, 32, 'identity')).toThrow(); expect(sawBigint).toBe(true);
  } finally { fs.default.fstatSync = fstat; lstatMock.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
  expect(() => readBoundedStable(file, Number.MAX_SAFE_INTEGER + 1, 'bad cap')).toThrow();
  expect(() => readBoundedStable(file, -1, 'bad cap')).toThrow();
});
