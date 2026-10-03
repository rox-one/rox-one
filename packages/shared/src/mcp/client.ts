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
import { isBlockedEnvVar } from '@craft-agent/core/env';
import { createMcpGuardedFetch, McpRedirectError } from './guarded-fetch.ts';
import { isSensitiveKeyName, REDACTED_VALUE } from '../utils/redaction.ts';

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

/** One wall-clock budget, including transport startup and the tools health check. */
export interface McpConnectOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

/** Unlike SDK request cancellation, this also settles a pending transport.start(). */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * Interface for clients managed by McpClientPool.
 * Both CraftMcpClient (remote MCP sources) and ApiSourcePoolClient (API sources) implement this.
 */
export interface PoolClient {
  /** True after terminal transport closure. Optional for in-process API clients. */
  readonly isClosed?: boolean;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<unknown>;
  close(): Promise<void>;
}

export class CraftMcpClient {
  private client: Client;
  private transport: Transport;
  private connected = false;
  private connecting?: Promise<void>;
  private closing?: Promise<void>;
  private transportClosing?: Promise<void>;
  private closed = false;
  private readonly lifetime = new AbortController();
  private readonly secrets: string[] = [];

  /** Exposes the existing EOF/close state without probing or restarting a transport. */
  get isClosed(): boolean {
    return this.closed;
  }

  constructor(config: McpClientConfig) {
    if (config.transport === 'stdio') {
      this.secrets = Object.entries(config.env ?? {})
        .filter(([key]) => isSensitiveKeyName(key)).map(([, value]) => value).filter(Boolean);
    } else {
      const url = new URL(config.url);
      this.secrets = [url.username, url.password, ...url.searchParams.values(), url.hash.slice(1),
        ...Object.values(config.headers ?? {}).flatMap(value => [value, value.replace(/^(?:Bearer|Basic)\s+/i, '')])].filter(Boolean);
      for (const value of [url.username, url.password].filter(Boolean)) {
        try { this.secrets.push(decodeURIComponent(value)); } catch { /* Keep malformed escapes verbatim. */ }
      }
    }
    this.client = new Client({
      name: 'craft-agent',
      version: '1.0.0',
    });

    // Create transport based on config type
    if (config.transport === 'stdio') {
      // Stdio transport for local MCP servers - merge with process env,
      // but filter out sensitive credentials to prevent leaking secrets to subprocesses
      const processEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !isBlockedEnvVar(key)) {
          processEnv[key] = value;
        }
      }
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...processEnv, ...config.env },
        cwd: config.cwd,
      });
    } else if (config.transport === 'sse') {
      // Legacy SSE transport for remote MCP servers. The SDK applies
      // requestInit.headers to BOTH the SSE handshake GET and the message
      // POSTs (see SSEClientTransport._commonHeaders), so auth/custom
      // headers behave the same as on the HTTP transport. The guarded fetch
      // covers both paths (handshake via the eventsource fetch passthrough,
      // POSTs via transport fetch) — SSRF: no cross-origin redirect follows.
      this.transport = new SSEClientTransport(
        withoutUserinfo(config.url),
        {
          requestInit: {
            headers: config.headers,
          },
          fetch: this.guardedFetch(),
        }
      );
    } else {
      // Streamable HTTP transport for remote MCP servers. Guarded fetch:
      // same-origin redirects only (SSRF protection, see guarded-fetch.ts).
      this.transport = new StreamableHTTPClientTransport(
        withoutUserinfo(config.url),
        {
          requestInit: {
            headers: config.headers,
          },
          fetch: this.guardedFetch(),
        }
      );
    }

    // SDK connect() doesn't pass its signal to start(). SSE close() alone does
    // not reject start() when the server never sends an endpoint event.
    const start = this.transport.start.bind(this.transport);
    this.transport.start = () => {
      this.lifetime.signal.throwIfAborted();
      return abortable(start(), this.lifetime.signal);
    };
    // The SDK closes fire-and-forget after initialize failures. Retain that
    // exact cleanup promise so our failure/close path can await child teardown.
    const close = this.transport.close.bind(this.transport);
    this.transport.close = () => this.transportClosing ??= Promise.resolve().then(close);
    this.client.onclose = () => {
      this.connected = false;
      this.closed = true;
    };
  }

  private guardedFetch() {
    return createMcpGuardedFetch((url, init) => fetch(url, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, this.lifetime.signal])
        : this.lifetime.signal,
    }));
  }

  private safeError(error: unknown): Error {
    let message = error instanceof Error ? error.message : String(error);
    // SDK transport errors may echo response bodies, including server-supplied
    // URLs and configured credentials. Never retain the raw error as a cause.
    message = message.replace(/https?:\/\/[^\s<>"']+/gi, url => formatMcpUrlForLog(url.replace(/[),.;]+$/, '')));
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) {
      message = message.split(secret).join(REDACTED_VALUE);
    }
    if (error instanceof StreamableHTTPError) {
      return new StreamableHTTPError(error.code, message.replace(/^Streamable HTTP error: /, ''));
    }
    if (error instanceof McpRedirectError) {
      return new McpRedirectError(message, formatMcpUrlForLog(error.redirectUrl));
    }
    return new Error(message);
  }

  connect(options?: McpConnectOptions): Promise<void> {
    if (this.closed) return Promise.reject(new Error('MCP client is closed'));
    if (this.connected) return Promise.resolve();
    if (options?.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      return Promise.reject(new Error('Invalid MCP connection timeout'));
    }
    // The first caller owns the shared attempt's deadline/cancellation.
    return this.connecting ??= this.connectOnce(options);
  }

  private async connectOnce(options?: McpConnectOptions): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
    const cancel = () => this.lifetime.abort(new Error('MCP connection cancelled'));
    options?.signal?.addEventListener('abort', cancel, { once: true });
    if (options?.signal?.aborted) cancel();
    const timer = setTimeout(() => this.lifetime.abort(new Error(`MCP connection timed out after ${timeoutMs}ms`)), timeoutMs);
    const signal = this.lifetime.signal;
    let healthCheck = false;
    try {
      signal.throwIfAborted();
      await abortable((async () => {
        await this.client.connect(this.transport, { signal, timeout: timeoutMs });
        signal.throwIfAborted();
        healthCheck = true;
        await this.client.listTools(undefined, { signal, timeout: timeoutMs });
      })(), signal);
      signal.throwIfAborted();
      if (this.closed) throw new Error('MCP connection closed');
      this.connected = true;
    } catch (error) {
      const cancelled = signal.aborted;
      const failure = this.safeError(signal.aborted ? signal.reason : error);
      await this.close().catch(() => {});
      if (healthCheck && !cancelled) {
        throw new Error(`MCP connection failed health check: ${failure.message}`);
      }
      throw failure;
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', cancel);
    }
  }

  async listTools(options?: PoolCallToolOptions): Promise<Tool[]> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid MCP tools/list timeout');
    const deadline = Date.now() + timeoutMs;
    if (!this.connected) {
      await this.connect(options);
    }

    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`MCP tools/list timed out after ${timeoutMs}ms`);
      const result = await this.client.listTools(undefined, {
        signal: options?.signal,
        timeout: remaining,
      });
      return result.tools;
    } catch (error) {
      throw this.safeError(error);
    }
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

  async callTool(name: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<unknown> {
    if (!this.connected) {
      await this.connect({ signal: options?.signal });
    }

    try {
      return await this.client.callTool({ name, arguments: args }, undefined, {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      });
    } catch (error) {
      throw this.safeError(error);
    }
  }

  close(): Promise<void> {
    this.closed = true;
    this.connected = false;
    this.lifetime.abort(new Error('MCP client is closed'));
    // Do not await connecting: its failure path itself awaits close(). Always
    // close the transport, even before initialization/health check completed.
    return this.closing ??= (async () => {
      try {
        await this.client.close();
      } finally {
        await this.transport.close();
      }
    })();
  }
}
