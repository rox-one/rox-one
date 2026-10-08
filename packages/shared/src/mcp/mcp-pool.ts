/**
 * Centralized MCP Client Pool
 *
 * Owns all MCP source connections in the main Electron process.
 * All backends (Claude, Pi) receive proxy tool definitions
 * and route tool calls through this pool instead of managing MCP connections
 * themselves.
 *
 * Benefits:
 * - One MCP code path for all backends
 * - Shared clients across sessions (e.g., same Linear connection)
 * - No credential cache files — main process has direct access
 * - Runtime source switching without session restart
 */

import { CraftMcpClient, DEFAULT_CONNECTION_TIMEOUT_MS, formatMcpUrlForLog, type McpClientConfig, type McpConnectOptions, type PoolCallToolOptions, type PoolClient } from './client.ts';
import { ApiSourcePoolClient } from './api-source-pool-client.ts';
import type { SdkMcpServerConfig } from '../agent/backend/types.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isLocalMcpEnabled } from '../workspaces/storage.ts';
import { guardLargeResult } from '../utils/large-response.ts';
import {
  saveBinaryResponse,
  detectExtensionFromMagic,
  sanitizeFilename,
} from '../utils/binary-detection.ts';
import { proxyToolName, proxyToolNamePrefix } from './proxy-tool-name.ts';

/**
 * Configuration for an in-process API source server.
 * Used by sync() to connect API sources alongside MCP sources.
 */
export interface ApiServerConfig {
  type: 'sdk';
  instance: McpServer;
}

/**
 * Proxy tool definition — the format passed to backends for registration.
 * Uses mcp__{slug}__{toolName} naming convention.
 */
export interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Result of an MCP tool call, matching the subprocess protocol format.
 */
export interface McpToolResult {
  content: string;
  isError: boolean;
  /** Source slug for error attribution (set on failure) */
  sourceSlug?: string;
}

/**
 * Convert SdkMcpServerConfig (used by backend types) to CraftMcpClient config.
 */
function sdkConfigToClientConfig(config: SdkMcpServerConfig): McpClientConfig | null {
  if (config.type === 'http' || config.type === 'sse') {
    return {
      // Keep the declared transport: coercing sse → http deterministically
      // fails against pure legacy SSE servers (they 405 plain JSON-RPC POSTs).
      transport: config.type,
      url: config.url,
      headers: config.headers,
    };
  }
  if (config.type === 'stdio') {
    return {
      transport: 'stdio',
      command: config.command,
      args: config.args,
      env: {
        ...Object.fromEntries((config.envVars ?? []).flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]])),
        ...config.env,
      },
      cwd: config.cwd,
    };
  }
  return null;
}

/**
 * Check if an MCP source's config has changed in a way that requires reconnection.
 * Compares endpoint/header changes, including API keys outside Authorization.
 * Local command/env changes also require a fresh subprocess.
 */
function mcpConfigChanged(oldConfig: SdkMcpServerConfig, newConfig: SdkMcpServerConfig): boolean {
  if (oldConfig.type !== newConfig.type) return true;
  const sortedEntries = (values?: Record<string, string>, lowerCaseKeys = false) =>
    Object.entries(values ?? {}).map(([key, value]) => [lowerCaseKeys ? key.toLowerCase() : key, value]).sort(([a], [b]) => a!.localeCompare(b!));

  if (
    (oldConfig.type === 'http' || oldConfig.type === 'sse') &&
    (newConfig.type === 'http' || newConfig.type === 'sse')
  ) {
    if (oldConfig.url !== newConfig.url) return true;
    if (JSON.stringify(sortedEntries(oldConfig.headers, true)) !== JSON.stringify(sortedEntries(newConfig.headers, true))) return true;
    if (oldConfig.bearerTokenEnvVar !== newConfig.bearerTokenEnvVar) return true;
  }

  if (oldConfig.type === 'stdio' && newConfig.type === 'stdio') {
    if (oldConfig.command !== newConfig.command) return true;
    if (JSON.stringify(oldConfig.args ?? []) !== JSON.stringify(newConfig.args ?? [])) return true;
    if (JSON.stringify(sortedEntries(oldConfig.env)) !== JSON.stringify(sortedEntries(newConfig.env))) return true;
    if (JSON.stringify([...(oldConfig.envVars ?? [])].sort()) !== JSON.stringify([...(newConfig.envVars ?? [])].sort())) return true;
    if (oldConfig.cwd !== newConfig.cwd) return true;
  }

  return false;
}

/** Retry connection setup only; a failed tool call may already have side effects. */
function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof StreamableHTTPError && [502, 503, 504].includes(error.code ?? 0)) return true;
  return /not connected|connection closed|connection reset|server unavailable|fetch failed|network|socket|econn(?:reset|refused)|epipe|etimedout|timed out|\b(?:502|503|504)\b/i.test(error.message);
}

function needsConnectionRecovery(error: unknown): boolean {
  // HTTP MCP uses 404 to invalidate a session after a server restart. A new
  // handshake can restore it, whereas retrying a missing endpoint cannot.
  return isConnectionFailure(error) || (error instanceof StreamableHTTPError && error.code === 404);
}

/** Cancel one caller's wait without abandoning recovery shared by other calls. */
function waitForRecovery(work: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return work;
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new Error('MCP tool call aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    work.then(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

interface PendingConnection {
  promise: Promise<void>;
  client?: PoolClient;
  cancelled: boolean;
}

export class McpClientPool {
  /** Active MCP clients keyed by source slug */
  private clients = new Map<string, PoolClient>();

  /** Configs used for active MCP connections (for change detection during sync) */
  protected activeConfigs = new Map<string, SdkMcpServerConfig>();

  /** Retain the desired config across outages, until the source is explicitly removed. */
  private desiredConfigs = new Map<string, SdkMcpServerConfig>();

  /** Coalesce simultaneous reconnects and let teardown cancel an in-flight handshake. */
  private connecting = new Map<string, PendingConnection>();
  private recovering = new Map<string, Promise<void>>();
  /** Serialize configuration changes and recovery for one source, independently of other sources. */
  private sourceOperations = new Map<string, Promise<void>>();
  private sourceGenerations = new Map<string, number>();
  private disconnectGeneration = 0;
  private syncGeneration = 0;

  /** Last known tool lists, retained during outages so later calls can reconnect. */
  private toolCache = new Map<string, Tool[]>();

  /** Proxy tool name → { slug, originalName } (e.g., "mcp__linear__createIssue" → { slug: "linear", originalName: "createIssue" }) */
  private proxyTools = new Map<string, { slug: string; originalName: string }>();

  /** Source slug → original tool name → safe proxy tool name */
  private sourceToolProxyNames = new Map<string, Map<string, string>>();

  /** Optional debug logger */
  private debugFn: ((msg: string) => void) | undefined;

  /** Workspace root path for local MCP filtering */
  private workspaceRootPath?: string;

  /** Session storage path for saving large responses */
  private sessionPath?: string;

  /** Summarize callback for large response handling */
  private summarizeCallback?: (prompt: string) => Promise<string | null>;

  /** Called after sync() connects/disconnects sources, so clients can be notified */
  onToolsChanged?: () => void;

  constructor(options?: { debug?: (msg: string) => void; workspaceRootPath?: string; sessionPath?: string }) {
    this.debugFn = options?.debug;
    this.workspaceRootPath = options?.workspaceRootPath;
    this.sessionPath = options?.sessionPath;
  }

  /**
   * Set the summarize callback for large response handling.
   * Typically called after agent creation: pool.setSummarizeCallback(agent.getSummarizeCallback())
   */
  setSummarizeCallback(fn: (prompt: string) => Promise<string | null>): void {
    this.summarizeCallback = fn;
  }

  private debug(msg: string): void {
    this.debugFn?.(`[McpClientPool] ${msg}`);
  }

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  /**
   * Register a client: connect, cache tools, build proxy mappings.
   * Shared logic for both remote MCP and in-process API sources.
   */
  protected async registerClient(slug: string, client: PoolClient, canRegister: () => boolean = () => true, options?: McpConnectOptions): Promise<void> {
    // listTools() triggers connect() internally for both CraftMcpClient and ApiSourcePoolClient
    let tools: Tool[];
    try {
      tools = await client.listTools(options);
      if (client.isConnected?.() === false) throw new Error(`MCP source "${slug}" closed during tool discovery`);
      if (!canRegister()) throw new Error(`MCP connection cancelled for source "${slug}"`);
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
    this.removeToolMappings(slug);
    this.clients.set(slug, client);
    this.toolCache.set(slug, tools);

    const usedProxyNames = new Set(this.proxyTools.keys());
    const sourceProxyNames = new Map<string, string>();
    for (const tool of tools) {
      const proxyName = proxyToolName(slug, tool.name, usedProxyNames);
      usedProxyNames.add(proxyName);
      sourceProxyNames.set(tool.name, proxyName);
      this.proxyTools.set(proxyName, { slug, originalName: tool.name });
    }
    this.sourceToolProxyNames.set(slug, sourceProxyNames);

    this.debug(`Connected source ${slug}: ${tools.length} tools`);
  }

  /** Factory seam keeps transport recovery tests independent of network/process mocks. */
  protected createClient(config: McpClientConfig): PoolClient {
    return new CraftMcpClient(config);
  }

  private runSourceOperation(
    slug: string,
    operation: (canContinue: () => boolean) => Promise<void>,
    cancellable = true,
  ): Promise<void> {
    const sourceGeneration = this.sourceGenerations.get(slug) ?? 0;
    const disconnectGeneration = this.disconnectGeneration;
    const canContinue = () => !cancellable || (
      sourceGeneration === (this.sourceGenerations.get(slug) ?? 0) &&
      disconnectGeneration === this.disconnectGeneration
    );
    const previous = this.sourceOperations.get(slug) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      if (!canContinue()) throw new Error(`MCP connection cancelled for source "${slug}"`);
      await operation(canContinue);
    }).finally(() => {
      if (this.sourceOperations.get(slug) === pending) this.sourceOperations.delete(slug);
    });
    this.sourceOperations.set(slug, pending);
    return pending;
  }

  /**
   * Connect to an MCP source server (remote HTTP/SSE/stdio).
   * If already connected, this is a no-op.
   */
  async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    const connectionConfig = structuredClone(config);
    this.desiredConfigs.set(slug, connectionConfig);
    return this.runSourceOperation(slug, () => this.connectSource(slug, connectionConfig));
  }

  /** Establish a connection within the source's serialized lifecycle operation. */
  protected async connectSource(slug: string, config: SdkMcpServerConfig): Promise<void> {
    const existing = this.connecting.get(slug);
    if (existing) return existing.promise;
    if (this.isConnected(slug)) return;
    const connectionConfig = structuredClone(config);
    const clientConfig = sdkConfigToClientConfig(connectionConfig);
    if (!clientConfig) {
      this.debug(`Unknown MCP server type for ${slug}: ${(config as { type: string }).type}`);
      return;
    }
    const pending: PendingConnection = { promise: Promise.resolve(), cancelled: false };
    pending.promise = Promise.resolve().then(async () => {
      await this.removeClient(slug, true);
      for (let attempt = 0; attempt < 2; attempt++) {
        if (pending.cancelled) throw new Error(`MCP connection cancelled for source "${slug}"`);
        pending.client = this.createClient(clientConfig);
        const deadline = Date.now() + DEFAULT_CONNECTION_TIMEOUT_MS;
        const remaining = (): number => {
          if (pending.cancelled) throw new Error(`MCP connection cancelled for source "${slug}"`);
          const milliseconds = deadline - Date.now();
          if (milliseconds <= 0) throw new Error(`MCP connection timed out after ${DEFAULT_CONNECTION_TIMEOUT_MS} ms`);
          return milliseconds;
        };
        let selectedConfig = clientConfig;
        let primaryError: unknown;
        let registrationStarted = false;
        let currentClientClosed = false;
        try {
          // Negotiate explicitly before discovery. Only an initialize rejection
          // can select legacy SSE; an initialized HTTP server never changes its
          // transport because a later health/discovery/tool request failed.
          if (clientConfig.transport === 'http' && pending.client.connect) {
            try {
              await pending.client.connect({ timeoutMs: remaining() });
            } catch (error) {
              await pending.client.close().catch(() => {});
              currentClientClosed = true;
              if (pending.cancelled) throw new Error(`MCP connection cancelled for source "${slug}"`);
              if (!(error instanceof StreamableHTTPError)
                || ![400, 404, 405].includes(error.code ?? 0)) throw error;
              primaryError = error;
              this.debug(`HTTP ${error.code} from ${formatMcpUrlForLog(clientConfig.url)}; trying legacy SSE for ${slug}`);
              remaining();
              selectedConfig = { ...clientConfig, transport: 'sse' };
              pending.client = this.createClient(selectedConfig);
              currentClientClosed = false;
              await pending.client.connect?.({ timeoutMs: remaining() });
            }
          }
          const discoveryOptions = { timeoutMs: remaining() };
          registrationStarted = true;
          await this.registerClient(slug, pending.client, () => !pending.cancelled, discoveryOptions);
          if (pending.cancelled) throw new Error(`MCP connection cancelled for source "${slug}"`);
          this.activeConfigs.set(slug, connectionConfig);
          return;
        } catch (error) {
          if (!registrationStarted && !currentClientClosed) await pending.client.close().catch(() => {});
          if (!pending.cancelled && attempt === 0 && isConnectionFailure(error)) {
            this.debug(`Retrying connection to MCP source ${slug}`);
            continue;
          }
          if (pending.cancelled) throw new Error(`MCP connection cancelled for source "${slug}"`);
          const context = this.connectionErrorContext(slug, selectedConfig, error);
          // Both client errors have already passed their configured credential
          // scrubber. Retain both safe contexts without a raw SDK cause object.
          const message = primaryError
            ? `${this.connectionErrorContext(slug, clientConfig, primaryError)}; legacy SSE fallback failed: ${context}`
            : context;
          // Retain the public HTTP status for callers that inspect the typed
          // error, while avoiding a raw SDK cause containing private headers.
          throw error instanceof StreamableHTTPError
            ? new StreamableHTTPError(error.code, message)
            : new Error(message);
        }
      }
    }).finally(() => {
      if (this.connecting.get(slug) === pending) this.connecting.delete(slug);
    });
    this.connecting.set(slug, pending);
    return pending.promise;
  }

  private connectionErrorContext(slug: string, config: McpClientConfig, error: unknown): string {
    const endpoint = config.transport === 'stdio' ? config.command : formatMcpUrlForLog(config.url);
    const status = error instanceof StreamableHTTPError && error.code !== undefined ? `, HTTP ${error.code}` : '';
    return `MCP source ${slug} (${config.transport}: ${endpoint}${status}) failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  /**
   * Connect to an in-process MCP server (API source) via in-memory transport.
   */
  async connectInProcess(slug: string, mcpServer: McpServer): Promise<void> {
    return this.runSourceOperation(slug, async canContinue => {
      if (this.clients.has(slug)) return;
      const pending: PendingConnection = {
        promise: Promise.resolve(), cancelled: false, client: new ApiSourcePoolClient(mcpServer),
      };
      pending.promise = this.registerClient(slug, pending.client!, () => !pending.cancelled && canContinue());
      this.connecting.set(slug, pending);
      try {
        await pending.promise;
      } finally {
        if (this.connecting.get(slug) === pending) this.connecting.delete(slug);
      }
    });
  }

  /**
   * Ensure one source is connected with the given config, without touching
   * other pool members (unlike sync(), which reconciles the full set).
   * Reconnects when the config changed (e.g. refreshed OAuth token), and
   * applies the same local-MCP gate as sync(): stdio configs are refused
   * when local MCP is disabled for this workspace.
   *
   * @throws Error for stdio configs while local MCP is disabled, and on
   *   connection failure (propagated from connect()).
   */
  async ensureConnected(slug: string, config: SdkMcpServerConfig): Promise<void> {
    if (config.type === 'stdio' && this.workspaceRootPath && !isLocalMcpEnabled(this.workspaceRootPath)) {
      throw new Error(`Local MCP is disabled for this workspace — cannot connect stdio source "${slug}"`);
    }

    const connectionConfig = structuredClone(config);
    this.desiredConfigs.set(slug, connectionConfig);
    return this.runSourceOperation(slug, async canContinue => {
      if (this.clients.has(slug)) {
        const oldConfig = this.activeConfigs.get(slug);
        if (this.isConnected(slug) && (!oldConfig || !mcpConfigChanged(oldConfig, connectionConfig))) return;
        this.debug(`Reconnecting source ${slug} after a config change or transport disconnect`);
        await this.removeClient(slug, true);
      }
      if (!canContinue()) throw new Error(`MCP connection cancelled for source "${slug}"`);
      await this.connectSource(slug, connectionConfig);
    });
  }

  /**
   * Disconnect a source and remove its tools from the pool.
   */
  async disconnect(slug: string): Promise<void> {
    this.sourceGenerations.set(slug, (this.sourceGenerations.get(slug) ?? 0) + 1);
    this.desiredConfigs.delete(slug);
    this.removeToolMappings(slug);
    const pending = this.connecting.get(slug);
    if (pending) pending.cancelled = true;
    // Interrupt the handshake immediately; queued teardown then drains earlier
    // lifecycle operations without waiting on a recovery from inside itself.
    const closingPending = pending?.client?.close().catch(() => {});
    await this.runSourceOperation(slug, async () => {
      await closingPending;
      await this.removeClient(slug);
    }, false);
    this.debug(`Disconnected source: ${slug}`);
  }

  private removeToolMappings(slug: string): void {
    for (const [proxyName, info] of this.proxyTools) {
      if (info.slug === slug) this.proxyTools.delete(proxyName);
    }
    this.sourceToolProxyNames.delete(slug);
    this.toolCache.delete(slug);
  }

  protected async removeClient(slug: string, preserveTools = false): Promise<void> {
    const client = this.clients.get(slug);
    this.clients.delete(slug);
    if (!preserveTools) this.removeToolMappings(slug);
    this.activeConfigs.delete(slug);
    await client?.close().catch(() => {});
  }

  /**
   * Disconnect all sources and clear all state.
   */
  async disconnectAll(): Promise<void> {
    this.disconnectGeneration++;
    this.syncGeneration++;
    const slugs = new Set([...this.clients.keys(), ...this.connecting.keys(), ...this.recovering.keys(), ...this.sourceOperations.keys(), ...this.desiredConfigs.keys()]);
    await Promise.all(Array.from(slugs, slug => this.disconnect(slug)));
    this.debug('Disconnected all MCP clients');
  }

  // ============================================================
  // Sync: Reconcile active sources
  // ============================================================

  /**
   * Sync the pool to match a desired set of MCP + API sources.
   * Connects new sources, disconnects removed ones, keeps existing ones.
   *
   * @param mcpServers - Map of slug → config for desired MCP sources
   * @param apiServers - Map of slug → config for desired API sources
   * @returns List of slugs that failed to connect
   */
  async sync(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, ApiServerConfig> = {}
  ): Promise<string[]> {
    const syncGeneration = ++this.syncGeneration;
    // Filter out stdio sources when local MCP is disabled for this workspace.
    const localEnabled = !this.workspaceRootPath || isLocalMcpEnabled(this.workspaceRootPath);
    const filteredMcp: Record<string, SdkMcpServerConfig> = {};
    for (const [slug, config] of Object.entries(mcpServers)) {
      if (config.type === 'stdio' && !localEnabled) {
        this.debug(`Filtering out stdio source "${slug}" (local MCP disabled)`);
        continue;
      }
      filteredMcp[slug] = config;
    }

    // Extract McpServer instances from API configs
    const apiSlugs = new Map<string, McpServer>();
    for (const [slug, config] of Object.entries(apiServers)) {
      if (config?.type === 'sdk' && config.instance) {
        apiSlugs.set(slug, config.instance);
      }
    }

    const desiredSlugs = new Set([...Object.keys(filteredMcp), ...apiSlugs.keys()]);
    const currentSlugs = new Set([...this.clients.keys(), ...this.connecting.keys(), ...this.recovering.keys(), ...this.sourceOperations.keys(), ...this.desiredConfigs.keys()]);
    const failures: string[] = [];

    // Disconnect sources no longer desired
    await Promise.all(Array.from(currentSlugs).filter(slug => !desiredSlugs.has(slug)).map(slug => this.disconnect(slug)));
    // A newer reconciliation or teardown owns the desired set now.
    if (syncGeneration !== this.syncGeneration) return failures;

    // Independent sources connect together so an unavailable remote server
    // does not postpone every local server behind its handshake timeout.
    const connections = [
      ...Object.entries(filteredMcp).map(([slug, config]) => ({ slug, connect: () => this.ensureConnected(slug, config) })),
      ...Array.from(apiSlugs).filter(([slug]) => !filteredMcp[slug])
        .map(([slug, server]) => ({ slug, connect: () => this.connectInProcess(slug, server) })),
    ];
    const results = await Promise.allSettled(connections.map(connection => connection.connect()));
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        const slug = connections[index]!.slug;
        this.debug(`Failed to connect source ${slug}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        failures.push(slug);
      }
    }

    this.onToolsChanged?.();
    return failures;
  }

  // ============================================================
  // Tool Discovery
  // ============================================================

  /**
   * Get last known tools for a configured source, including during recovery.
   */
  getTools(slug: string): Tool[] {
    return this.isConnected(slug) ? this.toolCache.get(slug) || [] : [];
  }

  /**
   * Get all connected source slugs.
   */
  getConnectedSlugs(): string[] {
    return Array.from(this.clients.keys()).filter(slug => this.isConnected(slug));
  }

  /**
   * Check if a source is connected.
   */
  isConnected(slug: string): boolean {
    const client = this.clients.get(slug);
    return !!client && client.isConnected?.() !== false;
  }

  private async recoverClient(slug: string, failedClient?: PoolClient): Promise<void> {
    const existing = this.recovering.get(slug);
    if (existing) return existing;
    const config = this.desiredConfigs.get(slug) ?? this.activeConfigs.get(slug);
    if (!config) throw new Error(`MCP source "${slug}" has no reconnect configuration`);
    if (config.type === 'stdio' && this.workspaceRootPath && !isLocalMcpEnabled(this.workspaceRootPath)) {
      throw new Error(`Local MCP is disabled for this workspace — cannot reconnect stdio source "${slug}"`);
    }
    const recovery = this.runSourceOperation(slug, async canContinue => {
      const current = this.clients.get(slug);
      if (failedClient && current !== failedClient) return;
      if (!failedClient && current && current.isConnected?.() !== false) return;
      await this.removeClient(slug, true);
      if (!canContinue()) {
        throw new Error(`MCP reconnection cancelled for source "${slug}"`);
      }
      await this.connectSource(slug, config);
    }).finally(() => { this.onToolsChanged?.(); });
    this.recovering.set(slug, recovery);
    try {
      await recovery;
    } finally {
      if (this.recovering.get(slug) === recovery) this.recovering.delete(slug);
    }
  }

  /**
   * Resolve the LLM-facing proxy name for an original MCP tool name.
   */
  getProxyToolName(slug: string, originalName: string): string | null {
    return this.isConnected(slug) ? this.sourceToolProxyNames.get(slug)?.get(originalName) ?? null : null;
  }

  /**
   * Resolve the source-local safe tool name used by SDK MCP servers.
   */
  getProxyToolLocalName(slug: string, originalName: string): string | null {
    const proxyName = this.getProxyToolName(slug, originalName);
    if (!proxyName) return null;

    const prefix = proxyToolNamePrefix(slug);
    return proxyName.startsWith(prefix) ? proxyName.slice(prefix.length) : proxyName;
  }

  /**
   * Generate proxy definitions for known sources (or a subset), including retryable outages.
   * These are passed to backends for tool registration.
   */
  getProxyToolDefs(slugs?: string[]): ProxyToolDef[] {
    const targetSlugs = slugs || Array.from(this.toolCache.keys());
    const defs: ProxyToolDef[] = [];

    for (const slug of targetSlugs) {
      const tools = this.getTools(slug);
      for (const tool of tools) {
        const proxyName = this.getProxyToolName(slug, tool.name);
        if (!proxyName) continue;
        // Strip $schema — AJV (Pi agent) fails on unregistered meta-schema URIs.
        // Same pattern as getToolDefsAsJsonSchema() in tool-defs.ts.
        const { $schema, ...cleanSchema } = (tool.inputSchema as Record<string, unknown>) || {};
        defs.push({
          name: proxyName,
          description: tool.description || `Tool from ${slug}`,
          inputSchema: Object.keys(cleanSchema).length > 0 ? cleanSchema : { type: 'object', properties: {} },
        });
      }
    }

    return defs;
  }

  // ============================================================
  // Tool Execution
  // ============================================================

  /**
   * Execute an MCP tool by its proxy name (mcp__{slug}__{toolName}).
   * Returns a result matching the subprocess protocol format.
   */
  async callTool(proxyName: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<McpToolResult> {
    const info = this.proxyTools.get(proxyName);
    if (!info) {
      return {
        content: `Unknown MCP proxy tool: ${proxyName}`,
        isError: true,
      };
    }

    const { slug, originalName } = info;

    let client = this.clients.get(slug);
    if (!client && !this.desiredConfigs.has(slug)) {
      return {
        content: `MCP client for source "${slug}" is not connected.`,
        isError: true,
        sourceSlug: slug,
      };
    }

    try {
      options?.signal?.throwIfAborted();
      // A transport known to be closed has not received this call yet. It is
      // safe to reconnect and execute once on the replacement connection.
      if (!client || client.isConnected?.() === false) {
        await waitForRecovery(this.recoverClient(slug, client), options?.signal);
        client = this.clients.get(slug);
        if (!client || !this.getProxyToolName(slug, originalName)) {
          throw new Error(`MCP tool "${originalName}" is unavailable after reconnecting`);
        }
      }
      options?.signal?.throwIfAborted();
      const result = await client.callTool(originalName, args, options) as {
        content?: Array<{ type: string; text?: unknown; data?: string; mimeType?: string }>;
        isError?: boolean;
      };

      const contentBlocks = result.content || [];
      const parts: string[] = [];

      // 1. Process each content block — handle text, image, audio
      for (const block of contentBlocks) {
        if (block.type === 'text') {
          // Handle non-string text fields (e.g., objects from non-conforming servers)
          if (typeof block.text === 'string') {
            parts.push(block.text);
          } else if (block.text !== undefined && block.text !== null) {
            parts.push(JSON.stringify(block.text, null, 2));
          }
        } else if ((block.type === 'image' || block.type === 'audio') && block.data && this.sessionPath) {
          // Decode base64 binary content and save to downloads/
          try {
            const buffer = Buffer.from(block.data, 'base64');
            const ext = detectExtensionFromMagic(buffer) || '.bin';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const safeName = sanitizeFilename(proxyName);
            const filename = `${safeName}_${timestamp}${ext}`;
            const saved = saveBinaryResponse(this.sessionPath, filename, buffer, block.mimeType ?? null);
            if (saved.type === 'file_download') {
              parts.push(`[${block.type.charAt(0).toUpperCase() + block.type.slice(1)} saved: ${saved.path} (${saved.sizeHuman})]`);
            }
          } catch {
            // Base64 decode failed — skip this block
          }
        }
      }

      // 2. Combine parts (fallback to JSON.stringify if no content extracted)
      const text = parts.join('\n') || JSON.stringify(result);

      // 3. Centralized binary + large response handling
      if (!result.isError && this.sessionPath) {
        const guarded = await guardLargeResult(text, {
          sessionPath: this.sessionPath,
          toolName: proxyName,
          input: args,
          summarize: this.summarizeCallback,
        });
        if (guarded) {
          return { content: guarded, isError: false };
        }
      }

      return {
        content: text,
        isError: !!result.isError,
        ...(result.isError ? { sourceSlug: slug } : {}),
      };
    } catch (err) {
      // A request may have reached the server before the transport failed.
      // Restore the connection for subsequent calls without replaying it.
      if (client && this.clients.get(slug) === client && this.activeConfigs.has(slug) &&
          !options?.signal?.aborted && (client.isConnected?.() === false || needsConnectionRecovery(err))) {
        await waitForRecovery(this.recoverClient(slug, client), options?.signal).catch(recoveryError => {
          if (!options?.signal?.aborted) {
            this.debug(`Failed to recover MCP source ${slug}: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
          }
        });
      }
      return {
        content: `MCP tool "${originalName}" (source: ${slug}) failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
        sourceSlug: slug,
      };
    }
  }

  /**
   * Check if a tool name is an MCP proxy tool managed by this pool.
   */
  isProxyTool(toolName: string): boolean {
    return this.proxyTools.has(toolName);
  }
}
