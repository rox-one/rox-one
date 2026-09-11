/**
 * Fail-closed permission shadow reviewer (H3).
 *
 * Recommends allow/deny from JSON rules. It never executes the decision —
 * the chat UI remains the only source of Allow/Deny.
 */

export interface PermissionShadowRules {
  enabled: boolean
  timeoutMs: number
  denyPatterns: readonly string[]
  allowPatterns: readonly string[]
}

export type PermissionShadowVerdict = 'allow' | 'deny' | 'timeout' | 'unverified'

export interface PermissionShadowReview {
  verdict: PermissionShadowVerdict
  reason: 'disabled' | 'timeout' | 'deny-pattern' | 'allow-pattern' | 'fail-closed'
}

export const DEFAULT_PERMISSION_SHADOW_RULES: PermissionShadowRules = {
  enabled: false,
  timeoutMs: 4000,
  denyPatterns: [],
  allowPatterns: [],
}

function matchesAny(haystack: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (!pattern) continue
    try {
      if (new RegExp(pattern, 'i').test(haystack)) return true
    } catch {
      if (haystack.toLowerCase().includes(pattern.toLowerCase())) return true
    }
  }
  return false
}

export function reviewPermissionShadow(input: {
  toolName: string
  command?: string
  rules?: PermissionShadowRules
  elapsedMs?: number
}): PermissionShadowReview {
  const rules = input.rules ?? DEFAULT_PERMISSION_SHADOW_RULES
  if (!rules.enabled) {
    return { verdict: 'unverified', reason: 'disabled' }
  }
  if ((input.elapsedMs ?? 0) >= rules.timeoutMs) {
    return { verdict: 'timeout', reason: 'timeout' }
  }
  const haystack = `${input.toolName}\n${input.command ?? ''}`
  if (matchesAny(haystack, rules.denyPatterns)) {
    return { verdict: 'deny', reason: 'deny-pattern' }
  }
  if (matchesAny(haystack, rules.allowPatterns)) {
    return { verdict: 'allow', reason: 'allow-pattern' }
  }
  return { verdict: 'deny', reason: 'fail-closed' }
}
