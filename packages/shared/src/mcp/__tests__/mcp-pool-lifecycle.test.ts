import { describe, expect, test } from 'bun:test';
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClientPool } from '../mcp-pool.ts';
import type { PoolClient } from '../client.ts';
import type { SdkMcpServerConfig } from '../../agent/backend/types.ts';
import { SourceServerBuilder } from '../../sources/server-builder.ts';
import type { LoadedSource } from '../../sources/types.ts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeClient(): PoolClient & { closed: boolean; closes: number; calls: number } {
  return {
    closed: false, closes: 0, calls: 0,
    isConnected() { return !this.closed; },
    listTools: async () => [{ name: 'inspect', inputSchema: { type: 'object' } }],
    async callTool() { this.calls++; return { content: [{ type: 'text', text: 'ok' }] }; },
    async close() { this.closes++; this.closed = true; },
  };
}

class LifecyclePool extends McpClientPool {
  connections = 0;
  clientsCreated: ReturnType<typeof fakeClient>[] = [];
  async register(slug: string, client: PoolClient, config?: SdkMcpServerConfig) {
    await this.registerClient(slug, client);
    if (config) this.activeConfigs.set(slug, config);
  }
  protected override async connectSource(slug: string, config: SdkMcpServerConfig) {
    this.connections++;
    const client = fakeClient();
    this.clientsCreated.push(client);
    await this.register(slug, client, config);
  }
}

const config: SdkMcpServerConfig = { type: 'http', url: 'https://pool.test/mcp' };

describe('McpClientPool liveness and lifecycle races', () => {
  for (const reconcile of ['sync', 'ensureConnected'] as const) {
    test(`${reconcile} replaces a closed client with unchanged config and clears dead tool views`, async () => {
      const pool = new LifecyclePool();
      const client = fakeClient();
      await pool.register('source', client, config);
      client.closed = true;
      expect(pool.isConnected('source')).toBe(false);
      expect(pool.getConnectedSlugs()).toEqual([]);
      expect(pool.getTools('source')).toEqual([]);
      expect(pool.getProxyToolDefs()).toEqual([]);
      expect(pool.getProxyToolName('source', 'inspect')).toBeNull();
      // The registry keeps the proxy name so the next call routes through the
      // pool and triggers recovery (main's contract, see mcp-pool-recovery);
      // only the advertised tool views are cleared while the transport is dead.
      expect(pool.isProxyTool('mcp__source__inspect')).toBe(true);
      if (reconcile === 'sync') expect(await pool.sync({ source: config })).toEqual([]);
      else await pool.ensureConnected('source', config);
      expect(client.closes).toBe(1);
      expect(pool.connections).toBe(1);
      expect(pool.isConnected('source')).toBe(true);
      expect(pool.getProxyToolDefs().map(tool => tool.name)).toEqual(['mcp__source__inspect']);
      await pool.disconnectAll();
    });
  }

  test('refuses to publish a client that closes as tool discovery resolves', async () => {
    const pool = new LifecyclePool();
    const client = fakeClient();
    client.listTools = async () => {
      client.closed = true;
      return [{ name: 'inspect', inputSchema: { type: 'object' } }];
    };
    try {
      await expect(pool.register('source', client, config)).rejects.toThrow(/closed/);
      expect(client.closes).toBe(1);
      expect(pool.getProxyToolDefs()).toEqual([]);
    } finally { await pool.disconnectAll(); }
  });

  test('overlapping sync and ensureConnected await one teardown and create one replacement', async () => {
    const pool = new LifecyclePool();
    const client = fakeClient();
    const started = deferred<void>();
    const teardown = deferred<void>();
    client.close = async () => { client.closes++; started.resolve(); await teardown.promise; };
    await pool.register('source', client, config);
    client.closed = true;
    const syncing = pool.sync({ source: config });
    const ensuring = pool.ensureConnected('source', config);
    try {
      await Promise.race([started.promise, new Promise(resolve => setTimeout(resolve, 100))]);
      expect(client.closes).toBe(1);
      expect(pool.connections).toBe(0);
      expect(pool.getProxyToolDefs()).toEqual([]);
      teardown.resolve();
      expect(await syncing).toEqual([]);
      await ensuring;
      expect(client.closes).toBe(1);
      expect(pool.connections).toBe(1);
    } finally {
      teardown.resolve();
      await Promise.allSettled([syncing, ensuring]);
      await pool.disconnectAll();
    }
  });

  test('a late failed call on an old client never removes or retries on its replacement', async () => {
    const pool = new LifecyclePool();
    const client = fakeClient();
    const pending = deferred<unknown>();
    client.callTool = async () => { client.calls++; return pending.promise; };
    await pool.register('source', client, config);
    const calling = pool.callTool('mcp__source__inspect', {});
    await pool.disconnect('source');
    await pool.ensureConnected('source', config);
    pending.reject(new Error('old transport closed'));
    const result = await calling;
    expect(result.isError).toBe(true);
    expect(result.sourceSlug).toBe('source');
    expect(client.calls).toBe(1);
    expect(pool.clientsCreated[0]?.calls).toBe(0);
    expect(pool.isConnected('source')).toBe(true);
    expect((await pool.callTool('mcp__source__inspect', {})).isError).toBe(false);
    await pool.disconnectAll();
  });

  test('an old call failure settles while its replacement is still initializing', async () => {
    const started = deferred<void>();
    const initialization = deferred<void>();
    class PendingPool extends LifecyclePool {
      protected override async connectSource(slug: string, config: SdkMcpServerConfig) {
        started.resolve();
        await initialization.promise;
        await super.connectSource(slug, config);
      }
    }
    const pool = new PendingPool();
    const client = fakeClient();
    const pending = deferred<unknown>();
    client.callTool = async () => { client.calls++; return pending.promise; };
    await pool.register('source', client, config);
    const calling = pool.callTool('mcp__source__inspect', {});
    const replacing = pool.ensureConnected('source', { ...config, url: 'https://replacement.test/mcp' });
    await started.promise;
    pending.reject(new Error('old transport closed'));
    try {
      const result = await Promise.race([calling, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('old call waited on replacement')), 500))]);
      expect(result.isError).toBe(true);
      expect(result.sourceSlug).toBe('source');
      expect(client.calls).toBe(1);
      expect(pool.getProxyToolDefs()).toEqual([]);
    } finally {
      initialization.resolve();
      await replacing;
      await calling;
      await pool.disconnectAll();
    }
  });

  test('API clients without a liveness marker remain usable through normal sync', async () => {
    const server = new McpServer({ name: 'pool-api-fixture', version: '1.0' });
    server.registerTool('inspect', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'in-process API' }] }));
    const pool = new McpClientPool();
    try {
      expect(await pool.sync({}, { api: { type: 'sdk', instance: server } })).toEqual([]);
      expect(pool.isConnected('api')).toBe(true);
      expect(await pool.sync({}, { api: { type: 'sdk', instance: server } })).toEqual([]);
      expect(await pool.callTool('mcp__api__inspect', {})).toEqual({ content: 'in-process API', isError: false });
    } finally { await pool.disconnectAll(); await server.close(); }
  });

  test('disconnectAll includes a source still initializing and removes its late registration', async () => {
    const started = deferred<void>();
    const discovery = deferred<void>();
    class PendingPool extends LifecyclePool {
      protected override async connectSource(slug: string, config: SdkMcpServerConfig) {
        started.resolve();
        await discovery.promise;
        await super.connectSource(slug, config);
      }
    }
    const pool = new PendingPool();
    const connecting = pool.connect('source', config);
    await started.promise;
    const disconnecting = pool.disconnectAll();
    discovery.resolve();
    await Promise.all([connecting, disconnecting]);
    expect(pool.clientsCreated[0]?.closes).toBe(1);
    expect(pool.getConnectedSlugs()).toEqual([]);
    expect(pool.getProxyToolDefs()).toEqual([]);
  });

  test('a failed replacement leaves no stale tools and does not poison the next lifecycle task', async () => {
    class FailingPool extends LifecyclePool {
      failNext = false;
      protected override async connectSource(slug: string, config: SdkMcpServerConfig) {
        if (this.failNext) { this.failNext = false; throw new Error('replacement unavailable'); }
        await super.connectSource(slug, config);
      }
    }
    const pool = new FailingPool();
    const client = fakeClient();
    await pool.register('source', client, config);
    client.closed = true;
    pool.failNext = true;
    expect(await pool.sync({ source: config })).toEqual(['source']);
    expect(client.closes).toBe(1);
    expect(pool.getProxyToolDefs()).toEqual([]);
    await pool.ensureConnected('source', config);
    expect(pool.isConnected('source')).toBe(true);
    await pool.disconnectAll();
  });
});

async function builderFixture(windowsShim = false) {
  const root = await mkdtemp(join(tmpdir(), 'pool builder lifecycle '));
  const folder = join(root, 'source with spaces');
  await mkdir(folder);
  await copyFile(fileURLToPath(new URL('./mcp-pool-lifecycle-fixture.mjs', import.meta.url)), join(folder, 'server.mjs'));
  await writeFile(join(folder, 'relative.txt'), 'source-local payload');
  const source: LoadedSource = {
    config: {
      id: 'pool-fixture', slug: 'fixture', name: 'Pool fixture', provider: 'fixture', type: 'mcp', enabled: true,
      mcp: { transport: 'stdio', command: process.execPath, args: ['./server.mjs', 'argument with spaces'], env: {
        POOL_VALUE: '${SOURCE_DIR}', POOL_START_RECORD: join(root, 'starts.txt'), POOL_CALL_RECORD: join(root, 'calls.txt'),
      } },
    },
    workspaceId: 'pool-test', workspaceRootPath: root, folderPath: folder, guide: null,
  };
  if (windowsShim && source.config.mcp) {
    await writeFile(join(folder, 'launcher.cmd'), `@echo off\r\n"${process.execPath}" %*\r\n`);
    source.config.mcp.command = 'not-a-windows-command';
    source.config.mcp.args = ['wrong default'];
    source.config.mcp.platform = { win32: {
      command: '${SOURCE_DIR}/launcher.cmd',
      args: ['server.mjs', '${WORKSPACE}', 'value with spaces', 'notes & tasks', 'заметки'],
      env: { POOL_VALUE: '${SOURCE_DIR}' },
    } };
  }
  const config = new SourceServerBuilder().buildMcpServer(source, null);
  if (!config || config.type !== 'stdio') throw new Error('Expected builder stdio config');
  return { root, folder, source, config };
}

describe('SourceServerBuilder -> McpClientPool real subprocess lifecycle', () => {
  test.skipIf(process.platform !== 'win32')('runs a builder platform-override .cmd through the pool with cwd, argv and env intact', async () => {
    const fixture = await builderFixture(true);
    const pool = new McpClientPool();
    try {
      expect(await pool.sync({ fixture: fixture.config })).toEqual([]);
      const result = await pool.callTool('mcp__fixture__inspect', {});
      expect(result.isError).toBe(false);
      const child = JSON.parse(result.content);
      expect(child.cwd).toBe(fixture.folder);
      expect(child.relative).toBe('source-local payload');
      expect(child.value).toBe(fixture.folder);
      expect(child.args).toEqual([fixture.root, 'value with spaces', 'notes & tasks', 'заметки']);
    } finally {
      await pool.disconnectAll();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('forwards source cwd to a relative child entrypoint and reconnects when cwd alone changes', async () => {
    const fixture = await builderFixture();
    const pool = new McpClientPool();
    try {
      expect(fixture.config.cwd).toBe(fixture.folder);
      expect(await pool.sync({ fixture: fixture.config })).toEqual([]);
      const first = JSON.parse((await pool.callTool('mcp__fixture__inspect', {})).content);
      expect(first.cwd).toBe(await realpath(fixture.folder));
      expect(first.relative).toBe('source-local payload');
      expect(first.args).toEqual(['argument with spaces']);
      expect(first.value).toBe(fixture.folder);

      const other = join(fixture.root, 'other source');
      await mkdir(other);
      await copyFile(join(fixture.folder, 'server.mjs'), join(other, 'server.mjs'));
      await writeFile(join(other, 'relative.txt'), 'replacement-local payload');
      await pool.ensureConnected('fixture', { ...fixture.config, cwd: other });
      const second = JSON.parse((await pool.callTool('mcp__fixture__inspect', {})).content);
      expect(second.cwd).toBe(await realpath(other));
      expect(second.relative).toBe('replacement-local payload');
      expect(second.pid).not.toBe(first.pid);
    } finally {
      await pool.disconnectAll();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  for (const reconcile of ['sync', 'ensureConnected'] as const) {
    test(`child exits on its first call; ${reconcile} creates a fresh child without replaying the failed call`, async () => {
      const fixture = await builderFixture();
      const pool = new McpClientPool();
      try {
        await pool.connect('fixture', fixture.config);
        const result = await pool.callTool('mcp__fixture__die', {}, { timeoutMs: 2000 });
        expect(result.isError).toBe(true);
        expect(result.sourceSlug).toBe('fixture');
        // Main's pool recovers the dead transport in place, without replaying
        // the failed call; the branch left the source disconnected until the
        // next sync. Either way exactly one child per connect is spawned.
        expect(pool.isConnected('fixture')).toBe(true);
        expect(pool.getProxyToolDefs().map(tool => tool.name)).toContain('mcp__fixture__inspect');
        expect((await readFile(join(fixture.root, 'calls.txt'), 'utf8')).trim().split('\n')).toHaveLength(1);
        if (reconcile === 'sync') expect(await pool.sync({ fixture: fixture.config })).toEqual([]);
        else await pool.ensureConnected('fixture', fixture.config);
        expect(pool.isConnected('fixture')).toBe(true);
        const fresh = JSON.parse((await pool.callTool('mcp__fixture__inspect', {})).content);
        const starts = (await readFile(join(fixture.root, 'starts.txt'), 'utf8')).trim().split('\n');
        expect(starts).toHaveLength(2);
        expect(starts[0]).not.toBe(starts[1]);
        const replacementPid = starts[1];
        if (!replacementPid) throw new Error('Replacement child did not record its PID');
        expect(String(fresh.pid)).toBe(replacementPid);
        expect((await readFile(join(fixture.root, 'calls.txt'), 'utf8')).trim().split('\n').map(line => line.split(':')[1])).toEqual(['die', 'inspect']);
      } finally {
        await pool.disconnectAll();
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }

  test('EOF after a successful reply hides idle dead clients and same-config sync replaces them', async () => {
    const fixture = await builderFixture();
    const pool = new McpClientPool();
    try {
      await pool.connect('fixture', fixture.config);
      const result = await pool.callTool('mcp__fixture__reply_then_exit', {});
      expect(result.isError).toBe(false);
      const first = JSON.parse(result.content);
      const deadline = Date.now() + 2000;
      while (pool.isConnected('fixture') && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(pool.isConnected('fixture')).toBe(false);
      expect(pool.getTools('fixture')).toEqual([]);
      expect(pool.getProxyToolDefs()).toEqual([]);
      expect(await pool.sync({ fixture: fixture.config })).toEqual([]);
      const fresh = JSON.parse((await pool.callTool('mcp__fixture__inspect', {})).content);
      expect(fresh.pid).not.toBe(first.pid);
      expect((await readFile(join(fixture.root, 'starts.txt'), 'utf8')).trim().split('\n')).toHaveLength(2);
    } finally {
      await pool.disconnectAll();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
