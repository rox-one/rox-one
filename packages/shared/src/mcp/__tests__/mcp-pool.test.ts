/**
 * McpClientPool.ensureConnected: single-source connect/reconnect semantics —
 * connect once, no-op on unchanged config, reconnect on credential change,
 * and the local-MCP gate for stdio configs (same gate sync() applies).
 */

import { describe, test, expect } from 'bun:test';
import { McpClientPool } from '../mcp-pool.ts';
import type { PoolClient } from '../client.ts';
import type { SdkMcpServerConfig } from '../../agent/backend/types.ts';

class TestPool extends McpClientPool {
  connectCalls: Array<{ slug: string; config: SdkMcpServerConfig }> = [];
  closedSlugs: string[] = [];

  async registerForTest(slug: string, client: PoolClient): Promise<void> {
    await this.registerClient(slug, client);
  }

  protected override async connectSource(slug: string, config: SdkMcpServerConfig): Promise<void> {
    this.connectCalls.push({ slug, config });
    const self = this;
    const fake: PoolClient = {
      listTools: async () => [],
      callTool: async () => ({ content: [] }),
      close: async () => { self.closedSlugs.push(slug); },
    };
    await this.registerClient(slug, fake);
    this.activeConfigs.set(slug, config);
  }
}

function httpConfig(token: string): SdkMcpServerConfig {
  return { type: 'http', url: 'https://mcp.example.test/mcp', headers: { Authorization: `Bearer ${token}` } };
}

describe('McpClientPool.ensureConnected', () => {
  test('connects an absent source once', async () => {
    const pool = new TestPool();
    await pool.ensureConnected('craft', httpConfig('a'));
    expect(pool.connectCalls.length).toBe(1);
    expect(pool.isConnected('craft')).toBe(true);
  });

  test('is a no-op when already connected with an unchanged config', async () => {
    const pool = new TestPool();
    await pool.ensureConnected('craft', httpConfig('a'));
    await pool.ensureConnected('craft', httpConfig('a'));
    expect(pool.connectCalls.length).toBe(1);
    expect(pool.closedSlugs).toEqual([]);
  });

  test('reconnects when the auth header changed (token refresh)', async () => {
    const pool = new TestPool();
    await pool.ensureConnected('craft', httpConfig('a'));
    await pool.ensureConnected('craft', httpConfig('b'));
    expect(pool.connectCalls.length).toBe(2);
    expect(pool.closedSlugs).toEqual(['craft']);
    expect(pool.isConnected('craft')).toBe(true);
  });

  test('reconnects when a lowercase authorization header changes', async () => {
    const pool = new TestPool();
    await pool.ensureConnected('craft', { type: 'http', url: 'https://example.test/mcp', headers: { authorization: 'Bearer a' } });
    await pool.ensureConnected('craft', { type: 'http', url: 'https://example.test/mcp', headers: { authorization: 'Bearer b' } });
    expect(pool.connectCalls.length).toBe(2);
    expect(pool.closedSlugs).toEqual(['craft']);
  });

  test('reconnects when stdio command, arguments, or environment changes', async () => {
    const pool = new TestPool();
    const config: SdkMcpServerConfig = { type: 'stdio', command: 'npx', args: ['server'], env: { MODE: 'a' } };
    await pool.ensureConnected('local', config);
    await pool.ensureConnected('local', { ...config, args: ['server', '--flag'] });
    await pool.ensureConnected('local', { ...config, env: { MODE: 'b' } });
    await pool.ensureConnected('local', { ...config, command: 'npx.cmd' });
    expect(pool.connectCalls.length).toBe(4);
    expect(pool.closedSlugs).toEqual(['local', 'local', 'local']);
  });

  test('closes a client whose tool discovery fails and never publishes its state', async () => {
    const pool = new TestPool();
    let closed = false;
    await expect(pool.registerForTest('broken', {
      listTools: async () => { throw new Error('discovery failed'); },
      callTool: async () => ({}),
      close: async () => { closed = true; throw new Error('cleanup failed'); },
    })).rejects.toThrow('discovery failed');
    expect(closed).toBe(true);
    expect(pool.isConnected('broken')).toBe(false);
    expect(pool.getProxyToolDefs()).toEqual([]);
  });

  test('attributes server-returned tool errors and forwards cancellation/timeouts', async () => {
    const pool = new TestPool();
    const controller = new AbortController();
    let received: unknown;
    await pool.registerForTest('broken', {
      listTools: async () => [{ name: 'fail', inputSchema: { type: 'object' } }],
      callTool: async (_name, _args, options) => {
        received = options;
        return { isError: true, content: [{ type: 'text', text: 'server rejected call' }] };
      },
      close: async () => {},
    });
    const options = { signal: controller.signal, timeoutMs: 25 };
    expect(await pool.callTool('mcp__broken__fail', {}, options)).toEqual({
      content: 'server rejected call', isError: true, sourceSlug: 'broken',
    });
    expect(received).toBe(options);
  });

  test('does not touch other pool members', async () => {
    const pool = new TestPool();
    await pool.ensureConnected('one', httpConfig('a'));
    await pool.ensureConnected('two', httpConfig('x'));
    await pool.ensureConnected('one', httpConfig('b')); // reconnect 'one' only
    expect(pool.isConnected('two')).toBe(true);
    expect(pool.closedSlugs).toEqual(['one']);
  });

  test('refuses stdio configs when local MCP is disabled for the workspace', async () => {
    const prev = process.env.CRAFT_LOCAL_MCP_ENABLED;
    process.env.CRAFT_LOCAL_MCP_ENABLED = 'false';
    try {
      const pool = new TestPool({ workspaceRootPath: '/tmp/ws-does-not-exist' });
      const stdio: SdkMcpServerConfig = { type: 'stdio', command: 'echo', args: [] };
      await expect(pool.ensureConnected('local', stdio)).rejects.toThrow(/Local MCP is disabled/);
      expect(pool.connectCalls.length).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.CRAFT_LOCAL_MCP_ENABLED;
      else process.env.CRAFT_LOCAL_MCP_ENABLED = prev;
    }
  });
});
