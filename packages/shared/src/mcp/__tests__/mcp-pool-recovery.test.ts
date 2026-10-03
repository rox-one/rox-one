import { describe, expect, test } from 'bun:test';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpClientPool } from '../mcp-pool.ts';
import type { McpClientConfig, PoolCallToolOptions, PoolClient } from '../client.ts';

const config = { type: 'http' as const, url: 'https://mcp.example.test/mcp' };
const tool = (name: string): Tool => ({ name, inputSchema: { type: 'object', properties: {} } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakeClient implements PoolClient {
  connected = true;
  closes = 0;
  calls: Array<{ name: string; options?: PoolCallToolOptions }> = [];
  tools: Tool[] = [tool('write')];
  listFailure?: Error;
  callFailure?: Error;
  onList?: () => Promise<Tool[]>;
  onClose?: () => Promise<void>;

  isConnected() { return this.connected; }
  async listTools() {
    if (this.listFailure) throw this.listFailure;
    return this.onList ? this.onList() : this.tools;
  }
  async callTool(name: string, _args: Record<string, unknown>, options?: PoolCallToolOptions) {
    this.calls.push({ name, options });
    if (this.callFailure) throw this.callFailure;
    return { content: [{ type: 'text', text: 'done' }] };
  }
  async close() {
    this.connected = false;
    this.closes++;
    await this.onClose?.();
  }
}

class QueuePool extends McpClientPool {
  created = 0;
  createdConfigs: McpClientConfig[] = [];
  constructor(private queue: FakeClient[], options?: { workspaceRootPath?: string }) { super(options); }
  protected override createClient(config: McpClientConfig): PoolClient {
    this.created++;
    this.createdConfigs.push(config);
    const client = this.queue.shift();
    if (!client) throw new Error('Unexpected extra connection attempt');
    return client;
  }
}

describe('McpClientPool transport recovery', () => {
  test('cleans up a failed handshake and retries a transient connection error once', async () => {
    const failed = new FakeClient();
    failed.listFailure = new Error('Connection closed');
    const healthy = new FakeClient();
    const pool = new QueuePool([failed, healthy]);
    expect(await pool.sync({ source: config })).toEqual([]);
    expect(pool.created).toBe(2);
    expect(failed.closes).toBe(1);
    expect(pool.isConnected('source')).toBe(true);
    await pool.disconnectAll();
    expect(healthy.closes).toBe(1);
  });

  test('bounds failed attempts and retries the configured source on the next sync', async () => {
    const failed = [new FakeClient(), new FakeClient()];
    for (const client of failed) client.listFailure = new Error('Server unavailable');
    const healthy = new FakeClient();
    const pool = new QueuePool([...failed, healthy]);
    expect(await pool.sync({ source: config })).toEqual(['source']);
    expect(pool.created).toBe(2);
    expect(failed.map(client => client.closes)).toEqual([1, 1]);
    expect(pool.getProxyToolDefs()).toEqual([]);
    expect(pool.isConnected('source')).toBe(false);
    expect(await pool.sync({ source: config })).toEqual([]);
    expect(pool.created).toBe(3);
    expect(pool.isConnected('source')).toBe(true);
    await pool.disconnectAll();
  });

  test('does not retry an authentication failure', async () => {
    const failed = new FakeClient();
    failed.listFailure = new Error('Unauthorized: HTTP 401');
    const pool = new QueuePool([failed]);
    expect(await pool.sync({ source: config })).toEqual(['source']);
    expect(pool.created).toBe(1);
    expect(failed.closes).toBe(1);
  });

  test('reconnects a known disconnected transport before calling a tool and refreshes tools', async () => {
    const original = new FakeClient();
    original.tools = [tool('write'), tool('removed')];
    const replacement = new FakeClient();
    replacement.tools = [tool('write'), tool('added')];
    const pool = new QueuePool([original, replacement]);
    await pool.connect('source', config);
    original.connected = false;
    expect(pool.isConnected('source')).toBe(false);
    expect(pool.getConnectedSlugs()).toEqual([]);
    let changes = 0;
    pool.onToolsChanged = () => { changes++; };
    const options = { signal: new AbortController().signal, timeoutMs: 1000 };
    const result = await pool.callTool('mcp__source__write', {}, options);
    expect(result).toEqual({ content: 'done', isError: false });
    expect(original.calls).toEqual([]);
    expect(replacement.calls).toEqual([{ name: 'write', options }]);
    expect(pool.getProxyToolDefs().map(def => def.name)).toEqual(['mcp__source__write', 'mcp__source__added']);
    expect(pool.isProxyTool('mcp__source__removed')).toBe(false);
    expect(changes).toBe(1);
    await pool.disconnectAll();
  });

  test('reconnects after an ambiguous tool failure without replaying the request', async () => {
    const original = new FakeClient();
    original.callFailure = new Error('Socket connection reset after write');
    const replacement = new FakeClient();
    const pool = new QueuePool([original, replacement]);
    await pool.connect('source', config);
    const result = await pool.callTool('mcp__source__write', { value: 1 });
    expect(result.isError).toBe(true);
    expect(result.sourceSlug).toBe('source');
    expect(original.calls).toHaveLength(1);
    expect(replacement.calls).toEqual([]);
    expect(pool.isConnected('source')).toBe(true);
    expect((await pool.callTool('mcp__source__write', { value: 2 })).isError).toBe(false);
    expect(replacement.calls).toHaveLength(1);
    await pool.disconnectAll();
  });

  test('keeps a healthy connection on a tool validation failure', async () => {
    const client = new FakeClient();
    client.callFailure = new Error('Invalid input: value is required');
    const pool = new QueuePool([client]);
    await pool.connect('source', config);
    expect((await pool.callTool('mcp__source__write', {})).isError).toBe(true);
    expect(pool.created).toBe(1);
    expect(client.closes).toBe(0);
    await pool.disconnectAll();
  });

  test('recovers an expired HTTP MCP session without replaying its tool call', async () => {
    const original = new FakeClient();
    original.callFailure = new StreamableHTTPError(404, 'MCP session not found');
    const replacement = new FakeClient();
    const pool = new QueuePool([original, replacement]);
    await pool.connect('source', config);
    expect((await pool.callTool('mcp__source__write', {})).isError).toBe(true);
    expect(pool.created).toBe(2);
    expect(original.calls).toHaveLength(1);
    expect(replacement.calls).toEqual([]);
    expect((await pool.callTool('mcp__source__write', {})).isError).toBe(false);
    await pool.disconnectAll();
  });

  test('a failed recovery remains retryable on the next sync', async () => {
    const original = new FakeClient();
    original.callFailure = new Error('Connection closed');
    const failures = [new FakeClient(), new FakeClient()];
    for (const failed of failures) failed.listFailure = new Error('Server unavailable');
    const healthy = new FakeClient();
    const pool = new QueuePool([original, ...failures, healthy]);
    await pool.connect('source', config);
    expect((await pool.callTool('mcp__source__write', {})).isError).toBe(true);
    expect(pool.created).toBe(3);
    expect(pool.isConnected('source')).toBe(false);
    expect(await pool.sync({ source: config })).toEqual([]);
    expect(pool.created).toBe(4);
    expect(pool.isConnected('source')).toBe(true);
    expect(healthy.calls).toEqual([]);
    await pool.disconnectAll();
  });

  test('a failed recovery retries on the next tool call without another sync', async () => {
    const original = new FakeClient();
    original.callFailure = new Error('Connection closed after write');
    const failures = [new FakeClient(), new FakeClient()];
    for (const failed of failures) failed.listFailure = new Error('Server unavailable');
    const healthy = new FakeClient();
    const pool = new QueuePool([original, ...failures, healthy]);
    await pool.connect('source', config);
    expect((await pool.callTool('mcp__source__write', { value: 1 })).isError).toBe(true);
    expect(pool.created).toBe(3);
    expect(pool.isConnected('source')).toBe(false);
    expect(pool.isProxyTool('mcp__source__write')).toBe(true);
    expect(await pool.callTool('mcp__source__write', { value: 2 })).toEqual({ content: 'done', isError: false });
    expect(pool.created).toBe(4);
    expect(original.calls).toHaveLength(1);
    expect(healthy.calls).toHaveLength(1);
    await pool.disconnectAll();
  });

  test('an aborted retry does not start another handshake after failed recovery', async () => {
    const original = new FakeClient();
    original.callFailure = new Error('Connection closed');
    const failures = [new FakeClient(), new FakeClient()];
    for (const failed of failures) failed.listFailure = new Error('Server unavailable');
    const healthy = new FakeClient();
    const pool = new QueuePool([original, ...failures, healthy]);
    await pool.connect('source', config);
    expect((await pool.callTool('mcp__source__write', {})).isError).toBe(true);
    const controller = new AbortController();
    controller.abort(new Error('User cancelled'));
    expect((await pool.callTool('mcp__source__write', {}, { signal: controller.signal })).isError).toBe(true);
    expect(pool.created).toBe(3);
    expect((await pool.callTool('mcp__source__write', {})).isError).toBe(false);
    expect(pool.created).toBe(4);
    expect(healthy.calls).toHaveLength(1);
    await pool.disconnectAll();
  });

  test('recovery respects the local MCP gate after it changes', async () => {
    const originalFlag = process.env.CRAFT_LOCAL_MCP_ENABLED;
    process.env.CRAFT_LOCAL_MCP_ENABLED = 'true';
    const original = new FakeClient();
    const pool = new QueuePool([original], { workspaceRootPath: '/tmp/ws-does-not-exist' });
    try {
      await pool.ensureConnected('source', { type: 'stdio', command: 'fixture' });
      original.connected = false;
      process.env.CRAFT_LOCAL_MCP_ENABLED = 'false';
      const result = await pool.callTool('mcp__source__write', {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Local MCP is disabled');
      expect(pool.created).toBe(1);
      expect(original.calls).toEqual([]);
    } finally {
      await pool.disconnectAll();
      if (originalFlag === undefined) delete process.env.CRAFT_LOCAL_MCP_ENABLED;
      else process.env.CRAFT_LOCAL_MCP_ENABLED = originalFlag;
    }
  });

  test.each(['disconnect', 'sync removal', 'disconnectAll'])('%s clears retry state after failed recovery', async removal => {
    const original = new FakeClient();
    original.callFailure = new Error('Connection closed');
    const failures = [new FakeClient(), new FakeClient()];
    for (const failed of failures) failed.listFailure = new Error('Server unavailable');
    const healthy = new FakeClient();
    const pool = new QueuePool([original, ...failures, healthy]);
    await pool.connect('source', config);
    expect((await pool.callTool('mcp__source__write', {})).isError).toBe(true);
    if (removal === 'disconnect') await pool.disconnect('source');
    else if (removal === 'sync removal') await pool.sync({});
    else await pool.disconnectAll();
    expect(pool.getProxyToolDefs()).toEqual([]);
    expect((await pool.callTool('mcp__source__write', {})).isError).toBe(true);
    expect(pool.created).toBe(3);
    expect(healthy.calls).toEqual([]);
    expect(pool.getConnectedSlugs()).toEqual([]);
  });

  test('starts unrelated sources while another connection is still pending', async () => {
    const listing = deferred<Tool[]>();
    const started = deferred<void>();
    const slow = new FakeClient();
    slow.onList = () => { started.resolve(); return listing.promise; };
    const fast = new FakeClient();
    const fastStarted = deferred<void>();
    fast.onList = async () => { fastStarted.resolve(); return fast.tools; };
    const pool = new QueuePool([slow, fast]);
    const syncing = pool.sync({ slow: config, fast: config });
    await Promise.all([started.promise, fastStarted.promise]);
    // The fast source has finished registration before the slow one resolves.
    await pool.connect('fast', config);
    expect(pool.isConnected('fast')).toBe(true);
    expect(pool.isConnected('slow')).toBe(false);
    listing.resolve(slow.tools);
    expect(await syncing).toEqual([]);
    await pool.disconnectAll();
  });

  test('reconnects after in-place mutation of stdio credentials, arguments, command and cwd', async () => {
    const pool = new QueuePool(Array.from({ length: 5 }, () => new FakeClient()));
    const localConfig = { type: 'stdio' as const, command: 'npx', args: ['initial-package'], env: { API_KEY: 'old' }, cwd: '/old' };
    await pool.sync({ source: localConfig });
    localConfig.env.API_KEY = 'fresh';
    await pool.sync({ source: localConfig });
    localConfig.args[0] = 'new-package';
    await pool.sync({ source: localConfig });
    localConfig.command = 'bun';
    await pool.sync({ source: localConfig });
    localConfig.cwd = '/new';
    await pool.sync({ source: localConfig });
    expect(pool.created).toBe(5);
    await pool.disconnectAll();
  });

  test('reconnects after in-place mutation of HTTP API-key headers', async () => {
    const pool = new QueuePool([new FakeClient(), new FakeClient()]);
    const remoteConfig = { ...config, headers: { 'X-Api-Key': 'old' } };
    await pool.sync({ source: remoteConfig });
    remoteConfig.headers['X-Api-Key'] = 'fresh';
    await pool.sync({ source: remoteConfig });
    expect(pool.created).toBe(2);
    await pool.disconnectAll();
  });

  test('coalesces simultaneous recovery before two separate tool requests', async () => {
    const original = new FakeClient();
    const replacement = new FakeClient();
    const pool = new QueuePool([original, replacement]);
    await pool.connect('source', config);
    original.connected = false;
    const results = await Promise.all([
      pool.callTool('mcp__source__write', { value: 1 }),
      pool.callTool('mcp__source__write', { value: 2 }),
    ]);
    expect(results.every(result => !result.isError)).toBe(true);
    expect(pool.created).toBe(2);
    expect(original.closes).toBe(1);
    expect(replacement.calls).toHaveLength(2);
    await pool.disconnectAll();
  });

  test('applies fresh credentials requested while the previous handshake is pending', async () => {
    const listing = deferred<Tool[]>();
    const started = deferred<void>();
    const original = new FakeClient();
    original.onList = () => { started.resolve(); return listing.promise; };
    const replacement = new FakeClient();
    const pool = new QueuePool([original, replacement]);
    const initial = pool.ensureConnected('source', { ...config, headers: { Authorization: 'Bearer old' } });
    await started.promise;
    const refreshed = pool.ensureConnected('source', { ...config, headers: { Authorization: 'Bearer fresh' } });
    listing.resolve(original.tools);
    await Promise.all([initial, refreshed]);
    expect(pool.created).toBe(2);
    expect(original.closes).toBe(1);
    expect(pool.createdConfigs[1]).toEqual({ transport: 'http', url: config.url, headers: { Authorization: 'Bearer fresh' } });
    expect(pool.isConnected('source')).toBe(true);
    await pool.disconnectAll();
  });

  test('serializes two credential updates while closing the previous connection', async () => {
    const closing = deferred<void>();
    const started = deferred<void>();
    const original = new FakeClient();
    original.onClose = () => { started.resolve(); return closing.promise; };
    const intermediate = new FakeClient();
    const latest = new FakeClient();
    const pool = new QueuePool([original, intermediate, latest]);
    await pool.ensureConnected('source', config);
    const updating = pool.ensureConnected('source', { ...config, headers: { Authorization: 'Bearer intermediate' } });
    await started.promise;
    const newest = pool.ensureConnected('source', { ...config, headers: { Authorization: 'Bearer latest' } });
    closing.resolve();
    await Promise.all([updating, newest]);
    expect(pool.created).toBe(3);
    expect(original.closes).toBe(1);
    expect(intermediate.closes).toBe(1);
    expect(pool.createdConfigs[2]).toEqual({ transport: 'http', url: config.url, headers: { Authorization: 'Bearer latest' } });
    expect(pool.isConnected('source')).toBe(true);
    await pool.disconnectAll();
  });

  test('a concurrent config change during recovery settles without waiting on itself', async () => {
    const closing = deferred<void>();
    const started = deferred<void>();
    const original = new FakeClient();
    original.onClose = () => { started.resolve(); return closing.promise; };
    const recovered = new FakeClient();
    const refreshed = new FakeClient();
    const pool = new QueuePool([original, recovered, refreshed]);
    await pool.connect('source', config);
    original.connected = false;
    const calling = pool.callTool('mcp__source__write', {});
    await started.promise;
    const updating = pool.ensureConnected('source', { ...config, headers: { Authorization: 'Bearer fresh' } });
    closing.resolve();
    await Promise.all([calling, updating]);
    expect(pool.created).toBe(3);
    expect(pool.createdConfigs[2]).toEqual({ transport: 'http', url: config.url, headers: { Authorization: 'Bearer fresh' } });
    expect(pool.isConnected('source')).toBe(true);
    await pool.disconnectAll();
  });

  test('a newer empty sync prevents an older sync from starting connections', async () => {
    const pool = new QueuePool([]);
    await Promise.all([pool.sync({ source: config }), pool.sync({})]);
    expect(pool.created).toBe(0);
    expect(pool.getConnectedSlugs()).toEqual([]);
    expect(pool.getProxyToolDefs()).toEqual([]);
  });

  test('a newer sync cancels a handshake for a source that it removed', async () => {
    const listing = deferred<Tool[]>();
    const started = deferred<void>();
    const original = new FakeClient();
    original.onList = () => { started.resolve(); return listing.promise; };
    original.onClose = async () => { listing.reject(new Error('Connection closed')); };
    const pool = new QueuePool([original]);
    const initial = pool.sync({ source: config });
    await started.promise;
    expect(await pool.sync({})).toEqual([]);
    expect(await initial).toEqual(['source']);
    expect(pool.created).toBe(1);
    expect(pool.getConnectedSlugs()).toEqual([]);
    expect(pool.getProxyToolDefs()).toEqual([]);
  });

  test('teardown cancels a queued connection before its handshake starts', async () => {
    const pool = new QueuePool([]);
    const connecting = pool.ensureConnected('source', config).catch(error => error);
    await pool.disconnectAll();
    expect(await connecting).toBeInstanceOf(Error);
    expect(pool.created).toBe(0);
    expect(pool.getConnectedSlugs()).toEqual([]);
    expect(pool.getProxyToolDefs()).toEqual([]);
  });

  test('does not execute a tool removed by the reconnecting server', async () => {
    const original = new FakeClient();
    const replacement = new FakeClient();
    replacement.tools = [tool('different')];
    const pool = new QueuePool([original, replacement]);
    await pool.connect('source', config);
    original.connected = false;
    expect((await pool.callTool('mcp__source__write', {})).isError).toBe(true);
    expect(original.calls).toEqual([]);
    expect(replacement.calls).toEqual([]);
    expect(pool.isProxyTool('mcp__source__write')).toBe(false);
    await pool.disconnectAll();
  });

  test('sync reconnects a closed transport even when the config is unchanged', async () => {
    const original = new FakeClient();
    const replacement = new FakeClient();
    const pool = new QueuePool([original, replacement]);
    await pool.sync({ source: config });
    original.connected = false;
    expect(await pool.sync({ source: config })).toEqual([]);
    expect(pool.created).toBe(2);
    expect(original.closes).toBe(1);
    expect(pool.isConnected('source')).toBe(true);
    await pool.disconnectAll();
  });

  test('teardown cancels and drains an in-flight handshake without registering tools', async () => {
    const listing = deferred<Tool[]>();
    const started = deferred<void>();
    const client = new FakeClient();
    client.onList = () => { started.resolve(); return listing.promise; };
    client.onClose = async () => { listing.reject(new Error('Connection closed')); };
    const pool = new QueuePool([client]);
    const connecting = pool.connect('source', config).catch(error => error);
    await started.promise;
    await pool.disconnectAll();
    expect(await connecting).toBeInstanceOf(Error);
    expect(pool.created).toBe(1);
    expect(pool.getConnectedSlugs()).toEqual([]);
    expect(pool.getProxyToolDefs()).toEqual([]);
  });

  test('teardown during recovery cannot resurrect a disconnected source', async () => {
    const closing = deferred<void>();
    const started = deferred<void>();
    const original = new FakeClient();
    original.onClose = () => { started.resolve(); return closing.promise; };
    const pool = new QueuePool([original]);
    await pool.connect('source', config);
    original.connected = false;
    const calling = pool.callTool('mcp__source__write', {});
    await started.promise;
    const disconnecting = pool.disconnectAll();
    closing.resolve();
    await disconnecting;
    expect((await calling).isError).toBe(true);
    expect(pool.created).toBe(1);
    expect(pool.getConnectedSlugs()).toEqual([]);
    expect(pool.getProxyToolDefs()).toEqual([]);
  });
});
