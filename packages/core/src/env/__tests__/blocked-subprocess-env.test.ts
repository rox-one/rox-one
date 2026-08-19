/**
 * Inventory 6.4 — one subprocess env blocklist.
 *
 * MCP stdio spawn and script-sandbox sanitization used to copy the same
 * arrays. Drift already let ROX_SECRET_* / INFISICAL_TOKEN through one path.
 * Both consumers must import this module; local copies are a regression.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BLOCKED_ENV_VAR_PREFIXES,
  BLOCKED_ENV_VARS,
  isBlockedEnvVar,
} from '../blocked-subprocess-env.ts'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..')

describe('blocked-subprocess-env', () => {
  it('blocks exact credential keys and the ROX_SECRET_ prefix', () => {
    expect(isBlockedEnvVar('ANTHROPIC_API_KEY')).toBe(true)
    expect(isBlockedEnvVar('INFISICAL_TOKEN')).toBe(true)
    expect(isBlockedEnvVar('ROX_SECRET_DB_URL')).toBe(true)
    expect(isBlockedEnvVar('ROX_SECRETS')).toBe(false)
    expect(isBlockedEnvVar('MCP_PROBE_SAFE_VAR')).toBe(false)
    expect(BLOCKED_ENV_VARS).toContain('INFISICAL_TOKEN')
    expect(BLOCKED_ENV_VAR_PREFIXES).toContain('ROX_SECRET_')
  })

  it('MCP client and sandbox-env do not keep a local BLOCKED_ENV_VARS copy', () => {
    const client = readFileSync(
      join(REPO_ROOT, 'packages/shared/src/mcp/client.ts'),
      'utf8',
    )
    const sandbox = readFileSync(
      join(REPO_ROOT, 'packages/session-tools-core/src/runtime/sandbox-env.ts'),
      'utf8',
    )

    expect(client).not.toMatch(/const BLOCKED_ENV_VARS\s*=/)
    expect(sandbox).not.toMatch(/export const BLOCKED_ENV_VARS\s*=\s*\[/)
    expect(client).toMatch(/@craft-agent\/core\/env/)
    expect(sandbox).toMatch(/@craft-agent\/core\/env/)
  })
})
