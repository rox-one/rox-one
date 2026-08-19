/**
 * Single builder for MCP proxy tool names (inventory 6.5).
 *
 * The name is an opaque exact-match key in McpClientPool.proxyTools.
 * Build (registerClient), emit (getProxyToolDefs), Pi registration,
 * pool-server restore, event-adapter reconstruction, and pool.callTool
 * must all use this module or the dispatch key drifts (#864, regression
 * of #498).
 *
 * Characters outside [A-Za-z0-9_-] become `_` so OpenAI/Codex accept the
 * name. Post-sanitization collisions take `_2`, `_3`, … when `usedNames`
 * is passed (registerClient). Callers that only reconstruct a name
 * (event adapter, pool-server prefix restore) omit `usedNames`.
 */

export const MCP_PROXY_NAME_PREFIX = 'mcp__' as const
export const LLM_TOOL_NAME_MAX_LENGTH = 128
export const LLM_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function sanitizeToolNamePart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, '_')
  return sanitized.length > 0 ? sanitized : 'tool'
}

function truncateWithSuffix(base: string, suffix: string): string {
  return `${base.slice(0, LLM_TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`
}

/** `mcp__{safeSlug}__` — prefix used to strip back to the source-local name. */
export function proxyToolNamePrefix(slug: string): string {
  return `${MCP_PROXY_NAME_PREFIX}${sanitizeToolNamePart(slug)}__`
}

/**
 * Build the LLM-facing proxy name `mcp__{slug}__{name}`.
 * When `usedNames` is provided, post-sanitization collisions get `_2`, `_3`, …
 */
export function proxyToolName(
  slug: string,
  name: string,
  usedNames?: Set<string>,
): string {
  let baseName = `${proxyToolNamePrefix(slug)}${sanitizeToolNamePart(name)}`
  if (baseName.length > LLM_TOOL_NAME_MAX_LENGTH) {
    baseName = baseName.slice(0, LLM_TOOL_NAME_MAX_LENGTH)
  }

  if (!usedNames) {
    return baseName
  }

  let candidate = baseName
  let counter = 2
  while (usedNames.has(candidate) || !LLM_TOOL_NAME_PATTERN.test(candidate)) {
    const suffix = `_${counter}`
    candidate = truncateWithSuffix(baseName, suffix)
    counter++
  }

  return candidate
}

export function stripMcpProxyPrefix(name: string): string {
  return name.startsWith(MCP_PROXY_NAME_PREFIX)
    ? name.slice(MCP_PROXY_NAME_PREFIX.length)
    : name
}

export function restoreMcpProxyPrefix(name: string): string {
  return name.startsWith(MCP_PROXY_NAME_PREFIX)
    ? name
    : `${MCP_PROXY_NAME_PREFIX}${name}`
}
