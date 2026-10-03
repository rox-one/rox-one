import { describe, expect, test } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { delimiter } from 'node:path';
import { CraftMcpClient, mergeMcpStdioEnvironment, type McpClientConfig } from '../client.ts';
import { McpClientPool } from '../mcp-pool.ts';
import { getToolchain } from '../../toolchain-runtime.ts';

const fixture = fileURLToPath(new URL('./fixtures/mcp-server-echo.mjs', import.meta.url));
const stdioConfig = { type: 'stdio' as const, command: process.execPath, args: [fixture] };

function spawnedTransport(client: CraftMcpClient) {
  return (client as unknown as {
    transport: { _process: ChildProcess; _serverParams: { command: string; env: Record<string, string> } };
  }).transport;
}

class CapturePool extends McpClientPool {
  created: CraftMcpClient[] = [];
  protected override createClient(config: McpClientConfig) {
    const client = new CraftMcpClient(config);
    this.created.push(client);
    return client;
  }
}

describe('CraftMcpClient lifecycle', () => {
  test('reports an exited stdio subprocess and the pool restarts it before the next tool request', async () => {
    const pool = new CapturePool();
    try {
      await pool.connect('local', stdioConfig);
      const original = pool.created[0]!;
      expect(original.isConnected()).toBe(true);
      const child = spawnedTransport(original)._process;
      const exited = once(child, 'close');
      child.kill('SIGKILL');
      await exited;
      expect(original.isConnected()).toBe(false);
      expect(pool.isConnected('local')).toBe(false);
      expect(await pool.callTool('mcp__local__echo', { text: 'recovered' })).toEqual({
        content: 'echo:recovered', isError: false,
      });
      expect(pool.created).toHaveLength(2);
      expect(pool.isConnected('local')).toBe(true);
    } finally {
      await pool.disconnectAll();
    }
    expect(pool.created.every(client => !client.isConnected())).toBe(true);
  });

  test('resolves managed launchers and adds their PATH before spawning a local server', async () => {
    const resolver = getToolchain().resolver;
    const originalFind = resolver.findExecutable;
    const originalPrefix = resolver.toolchainPathPrefix;
    const lookedUp: string[] = [];
    resolver.findExecutable = async name => { lookedUp.push(name); return process.execPath; };
    resolver.toolchainPathPrefix = async () => '/managed/runtime/bin';
    const client = new CraftMcpClient({ transport: 'stdio', command: 'bun', args: [fixture], env: { MCP_CUSTOM: 'kept' } });
    try {
      expect((await client.listTools()).map(tool => tool.name)).toEqual(['echo']);
      const params = spawnedTransport(client)._serverParams;
      expect(lookedUp).toEqual(['bun']);
      expect(params.command).toBe(process.execPath);
      expect(params.env.PATH?.startsWith(`/managed/runtime/bin${delimiter}`)).toBe(true);
      expect(params.env.MCP_CUSTOM).toBe('kept');
    } finally {
      await client.close();
      resolver.findExecutable = originalFind;
      resolver.toolchainPathPrefix = originalPrefix;
    }
  });

  test('preserves explicit executable paths and source-specific PATH values', async () => {
    const resolver = getToolchain().resolver;
    const originalFind = resolver.findExecutable;
    const originalPrefix = resolver.toolchainPathPrefix;
    let lookups = 0;
    resolver.findExecutable = async () => { lookups++; return '/unexpected/override'; };
    resolver.toolchainPathPrefix = async () => '/managed/runtime/bin';
    const client = new CraftMcpClient({
      transport: 'stdio', command: process.execPath, args: [fixture], env: { PATH: '/source/runtime/bin' },
    });
    try {
      await client.listTools();
      const params = spawnedTransport(client)._serverParams;
      expect(params.command).toBe(process.execPath);
      expect(params.env.PATH).toBe('/source/runtime/bin');
      expect(lookups).toBe(0);
    } finally {
      await client.close();
      resolver.findExecutable = originalFind;
      resolver.toolchainPathPrefix = originalPrefix;
    }
  });
});


test('Windows source PATH projection removes conflicting aliases and preserves explicit empty overrides', () => {
  for (const key of ['PATH','Path','pAtH']) {
    expect(mergeMcpStdioEnvironment({PATH:'inherited',Path:'conflicting',KEPT:'inherited'}, {[key]:'source',MCP_CUSTOM:'kept'},'win32')).toEqual({KEPT:'inherited',MCP_CUSTOM:'kept',PATH:'source'});
    expect(mergeMcpStdioEnvironment({PATH:'inherited'}, {[key]:''},'win32')).toEqual({PATH:''});
  }
  expect(mergeMcpStdioEnvironment({Path:'inherited'}, {},'win32')).toEqual({PATH:'inherited'});
  expect(mergeMcpStdioEnvironment({PATH:'posix'}, {Path:'ordinary env'},'darwin')).toEqual({PATH:'posix',Path:'ordinary env'});
});
