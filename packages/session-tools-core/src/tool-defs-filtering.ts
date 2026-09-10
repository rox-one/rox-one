/**
 * MCP lens: classify host tools as essential vs non-essential.
 *
 * Session-scoped craft tools stay in the primary schema. MCP source-proxy
 * tools (`mcp__{slug}__*`, not `mcp__session__*`) are non-essential and can
 * be hidden from the advertised set when the lens is on.
 */

export type HostToolLoadMode = 'essential' | 'discoverable'

export function isEssentialHostTool(name: string): boolean {
  if (name.startsWith('mcp__session__')) return true
  if (name.startsWith('mcp__')) return false
  return true
}

export function hostToolLoadMode(name: string): HostToolLoadMode {
  return isEssentialHostTool(name) ? 'essential' : 'discoverable'
}

export function applyMcpLens<T extends { name: string }>(
  tools: readonly T[],
  enabled: boolean,
): { visible: T[]; hidden: T[] } {
  if (!enabled) {
    return { visible: [...tools], hidden: [] }
  }
  const visible: T[] = []
  const hidden: T[] = []
  for (const tool of tools) {
    if (isEssentialHostTool(tool.name)) visible.push(tool)
    else hidden.push(tool)
  }
  return { visible, hidden }
}
