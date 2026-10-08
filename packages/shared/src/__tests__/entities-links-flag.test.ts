import { describe, expect, it, afterEach } from 'bun:test'
import { ENTITIES_LINKS_WORKBENCH_FLAG, isEntitiesLinksEnabled } from '../feature-flags.ts'

const ENV_KEY = 'CRAFT_FEATURE_ENTITIES_LINKS'
let previous: string | undefined

function saveEnv() {
  previous = process.env[ENV_KEY]
}

function restoreEnv() {
  if (previous === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = previous
}

describe('isEntitiesLinksEnabled: workbench flag + env override', () => {
  afterEach(() => restoreEnv())

  it('defaults OFF with no env and no workbench flags', () => {
    saveEnv()
    delete process.env[ENV_KEY]
    expect(isEntitiesLinksEnabled()).toBe(false)
    expect(isEntitiesLinksEnabled(new Set())).toBe(false)
    expect(isEntitiesLinksEnabled(new Set(['workbench.top-chrome.v2']))).toBe(false)
  })

  it('the user-toggleable workbench flag enables it', () => {
    saveEnv()
    delete process.env[ENV_KEY]
    expect(isEntitiesLinksEnabled(new Set([ENTITIES_LINKS_WORKBENCH_FLAG]))).toBe(true)
    expect(ENTITIES_LINKS_WORKBENCH_FLAG).toBe('entities.links.v1')
  })

  it('env override wins over the workbench flag in both directions', () => {
    saveEnv()
    process.env[ENV_KEY] = '1'
    expect(isEntitiesLinksEnabled(new Set())).toBe(true)
    process.env[ENV_KEY] = '0'
    expect(isEntitiesLinksEnabled(new Set([ENTITIES_LINKS_WORKBENCH_FLAG]))).toBe(false)
  })
})
