import { afterEach, describe, expect, it } from 'bun:test'
import {
  isModeMessengerEnabled,
  resetImEnabledWorkbenchFlagsForTests,
  setImEnabledWorkbenchFlags,
  MODE_MESSENGER_ENV_KEY,
  MODE_MESSENGER_WORKBENCH_FLAG,
} from '../flags'

afterEach(() => resetImEnabledWorkbenchFlagsForTests())

describe('isModeMessengerEnabled', () => {
  it('mirrors the workbench flag id literal', () => {
    expect(MODE_MESSENGER_WORKBENCH_FLAG).toBe('workbench.mode.messenger.v1')
  })

  it('lets the env override win over everything', () => {
    setImEnabledWorkbenchFlags([])
    expect(isModeMessengerEnabled(undefined, { [MODE_MESSENGER_ENV_KEY]: '1' })).toBe(true)
    setImEnabledWorkbenchFlags([MODE_MESSENGER_WORKBENCH_FLAG])
    expect(isModeMessengerEnabled(undefined, { [MODE_MESSENGER_ENV_KEY]: '0' })).toBe(false)
  })

  it('reads membership from a published flag set', () => {
    setImEnabledWorkbenchFlags([])
    expect(isModeMessengerEnabled(undefined, {})).toBe(false)
    setImEnabledWorkbenchFlags([MODE_MESSENGER_WORKBENCH_FLAG])
    expect(isModeMessengerEnabled(undefined, {})).toBe(true)
  })

  it('defaults to ON (the flag default) when nothing is published', () => {
    expect(isModeMessengerEnabled(undefined, {})).toBe(true)
  })

  it('accepts an explicit flag set argument over the published one', () => {
    setImEnabledWorkbenchFlags([MODE_MESSENGER_WORKBENCH_FLAG])
    expect(isModeMessengerEnabled(new Set<string>(), {})).toBe(false)
  })
})
