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

describe('resolveEntitiesLinksEffectiveState (review 3 #3)', () => {
  afterEach(() => restoreEnv())

  it('no env: the persisted toggle decides', async () => {
    saveEnv()
    delete process.env[ENV_KEY]
    const { resolveEntitiesLinksEffectiveState } = await import('../feature-flags.ts')
    expect(resolveEntitiesLinksEffectiveState(false)).toEqual({ enabled: false, persisted: false, envOverride: undefined })
    expect(resolveEntitiesLinksEffectiveState(true)).toEqual({ enabled: true, persisted: true, envOverride: undefined })
  })

  it('env=1 forces on regardless of the toggle', async () => {
    saveEnv()
    process.env[ENV_KEY] = '1'
    const { resolveEntitiesLinksEffectiveState } = await import('../feature-flags.ts')
    expect(resolveEntitiesLinksEffectiveState(false)).toEqual({ enabled: true, persisted: false, envOverride: true })
    expect(isEntitiesLinksEnabled(new Set())).toBe(true)
  })

  it('env=0 forces off even with the toggle on', async () => {
    saveEnv()
    process.env[ENV_KEY] = '0'
    const { resolveEntitiesLinksEffectiveState } = await import('../feature-flags.ts')
    expect(resolveEntitiesLinksEffectiveState(true)).toEqual({ enabled: false, persisted: true, envOverride: false })
    expect(isEntitiesLinksEnabled(new Set([ENTITIES_LINKS_WORKBENCH_FLAG]))).toBe(false)
  })

  it('agrees with isEntitiesLinksEnabled for every combination', async () => {
    const { resolveEntitiesLinksEffectiveState } = await import('../feature-flags.ts')
    saveEnv()
    for (const env of [undefined, '1', '0', 'garbage']) {
      if (env === undefined) delete process.env[ENV_KEY]
      else process.env[ENV_KEY] = env
      for (const persisted of [false, true]) {
        const flags = persisted ? new Set([ENTITIES_LINKS_WORKBENCH_FLAG]) : new Set<string>()
        expect(resolveEntitiesLinksEffectiveState(persisted).enabled).toBe(isEntitiesLinksEnabled(flags))
      }
    }
  })
})
