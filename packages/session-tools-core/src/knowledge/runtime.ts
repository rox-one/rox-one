/**
 * Knowledge Tool Runtime — the seam between the knowledge session tools
 * (knowledge_search / knowledge_read / knowledge_get_backlinks, K-10 §3.1 read
 * capabilities) and the knowledge subsystem that actually reaches a provider.
 *
 * This package is deliberately free of any knowledge-provider implementation:
 * the runtime is REGISTERED by the process that owns the knowledge RPC layer
 * (server-core `registerKnowledgeHandlers` registers an implementation closing
 * over its provider resolver). Agent backends (Claude in-process, Pi and OMP
 * main-process host tools) all execute session-tool handlers in that same
 * process, so one registration covers all three.
 *
 * In processes without the knowledge layer (e.g. the Codex session-mcp-server
 * subprocess), no runtime is registered and the handlers answer with a typed
 * CONNECTION_UNAVAILABLE error — never a hang, never a raw throw.
 */

import type {
  ContextMode,
  ContextPayload,
  KnowledgeNode,
  KnowledgeRef,
  SearchInput,
  SearchPage,
} from '@craft-agent/core/knowledge';

/** Context fetch mode for knowledge_read; 'none' returns only the node. */
export type KnowledgeReadContextMode = 'none' | ContextMode;

export interface KnowledgeReadResult {
  node: KnowledgeNode;
  /** Present iff contextMode was 'snapshot' | 'live-reference'. */
  context?: ContextPayload;
}

export type KnowledgeBacklink = ContextPayload['backlinks'][number];

/**
 * Provider-facing surface used by the knowledge tool handlers. Implementations
 * resolve the default connection when `connectionId` is omitted and map
 * failures onto typed KnowledgeError codes (CONNECTION_UNAVAILABLE when no
 * provider is reachable/configured).
 */
export interface KnowledgeToolRuntime {
  search(args: { connectionId?: string; input: SearchInput }): Promise<SearchPage>;
  read(args: {
    connectionId?: string;
    ref: KnowledgeRef;
    contextMode?: KnowledgeReadContextMode;
  }): Promise<KnowledgeReadResult>;
  getBacklinks(args: { connectionId?: string; ref: KnowledgeRef }): Promise<KnowledgeBacklink[]>;
  /**
   * The connection id a call WITHOUT an explicit connectionId resolves to
   * (first configured connection), or null when none exists. Handlers use it
   * so the provenance line names the real connection instead of a placeholder.
   */
  defaultConnectionId?(): string | null;
}

let registeredRuntime: KnowledgeToolRuntime | null = null;

/** Register the process-wide knowledge tool runtime. Last registration wins (server reload). */
export function registerKnowledgeToolRuntime(runtime: KnowledgeToolRuntime): void {
  registeredRuntime = runtime;
}

/** The registered runtime, or null when the knowledge layer is absent in this process. */
export function getKnowledgeToolRuntime(): KnowledgeToolRuntime | null {
  return registeredRuntime;
}

/** Test seam: drop the registration (afterEach) so suites don't leak into each other. */
export function clearKnowledgeToolRuntime(): void {
  registeredRuntime = null;
}
