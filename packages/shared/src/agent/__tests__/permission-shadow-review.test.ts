import { describe, expect, it } from 'bun:test'
import { reviewPermissionShadow, type PermissionShadowRules } from '../permission-shadow-review.ts'

const RULES: PermissionShadowRules = {
  enabled: true,
  timeoutMs: 1000,
  denyPatterns: ['rm\\s+-rf', '127\\.0\\.0\\.1'],
  allowPatterns: ['^Bash\\nls '],
}

describe('reviewPermissionShadow', () => {
  it('is unverified when disabled and fail-closed otherwise', () => {
    expect(reviewPermissionShadow({ toolName: 'Bash', command: 'ls src' }).verdict).toBe('unverified')
    expect(reviewPermissionShadow({
      toolName: 'Bash',
      command: 'rm -rf /',
      rules: RULES,
    }).verdict).toBe('deny')
    expect(reviewPermissionShadow({
      toolName: 'Bash',
      command: 'ls src',
      rules: RULES,
    }).verdict).toBe('allow')
    expect(reviewPermissionShadow({
      toolName: 'Bash',
      command: 'curl 127.0.0.1:8080',
      rules: RULES,
    }).verdict).toBe('deny')
    expect(reviewPermissionShadow({
      toolName: 'Write',
      command: 'notes.md',
      rules: RULES,
    })).toEqual({ verdict: 'deny', reason: 'fail-closed' })
  })

  it('times out to deny-recommendation without granting allow', () => {
    const review = reviewPermissionShadow({
      toolName: 'Bash',
      command: 'ls src',
      rules: RULES,
      elapsedMs: 1000,
    })
    expect(review.verdict).toBe('timeout')
    expect(review.verdict).not.toBe('allow')
  })
})
