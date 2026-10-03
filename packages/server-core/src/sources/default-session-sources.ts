import { getEnabledBuiltinMcpSourceSlugs } from '@craft-agent/shared/sources/builtin-mcp'

/** Select pending defaults too, so completing setup activates them in this chat. */
export function resolveDefaultSessionSources(
  workspaceRootPath: string,
  explicitSlugs?: readonly string[],
  workspaceDefaults?: readonly string[],
): string[] {
  if (explicitSlugs !== undefined) return [...explicitSlugs]
  if (workspaceDefaults !== undefined) return [...new Set(workspaceDefaults)]
  return getEnabledBuiltinMcpSourceSlugs(workspaceRootPath)
}
