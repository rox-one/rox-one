import type { FolderSourceConfig } from './types.ts';
import { applyBuiltinSourceAvailability, isManagedBuiltinSource } from './builtin-sources.ts';

/** Provider operations whose authenticated endpoints retrieve public web information. */
const READ_ENDPOINTS: Record<string, readonly string[]> = {
  exa: ['/search', '/contents', '/findSimilar'],
  firecrawl: ['/v2/scrape', '/v2/map'],
  brave: ['/res/v1/web/search'],
};

export function builtinReadOnlyToolSlug(toolName: string): string | undefined {
  const proxy = /^mcp__(exa|firecrawl|brave)__api_\1$/.exec(toolName);
  return proxy?.[1] ?? /^api_(exa|firecrawl|brave)$/.exec(toolName)?.[1];
}

/**
 * Never trust a tool label or an upstream MCP readOnlyHint alone. This allowance
 * requires the enabled managed provider, its pinned API origin and auth shape,
 * live availability, and a specific read operation. E2B is deliberately excluded.
 */
export function isBuiltinReadOnlyToolCall(
  config: FolderSourceConfig,
  toolName: string,
  input: unknown,
): boolean {
  if (builtinReadOnlyToolSlug(toolName) !== config.slug || !config.enabled || !isManagedBuiltinSource(config)) return false;
  const available = applyBuiltinSourceAvailability(config);
  if (!available.isAuthenticated || ['failed', 'needs_auth', 'local_disabled'].includes(available.connectionStatus ?? '')) return false;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const args = input as Record<string, unknown>;
  const method = config.slug === 'brave' ? 'GET' : 'POST';
  if (args.method !== method || typeof args.path !== 'string') return false;
  // Absolute, encoded or normalizable paths must not borrow the safe endpoint's policy.
  const path = config.slug === 'brave' ? args.path.split('?')[0] : args.path;
  if (!READ_ENDPOINTS[config.slug]?.includes(path!)) return false;
  if (config.slug === 'firecrawl' && args.params && typeof args.params === 'object') {
    // Firecrawl browser actions can type/click/execute script and submit forms.
    // A scrape with actions is not the same operation as retrieving a page.
    const params = args.params as Record<string, unknown>;
    if (Object.hasOwn(params, 'actions') || Object.hasOwn(params, '_rawBody')) return false;
  }
  return true;
}
