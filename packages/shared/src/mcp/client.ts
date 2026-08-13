/**
 * MCP client using official @modelcontextprotocol/sdk
 * Supports HTTP (Streamable HTTP), legacy SSE, and stdio transports for
 * remote and local MCP servers
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { isBlockedEnvVar } from '@craft-agent/core/env';
import { createMcpGuardedFetch } from './guarded-fetch.ts';

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
 * Interface for clients managed by McpClientPool.
 * Both CraftMcpClient (remote MCP sources) and ApiSourcePoolClient (API sources) implement this.
 */
export interface PoolClient {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export class CraftMcpClient {
  private client: Client;
  private transport: Transport;
  private connected = false;

  constructor(config: McpClientConfig) {
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
          fetch: createMcpGuardedFetch(),
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
          fetch: createMcpGuardedFetch(),
        }
      );
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await this.client.connect(this.transport);

    // Verify connection works by listing tools
    try {
      await this.client.listTools();
    } catch (error) {
      await this.client.close();
      throw new Error(
        `MCP connection failed health check: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.connected = true;
  }

  async listTools(): Promise<Tool[]> {
    if (!this.connected) {
      await this.connect();
    }

    const result = await this.client.listTools();
    return result.tools;
  }

  /**
   * Returns server name/version reported during the MCP handshake.
   * Available after `connect()` resolves; undefined otherwise.
   */
  getServerInfo(): { name: string; version: string } | undefined {
    const info = this.client.getServerVersion();
    if (!info) return undefined;
    return { name: info.name, version: info.version };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      await this.connect();
    }

    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }
}
