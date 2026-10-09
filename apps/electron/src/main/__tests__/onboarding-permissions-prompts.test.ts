import { beforeAll, describe, expect, it, mock } from 'bun:test'

// `electron` must be mocked before the module graph loads, so the component is
// imported dynamically in `beforeAll`. Type-only imports are erased.
import type {
  OnboardingPermissionSurface,
  PermissionPromptAction,
  PermissionPromptOutcome,
} from '../onboarding-permissions'

const calls = {
  isTrustedAccessibilityClient: [] as boolean[],
  askForMediaAccess: [] as string[],
  getMediaAccessStatus: [] as string[],
  getSources: 0,
}

mock.module('electron', () => ({
  systemPreferences: {
    getMediaAccessStatus: (kind: string) => {
      calls.getMediaAccessStatus.push(kind)
      return kind === 'screen' ? 'denied' : 'granted'
    },
    isTrustedAccessibilityClient: (prompt: boolean) => {
      calls.isTrustedAccessibilityClient.push(prompt)
      return true
    },
    askForMediaAccess: async (kind: string) => {
      calls.askForMediaAccess.push(kind)
      return kind === 'camera'
    },
  },
  desktopCapturer: {
    getSources: async () => {
      calls.getSources += 1
      return []
    },
  },
  shell: { openExternal: async () => {} },
}))

let promptPermission: (surface: OnboardingPermissionSurface, action: PermissionPromptAction) => Promise<PermissionPromptOutcome>
let electronPermissionSurface: () => OnboardingPermissionSurface

beforeAll(async () => {
  const loaded = await import('../onboarding-permissions')
  promptPermission = loaded.promptPermission
  electronPermissionSurface = loaded.electronPermissionSurface
})

function resetCalls(): void {
  calls.isTrustedAccessibilityClient.length = 0
  calls.askForMediaAccess.length = 0
  calls.getMediaAccessStatus.length = 0
  calls.getSources = 0
}

function darwinSurface(overrides: Partial<OnboardingPermissionSurface> = {}): OnboardingPermissionSurface {
  return { ...electronPermissionSurface(), platform: 'darwin', ...overrides }
}

describe('interactive permission prompts', () => {
  it('performs no prompt merely by importing the module', () => {
    expect(calls.isTrustedAccessibilityClient).toEqual([])
    expect(calls.askForMediaAccess).toEqual([])
    expect(calls.getMediaAccessStatus).toEqual([])
    expect(calls.getSources).toBe(0)
  })

  it('accessibility prompts via isTrustedAccessibilityClient(true) exactly once', async () => {
    resetCalls()
    const outcome = await promptPermission(darwinSurface(), 'accessibility')
    expect(calls.isTrustedAccessibilityClient).toEqual([true])
    expect(calls.askForMediaAccess).toEqual([])
    expect(calls.getSources).toBe(0)
    expect(outcome).toEqual({ action: 'accessibility', supported: true, prompted: true, status: 'granted' })
  })

  it('screenRecording attempts a capture (aborting it) and reads the post-prompt status', async () => {
    resetCalls()
    const outcome = await promptPermission(darwinSurface(), 'screenRecording')
    expect(calls.getSources).toBe(1)
    expect(calls.getMediaAccessStatus).toEqual(['screen'])
    expect(calls.askForMediaAccess).toEqual([])
    expect(outcome).toEqual({ action: 'screenRecording', supported: true, prompted: true, status: 'denied' })
  })

  it('microphone asks systemPreferences.askForMediaAccess once and maps the answer', async () => {
    resetCalls()
    const outcome = await promptPermission(darwinSurface(), 'microphone')
    expect(calls.askForMediaAccess).toEqual(['microphone'])
    expect(outcome).toEqual({ action: 'microphone', supported: true, prompted: true, status: 'denied' })
  })

  it('camera asks systemPreferences.askForMediaAccess once and maps the answer', async () => {
    resetCalls()
    const outcome = await promptPermission(darwinSurface(), 'camera')
    expect(calls.askForMediaAccess).toEqual(['camera'])
    expect(outcome).toEqual({ action: 'camera', supported: true, prompted: true, status: 'granted' })
  })

  it('degrades honestly when the accessibility API throws', async () => {
    resetCalls()
    const outcome = await promptPermission(
      darwinSurface({
        isTrustedAccessibilityClient: () => {
          throw new Error('nope')
        },
      }),
      'accessibility',
    )
    expect(outcome).toEqual({ action: 'accessibility', supported: true, prompted: false, status: 'unknown', reason: 'unavailable' })
  })

  it('reports unsupported off macOS without calling any prompt API', async () => {
    resetCalls()
    const outcome = await promptPermission(darwinSurface({ platform: 'linux' }), 'microphone')
    expect(outcome).toEqual({ action: 'microphone', supported: false, prompted: false, status: 'unsupported', reason: 'unsupported' })
    expect(calls.askForMediaAccess).toEqual([])
  })

  it('reports unsupported when the surface exposes no prompt seam', async () => {
    resetCalls()
    const outcome = await promptPermission(darwinSurface({ askForMediaAccess: undefined }), 'camera')
    expect(outcome).toEqual({ action: 'camera', supported: false, prompted: false, status: 'unsupported', reason: 'unavailable' })
    expect(calls.askForMediaAccess).toEqual([])
  })
})