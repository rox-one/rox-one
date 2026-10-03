import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { CraftMcpClient, isManagedLocalQdrantConfig, type StdioMcpClientConfig } from '../client.ts';
import { McpClientPool } from '../mcp-pool.ts';
import { validateStdioMcpConnection } from '../validation.ts';

const root = mkdtempSync(join(tmpdir(), 'craft-qdrant-sharing-'));
const packageName = 'mcp-server-qdrant==0.8.1';
const launcher = join(root, process.platform === 'win32' ? 'uvx.exe' : 'uvx');
if (process.platform === 'win32') copyFileSync(process.execPath, launcher);
else symlinkSync(process.execPath, launcher);

// Run the SDK protocol through a real subprocess. The lock models embedded
// Qdrant's one-owner storage rule without downloading Python/model packages.
writeFileSync(join(root, packageName), `
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const log = (event) => fs.appendFileSync(process.env.MCP_TEST_EVENTS, JSON.stringify(event) + '\\n');
const storage = process.env.QDRANT_LOCAL_PATH;
const lock = storage && !process.env.QDRANT_URL && !process.env.MCP_TEST_DISABLE_STORAGE_LOCK ? path.join(storage, 'owner-lock') : null;
if (lock) {
  fs.mkdirSync(storage, { recursive: true });
  if (fs.existsSync(lock)) {
    const owner = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
    try { process.kill(owner, 0); }
    catch (error) { if (error.code === 'ESRCH') fs.rmSync(lock, { recursive: true, force: true }); else throw error; }
  }
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
}
log({ event: 'spawn', pid: process.pid });
const respond = (request, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
const input = readline.createInterface({ input: process.stdin });
let lists = 0;
input.on('line', async line => {
  const request = JSON.parse(line);
  log({ event: request.method, pid: process.pid });
  if (!('id' in request)) return;
  if (request.method === 'initialize') {
    if (process.env.MCP_TEST_FAIL_INITIALIZE) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: {code: -32603, message:'fixture initialize failed'} }) + '\\n');
      return;
    }
    const gate = process.env.MCP_TEST_INITIALIZE_GATE;
    while (gate && !fs.existsSync(gate)) await new Promise(resolve => setTimeout(resolve, 5));
    respond(request, { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'qdrant-fixture', version: '1.0.0' } });
  } else if (request.method === 'tools/list') {
    const gate = process.env.MCP_TEST_LIST_GATE;
    lists++;
    while (lists > 1 && gate && !fs.existsSync(gate)) await new Promise(resolve => setTimeout(resolve, 5));
    respond(request, { tools: [{name:'echo', inputSchema:{type:'object', properties:{text:{type:'string'}}}}] });
  } else if (request.method === 'tools/call') {
    const gate = process.env.MCP_TEST_CALL_GATE;
    while (request.params.arguments.text === 'blocked' && gate && !fs.existsSync(gate)) await new Promise(resolve => setTimeout(resolve, 5));
    respond(request, { content: [{ type:'text', text: request.params.arguments.text ?? 'echo' }] });
  }
});
input.on('close', () => {
  log({ event: 'stdin-close', pid: process.pid });
  setTimeout(() => {
    if (lock) fs.rmSync(lock, { recursive: true, force: true });
    log({ event: 'exit', pid: process.pid });
    process.exit(0);
  }, Number(process.env.MCP_TEST_CLOSE_DELAY ?? 0));
});
`);

const clients = new Set<CraftMcpClient>();
const pools = new Set<McpClientPool>();
let sequence = 0;
function config(extraEnv: Record<string, string> = {}): StdioMcpClientConfig {
  const id = ++sequence;
  return {
    transport: 'stdio', command: launcher, args: [packageName], cwd: root,
    env: {
      QDRANT_LOCAL_PATH: join(root, `storage-${id}`), QDRANT_URL: '', COLLECTION_NAME: 'rox-memory',
      EMBEDDING_MODEL: 'fixture-model', MCP_TEST_EVENTS: join(root, `events-${id}.jsonl`), ...extraEnv,
    },
  };
}
function client(settings: StdioMcpClientConfig) {
  const instance = new CraftMcpClient(settings);
  clients.add(instance);
  return instance;
}
function child(instance: CraftMcpClient): ChildProcess {
  return (instance as unknown as { transport: { _process: ChildProcess } }).transport._process;
}
function events(settings: StdioMcpClientConfig): Array<{ event: string; pid: number }> {
  const path = settings.env!.MCP_TEST_EVENTS!;
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('fixture event timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
afterEach(async () => {
  await Promise.all([...pools].map(pool => pool.disconnectAll()));
  await Promise.all([...clients].map(instance => instance.close()));
  pools.clear();
  clients.clear();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('managed embedded Qdrant client leases', () => {
  test('recognizes the pinned official stdio launch and excludes mixed remote settings', () => {
    const settings = config();
    const canonical = { ...settings, args:['--from',packageName,'mcp-server-qdrant','--transport','stdio'] };
    expect(isManagedLocalQdrantConfig(canonical)).toBe(true);
    expect(isManagedLocalQdrantConfig({ ...canonical, args:[...canonical.args.slice(0, -1), 'sse'] })).toBe(false);
    expect(isManagedLocalQdrantConfig({ ...canonical, env:{...canonical.env, QDRANT_API_KEY:'remote-key'} })).toBe(false);
  });

  test('explicit local mode omits blank and inherited remote settings from the subprocess', async () => {
    const originalUrl = process.env.QDRANT_URL;
    const originalKey = process.env.QDRANT_API_KEY;
    try {
      process.env.QDRANT_URL = 'https://unrelated-remote.example.test';
      process.env.QDRANT_API_KEY = 'unrelated-remote-key';
      const settings = config({QDRANT_API_KEY:''});
      delete settings.env!.QDRANT_URL;
      const first = client(settings);
      const second = client(settings);
      await Promise.all([first.connect(), second.connect()]);
      const params = (first as unknown as {transport:{_serverParams:{env:Record<string,string>}}}).transport._serverParams;
      expect(params.env.QDRANT_URL).toBeUndefined();
      expect(params.env.QDRANT_API_KEY).toBeUndefined();
      expect(child(first).pid).toBe(child(second).pid);
      await Promise.all([first.close(), second.close()]);
    } finally {
      if (originalUrl === undefined) delete process.env.QDRANT_URL; else process.env.QDRANT_URL = originalUrl;
      if (originalKey === undefined) delete process.env.QDRANT_API_KEY; else process.env.QDRANT_API_KEY = originalKey;
    }
  });

  test('session-scoped inherited directories do not prevent sharing across chats', async () => {
    const original = process.env.CRAFT_SESSION_DIR;
    try {
      const settings = config();
      process.env.CRAFT_SESSION_DIR = join(root, 'session-one');
      const first = client(settings);
      process.env.CRAFT_SESSION_DIR = join(root, 'session-two');
      const second = client(settings);
      await Promise.all([first.connect(), second.connect()]);
      expect(child(first).pid).toBe(child(second).pid);
      const params = (first as unknown as {transport:{_serverParams:{env:Record<string,string>}}}).transport._serverParams;
      expect(params.env.CRAFT_SESSION_DIR).toBeUndefined();
      await Promise.all([first.close(), second.close()]);
    } finally {
      if (original === undefined) delete process.env.CRAFT_SESSION_DIR; else process.env.CRAFT_SESSION_DIR = original;
    }
  });

  test('shares one subprocess across a startup probe, session pool and direct tool caller', async () => {
    const settings = config();
    const probe = client(settings);
    const session = client(settings);
    const pool = new McpClientPool();
    pools.add(pool);
    const { transport: _, ...poolSettings } = settings;
    const [tools, , result] = await Promise.all([
      probe.listTools(), pool.connect('qdrant', { type: 'stdio', ...poolSettings }), session.callTool('echo', {text:'session'}),
    ]);
    expect(tools.map(tool => tool.name)).toEqual(['echo']);
    expect(result).toMatchObject({content:[{type:'text',text:'session'}]});
    expect(child(probe).pid).toBe(child(session).pid);
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(1);
    expect(events(settings).filter(event => event.event === 'initialize')).toHaveLength(1);
    await probe.close();
    await pool.disconnectAll();
    expect(session.isConnected()).toBe(true);
    expect(await session.callTool('echo', {text:'still running'})).toMatchObject({content:[{text:'still running'}]});
    await session.close();
    expect(events(settings).filter(event => event.event === 'exit')).toHaveLength(1);
  });

  test('coalesces concurrent direct connects and tools/list requests', async () => {
    const settings = config();
    const first = client(settings);
    const second = client(settings);
    await Promise.all([first.connect(), second.connect(), first.connect()]);
    const listsBefore = events(settings).filter(event => event.event === 'tools/list').length;
    await Promise.all([first.listTools(), second.listTools(), first.listTools()]);
    expect(events(settings).filter(event => event.event === 'tools/list')).toHaveLength(listsBefore + 1);
  });

  test('source validation leases the process already held by a session', async () => {
    const settings = config();
    const session = client(settings);
    await session.connect();
    const {transport: _, ...validationSettings} = settings;
    const result = await validateStdioMcpConnection(validationSettings);
    expect(result.success).toBe(true);
    expect(result.tools).toEqual(['echo']);
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(1);
    expect(await session.callTool('echo', {text:'after validation'})).toMatchObject({content:[{text:'after validation'}]});
    await session.close();
    expect(events(settings).filter(event => event.event === 'exit')).toHaveLength(1);
  });

  test('normalizes storage paths and environment key order', async () => {
    const settings = config();
    const first = client(settings);
    const second = client({ ...settings, env: Object.fromEntries(Object.entries({
      ...settings.env, QDRANT_LOCAL_PATH: join(settings.env!.QDRANT_LOCAL_PATH!, '..', '.', settings.env!.QDRANT_LOCAL_PATH!.split(/[\\/]/).at(-1)!),
    }).reverse()) });
    await Promise.all([first.connect(), second.connect()]);
    expect(child(first).pid).toBe(child(second).pid);
  });

  test.skipIf(process.platform === 'win32')('canonicalizes a symlinked parent before the database directory exists', async () => {
    const settings = config();
    const parent = join(root, `real-parent-${++sequence}`);
    const alias = join(root, `alias-${sequence}`);
    mkdirSync(parent);
    symlinkSync(parent, alias, 'dir');
    const first = client({ ...settings, env: { ...settings.env, QDRANT_LOCAL_PATH:join(alias, 'new-db') } });
    const second = client({ ...settings, env: { ...settings.env, QDRANT_LOCAL_PATH:join(parent, 'new-db') } });
    await Promise.all([first.connect(), second.connect()]);
    expect(child(first).pid).toBe(child(second).pid);
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(1);
  });

  test('rejects conflicting active configs for one directory and releases the directory on final close', async () => {
    const settings = config();
    const owner = client(settings);
    await owner.connect();
    const changed = client({ ...settings, env: { ...settings.env, COLLECTION_NAME: 'different' } });
    await expect(changed.connect()).rejects.toThrow('already in use with a different configuration');
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(1);
    await changed.close();
    await owner.close();
    const replacement = client({ ...settings, env: { ...settings.env, COLLECTION_NAME: 'different' } });
    await replacement.connect();
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(2);
  });

  test('keeps different storage directories independent', async () => {
    const firstSettings = config();
    const secondSettings = config();
    const first = client(firstSettings);
    const second = client(secondSettings);
    await Promise.all([first.connect(), second.connect()]);
    expect(child(first).pid).not.toBe(child(second).pid);
  });

  test('closing one lease during initialize preserves another waiting session', async () => {
    const gate = join(root, `gate-${++sequence}`);
    const settings = config({MCP_TEST_INITIALIZE_GATE:gate});
    const probe = client(settings);
    const session = client(settings);
    const firstConnect = probe.connect().catch(error => error);
    const secondConnect = session.connect();
    await waitFor(() => events(settings).some(event => event.event === 'initialize'));
    await probe.close();
    expect((await firstConnect).message).toContain('closed');
    expect(events(settings).filter(event => event.event === 'exit')).toHaveLength(0);
    writeFileSync(gate, 'ready');
    await secondConnect;
    expect(session.isConnected()).toBe(true);
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(1);
  });

  test('closing one lease cancels its tools/list wait without cancelling another lease', async () => {
    const gate = join(root, `list-gate-${++sequence}`);
    const settings = config({MCP_TEST_LIST_GATE:gate});
    const first = client(settings);
    const second = client(settings);
    await Promise.all([first.connect(), second.connect()]);
    const firstList = first.listTools().catch(error => error);
    const secondList = second.listTools();
    try {
      await waitFor(() => events(settings).filter(event => event.event === 'tools/list').length === 2);
      await first.close();
      const cancelled = await Promise.race([firstList, new Promise(resolve => setTimeout(() => resolve('still waiting'), 100))]);
      expect(cancelled).toBeInstanceOf(Error);
      expect((cancelled as Error).message).toContain('closed');
      expect(second.isConnected()).toBe(true);
    } finally {
      writeFileSync(gate, 'ready');
      await firstList;
      expect((await secondList).map(tool => tool.name)).toEqual(['echo']);
    }
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(1);
  });

  test('closing one lease cancels its tool request while another lease keeps using the process', async () => {
    const gate = join(root, `call-gate-${++sequence}`);
    const settings = config({MCP_TEST_CALL_GATE:gate});
    const first = client(settings);
    const second = client(settings);
    await Promise.all([first.connect(), second.connect()]);
    const request = first.callTool('echo', {text:'blocked'}, {signal:new AbortController().signal}).catch(error => error);
    try {
      await waitFor(() => events(settings).some(event => event.event === 'tools/call'));
      await first.close();
      const cancelled = await Promise.race([request, new Promise(resolve => setTimeout(() => resolve('still waiting'), 100))]);
      expect(cancelled).toBeInstanceOf(Error);
      await waitFor(() => events(settings).some(event => event.event === 'notifications/cancelled'));
      expect(await second.callTool('echo', {text:'still running'})).toMatchObject({content:[{text:'still running'}]});
      expect(events(settings).filter(event => event.event === 'exit')).toHaveLength(0);
    } finally {
      writeFileSync(gate, 'ready');
      await request;
    }
  });

  test('caller cancellation settles a tool call during initialize without cancelling another lease', async () => {
    const gate = join(root, `call-initialize-gate-${++sequence}`);
    const settings = config({MCP_TEST_INITIALIZE_GATE:gate});
    const first = client(settings);
    const second = client(settings);
    const controller = new AbortController();
    const reason = new Error('User cancelled the tool call');
    const request = first.callTool('echo', {text:'cancelled'}, {signal:controller.signal}).catch(error => error);
    const secondConnect = second.connect();
    try {
      await waitFor(() => events(settings).some(event => event.event === 'initialize'));
      controller.abort(reason);
      const cancelled = await Promise.race([request, new Promise(resolve => setTimeout(() => resolve('still waiting'), 100))]);
      expect(cancelled).toBe(reason);
      expect(events(settings).filter(event => event.event === 'tools/call')).toHaveLength(0);
    } finally {
      writeFileSync(gate, 'ready');
      await request;
      await secondConnect;
      await first.connect();
    }
    expect(first.isConnected()).toBe(true);
    expect(second.isConnected()).toBe(true);
    expect(await first.callTool('echo', {text:'new request'})).toMatchObject({content:[{text:'new request'}]});
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(1);
  });

  test('final close cancels initialize, cleans up the process and permits another owner', async () => {
    const gate = join(root, `gate-${++sequence}`);
    const settings = config({MCP_TEST_INITIALIZE_GATE:gate});
    const first = client(settings);
    const connecting = first.connect().catch(error => error);
    await waitFor(() => events(settings).some(event => event.event === 'initialize'));
    await first.close();
    expect((await connecting).message).toContain('closed');
    expect(events(settings).filter(event => event.event === 'exit')).toHaveLength(1);
    writeFileSync(gate, 'ready');
    await client(settings).connect();
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(2);
  });

  test('waits for the final transport shutdown before starting a replacement', async () => {
    const settings = config({MCP_TEST_CLOSE_DELAY:'100'});
    const first = client(settings);
    await first.connect();
    const closing = first.close();
    const replacement = client(settings);
    await replacement.connect();
    await closing;
    expect(events(settings).filter(event => event.event === 'spawn' || event.event === 'exit').map(event => event.event))
      .toEqual(['spawn', 'exit', 'spawn']);
  });

  test('cleans up failed shared handshakes and removes the registry entry on final release', async () => {
    const settings = config({MCP_TEST_FAIL_INITIALIZE:'1', MCP_TEST_CLOSE_DELAY:'150'});
    const first = client(settings);
    const second = client(settings);
    const results = await Promise.allSettled([first.connect(), second.connect()]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    await Promise.all([first.close(), second.close()]);
    const recovered = client({ ...settings, env: { ...settings.env, MCP_TEST_FAIL_INITIALIZE:'' } });
    await recovered.connect();
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(2);
  });

  test('restarts one crashed subprocess for all remaining leases', async () => {
    const settings = config();
    const first = client(settings);
    const second = client(settings);
    await Promise.all([first.connect(), second.connect()]);
    const original = child(first);
    const exited = once(original, 'close');
    original.kill('SIGKILL');
    await exited;
    expect(first.isConnected()).toBe(false);
    expect(second.isConnected()).toBe(false);
    await Promise.all([first.callTool('echo', {text:'first'}), second.callTool('echo', {text:'second'})]);
    expect(child(first).pid).toBe(child(second).pid);
    expect(child(first).pid).not.toBe(original.pid);
    expect(events(settings).filter(event => event.event === 'spawn')).toHaveLength(2);
    await first.close();
    expect(second.isConnected()).toBe(true);
  });

  test('remote Qdrant configurations keep independent connections even with a leftover local path', async () => {
    const settings = config({QDRANT_URL:'https://qdrant.example.test'});
    expect(isManagedLocalQdrantConfig(settings)).toBe(false);
    const first = client(settings);
    const second = client(settings);
    await Promise.all([first.connect(), second.connect()]);
    expect(child(first).pid).not.toBe(child(second).pid);
    const params = (first as unknown as {transport:{_serverParams:{env:Record<string,string>}}}).transport._serverParams;
    expect(params.env.QDRANT_LOCAL_PATH).toBe(settings.env!.QDRANT_LOCAL_PATH!);
  });

  test('explicit remote mode omits an unrelated inherited local storage path', async () => {
    const original = process.env.QDRANT_LOCAL_PATH;
    try {
      process.env.QDRANT_LOCAL_PATH = join(root, 'unrelated-local-storage');
      const settings = config({QDRANT_URL:'https://remote.example.test'});
      delete settings.env!.QDRANT_LOCAL_PATH;
      const remote = client(settings);
      await remote.connect();
      const params = (remote as unknown as {transport:{_serverParams:{env:Record<string,string>}}}).transport._serverParams;
      expect(params.env.QDRANT_LOCAL_PATH).toBeUndefined();
      expect(params.env.QDRANT_URL).toBe('https://remote.example.test');
      await remote.close();

      const custom = client({...settings, command:process.execPath});
      await custom.connect();
      const customParams = (custom as unknown as {transport:{_serverParams:{env:Record<string,string>}}}).transport._serverParams;
      expect(customParams.env.QDRANT_LOCAL_PATH).toBe(join(root, 'unrelated-local-storage'));
      await custom.close();
    } finally {
      if (original === undefined) delete process.env.QDRANT_LOCAL_PATH; else process.env.QDRANT_LOCAL_PATH = original;
    }
  });

  test('custom executable launches keep independent connections', async () => {
    const settings = { ...config({MCP_TEST_DISABLE_STORAGE_LOCK:'1'}), command: process.execPath };
    expect(isManagedLocalQdrantConfig(settings)).toBe(false);
    const first = client(settings);
    const second = client(settings);
    await Promise.all([first.connect(), second.connect()]);
    expect(child(first).pid).not.toBe(child(second).pid);
  });
});

test('closing a stalled SSE handshake settles direct and pool connection promises', async () => {
  const sockets = new Set<import('node:net').Socket>();
  let accept!: () => void;
  let accepted = new Promise<void>(resolve => { accept = resolve; });
  const server = createServer((_request, response) => {
    response.writeHead(200, {'content-type':'text/event-stream'});
    response.write(': keepalive\n\n');
    accept();
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}/sse`;
  try {
    const direct = new CraftMcpClient({transport:'sse',url});
    const connecting = direct.connect().catch(error => error);
    await accepted;
    await direct.close();
    expect((await connecting).message).toContain('closed');
    accepted = new Promise<void>(resolve => { accept = resolve; });
    const pool = new McpClientPool();
    const poolConnecting = pool.connect('stalled', {type:'sse',url}).catch(error => error);
    await accepted;
    await pool.disconnectAll();
    expect(await poolConnecting).toBeInstanceOf(Error);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
