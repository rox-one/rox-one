import { createBashToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { runHostBash } from '@craft-agent/session-tools-core';

/**
 * Pi `bash` tool that executes through craft host-tool Bash (and craft-exec
 * when the native sidecar is up). Same name/schema as the SDK builtin so the
 * allowlist and permission hooks stay unchanged.
 */
export function createCraftBashToolDefinition(cwd: string): ToolDefinition<any, any> {
  const base = createBashToolDefinition(cwd);
  return {
    ...base,
    execute: async (_toolCallId, params) => {
      const command = typeof (params as { command?: unknown }).command === 'string'
        ? (params as { command: string }).command
        : '';
      const result = await runHostBash({ command, cwd });
      return {
        content: result.content,
        details: result.isError ? { isError: true } : {},
      };
    },
  };
}
