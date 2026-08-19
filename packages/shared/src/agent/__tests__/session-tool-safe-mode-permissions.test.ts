/**
 * Regression tests for metadata-driven session tool safe-mode classification.
 */
import { describe, it, expect } from 'bun:test';
import { shouldAllowToolInMode } from '../../agent/mode-manager.ts';

describe('session tool safe-mode classification', () => {
  // send_developer_feedback intentionally omitted — it is feature-flagged via
  // FEATURE_FLAGS.developerFeedback (off by default outside dev runtimes), so
  // its safe-mode visibility depends on env state. The dedicated suite at
  // send-developer-feedback-permissions.test.ts owns that flag-aware behavior.
  it('allows read-only session tools in safe mode', () => {
    const allowedTools = [
      'mcp__session__call_llm',
      'mcp__session__browser_tool',
      'mcp__session__script_sandbox',
    ] as const;

    for (const toolName of allowedTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks mutating/auth session tools in safe mode', () => {
    const blockedTools = [
      'mcp__session__source_oauth_trigger',
      'mcp__session__source_credential_prompt',
      'mcp__session__spawn_session',
      'mcp__session__update_user_preferences',
    ] as const;

    for (const toolName of blockedTools) {
      const result = shouldAllowToolInMode(toolName, {}, 'safe');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('Session configuration changes are blocked in');
      }
    }
  });

  it('classifies host-tool bash with the same Explore command rules as Claude Bash', () => {
    const read = { command: 'ls' };
    const write = { command: 'echo x > /tmp/host-bash-write' };
    const canonicalRead = shouldAllowToolInMode('Bash', read, 'safe');
    const canonicalWrite = shouldAllowToolInMode('Bash', write, 'safe');

    expect(canonicalWrite.allowed).toBe(false);

    for (const toolName of ['bash', 'mcp__session__bash'] as const) {
      expect(shouldAllowToolInMode(toolName, read, 'safe')).toEqual(canonicalRead);
      expect(shouldAllowToolInMode(toolName, write, 'safe').allowed).toBe(false);
    }
  });
});
