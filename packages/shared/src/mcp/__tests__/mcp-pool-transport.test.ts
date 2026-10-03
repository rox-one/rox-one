import { describe, expect, test, spyOn } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClientPool } from '../mcp-pool.ts';
import { getToolchain } from '../../toolchain-runtime.ts';

describe('McpClientPool transport failures', () => {
  for (const status of [401, 403, 429, 500, 503]) {
    test(`reports an empty-body HTTP ${status} without falling back to SSE`, async () => {
      const methods: string[] = [];
      const server = createServer((req, res) => {
        methods.push(req.method!);
        res.writeHead(status).end();
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      const logs: string[] = [];
      const pool = new McpClientPool({ debug: (message) => logs.push(message) });
      try {
        expect(await pool.sync({ docs: { type: 'http', url: `http://127.0.0.1:${port}/mcp?key=private-query` } })).toEqual(['docs']);
        expect(methods).toEqual(['POST']);
        expect(logs.join('\n')).toContain(`HTTP ${status}`);
        expect(logs.join('\n')).toContain(`/mcp`);
        expect(logs.join('\n')).not.toContain('private-query');
        expect(pool.isConnected('docs')).toBe(false);
      } finally {
        await pool.disconnectAll();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }

  test('preserves both failures when HTTP negotiation and SSE fallback fail', async () => {
    const methods: string[] = [];
    const server = createServer((req, res) => {
      methods.push(req.method!);
      res.writeHead(req.method === 'POST' ? 405 : 404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const pool = new McpClientPool();
    try {
      await expect(pool.connect('legacy', { type: 'http', url: `http://127.0.0.1:${port}/sse` })).rejects.toThrow(/HTTP 405.*legacy SSE fallback failed/);
      expect(methods).toEqual(['POST', 'GET']);
      expect(pool.isConnected('legacy')).toBe(false);
    } finally {
      await pool.disconnectAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('does not negotiate SSE for a tools/list failure after successful HTTP initialization', async () => {
    let lists = 0;
    const server = createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const message = JSON.parse(body);
        if (message.id === undefined) { res.writeHead(202).end(); return; }
        if (message.method === 'tools/list' && ++lists === 2) { res.writeHead(405).end(); return; }
        const result = message.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'http-stub', version: '1.0' } }
          : { tools: [] };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const logs: string[] = [];
    const pool = new McpClientPool({ debug: message => logs.push(message) });
    try {
      expect(await pool.sync({ docs: { type: 'http', url: `http://127.0.0.1:${port}/mcp` } })).toEqual(['docs']);
      expect(lists).toBe(2);
      expect(logs.join('\n')).toContain('HTTP 405');
      expect(logs.join('\n')).not.toContain('trying legacy SSE');
      expect(pool.getProxyToolDefs()).toEqual([]);
    } finally {
      await pool.disconnectAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('McpClientPool Windows stdio launch', () => {
  // Runs real SDK cross-spawn + cmd.exe, without package downloads or live config.
  for (const command of ['npx', 'uv', 'npx.cmd', 'absolute.cmd']) {
    test.skipIf(process.platform !== 'win32')(`launches ${command} from managed PATH and preserves source env/argv`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'mcp pool launch '));
      const fixture = fileURLToPath(new URL('./mcp-pool-stdio-fixture.ts', import.meta.url));
      await writeFile(join(dir, 'npx.cmd'), `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
      await writeFile(join(dir, 'uv.cmd'), `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
      const prefix = spyOn(getToolchain().resolver, 'toolchainPathPrefix').mockResolvedValue(dir);
      const pool = new McpClientPool();
      const env = { Path: 'C:\\source path', POOL_TEST_VALUE: 'source override' };
      try {
        const executable = command === 'absolute.cmd' ? join(dir, 'npx.cmd') : command;
        expect(await pool.sync({ local: { type: 'stdio', command: executable, args: ['spaced argument', 'literal&argument'], env } })).toEqual([]);
        const result = await pool.callTool('mcp__local__inspect', {});
        expect(result.isError).toBe(false);
        const child = JSON.parse(result.content);
        expect(child.path).toBe(`${dir}${delimiter}${env.Path}`);
        expect(child.value).toBe('source override');
        expect(child.args).toEqual(['spaced argument', 'literal&argument']);
        expect(env).toEqual({ Path: 'C:\\source path', POOL_TEST_VALUE: 'source override' });
      } finally {
        await pool.disconnectAll();
        prefix.mockRestore();
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  test.skipIf(process.platform !== 'win32')('resolves a bare native uv.exe through managed PATH without a shell wrapper', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp pool native '));
    const fixture = fileURLToPath(new URL('./mcp-pool-stdio-fixture.ts', import.meta.url));
    // A renamed real runtime is a native executable stand-in; no uv download/install.
    await copyFile(process.execPath, join(dir, 'uv.exe'));
    const prefix = spyOn(getToolchain().resolver, 'toolchainPathPrefix').mockResolvedValue(dir);
    const pool = new McpClientPool();
    try {
      await pool.connect('local', { type: 'stdio', command: 'uv', args: [fixture, 'native argument', 'literal&argument'] });
      const result = await pool.callTool('mcp__local__inspect', {});
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content).args).toEqual(['native argument', 'literal&argument']);
      expect(JSON.parse(result.content).path.split(delimiter)[0]).toBe(dir);
    } finally {
      await pool.disconnectAll();
      prefix.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('McpClientPool request deadlines', () => {
  test('times out and aborts real stdio requests, attributes errors, and keeps the client usable', async () => {
    const pool = new McpClientPool();
    const fixture = fileURLToPath(new URL('./mcp-pool-stdio-fixture.ts', import.meta.url));
    try {
      await pool.connect('local', { type: 'stdio', command: process.execPath, args: [fixture] });
      const timedOut = await pool.callTool('mcp__local__inspect', { stall: true }, { timeoutMs: 50 });
      expect(timedOut.isError).toBe(true);
      expect(timedOut.sourceSlug).toBe('local');
      expect(timedOut.content).toContain('Request timed out');

      const controller = new AbortController();
      const pending = pool.callTool('mcp__local__inspect', { stall: true }, { signal: controller.signal, timeoutMs: 1000 });
      controller.abort(new Error('pool test cancelled'));
      const aborted = await pending;
      expect(aborted.isError).toBe(true);
      expect(aborted.sourceSlug).toBe('local');
      expect(aborted.content).toContain('pool test cancelled');
      expect((await pool.callTool('mcp__local__inspect', {})).isError).toBe(false);
    } finally {
      await pool.disconnectAll();
    }
  });
});
