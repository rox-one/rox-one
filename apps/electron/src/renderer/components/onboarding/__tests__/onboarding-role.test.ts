import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDefaultStore } from 'jotai'
import type { EnvironmentPrefs } from '@rox/shared/environment'
import { devSpaceEnabledAtom, onboardingRoleAtom } from '../../../atoms/dev-space'
import {
  nextStepAfterRole,
  persistOnboardingRole,
  shouldEnableDevSpace,
  type OnboardingRoleAnswer,
  type OnboardingRoleApi,
} from '../onboarding-role'

const originalWindow: unknown = globalThis.window

function memoryStorage(): Storage {
  const data: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(data).length
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key]
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null
    },
    setItem(key: string, value: string) {
      data[key] = String(value)
    },
    removeItem(key: string) {
      delete data[key]
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null
    },
  }
}

function fakeApi(): {
  api: OnboardingRoleApi
  patches: Array<Partial<EnvironmentPrefs> & { completeQuestionnaire?: boolean }>
} {
  const patches: Array<Partial<EnvironmentPrefs> & { completeQuestionnaire?: boolean }> = []
  return {
    patches,
    api: {
      saveEnvironmentSetup: async (patch) => {
        patches.push(patch)
        return {}
      },
    },
  }
}

const store = getDefaultStore()

describe('nextStepAfterRole', () => {
  it('keeps the Rox Connect and Git Bash gates after the role step', () => {
    expect(nextStepAfterRole({ applyRoxConnectGate: true, gitBashMissing: true })).toBe('rox-connect')
    expect(nextStepAfterRole({ applyRoxConnectGate: false, gitBashMissing: true })).toBe('git-bash')
  })

  it('goes straight into the app when neither gate applies', () => {
    expect(nextStepAfterRole({ applyRoxConnectGate: false, gitBashMissing: false })).toBe('finish')
  })
})

describe('shouldEnableDevSpace', () => {
  it('enables only for an explicit developer choice', () => {
    expect(shouldEnableDevSpace({ isDeveloper: true, relatedRoles: [], skipped: false })).toBe(true)
    expect(shouldEnableDevSpace({ isDeveloper: false, relatedRoles: [], skipped: false })).toBe(false)
    expect(shouldEnableDevSpace({ isDeveloper: true, relatedRoles: [], skipped: true })).toBe(false)
  })
})

describe('persistOnboardingRole', () => {
  beforeEach(() => {
    globalThis.window = { localStorage: memoryStorage() } as unknown as typeof window
    store.set(devSpaceEnabledAtom, false)
    store.set(onboardingRoleAtom, null)
  })

  afterEach(() => {
    if (originalWindow) globalThis.window = originalWindow as typeof window
    else Reflect.deleteProperty(globalThis, 'window')
  })

  const developer: OnboardingRoleAnswer = { isDeveloper: true, relatedRoles: ['designer'], skipped: false }

  it('records an explicit answer and turns the Developer Space on', async () => {
    const { api, patches } = fakeApi()
    await persistOnboardingRole(api, developer)
    expect(patches[0]!.role).toEqual({
      status: 'answered',
      value: { isDeveloper: true, relatedRoles: ['designer'] },
    })
    expect(store.get(onboardingRoleAtom)).toEqual(developer)
    expect(store.get(devSpaceEnabledAtom)).toBe(true)
  })

  it('records a skip as skipped and never enables the flag', async () => {
    const { api, patches } = fakeApi()
    await persistOnboardingRole(api, { isDeveloper: false, relatedRoles: [], skipped: true })
    expect(patches[0]!.role).toEqual({
      status: 'skipped',
      value: { isDeveloper: false, relatedRoles: [] },
    })
    expect(store.get(devSpaceEnabledAtom)).toBe(false)
  })

  it('never overwrites a manual disable when the role step runs again', async () => {
    store.set(onboardingRoleAtom, developer)
    const { api } = fakeApi()
    await persistOnboardingRole(api, developer)
    expect(store.get(devSpaceEnabledAtom)).toBe(false)
  })

  it('lets an explicit answer turn the flag on after an earlier skip', async () => {
    store.set(onboardingRoleAtom, { isDeveloper: false, relatedRoles: [], skipped: true })
    const { api } = fakeApi()
    await persistOnboardingRole(api, developer)
    expect(store.get(devSpaceEnabledAtom)).toBe(true)
  })

  it('keeps the local answer untouched when the environment save fails', async () => {
    const api: OnboardingRoleApi = {
      saveEnvironmentSetup: async () => {
        throw new Error('save-failed')
      },
    }
    await expect(persistOnboardingRole(api, developer)).rejects.toThrow('save-failed')
    expect(store.get(onboardingRoleAtom)).toBeNull()
    expect(store.get(devSpaceEnabledAtom)).toBe(false)
  })
})

describe('onboarding role wiring', () => {
  const wizard = readFileSync(join(import.meta.dir, '../OnboardingWizard.tsx'), 'utf8')
  const hook = readFileSync(join(import.meta.dir, '../../../hooks/useOnboarding.ts'), 'utf8')

  it('renders the role step between welcome and the existing gates', () => {
    expect(wizard).toContain("| 'role'")
    expect(wizard).toContain("case 'role':")
    expect(wizard).toContain('<RoleStep')
  })

  it('delegates the advance decision and keeps the Windows Git Bash branch', () => {
    expect(hook).toContain("case 'role'")
    expect(hook).toContain('nextStepAfterRole')
    expect(hook).toContain("status.platform === 'win32' && !status.found")
    expect(hook).toContain("s.step !== 'role'")
  })
})