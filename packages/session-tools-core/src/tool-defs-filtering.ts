/**
 * MCP lens: classify host tools as essential vs non-essential.
 *
 * Session-scoped craft tools stay in the primary schema. MCP source-proxy
 * tools (`mcp__{slug}__*`) are non-essential. A third-party MCP whose slug
 * is `session` does not inherit host-tool privilege — only catalog names
 * under `mcp__session__` stay essential.
 *
 * Keep this suffix set aligned with SESSION_TOOL_DEFS names in tool-defs.ts
 * (verified by mcp-lens.test.ts) so this module stays zod-free for isolated tests.
 */

export type HostToolLoadMode = 'essential' | 'discoverable'

const SESSION_MCP_PREFIX = 'mcp__session__'

export const SESSION_MCP_ESSENTIAL_SUFFIXES = new Set([
  'SubmitPlan',
  'config_validate',
  'skill_validate',
  'mermaid_validate',
  'source_test',
  'source_oauth_trigger',
  'source_google_oauth_trigger',
  'source_slack_oauth_trigger',
  'source_microsoft_oauth_trigger',
  'source_credential_prompt',
  'update_user_preferences',
  'transform_data',
  'script_sandbox',
  'bash',
  'render_template',
  'send_developer_feedback',
  'call_llm',
  'spawn_session',
  'github_user',
  'browser_tool',
  'set_session_labels',
  'set_session_status',
  'archive_session',
  'create_task',
  'get_session_info',
  'list_sessions',
  'list_background_tasks',
  'send_agent_message',
  'agent_teams',
  'list_messaging_channels',
  'unbind_messaging_channel',
  'knowledge_search',
  'knowledge_read',
  'knowledge_get_backlinks',
  'list_pages',
  'get_page',
  'create_page',
  'update_page',
  'write_page_data',
  'delete_page',
])

export function isEssentialHostTool(name: string): boolean {
  if (name.startsWith(SESSION_MCP_PREFIX)) {
    return SESSION_MCP_ESSENTIAL_SUFFIXES.has(name.slice(SESSION_MCP_PREFIX.length))
  }
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
