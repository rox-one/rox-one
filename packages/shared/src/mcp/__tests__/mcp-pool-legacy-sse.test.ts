import { describe, expect, test, spyOn } from 'bun:test';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { McpClientPool } from '../mcp-pool.ts';
import type { McpClientConfig, McpConnectOptions, PoolClient } from '../client.ts';

const tool: Tool = { name: 'echo', inputSchema: { type: 'object', properties: {} } };
const config = { type: 'http' as const, url: 'https://legacy.example.test/mcp' };
const token = 'fixture-private-token';

async function listen(server: HttpServer) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

async function stop(server: HttpServer) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

describe('McpClientPool legacy SSE negotiation over actual HTTP', () => {
  for (const status of [400, 404, 405]) {
    test(`HTTP ${status} initialize selects authenticated SSE and retains tool/config ownership`, async () => {
      const requests: Array<{ method: string; path: string; authorization?: string }> = [];
      const sessions = new Map<string, SSEServerTransport>();
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        requests.push({ method: req.method!, path: url.pathname, authorization: req.headers.authorization });
        if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
        if (url.pathname === '/mcp' && req.method === 'GET') {
          const transport = new SSEServerTransport('/messages', res);
          sessions.set(transport.sessionId, transport);
          res.once('close', () => sessions.delete(transport.sessionId));
          const mcp = new Server({ name: 'legacy', version: '1' }, { capabilities: { tools: {} } });
          mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool] }));
          mcp.setRequestHandler(CallToolRequestSchema, async request => ({
            content: [{ type: 'text', text: String(request.params.arguments?.value ?? '') }],
          }));
          void mcp.connect(transport).catch(() => {});
          return;
        }
        if (url.pathname === '/messages' && req.method === 'POST') {
          const transport = sessions.get(url.searchParams.get('sessionId') ?? '');
          if (!transport) { res.writeHead(404).end(); return; }
          void transport.handlePostMessage(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
          return;
        }
        res.writeHead(status).end();
      });
      const url = await listen(server);
      const logs: string[] = [];
      const pool = new McpClientPool({ debug: message => logs.push(message) });
      const source = { type: 'http' as const, url: `${url}?key=private-query`, headers: { Authorization: `Bearer ${token}` } };
      try {
        expect(await pool.sync({ legacy: source })).toEqual([]);
        expect(pool.isConnected('legacy')).toBe(true);
        expect(pool.getProxyToolDefs().map(def => def.name)).toEqual(['mcp__legacy__echo']);
        expect(await pool.callTool('mcp__legacy__echo', { value: 'actual-sse' })).toEqual({ content: 'actual-sse', isError: false });
        const requestCount = requests.length;
        expect(await pool.sync({ legacy: source })).toEqual([]);
        expect(requests).toHaveLength(requestCount); // Declared HTTP config remains the source identity.
        expect(requests.slice(0, 2).map(request => request.method)).toEqual(['POST', 'GET']);
        expect(requests.some(request => request.path === '/messages')).toBe(true);
        expect(requests.every(request => request.authorization === `Bearer ${token}`)).toBe(true);
        expect(logs.join('\n')).toContain(`HTTP ${status}`);
        expect(logs.join('\n')).not.toContain(token);
        expect(logs.join('\n')).not.toContain('private-query');
      } finally { await pool.disconnectAll(); await stop(server); }
    }, 10_000);
  }

  for (const status of [401, 403, 429, 500, 503]) {
    test(`HTTP ${status} refuses SSE while retaining the existing transient retry policy`, async () => {
      const methods: string[] = [];
      const server = createServer((req, res) => { methods.push(req.method!); res.writeHead(status).end(); });
      const url = await listen(server);
      const logs: string[] = [];
      const pool = new McpClientPool({ debug: message => logs.push(message) });
      try {
        expect(await pool.sync({ source: { type: 'http', url: `${url}?key=private-query` } })).toEqual(['source']);
        expect(methods).toEqual(status === 503 ? ['POST', 'POST'] : ['POST']);
        expect(logs.join('\n')).toContain(`HTTP ${status}`);
        expect(logs.join('\n')).not.toContain('trying legacy SSE');
        expect(logs.join('\n')).not.toContain('private-query');
        expect(pool.getProxyToolDefs()).toEqual([]);
      } finally { await pool.disconnectAll(); await stop(server); }
    }, 10_000);
  }

  test('retains both sanitized failures without raw SDK causes', async () => {
    const methods: string[] = [];
    const server = createServer((req, res) => {
      methods.push(req.method!);
      res.writeHead(req.method === 'POST' ? 405 : 404).end(`${token} http://private.example/mcp?key=private-query`);
    });
    const url = await listen(server);
    const pool = new McpClientPool();
    try {
      const error = await pool.connect('legacy', { type: 'http', url: `${url}?key=private-query`, headers: { Authorization: `Bearer ${token}` } }).then(() => undefined, error => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/HTTP 405.*legacy SSE fallback failed.*sse:/);
      expect(error.message).not.toContain(token);
      expect(error.message).not.toContain('private-query');
      expect(error.cause).toBeUndefined();
      expect(methods).toEqual(['POST', 'GET']);
      expect(pool.getProxyToolDefs()).toEqual([]);
    } finally { await pool.disconnectAll(); await stop(server); }
  }, 10_000);

  for (const failingList of [1, 2]) {
    test(`HTTP tools/list ${failingList === 1 ? 'health' : 'discovery'} failure never selects SSE`, async () => {
      let lists = 0;
      const methods: string[] = [];
      const server = createServer((req, res) => {
        methods.push(req.method!);
        if (req.method !== 'POST') { res.writeHead(405).end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const message = JSON.parse(body);
          if (message.id === undefined) { res.writeHead(202).end(); return; }
          if (message.method === 'tools/list' && ++lists === failingList) { res.writeHead(405).end(); return; }
          const result = message.method === 'initialize'
            ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'http', version: '1' } }
            : { tools: [] };
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
        });
      });
      const url = await listen(server);
      const logs: string[] = [];
      const pool = new McpClientPool({ debug: message => logs.push(message) });
      try {
        expect(await pool.sync({ source: { type: 'http', url } })).toEqual(['source']);
        expect(lists).toBe(failingList);
        // StreamableHTTP SDK itself may open an optional GET notification stream.
        expect(logs.join('\n')).not.toContain('trying legacy SSE');
        expect(pool.getProxyToolDefs()).toEqual([]);
        expect(methods.filter(method => method === 'POST')).toHaveLength(failingList + 2);
      } finally { await pool.disconnectAll(); await stop(server); }
    }, 10_000);
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

class NegotiatingClient implements PoolClient {
  connected = false;
  closes = 0;
  budgets: number[] = [];
  onConnect?: () => Promise<void>;
  onClose?: () => Promise<void>;
  onList?: () => Promise<void>;
  async connect(options?: McpConnectOptions) { this.budgets.push(options!.timeoutMs!); await this.onConnect?.(); this.connected = true; }
  async listTools(options?: McpConnectOptions) { this.budgets.push(options!.timeoutMs!); await this.onList?.(); return [tool]; }
  isConnected() { return this.connected; }
  async callTool() { return { content: [] }; }
  async close() { this.connected = false; this.closes++; await this.onClose?.(); }
}

class QueuePool extends McpClientPool {
  configs: McpClientConfig[] = [];
  private queue: NegotiatingClient[];
  constructor(clients: NegotiatingClient[]) { super(); this.queue = [...clients]; }
  protected override createClient(config: McpClientConfig): PoolClient {
    this.configs.push(config);
    const client = this.queue.shift();
    if (!client) throw new Error('Unexpected extra client');
    return client;
  }
}

describe('McpClientPool legacy SSE lifetime and budget fences', () => {
  test('shares one attempt budget across HTTP, cleanup, SSE and tool discovery', async () => {
    const originalNow = Date.now;
    let elapsed = 0;
    const clock = spyOn(Date, 'now').mockImplementation(() => originalNow() + elapsed);
    const http = new NegotiatingClient();
    const sse = new NegotiatingClient();
    http.onConnect = async () => { elapsed += 10_000; throw new StreamableHTTPError(405, 'legacy'); };
    http.onClose = async () => { elapsed += 2_000; };
    sse.onConnect = async () => { elapsed += 7_000; };
    const pool = new QueuePool([http, sse]);
    try {
      await pool.connect('source', config);
      expect(pool.configs.map(config => config.transport)).toEqual(['http', 'sse']);
      expect(http.closes).toBe(1);
      expect(http.budgets[0]).toBeLessThanOrEqual(30_000);
      expect(sse.budgets[0]).toBeGreaterThan(17_900);
      expect(sse.budgets[0]).toBeLessThanOrEqual(18_000);
      expect(sse.budgets[1]).toBeGreaterThan(10_900);
      expect(sse.budgets[1]).toBeLessThanOrEqual(11_000);
    } finally { clock.mockRestore(); await pool.disconnectAll(); }
  });

  test('disconnect during failed HTTP cleanup creates no fallback or proxy', async () => {
    const enteredClose = deferred();
    const releaseClose = deferred();
    const http = new NegotiatingClient();
    http.onConnect = async () => { throw new StreamableHTTPError(405, 'legacy'); };
    http.onClose = async () => { enteredClose.resolve(); await releaseClose.promise; };
    const pool = new QueuePool([http]);
    const connection = pool.connect('source', config).then(() => undefined, error => error);
    await enteredClose.promise;
    const disconnected = pool.disconnect('source');
    releaseClose.resolve();
    await disconnected;
    expect((await connection).message).toContain('cancelled');
    expect(pool.configs).toHaveLength(1);
    expect(pool.getProxyToolDefs()).toEqual([]);
  });

  test('disconnect during SSE initialization refuses late publication', async () => {
    const entered = deferred();
    const release = deferred();
    const http = new NegotiatingClient();
    const sse = new NegotiatingClient();
    http.onConnect = async () => { throw new StreamableHTTPError(404, 'legacy'); };
    sse.onConnect = async () => { entered.resolve(); await release.promise; };
    const pool = new QueuePool([http, sse]);
    const connection = pool.connect('source', config).then(() => undefined, error => error);
    await entered.promise;
    const disconnected = pool.disconnect('source');
    release.resolve();
    await disconnected;
    expect((await connection).message).toContain('cancelled');
    expect(sse.budgets).toHaveLength(1); // No discovery after cancellation.
    expect(sse.closes).toBeGreaterThan(0);
    expect(pool.getProxyToolDefs()).toEqual([]);
    expect(pool.isConnected('source')).toBe(false);
  });

  test('an expired budget before discovery still closes each failed client', async () => {
    const originalNow = Date.now;
    let elapsed = 0;
    const clock = spyOn(Date, 'now').mockImplementation(() => originalNow() + elapsed);
    const clients = [new NegotiatingClient(), new NegotiatingClient()];
    for (const client of clients) client.onConnect = async () => { elapsed += 31_000; };
    const pool = new QueuePool(clients);
    try {
      await expect(pool.connect('source', config)).rejects.toThrow('timed out');
      expect(clients.map(client => client.closes)).toEqual([1, 1]);
      expect(clients.map(client => client.budgets.length)).toEqual([1, 1]);
      expect(pool.getProxyToolDefs()).toEqual([]);
    } finally { clock.mockRestore(); await pool.disconnectAll(); }
  });
});
