import { describe, expect, spyOn, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpRedirectError } from '../guarded-fetch.ts';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CraftMcpClient } from '../client.ts';
import { getToolchain } from '../../toolchain-runtime.ts';

const fixture = fileURLToPath(new URL('./client-lifecycle-stdio-fixture.ts', import.meta.url));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check: () => boolean | Promise<boolean>) {
  const deadline = performance.now() + 10_000;
  while (!await check()) {
    if (performance.now() > deadline) throw new Error('Fixture did not reach expected state');
    await delay(10);
  }
}

/** Drive only lifecycle/request deadline timers; fixture I/O and polling stay real. */
function deadlineClock(budgetMs: number) {
  const schedule = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  // Bun and Node's timer handle declarations differ; forward the real handle.
  const clear = (handle: unknown) => Reflect.apply(originalClear, globalThis, [handle]);
  const timers = new Map<unknown, { due: number; fire: () => void }>();
  let now = Date.now();
  const dateSpy = spyOn(Date, 'now').mockImplementation(() => now);
  const timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation(new Proxy(schedule, {
    apply(target, receiver, [callback, ms, ...args]) {
      if (typeof callback !== 'function' || typeof ms !== 'number' || ms <= 10 || ms > budgetMs) {
        return Reflect.apply(target, receiver, [callback, ms, ...args]);
      }
      // Keep a real clearable handle so the SDK's cleanup behavior is exercised.
      const handle = Reflect.apply(target, receiver, [() => {}, 2_147_483_647]);
      timers.set(handle, { due: now + ms, fire: () => Reflect.apply(callback, undefined, args) });
      return handle;
    },
  }));
  const clearSpy = spyOn(globalThis, 'clearTimeout').mockImplementation((handle?: unknown) => {
    timers.delete(handle);
    clear(handle);
  });
  return {
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [handle, timer] = next;
        now = timer.due;
        timers.delete(handle);
        clear(handle);
        timer.fire();
      }
      now = target;
    },
    remaining: () => [...timers.values()].map(timer => timer.due - now),
    restore() {
      for (const handle of timers.keys()) clear(handle);
      timers.clear();
      clearSpy.mockRestore();
      timerSpy.mockRestore();
      dateSpy.mockRestore();
    },
  };
}

async function httpFixture(settings: { sse?: boolean; stall?: string; error?: string; delayMs?: number; status?: number; body?: string; holdResponses?: boolean; redirect?: string; errorMethod?: string } = {}) {
  const child = spawn('node', [fileURLToPath(new URL('./client-lifecycle-http-fixture.mjs', import.meta.url)), JSON.stringify(settings)], { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => resolve());
  });
  const state = { port: 0, requested: false, pending: 0, closed: 0, updated: 0, methods: [] as string[], held: [] as Array<{ index: number; method: string }>, abandoned: [] as number[] };
  const output = createInterface({ input: child.stdout! });
  output.on('line', line => {
    const event = JSON.parse(line);
    if (event.port) state.port = event.port;
    if (event.method) state.methods.push(event.method);
    if (event.requested) state.requested = true;
    if (event.pending) state.pending++;
    if (event.closed) state.closed++;
    if (event.updated) state.updated++;
    if (event.held) state.held.push(event.held);
    if (event.abandoned) state.abandoned.push(event.abandoned);
  });
  try { await waitFor(() => state.port !== 0); }
  catch (error) { child.kill(); await exited; throw error; }
  const control = async (patch: typeof settings & { release?: number }) => {
    const before = state.updated;
    child.stdin!.write(JSON.stringify(patch) + '\n');
    await waitFor(() => state.updated > before);
  };
  return { state, url: `http://127.0.0.1:${state.port}/mcp`, update: control,
    release: (index: number) => control({ release: index }),
    held: async (method: string, occurrence = 1) => {
      await waitFor(() => state.held.filter(request => request.method === method).length >= occurrence);
      return state.held.filter(request => request.method === method)[occurrence - 1]!.index;
    }, stop: async () => {
    child.stdin!.end();
    await exited;
    output.close();
  } };
}

describe('CraftMcpClient lifecycle — real transports', () => {
  for (const headers of [false, true]) {
    test(`bounds SSE startup ${headers ? 'without endpoint event' : 'without response headers'} and closes its socket`, async () => {
      const server = await httpFixture({ sse: headers });
      const client = new CraftMcpClient({ transport: 'sse', url: server.url });
      try {
        const started = Date.now();
        await expect(client.connect({ timeoutMs: 200 })).rejects.toThrow('MCP connection timed out after 200ms');
        expect(Date.now() - started).toBeLessThan(1500);
        expect(server.state.requested).toBe(true);
        await waitFor(() => server.state.closed === 1);
        expect(client.getServerInfo()).toBeUndefined();
        await client.close();
      } finally { await client.close(); await server.stop(); }
    });
  }

  test('close cancels pending SSE startup, dedupes cleanup, and prevents resurrection', async () => {
    const server = await httpFixture({ sse: true });
    const client = new CraftMcpClient({ transport: 'sse', url: server.url });
    try {
      const pending = client.connect({ timeoutMs: 2000 }).catch(error => error);
      await waitFor(() => server.state.requested);
      const firstClose = client.close();
      expect(client.close()).toBe(firstClose);
      await firstClose;
      expect((await pending).message).toBe('MCP client is closed');
      await waitFor(() => server.state.closed === 1);
      await expect(client.connect()).rejects.toThrow('MCP client is closed');
      await expect(client.listTools()).rejects.toThrow('MCP client is closed');
    } finally { await client.close(); await server.stop(); }
  });

  for (const stage of ['initialize', 'notifications/initialized', 'tools/list']) {
    test(`bounds HTTP ${stage} and aborts the real pending request`, async () => {
      const server = await httpFixture({ stall: stage });
      const client = new CraftMcpClient({ transport: 'http', url: server.url });
      const clock = deadlineClock(200);
      try {
        const pending = client.connect({ timeoutMs: 200 }).catch(error => error);
        // Reach the intended real network phase before driving only its budget.
        // CPU contention must not silently turn a tools/list test into initialize.
        await waitFor(() => server.state.methods.includes(stage));
        clock.advance(199);
        expect(client.getServerInfo()).toBeUndefined();
        clock.advance(1);
        expect((await pending).message).toBe('MCP connection timed out after 200ms');
        expect(server.state.methods).toContain(stage);
        await waitFor(() => server.state.closed === server.state.pending && server.state.pending > 0);
        expect(client.getServerInfo()).toBeUndefined();
        expect(clock.remaining()).toEqual([]);
      } finally { await client.close(); clock.restore(); await server.stop(); }
    });
  }

  test('uses one total deadline across initialize and tools health check', async () => {
    const server = await httpFixture({ holdResponses: true });
    const client = new CraftMcpClient({ transport: 'http', url: server.url });
    const clock = deadlineClock(250);
    try {
      let settled = false;
      const pending = client.connect({ timeoutMs: 250 }).catch(error => error).finally(() => { settled = true; });
      const initialize = await server.held('initialize');
      clock.advance(100);
      await server.release(initialize);
      const initialized = await server.held('notifications/initialized');
      clock.advance(100);
      await server.release(initialized);
      const healthCheck = await server.held('tools/list');
      clock.advance(49);
      expect(settled).toBe(false);
      clock.advance(1);
      await waitFor(() => settled);
      expect((await pending).message).toBe('MCP connection timed out after 250ms');
      await waitFor(() => server.state.abandoned.includes(healthCheck));
      expect(server.state.methods.filter(method => method === 'tools/list')).toHaveLength(1);
      expect(client.getServerInfo()).toBeUndefined();
      expect(clock.remaining()).toEqual([]);
    } finally { await client.close(); clock.restore(); await server.stop(); }
  });

  test('concurrent connects share exactly one initialize and health check', async () => {
    const server = await httpFixture({ delayMs: 20 });
    const client = new CraftMcpClient({ transport: 'http', url: server.url });
    try {
      const first = client.connect();
      expect(client.connect()).toBe(first);
      await Promise.all([first, client.connect(), client.connect()]);
      await client.connect();
      expect(server.state.methods.filter(method => method === 'initialize')).toHaveLength(1);
      expect(server.state.methods.filter(method => method === 'tools/list')).toHaveLength(1);
      expect(client.getServerInfo()).toEqual({ name: 'http-fixture', version: '1.0' });
    } finally { await client.close(); await server.stop(); }
  });

  test('automatic listTools connection does not reset the overall deadline after its health check', async () => {
    const server = await httpFixture({ holdResponses: true });
    const client = new CraftMcpClient({ transport: 'http', url: server.url });
    const clock = deadlineClock(350);
    try {
      let settled = false;
      const pending = client.listTools({ timeoutMs: 350 }).catch(error => error).finally(() => { settled = true; });
      const initialize = await server.held('initialize');
      clock.advance(100);
      await server.release(initialize);
      const initialized = await server.held('notifications/initialized');
      clock.advance(100);
      await server.release(initialized);
      const healthCheck = await server.held('tools/list');
      clock.advance(100);
      await server.release(healthCheck);
      const discovery = await server.held('tools/list', 2);
      // The SDK receives exactly the remaining 50ms, not a fresh 350ms.
      expect(clock.remaining().length).toBeGreaterThan(0);
      expect(clock.remaining().every(ms => ms === 50)).toBe(true);
      clock.advance(49);
      expect(settled).toBe(false);
      clock.advance(1);
      await waitFor(() => settled);
      expect((await pending).message).toBe('MCP tools/list timed out after 350ms');
      expect(server.state.methods.filter(method => method === 'tools/list')).toHaveLength(2);
      await client.close();
      await waitFor(() => server.state.abandoned.includes(discovery));
      expect(clock.remaining()).toEqual([]);
    } finally { await client.close(); clock.restore(); await server.stop(); }
  });

  test('removes the caller abort listener after connect succeeds', async () => {
    const server = await httpFixture();
    const client = new CraftMcpClient({ transport: 'http', url: server.url });
    const controller = new AbortController();
    try {
      await client.connect({ signal: controller.signal });
      controller.abort();
      expect(await client.listTools()).toEqual([]);
      expect(client.getServerInfo()).toBeDefined();
    } finally { await client.close(); await server.stop(); }
  });

  for (const stage of ['initialize', 'tools/list']) {
    test(`close cancels HTTP ${stage} without waiting for the connection deadline`, async () => {
      const server = await httpFixture({ stall: stage });
      const client = new CraftMcpClient({ transport: 'http', url: server.url });
      try {
        const pending = client.connect({ timeoutMs: 2000 }).catch(error => error);
        await waitFor(() => server.state.pending === 1);
        await client.close();
        expect((await pending).message).toBe('MCP client is closed');
        await waitFor(() => server.state.closed === server.state.pending);
        expect(client.getServerInfo()).toBeUndefined();
      } finally { await client.close(); await server.stop(); }
    });
  }

  test('explicit abort during HTTP initialization cancels the shared attempt without leaking the reason', async () => {
    const server = await httpFixture({ stall: 'initialize' });
    const client = new CraftMcpClient({ transport: 'http', url: server.url });
    const controller = new AbortController();
    try {
      const pending = client.connect({ signal: controller.signal, timeoutMs: 2000 }).catch(error => error);
      await waitFor(() => server.state.pending === 1);
      controller.abort(new Error('private caller reason'));
      expect((await pending).message).toBe('MCP connection cancelled');
      await waitFor(() => server.state.closed === server.state.pending);
    } finally { await client.close(); await server.stop(); }
  });

  test('preserves HTTP error status/type while redacting echoed URLs and configured header secrets', async () => {
    const server = await httpFixture({ status: 405, body: 'https://username:password@host/mcp?key=query-secret#fragment-secret header-secret' });
    const client = new CraftMcpClient({ transport: 'http', url: server.url + '?key=query-secret#fragment-secret', headers: { Authorization: 'Bearer header-secret' } });
    try {
      const error = await client.connect().catch(error => error);
      expect(error).toBeInstanceOf(StreamableHTTPError);
      expect(error.code).toBe(405);
      expect(error.message).toContain('https://host/mcp');
      for (const secret of ['username', 'password', 'query-secret', 'fragment-secret', 'header-secret']) expect(error.message).not.toContain(secret);
      expect(error.cause).toBeUndefined();
    } finally { await client.close(); await server.stop(); }
  });

  test('redacts health-check errors and closes an initialized connection', async () => {
    const server = await httpFixture({ error: 'Bearer private-header https://user:pass@host/mcp?token=private-query' });
    const client = new CraftMcpClient({ transport: 'http', url: server.url, headers: { Authorization: 'Bearer private-header' } });
    try {
      const error = await client.connect().catch(error => error);
      expect(error.message).toContain('failed health check');
      expect(error.message).not.toContain('private-header');
      expect(error.message).not.toContain('private-query');
      expect(client.getServerInfo()).toBeUndefined();
    } finally { await client.close(); await server.stop(); }
  });

  test('bounds a later tools/list request after a successful connection', async () => {
    const server = await httpFixture();
    const client = new CraftMcpClient({ transport: 'http', url: server.url });
    try {
      await client.connect();
      await server.update({ stall: 'tools/list' });
      await expect(client.listTools({ timeoutMs: 100 })).rejects.toThrow('MCP tools/list timed out after 100ms');
      await client.close();
      await waitFor(() => server.state.closed === server.state.pending && server.state.pending > 0);
    } finally { await client.close(); await server.stop(); }
  });
});

describe('CraftMcpClient lifecycle — real stdio children', () => {
  test('forwards cwd (including spaces), argv and env; filters inherited secrets', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'client cwd fixture ')));
    await writeFile(join(dir, 'relative.txt'), 'relative cwd dependency');
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'inherited-private-key';
    const client = new CraftMcpClient({ transport: 'stdio', command: process.execPath, args: [fixture, 'spaced arg', 'literal&arg'], cwd: dir, env: { CLIENT_VALUE: 'source override' } });
    try {
      const tools = await client.listTools();
      expect(tools.map(tool => tool.name)).toEqual(['inspect']);
      const result = await client.callTool('inspect', {}) as { content: Array<{ text: string }> };
      expect(JSON.parse(result.content[0]!.text)).toEqual({ cwd: dir, relative: 'relative cwd dependency', args: ['spaced arg', 'literal&arg'], value: 'source override' });
    } finally {
      await client.close();
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
      await rm(dir, { recursive: true, force: true });
    }
  });

  for (const stage of ['initialize', 'tools/list']) {
    test(`timeout during ${stage} reaps the real child`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'client stalled child '));
      const marker = join(dir, 'started.txt');
      const client = new CraftMcpClient({ transport: 'stdio', command: process.execPath, args: [fixture], env: { CLIENT_STALL: stage, CLIENT_STARTED_FILE: marker } });
      try {
        await expect(client.connect({ timeoutMs: 500 })).rejects.toThrow('timed out');
        const pid = Number(await readFile(marker, 'utf8'));
        expect(() => process.kill(pid, 0)).toThrow();
        expect(client.getServerInfo()).toBeUndefined();
      } finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
    });
  }

  test('close during initialize awaits child exit and rejects the pending connection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'client close child '));
    const marker = join(dir, 'started.txt');
    const client = new CraftMcpClient({ transport: 'stdio', command: process.execPath, args: [fixture], env: { CLIENT_STALL: 'initialize', CLIENT_STARTED_FILE: marker } });
    try {
      const pending = client.connect().catch(error => error);
      await waitFor(async () => readFile(marker).then(() => true, () => false));
      const pid = Number(await readFile(marker, 'utf8'));
      await client.close();
      expect((await pending).message).toBe('MCP client is closed');
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
  });

  test('awaits SDK shutdown escalation when a timed-out child ignores stdin EOF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'client stubborn child '));
    const marker = join(dir, 'started.txt');
    const client = new CraftMcpClient({ transport: 'stdio', command: process.execPath, args: [fixture], env: { CLIENT_STALL: 'initialize', CLIENT_STUBBORN: '1', CLIENT_STARTED_FILE: marker } });
    try {
      const started = Date.now();
      await expect(client.connect({ timeoutMs: 500 })).rejects.toThrow('timed out');
      const pid = Number(await readFile(marker, 'utf8'));
      await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
      expect(Date.now() - started).toBeLessThan(5500);
      await client.close();
    } finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
  }, 10_000);

  test('redacts explicitly configured stdio secrets from failed health-check diagnostics', async () => {
    const client = new CraftMcpClient({ transport: 'stdio', command: process.execPath, args: [fixture], env: { CLIENT_ERROR_SECRET: 'stdio-private-secret' } });
    try {
      const error = await client.connect().catch(error => error);
      expect(error.message).toContain('failed health check');
      expect(error.message).toContain('[REDACTED]');
      expect(error.message).not.toContain('stdio-private-secret');
      expect(error.cause).toBeUndefined();
    } finally { await client.close(); }
  });

  test('pre-aborted connect never spawns and close-before-connect is terminal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'client preabort '));
    const marker = join(dir, 'started.txt');
    const client = new CraftMcpClient({ transport: 'stdio', command: process.execPath, args: [fixture], env: { CLIENT_STARTED_FILE: marker } });
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(client.connect({ signal: controller.signal })).rejects.toThrow('cancelled');
      await expect(readFile(marker)).rejects.toThrow();
      const unopened = new CraftMcpClient({ transport: 'stdio', command: process.execPath, args: [fixture] });
      await unopened.close();
      await expect(unopened.connect()).rejects.toThrow('closed');
    } finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
  });

  test('missing executable rejects promptly and remains safe to close repeatedly', async () => {
    const client = new CraftMcpClient({ transport: 'stdio', command: 'rox-client-fixture-command-does-not-exist' });
    try {
      await expect(client.connect({ timeoutMs: 1000 })).rejects.toThrow();
      await Promise.all([client.close(), client.close()]);
      await expect(client.connect()).rejects.toThrow('closed');
    } finally { await client.close(); }
  });

  test('invalid deadlines do not poison a subsequent valid connect', async () => {
    const client = new CraftMcpClient({ transport: 'stdio', command: process.execPath, args: [fixture] });
    try {
      for (const timeoutMs of [0, -1, NaN, Infinity]) {
        await expect(client.connect({ timeoutMs })).rejects.toThrow('Invalid MCP connection timeout');
      }
      await client.connect();
      expect(client.getServerInfo()).toEqual({ name: 'client-fixture', version: '1.0' });
    } finally { await client.close(); }
  });
});


test('bounds adversarial URL punctuation diagnostics without the source quadratic suffix regex', async () => {
  const punctuation = ')'.repeat(100_000) + 'X';
  const server = await httpFixture({status:405, body:'https://user:password@host/mcp?token=private-query'+punctuation+' header-secret'});
  const client = new CraftMcpClient({transport:'http',url:server.url,headers:{Authorization:'Bearer header-secret'}});
  try {
    const error = await client.connect().catch(error => error);
    expect(error).toBeInstanceOf(StreamableHTTPError);
    expect(error.code).toBe(405);
    expect(error.message.length).toBeLessThanOrEqual(8215);
    for (const secret of ['user:password','private-query','header-secret']) expect(error.message).not.toContain(secret);
    expect(error.cause).toBeUndefined();
  } finally {await client.close(); await server.stop();}
});


test('real refused redirect diagnostics and typed target cannot retain configured credentials', async () => {
  const server = await httpFixture({status:302,body:'',redirect:'https://foreign.example.test/header-secret?token=query-secret#fragment-secret'});
  const client = new CraftMcpClient({transport:'http',url:server.url,headers:{Authorization:'Bearer header-secret'}});
  try {
    const error = await client.connect().catch(error => error);
    expect(error).toBeInstanceOf(McpRedirectError);
    for (const text of [error.message,error.redirectUrl]) {
      for (const secret of ['header-secret','query-secret','fragment-secret']) expect(text).not.toContain(secret);
    }
    expect(error.cause).toBeUndefined();
  } finally {await client.close(); await server.stop();}
});

test('real tool failure preserves a usable connection while scrubbing server diagnostic credentials', async () => {
  const server = await httpFixture();
  const client = new CraftMcpClient({transport:'http',url:server.url,headers:{Authorization:'Bearer header-secret'}});
  try {
    await client.connect();
    await server.update({errorMethod:'tools/call',error:'header-secret https://user:pass@host/mcp?token=query-secret'});
    const error = await client.callTool('fixture',{}).catch(error => error);
    for (const secret of ['header-secret','user:pass','query-secret']) expect(error.message).not.toContain(secret);
    expect(error.cause).toBeUndefined();
    expect(client.isConnected()).toBe(true);
    expect(await client.listTools()).toEqual([]);
  } finally {await client.close(); await server.stop();}
});


test('total startup budget includes local resolution and refuses its late spawn after timeout', async () => {
  const resolver = getToolchain().resolver;
  const original = resolver.toolchainPathPrefix;
  let release!: (prefix:string) => void;
  resolver.toolchainPathPrefix = () => new Promise(resolve => { release = resolve; });
  const dir = await mkdtemp(join(tmpdir(),'mcp-late-resolution-'));
  const marker = join(dir,'started.txt');
  const client = new CraftMcpClient({transport:'stdio',command:process.execPath,args:[fixture],env:{CLIENT_STARTED_FILE:marker}});
  try {
    await expect(client.connect({timeoutMs:75})).rejects.toThrow('MCP connection timed out after 75ms');
    release('');
    await delay(150);
    expect(await readFile(marker).then(()=>true,()=>false)).toBe(false);
    expect(client.isConnected()).toBe(false);
    await expect(client.connect()).rejects.toThrow('closed');
  } finally {release?.('');resolver.toolchainPathPrefix=original;await client.close();await rm(dir,{recursive:true,force:true});}
});
