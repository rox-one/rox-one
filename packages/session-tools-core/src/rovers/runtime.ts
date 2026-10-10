/**
 * Rovers tool runtime — the seam between the rovers_* session tools and the
 * read-only Rovers service catalog (catalog.json v1).
 *
 * The runtime IS a `@rox/rovers-core-lite` query view over the loaded catalog.
 * It is REGISTERED by the server-core rovers RPC layer
 * (`registerRoversHandlers`), which resolves the bundled catalog (or the
 * `ROX_ROVERS_CATALOG_PATH` dev override), validates it, and wires the same view
 * the `rovers:list` channel serves. Agent backends execute session-tool handlers
 * in that same process, so one registration covers all of them.
 *
 * In processes without the rovers RPC layer (e.g. the Codex session-mcp-server
 * subprocess), no runtime is registered and the handlers answer with a typed
 * ROVERS_UNAVAILABLE error — never a hang, never a raw throw.
 *
 * The view type is imported from `@rox/rovers-core-lite` (itself free of node
 * built-ins and `@rox/shared`), so this package keeps its dependency-free rule
 * for the shared runtime while the query logic stays in one place.
 */

import type { RoversCatalogQuery } from '@rox/rovers-core-lite';

let registeredQuery: RoversCatalogQuery | null = null;

/** Register the process-wide Rovers catalog view. Last registration wins (server reload). */
export function registerRoversToolRuntime(query: RoversCatalogQuery): void {
  registeredQuery = query;
}

/** The registered catalog view, or null when the rovers layer is absent in this process. */
export function getRoversToolRuntime(): RoversCatalogQuery | null {
  return registeredQuery;
}

/** Test seam: drop the registration (afterEach) so suites do not leak into each other. */
export function clearRoversToolRuntime(): void {
  registeredQuery = null;
}