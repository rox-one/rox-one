import { expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dir, '../../../../..');
const pack = path.join(root, 'apps/electron/resources/skills/compound-engineering');
const sandbox = () => fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'rox-compound-')));

for (const skill of ['ce-brainstorm', 'ce-prototype', 'ce-polish']) {
  test(`${skill}: confined descriptor reads and private output resist symlinks`, async () => {
    const helper = await import(path.join(pack, skill, 'scripts/safe-files.js'));
    const dir = sandbox();
    try {
      const screens = path.join(dir, 'screens'); fs.mkdirSync(screens);
      const outside = path.join(dir, 'outside'); fs.writeFileSync(outside, 'PRIVATE_SENTINEL');
      const target = path.join(screens, 'screen.html'); fs.writeFileSync(target, '<h1>prototype</h1>');
      expect(helper.readContainedFile(screens, target)?.data.toString()).toBe('<h1>prototype</h1>');
      expect(helper.readContainedFile(screens, outside)).toBeNull();
      const rootAlias = path.join(dir, 'chosen-root-alias'); fs.symlinkSync(screens, rootAlias);
      expect(helper.readContainedFile(rootAlias, path.join(rootAlias, 'screen.html'))?.data.toString()).toBe('<h1>prototype</h1>');
      fs.symlinkSync(outside, path.join(screens, 'link.html'));
      fs.symlinkSync(dir, path.join(screens, 'linked-directory'));
      expect(helper.readContainedFile(screens, path.join(screens, 'link.html'))).toBeNull();
      expect(helper.readContainedFile(screens, path.join(screens, 'linked-directory/outside'))).toBeNull();
      expect(helper.readContainedFile(screens, screens)).toBeNull();
      // Swap after confinement resolution, at the actual open boundary.
      const originalOpen = fs.openSync;
      fs.openSync = ((file: any, ...args: any[]) => {
        if (file === target) { fs.unlinkSync(target); fs.symlinkSync(outside, target); }
        return (originalOpen as any)(file, ...args);
      }) as typeof fs.openSync;
      try { expect(helper.readContainedFile(screens, target)).toBeNull(); }
      finally { fs.openSync = originalOpen; }
      fs.unlinkSync(target); fs.writeFileSync(target, 'before-open');
      fs.openSync = ((file: any, ...args: any[]) => {
        const fd = (originalOpen as any)(file, ...args);
        if (file === target) { fs.unlinkSync(target); fs.writeFileSync(target, 'replacement'); }
        return fd;
      }) as typeof fs.openSync;
      try { expect(helper.readContainedFile(screens, target)).toBeNull(); }
      finally { fs.openSync = originalOpen; }
      const state = path.join(dir, 'state'); helper.ensurePrivateDirectory(state);
      const output = path.join(state, 'session.json');
      // A legacy predictable temporary name may already be hostile.
      fs.symlinkSync(outside, `${output}.${process.pid}.tmp`);
      fs.symlinkSync(outside, output);
      helper.writePrivate(output, 'local session');
      expect(fs.readFileSync(outside, 'utf8')).toBe('PRIVATE_SENTINEL');
      expect(fs.readFileSync(output, 'utf8')).toBe('local session');
      expect(fs.statSync(output).mode & 0o777).toBe(0o600);
      expect(fs.statSync(state).mode & 0o777).toBe(0o700);
      expect(fs.readdirSync(state).filter(name => name.startsWith('.ce-write-'))).toEqual([]);
      helper.appendPrivate(output, '\nappend');
      expect(fs.readFileSync(output, 'utf8')).toBe('local session\nappend');
      const link = path.join(state, 'log-link'); fs.symlinkSync(outside, link);
      expect(() => helper.appendPrivate(link, 'overwrite')).toThrow();
      const linkedState = path.join(dir, 'linked-state'); fs.symlinkSync(state, linkedState);
      expect(() => helper.writePrivate(path.join(linkedState, 'new'), 'unsafe')).toThrow();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

async function runningHelper(skill: string, script: string, extra: string[] = []) {
  const dir = sandbox(); fs.mkdirSync(path.join(dir, 'screens'));
  fs.writeFileSync(path.join(dir, 'screens/index.html'), '<!doctype html><html><script>window.PROTOTYPE_OK=true</script><h1>working</h1></html>');
  const child = spawn(process.execPath.includes('bun') ? 'node' : process.execPath, [path.join(pack, skill, 'scripts', script), 'serve', '--root', dir, '--host', '127.0.0.1', '--port', '0', ...extra], {
    stdio: 'ignore', env: { ...process.env, OPENAI_API_KEY: '', CE_LIGHT_WEB_WAIT_TIMEOUT_MS: '100' },
  });
  const metadata = path.join(dir, 'state', script === 'live-endpoint.js' ? 'session.json' : 'display-info.json');
  try {
    for (let i = 0; i < 300; i++) {
      if (fs.existsSync(metadata)) {
        const info = JSON.parse(fs.readFileSync(metadata, 'utf8'));
        if (info.port) return { dir, child, info, base: `http://127.0.0.1:${info.port}` };
      }
      if (child.exitCode !== null) throw new Error('Helper exited before readiness');
      await Bun.sleep(10);
    }
    throw new Error('Helper readiness timeout');
  } catch (error) { child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); throw error; }
}
async function stopHelper(run: Awaited<ReturnType<typeof runningHelper>>) {
  if (run.child.exitCode === null) {
    const exit = new Promise<void>(resolve => run.child.once('exit', () => resolve()));
    run.child.kill('SIGTERM');
    const timeout = setTimeout(() => run.child.kill('SIGKILL'), 1000);
    await exit; clearTimeout(timeout);
  }
  fs.rmSync(run.dir, { recursive: true, force: true });
}

for (const skill of ['ce-brainstorm', 'ce-prototype']) {
  test(`${skill}: actual HTTP screens preserve authored HTML and deny escape`, async () => {
    const run = await runningHelper(skill, 'light-webserver.js', ['--annotate']);
    try {
      const outside = path.join(run.dir, 'private.txt'); fs.writeFileSync(outside, 'PRIVATE_SENTINEL');
      fs.symlinkSync(outside, path.join(run.dir, 'screens/escape.txt'));
      for (const route of ['/escape.txt', '/%2e%2e/private.txt', '/..%5cprivate.txt', '/%00', '/missing', '/%ZZ']) {
        const response = await fetch(run.base + route);
        expect([400, 404]).toContain(response.status);
        expect(await response.text()).not.toContain('PRIVATE_SENTINEL');
      }
      const page = await fetch(run.base + '/index.html', { headers: { accept: 'text/html' } });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<script>window.PROTOTYPE_OK=true</script>');
      expect((await fetch(run.base + '/wait')).status).toBe(401);
      expect(fs.statSync(path.join(run.dir, 'state/display-info.json')).mode & 0o777).toBe(0o600);
    } finally { await stopHelper(run); }
  });
}

test('polish route selection never bypasses page/agent credentials or origin separation', async () => {
  const run = await runningHelper('ce-polish', 'live-endpoint.js', ['--app-origin', 'http://localhost:3000']);
  try {
    for (const [route, method] of [['/session', 'GET'], ['/status', 'GET'], ['/wait', 'GET'], ['/mint', 'POST'], ['/events', 'POST'], ['/session/end', 'POST'], ['/units/test/status', 'POST']] as const) {
      const response = await fetch(run.base + route, { method });
      expect(response.status).toBe(401);
    }
    const pageHeaders = { authorization: `Bearer ${run.info.page_token}` };
    const agentHeaders = { authorization: `Bearer ${run.info.agent_token}` };
    expect((await fetch(run.base + '/session', { headers: pageHeaders })).status).toBe(200);
    expect((await fetch(run.base + '/session', { headers: agentHeaders })).status).toBe(403);
    expect((await fetch(run.base + '/status', { headers: agentHeaders })).status).toBe(200);
    expect((await fetch(run.base + '/status', { headers: pageHeaders })).status).toBe(403);
    expect((await fetch(run.base + '/status', { headers: { ...agentHeaders, origin: 'http://localhost:3000' } })).status).toBe(403);
    expect((await fetch(run.base + '/session', { headers: { ...pageHeaders, origin: 'http://hostile.invalid' } })).status).toBe(403);
    expect((await fetch(run.base + '/session', { method: 'OPTIONS' })).status).toBe(204);
    const state = JSON.parse(fs.readFileSync(path.join(run.dir, 'state/board.json'), 'utf8'));
    expect(state.session_id).toBeNull();
  } finally { await stopHelper(run); }
});

test('prototype overlay reload cannot navigate to injected executable/external URLs', () => {
  const source = fs.readFileSync(path.join(pack, 'ce-prototype/assets/annotate.js'), 'utf8');
  const functionBody = source.split('function persistAndReload() {')[1]!.split('\n  }')[0]!;
  for (const page of ['javascript:alert(1)', '//hostile.invalid', '/\\hostile.invalid', '/\n/hostile.invalid', 'https://hostile.invalid']) {
    let destination: string | undefined;
    new Function('servedPage', 'window', 'persistState', functionBody)(page, { location: { origin: 'http://localhost:4000', search: '?token=TEST_ONLY', hash: '#pin', replace: (url: string) => { destination = url; } } }, () => {});
    expect(destination).toBeUndefined();
  }
  let destination: string | undefined;
  new Function('servedPage', 'window', 'persistState', functionBody)('/nested/screen.html', { location: { origin: 'http://localhost:4000', search: '?mode=local', hash: '#pin', replace: (url: string) => { destination = url; } } }, () => {});
  expect(destination).toBe('http://localhost:4000/nested/screen.html?mode=local#pin');
});
