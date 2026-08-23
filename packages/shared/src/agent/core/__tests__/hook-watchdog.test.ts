import { describe, expect, it } from 'bun:test'
import {
  evaluateHookWatchdog,
  HOOK_WATCHDOG_THRESHOLD,
} from '../pre-tool-use.ts'

/** RX-TSK-0303: fail-closed watchdog over the PreToolUse hook chain. */
describe('hook-chain watchdog', () => {
  it('ok while PreToolUse has fired at least once', () => {
    expect(evaluateHookWatchdog({ preToolUseSeen: true, postToolUseCount: 999 }).action).toBe('ok')
    expect(evaluateHookWatchdog({ preToolUseSeen: true, postToolUseCount: 0 }).action).toBe('ok')
  })

  it('ok below threshold when chain is silent', () => {
    for (let n = 0; n < HOOK_WATCHDOG_THRESHOLD; n++) {
      expect(
        evaluateHookWatchdog({ preToolUseSeen: false, postToolUseCount: n }).action,
      ).toBe('ok')
    }
  })

  it('kills the session at threshold with an explanatory reason', () => {
    const verdict = evaluateHookWatchdog({
      preToolUseSeen: false,
      postToolUseCount: HOOK_WATCHDOG_THRESHOLD,
    })
    expect(verdict.action).toBe('kill-session')
    if (verdict.action === 'kill-session') {
      expect(verdict.reason).toContain('PreToolUse permission chain is silent')
      expect(verdict.reason).toContain(String(HOOK_WATCHDOG_THRESHOLD))
    }
  })

  it('stays silent strictly below threshold (boundary)', () => {
    const below = evaluateHookWatchdog({
      preToolUseSeen: false,
      postToolUseCount: HOOK_WATCHDOG_THRESHOLD - 1,
    })
    const at = evaluateHookWatchdog({
      preToolUseSeen: false,
      postToolUseCount: HOOK_WATCHDOG_THRESHOLD,
    })
    expect(below.action).toBe('ok')
    expect(at.action).toBe('kill-session')
  })
})
