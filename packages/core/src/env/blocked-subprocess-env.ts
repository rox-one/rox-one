/**
 * Single subprocess env blocklist (inventory 6.4).
 *
 * MCP stdio spawn (`packages/shared/src/mcp/client.ts`) and script-sandbox
 * sanitization (`packages/session-tools-core/src/runtime/sandbox-env.ts`)
 * must import this module. Do not copy the arrays — drift already let
 * ROX_SECRET_* / INFISICAL_TOKEN through one path.
 *
 * This is not ENV_OVERRIDE_DENY (config setter denylist for PATH / LD_PRELOAD).
 * That list answers "what may a user inject"; this one answers "what must
 * never be inherited by a child process".
 */

export const BLOCKED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'STRIPE_SECRET_KEY',
  'NPM_TOKEN',
  'INFISICAL_TOKEN',
] as const

export const BLOCKED_ENV_VAR_PREFIXES = ['ROX_SECRET_'] as const

export type BlockedEnvVar = (typeof BLOCKED_ENV_VARS)[number]
export type BlockedEnvVarPrefix = (typeof BLOCKED_ENV_VAR_PREFIXES)[number]

export function isBlockedEnvVar(key: string): boolean {
  return (
    (BLOCKED_ENV_VARS as readonly string[]).includes(key) ||
    BLOCKED_ENV_VAR_PREFIXES.some((prefix) => key.startsWith(prefix))
  )
}
