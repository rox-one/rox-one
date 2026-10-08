/**
 * MCP client using official @modelcontextprotocol/sdk
 * Supports HTTP (Streamable HTTP), legacy SSE, and stdio transports for
 * remote and local MCP servers
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { basename, dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { isBlockedEnvVar } from '@rox/core/env';
import { createMcpGuardedFetch, McpRedirectError } from './guarded-fetch.ts';
import { isSensitiveKeyName, REDACTED_VALUE } from '../utils/redaction.ts';
import { getToolchain, withToolchainPathPrefix } from '../toolchain-runtime.ts';
import { pathEnvKey } from '../toolchain/exec.ts';

/**
 * HTTP transport config for remote MCP servers
 */
export interface HttpMcpClientConfig {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Legacy SSE transport config for remote MCP servers.
 * SSE is deprecated upstream in favor of Streamable HTTP, but the SDK still
 * ships the transport and pure-SSE servers remain in the wild.
 */
export interface SseMcpClientConfig {
  transport: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Stdio transport config for local MCP servers (spawns subprocess)
 */
export interface StdioMcpClientConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Unified config supporting all transport types
 */
export type McpClientConfig = HttpMcpClientConfig | SseMcpClientConfig | StdioMcpClientConfig;

/**
 * Defensive userinfo strip for remote MCP endpoint URLs. Credentialed URLs
 * (`http://user:pass@host`) are rejected at source-config validation, but a
 * hand-edited config.json can still reach this constructor — never let
 * credentials ride the wire or echo back through SDK error messages.
 */
function withoutUserinfo(rawUrl: string): URL {
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url;
}

/**
 * Log-safe rendering of an MCP endpoint URL: origin + pathname only — never
 * userinfo, query string, or hash (all of which may carry credentials).
 */
export function formatMcpUrlForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

/**
 * Per-call options for PoolClient.callTool.
 * Forwarded to the MCP SDK's RequestOptions so aborts become protocol-level
 * cancellation notifications instead of orphaned in-flight requests.
 */
export interface PoolCallToolOptions {
  /** Cancels the in-flight request when aborted */
  signal?: AbortSignal;
  /** Request timeout in ms (SDK default applies when omitted) */
  timeoutMs?: number;
}

export interface McpConnectOptions {
  signal?: AbortSignal;
  /** Total budget including executable resolution, startup and health discovery. */
  timeoutMs?: number;
}

export const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

function operationBudget(timeoutMs: number, lifetime: AbortSignal, caller: AbortSignal | undefined, label: string) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`Invalid ${label} timeout`);
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const closed = () => controller.abort(new Error('MCP client is closed'));
  const cancelled = () => controller.abort(new Error('MCP connection cancelled'));
  lifetime.addEventListener('abort', closed, { once: true });
  caller?.addEventListener('abort', cancelled, { once: true });
  if (lifetime.aborted) closed();
  else if (caller?.aborted) cancelled();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    remaining: () => {
      if (Date.now() >= deadline) controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
      controller.signal.throwIfAborted();
      return deadline - Date.now();
    },
    dispose() {
      clearTimeout(timer);
      lifetime.removeEventListener('abort', closed);
      caller?.removeEventListener('abort', cancelled);
    },
  };
}

/** Linear suffix scan: an attacker-controlled punctuation run must not backtrack. */
function logSafeUrlToken(token: string): string {
  let end = token.length;
  while (end > 0 && '),.;'.includes(token[end - 1]!)) end--;
  return formatMcpUrlForLog(token.slice(0, end)) + token.slice(end);
}

function errorSanitizer(config: McpClientConfig): (error: unknown) => Error {
  const secrets: string[] = [];
  if (config.transport === 'stdio') {
    secrets.push(...Object.entries(config.env ?? {}).filter(([key]) => isSensitiveKeyName(key)).map(([, value]) => value));
  } else {
    const url = new URL(config.url);
    secrets.push(url.username, url.password, ...url.searchParams.values(), url.hash.slice(1));
    for (const value of [url.username, url.password, url.hash.slice(1)]) {
      try { secrets.push(decodeURIComponent(value)); } catch { /* Preserve malformed escapes for literal scrubbing. */ }
    }
    for (const value of Object.values(config.headers ?? {})) secrets.push(value, value.replace(/^(?:Bearer|Basic)\s+/i, ''));
  }
  const values = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  const scrub = (text: string) => {
    let safe = text.replace(/https?:\/\/[^\s<>"']+/gi, logSafeUrlToken);
    for (const secret of values) safe = safe.split(secret).join(REDACTED_VALUE);
    return safe.slice(0, 8192);
  };
  return (error: unknown) => {
    const message = scrub(error instanceof Error ? error.message : String(error));
    // Preserve retry classification but never retain raw SDK error/cause properties.
    if (error instanceof StreamableHTTPError) return new StreamableHTTPError(error.code, message.replace(/^Streamable HTTP error: /, ''));
    if (error instanceof McpRedirectError) return new McpRedirectError(message, scrub(error.redirectUrl));
    return new Error(message);
  };
}

/**
 * Interface for clients managed by McpClientPool.
 * Both CraftMcpClient (remote MCP sources) and ApiSourcePoolClient (API sources) implement this.
 */
export interface PoolClient {
  /** Explicit negotiation, when supported; separates initialize from later discovery. */
  connect?(options?: McpConnectOptions): Promise<void>;
  listTools(options?: McpConnectOptions): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<unknown>;
  close(): Promise<void>;
  /** Transport health, when available. Older/in-process clients may omit it. */
  isConnected?(): boolean;
  /** True after terminal transport closure, when the client reports it. */
  readonly isClosed?: boolean;
}

/** Source PATH is authoritative; Windows children receive one unambiguous alias. */
export function mergeMcpStdioEnvironment(
  inherited: Record<string, string>,
  source: Record<string, string> = {},
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env = { ...inherited, ...source };
  if (platform === 'win32') {
    const sourceKey = Object.keys(source).find(key => key.toUpperCase() === 'PATH');
    const value = sourceKey !== undefined ? source[sourceKey] : inherited[pathEnvKey(inherited, true)];
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
    if (value !== undefined) env.PATH = value;
  }
  return env;
}

function inheritedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !isBlockedEnvVar(key)) env[key] = value;
  }
  return env;
}

function isOfficialQdrantLaunch(config: McpClientConfig): config is StdioMcpClientConfig {
  if (config.transport !== 'stdio' || !/^uvx(?:\.exe)?$/i.test(basename(config.command.replaceAll('\\', '/')))) return false;
  const args = config.args ?? [];
  const officialPackage = 'mcp-server-qdrant==0.8.1';
  if (!(args.length === 1 && args[0] === officialPackage)
    && !((args.length === 3 || (args.length === 5 && args[3] === '--transport' && args[4] === 'stdio'))
      && args[0] === '--from' && args[1] === officialPackage && args[2] === 'mcp-server-qdrant')) return false;
  return true;
}

/** Only the official embedded Qdrant launch is eligible for process sharing. */
export function isManagedLocalQdrantConfig(config: McpClientConfig): boolean {
  if (!isOfficialQdrantLaunch(config)) return false;
  const localPath = config.env?.QDRANT_LOCAL_PATH?.trim();
  return !!localPath && !localPath.includes('${') && !config.env?.QDRANT_URL?.trim() && !config.env?.QDRANT_API_KEY?.trim();
}

function abortable<T>(work: Promise<T>, signal: AbortSignal, reason: () => unknown = () => new Error('MCP client is closed')): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(reason());
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    // Keep observing work after cancellation: SDK SSE start() does not settle
    // when its EventSource is closed before receiving the endpoint event.
    work.then(result => {
      signal.removeEventListener('abort', abort);
      resolvePromise(result);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

function coalesceTransportClose(transport: Transport): Transport {
  const close = transport.close.bind(transport);
  let closing: Promise<void> | undefined;
  // The SDK closes failed initialization without awaiting it. In particular,
  // stdio.close() clears its process field before the child exits, so another
  // close must join that shutdown instead of reporting completion early.
  transport.close = () => closing ??= Promise.resolve().then(close);
  return transport;
}

/** One SDK connection/transport. Public clients can lease the same instance. */
class McpConnection {
  readonly client: Client;
  transport: Transport;
  private connected = false;
  private closing = false;
  private readonly controller = new AbortController();
  private connecting?: Promise<void>;
  private listing?: Promise<Tool[]>;
  private cleanup?: Promise<void>;
  private closingTask?: Promise<void>;
  private readonly safeError: (error: unknown) => Error;

  constructor(private readonly config: McpClientConfig) {
    this.safeError = errorSanitizer(config);
    this.client = new Client({
      name: 'craft-agent',
      version: '1.0.0',
    });
    this.client.onclose = () => { this.connected = false; };

    this.transport = coalesceTransportClose(this.createTransport());
  }

  private createTransport(signal: AbortSignal = this.controller.signal): Transport {
    signal = AbortSignal.any([this.controller.signal, signal]);
    const config = this.config;
    if (config.transport === 'stdio') {
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      });
    } else if (config.transport === 'sse') {
      // Legacy SSE transport for remote MCP servers. The SDK applies
      // requestInit.headers to BOTH the SSE handshake GET and the message
      // POSTs (see SSEClientTransport._commonHeaders), so auth/custom
      // headers behave the same as on the HTTP transport. The guarded fetch
      // covers both paths (handshake via the eventsource fetch passthrough,
      // POSTs via transport fetch) — SSRF: no cross-origin redirect follows.
      return new SSEClientTransport(
        withoutUserinfo(config.url),
        {
          requestInit: {
            headers: config.headers,
          },
          fetch: createMcpGuardedFetch((url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })),
        }
      );
    } else {
      // Streamable HTTP transport for remote MCP servers. Guarded fetch:
      // same-origin redirects only (SSRF protection, see guarded-fetch.ts).
      return new StreamableHTTPClientTransport(
        withoutUserinfo(config.url),
        {
          requestInit: {
            headers: config.headers,
          },
          fetch: createMcpGuardedFetch((url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })),
        }
      );
    }
  }

  connect(options?: McpConnectOptions): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.closing) return Promise.reject(new Error('MCP client is closed'));
    if (this.connecting) return this.connecting;
    let budget: ReturnType<typeof operationBudget>;
    try { budget = operationBudget(options?.timeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS, this.controller.signal, options?.signal, 'MCP connection'); }
    catch (error) { return Promise.reject(error); }
    const work = Promise.resolve().then(async () => {
      budget.signal.throwIfAborted();
      this.transport = coalesceTransportClose(this.createTransport(budget.signal));
      // SSE start() can otherwise remain pending after EventSource.close().
      const start = this.transport.start.bind(this.transport);
      this.transport.start = () => {
        budget.signal.throwIfAborted();
        return abortable(start(), budget.signal, () => budget.signal.reason);
      };
      try {
        await abortable(this.client.connect(this.transport, { signal: budget.signal, timeout: budget.remaining() }), budget.signal, () => budget.signal.reason);
        budget.signal.throwIfAborted();
        try {
          await abortable(this.client.listTools(undefined, { signal: budget.signal, timeout: budget.remaining() }), budget.signal, () => budget.signal.reason);
        } catch (error) {
          if (budget.signal.aborted) throw budget.signal.reason;
          throw new Error(`MCP connection failed health check: ${this.safeError(error).message}`);
        }
        budget.signal.throwIfAborted();
        if (this.closing) throw new Error('MCP client is closed');
        this.connected = true;
      } catch (error) {
        const failure = this.safeError(budget.signal.aborted ? budget.signal.reason : error);
        await this.closeTransport().catch(() => {});
        throw failure;
      }
    });
    this.connecting = work.finally(() => { budget.dispose(); this.connecting = undefined; });
    return this.connecting;
  }

  async listTools(options?: PoolCallToolOptions): Promise<Tool[]> {
    if (!this.connected) await this.connect(options);
    if (!options && this.listing) return this.listing;
    const work = this.client.listTools(undefined, {
      ...(options?.signal ? { signal: options.signal } : {}),
      timeout: options?.timeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    }).then(result => result.tools).catch(error => { throw this.safeError(error); });
    if (options) return work;
    this.listing = work.finally(() => { this.listing = undefined; });
    return this.listing;
  }

  /**
   * Returns server name/version reported during the MCP handshake.
   * Available after `connect()` resolves; undefined otherwise.
   */
  getServerInfo(): { name: string; version: string } | undefined {
    const info = this.connected ? this.client.getServerVersion() : undefined;
    if (!info) return undefined;
    return { name: info.name, version: info.version };
  }

  isConnected(): boolean {
    return this.connected;
  }

  async callTool(name: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<unknown> {
    if (!this.connected) {
      await this.connect({ signal: options?.signal });
    }

    try {
      return await this.client.callTool({ name, arguments: args }, undefined, {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      });
    } catch (error) { throw this.safeError(error); }
  }

  async close(): Promise<void> {
    if (this.closingTask) return this.closingTask;
    this.closing = true;
    this.connected = false;
    this.controller.abort();
    this.closingTask = this.closeTransport();
    return this.closingTask;
  }

  private closeTransport(): Promise<void> {
    if (this.cleanup) return this.cleanup;
    this.cleanup = (async () => {
      try {
        await this.client.close();
      } finally {
        // Also close failed starts that never reached a connected health check.
        await this.transport.close();
      }
    })().finally(() => { this.cleanup = undefined; });
    return this.cleanup;
  }
}

interface SharedQdrantConnection {
  key: string;
  storagePath: string;
  connection: McpConnection;
  references: number;
  closing?: Promise<void>;
}

// Qdrant's embedded database allows one process owner per storage directory.
// Key the registry by the directory too, so changed configs cannot start a
// second owner while a session or startup probe still holds a lease.
const sharedQdrantConnections = new Map<string, SharedQdrantConnection>();

function normalizedStoragePath(config: StdioMcpClientConfig): string {
  let path = resolve(config.cwd ?? process.cwd(), config.env!.QDRANT_LOCAL_PATH!);
  let ancestor = path;
  const missing: string[] = [];
  for (;;) {
    try {
      path = resolve(realpathSync.native(ancestor), ...missing);
      break;
    } catch {
      // Resolve symlinked parents even before Qdrant creates the DB directory.
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function qdrantConfigKey(config: StdioMcpClientConfig): string {
  return JSON.stringify([config.command, config.args ?? [], config.cwd,
    Object.entries(config.env ?? {}).sort(([left], [right]) => left.localeCompare(right))]);
}

async function acquireQdrantConnection(
  config: StdioMcpClientConfig,
  signal: AbortSignal,
  acquired: (entry: SharedQdrantConnection) => void,
): Promise<void> {
  const storagePath = normalizedStoragePath(config);
  const effectiveConfig = { ...config, env: { ...config.env, QDRANT_LOCAL_PATH: storagePath } };
  const key = qdrantConfigKey(effectiveConfig);
  for (;;) {
    if (signal.aborted) throw new Error('MCP client is closed');
    const existing = sharedQdrantConnections.get(storagePath);
    if (existing?.closing) {
      await abortable(existing.closing, signal);
      continue;
    }
    if (existing) {
      if (existing.key !== key) throw new Error('Managed local Qdrant storage is already in use with a different configuration');
      existing.references++;
      acquired(existing);
      return;
    }
    const entry: SharedQdrantConnection = {
      key, storagePath, connection: new McpConnection(effectiveConfig), references: 1,
    };
    sharedQdrantConnections.set(storagePath, entry);
    acquired(entry);
    return;
  }
}

async function releaseQdrantConnection(entry: SharedQdrantConnection): Promise<void> {
  entry.references--;
  if (entry.references > 0) return;
  entry.closing = entry.connection.close().finally(() => {
    if (sharedQdrantConnections.get(entry.storagePath) === entry) sharedQdrantConnections.delete(entry.storagePath);
  });
  await entry.closing;
}

export class CraftMcpClient {
  private connection: McpConnection;
  private readonly config: McpClientConfig;
  private readonly inheritedEnv: Record<string, string>;
  private readonly controller = new AbortController();
  private resolvedStdio = false;
  private shared?: SharedQdrantConnection;
  private connecting?: Promise<void>;
  private closingTask?: Promise<void>;

  // Preserve the diagnostic/test seams for inspecting the actual transport.
  private get client(): Client { return this.connection.client; }
  private get transport(): Transport { return this.connection.transport; }

  constructor(config: McpClientConfig) {
    this.config = structuredClone(config);
    this.inheritedEnv = inheritedEnvironment();
    this.connection = new McpConnection(config.transport === 'stdio'
      ? { ...this.config as StdioMcpClientConfig, env: mergeMcpStdioEnvironment(this.inheritedEnv, config.env) }
      : this.config);
  }

  connect(options?: McpConnectOptions): Promise<void> {
    if (this.controller.signal.aborted) return Promise.reject(new Error('MCP client is closed'));
    if (options?.signal?.aborted) return Promise.reject(new Error('MCP connection cancelled'));
    if (this.isConnected()) return Promise.resolve();
    if (this.connecting) return this.connecting;
    let budget: ReturnType<typeof operationBudget>;
    try { budget = operationBudget(options?.timeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS, this.controller.signal, options?.signal, 'MCP connection'); }
    catch (error) { return Promise.reject(error); }
    const work = Promise.resolve().then(async () => {
      budget.signal.throwIfAborted();
      if (this.config.transport === 'stdio' && !this.resolvedStdio) {
        const config = this.config;
        const inheritedEnv = await withToolchainPathPrefix(this.inheritedEnv);
        let command = config.command;
        // Explicit paths and source-specific PATH values remain user choices.
        if (/^(?:npx|bun|uvx)$/.test(command) && !Object.keys(config.env ?? {}).some(key => process.platform === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH')) {
          command = await getToolchain().resolver.findExecutable(command).catch(() => null) ?? command;
        }
        if (this.controller.signal.aborted) throw new Error('MCP client is closed');
        const env = mergeMcpStdioEnvironment(inheritedEnv, config.env);
        if (isManagedLocalQdrantConfig(config)) {
          // The official server considers even empty remote settings present.
          // An explicit embedded config must omit them, including unrelated
          // ambient credentials intended for another remote Qdrant instance.
          delete env.QDRANT_URL;
          delete env.QDRANT_API_KEY;
          // SessionManager updates this ambient value for individual chats;
          // the shared database process belongs to its source, not one chat.
          if (config.env?.CRAFT_SESSION_DIR === undefined) delete env.CRAFT_SESSION_DIR;
        } else if (isOfficialQdrantLaunch(config) && config.env?.QDRANT_URL?.trim()
          && !config.env?.QDRANT_LOCAL_PATH?.trim()) {
          // An explicit remote connection must not inherit a local database
          // path intended for a separate source. Explicitly mixed settings
          // remain intact so configuration validation can report the error.
          delete env.QDRANT_LOCAL_PATH;
        }
        const effectiveConfig: StdioMcpClientConfig = {
          ...config, command, env, cwd: resolve(config.cwd ?? process.cwd()),
        };
        if (isManagedLocalQdrantConfig(effectiveConfig)) {
          await acquireQdrantConnection(effectiveConfig, this.controller.signal, shared => {
            // Publish the lease in the same turn that increments its count,
            // so close() can always release it even during preparation.
            this.shared = shared;
            this.connection = shared.connection;
          });
        } else {
          this.connection = new McpConnection(effectiveConfig);
        }
        this.resolvedStdio = true;
      }
      if (this.controller.signal.aborted) throw new Error('MCP client is closed');
      await this.connection.connect(this.shared ? undefined : { signal: budget.signal });
      if (this.controller.signal.aborted) throw new Error('MCP client is closed');
    });
    this.connecting = abortable(work, budget.signal, () => budget.signal.reason)
      .catch(async error => {
        if (budget.signal.aborted) {
          const failure = budget.signal.reason;
          await this.close().catch(() => {});
          throw failure;
        }
        throw error;
      }).finally(() => { budget.dispose(); this.connecting = undefined; });
    return this.connecting;
  }

  async listTools(options?: PoolCallToolOptions): Promise<Tool[]> {
    const budget = operationBudget(options?.timeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS, this.controller.signal, options?.signal, 'MCP tools/list');
    try {
      await abortable(this.connect({ signal: budget.signal, timeoutMs: budget.remaining() }), budget.signal, () => budget.signal.reason);
      budget.signal.throwIfAborted();
      // A shared physical request must not be cancelled by one lease's budget.
      return await abortable(this.connection.listTools(this.shared ? undefined : { signal: budget.signal, timeoutMs: budget.remaining() }), budget.signal, () => budget.signal.reason);
    } finally { budget.dispose(); }
  }

  getServerInfo(): { name: string; version: string } | undefined {
    return this.isConnected() ? this.connection.getServerInfo() : undefined;
  }

  isConnected(): boolean {
    return !this.controller.signal.aborted && this.connection.isConnected();
  }

  async callTool(name: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<unknown> {
    const signal = options?.signal
      ? AbortSignal.any([this.controller.signal, options.signal])
      : this.controller.signal;
    signal.throwIfAborted();
    await abortable(this.connect(), signal, () => signal.reason);
    signal.throwIfAborted();
    // Cancel this lease's request through MCP without closing the connection
    // used by other leases. A caller's explicit cancellation has the same scope.
    return abortable(this.connection.callTool(name, args, { ...options, signal }), signal, () => signal.reason);
  }

  close(): Promise<void> {
    if (this.closingTask) return this.closingTask;
    this.controller.abort();
    this.closingTask = this.shared ? releaseQdrantConnection(this.shared) : this.connection.close();
    return this.closingTask;
  }
}
