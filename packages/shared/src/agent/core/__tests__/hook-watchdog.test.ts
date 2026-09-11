import { describe, expect, it } from 'bun:test'
import {
  evaluateHookWatchdog,
  HOOK_WATCHDOG_THRESHOLD,
} from '../pre-tool-use.ts'

/** RX-TSK-0303: fail-closed watchdog over the PreToolUse hook chain. */
describe('hook-chain watchdog', () => {
  it('ok on a healthy chain (divergence ≤1)', () => {
    expect(evaluateHookWatchdog({ preToolUseCount: 10, postToolUseCount: 10 }).action).toBe('ok')
    expect(evaluateHookWatchdog({ preToolUseCount: 10, postToolUseCount: 11 }).action).toBe('ok')
    expect(evaluateHookWatchdog({ preToolUseCount: 0, postToolUseCount: 0 }).action).toBe('ok')
  })

  it('ok below divergence threshold (cold start)', () => {
    for (let n = 0; n < HOOK_WATCHDOG_THRESHOLD; n++) {
      expect(
        evaluateHookWatchdog({ preToolUseCount: 0, postToolUseCount: n }, 'kill').action,
      ).toBe('ok')
    }
  })

  it('kills on cold-start silence at threshold', () => {
    const v = evaluateHookWatchdog({
      preToolUseCount: 0,
      postToolUseCount: HOOK_WATCHDOG_THRESHOLD,
    }, 'kill')
    expect(v.action).toBe('kill-session')
    if (v.action === 'kill-session') expect(v.reason).toContain('diverged')
  })

  it('kills on mid-session chain breakage (the blind spot of a set-once latch)', () => {
    const before = { preToolUseCount: 50, postToolUseCount: 50 }
    expect(evaluateHookWatchdog(before, 'kill').action).toBe('ok')

    // Цепочка умерла после 50 проверенных вызовов: дивергенция растёт.
    const drifting = evaluateHookWatchdog({
      preToolUseCount: 50,
      postToolUseCount: 50 + HOOK_WATCHDOG_THRESHOLD - 1,
    }, 'kill')
    expect(drifting.action).toBe('ok')

    const broken = evaluateHookWatchdog({
      preToolUseCount: 50,
      postToolUseCount: 50 + HOOK_WATCHDOG_THRESHOLD,
    }, 'kill')
    expect(broken.action).toBe('kill-session')
  })
})
