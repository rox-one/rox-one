import { createBashToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { runHostBash } from '@craft-agent/session-tools-core';

/**
 * Pi `bash` tool that executes through craft host-tool Bash (and craft-exec
 * when the native sidecar is up). Same name/schema as the SDK builtin so the
 * allowlist and permission hooks stay unchanged.
 */
export function createCraftBashToolDefinition(cwd: string): ToolDefinition<any, any> {
  const base = createBashToolDefinition(cwd);
  // Дженерики ToolDefinition<any, any> стирают связь параметров execute с
  // базовым инструментом — приводим собранный объект явно.
  const definition = {
    ...base,
    execute: async (_toolCallId: string, params: unknown) => {
      const command =
        typeof params === 'object' && params !== null && 'command' in params && typeof params.command === 'string'
          ? params.command
          : '';
      const result = await runHostBash({ command, cwd, workspaceRoot: cwd });
      return {
        content: result.content,
        details: result.isError ? { isError: true } : {},
      };
    },
  };
  return definition as unknown as ToolDefinition<any, any>;
}
