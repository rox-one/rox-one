/**
 * QuestionnaireStep — Continue gating, the Skip path (preselected permissions
 * + deferred rewards) and the bubble-selection pass-through.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { QuestionnaireStep as QuestionnaireStepComponent } from '../QuestionnaireStep'
import {
  createRewardLedger,
  DEFERRED_REWARD_CAP,
  FULL_ONBOARDING_BONUS_STEP,
  type RewardStorage,
} from '../onboarding-rewards'

useDomForFile()

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}))

let QuestionnaireStep: typeof QuestionnaireStepComponent

// Static import cannot work: the component graph must load after the mocks.
beforeAll(async () => {
  ({ QuestionnaireStep } = await import('../QuestionnaireStep'))
})

afterEach(() => { resetDom() })

function memoryStorage(): RewardStorage {
  const data: Record<string, string> = {}
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value },
  }
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

function requireElement<T extends Element>(container: HTMLElement, selector: string): T {
  const element = container.querySelector<T>(selector)
  if (!element) throw new Error(`missing element: ${selector}`)
  return element
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  // react-dom is evaluated before this suite installs the happy-dom globals,
  // so React falls back to its key-event input polyfill: the value tracker
  // only re-reads the field and synthesises onChange on a key event, never on
  // `input`/`change`. Focus first (the polyfill path requires it), write
  // through the native setter, then mirror both event families so the driver
  // works whether React picked the native or the polyfilled path.
  input.focus()
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }))
}

function fillName(container: HTMLElement): void {
  const input = requireElement<HTMLInputElement>(container, '[data-testid="profile-questionnaire-column"] input')
  setInputValue(input, 'Ада')
}

/** Let the mount-time host probe promise chain settle inside `act`. */
async function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => { await promise })
}

describe('QuestionnaireStep Continue gating', () => {
  it('keeps Continue disabled until the profile is complete, then enables it', async () => {
    const { container, root } = await render(
      <QuestionnaireStep onContinue={() => {}} onSkip={() => {}} />,
    )

    const button = requireElement<HTMLButtonElement>(container, '[data-testid="questionnaire-continue"]')
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('data-state')).toBe('incomplete')

    await act(async () => { fillName(container) })

    expect(button.disabled).toBe(false)
    expect(button.getAttribute('data-state')).toBe('ready')

    await unmount(root)
  })
})

describe('QuestionnaireStep Skip path', () => {
  it('applies the preselected permissions and awards every step as deferred (+1)', async () => {
    const ledger = createRewardLedger({ storage: memoryStorage() })
    const onSkip = mock(() => {})
    const onPermissionsChange = mock(() => {})
    const { container, root } = await render(
      <QuestionnaireStep
        onContinue={() => {}}
        onSkip={onSkip}
        rewards={ledger}
        rewardSteps={['username', 'org']}
        permissions={{ platform: 'mac', enabled: {}, grants: {} }}
        onPermissionsChange={onPermissionsChange}
      />,
    )

    await act(async () => {
      requireElement<HTMLButtonElement>(container, '[data-testid="questionnaire-skip"]').click()
    })

    expect(onSkip).toHaveBeenCalledTimes(1)
    const payload = (onSkip.mock.calls as unknown as Array<[{ permissions: { enabled: Record<string, boolean> } }]>)[0][0]
    expect(payload.permissions.enabled.fullDiskAccess).toBe(true)
    expect(onPermissionsChange).toHaveBeenCalledTimes(1)

    const usernameEntry = ledger.getEntry('username')
    expect(usernameEntry?.source).toBe('deferred')
    expect(usernameEntry?.amount).toBe(DEFERRED_REWARD_CAP)
    expect(usernameEntry?.status).toBe('confirmed')
    expect(ledger.getEntry('org')?.amount).toBe(DEFERRED_REWARD_CAP)
    expect(ledger.isAwarded(FULL_ONBOARDING_BONUS_STEP)).toBe(false)

    await unmount(root)
  })
})

describe('QuestionnaireStep Continue rewards', () => {
  it('awards the full step amounts and the +50 full-onboarding bonus on a complete pass', async () => {
    const ledger = createRewardLedger({ storage: memoryStorage() })
    const onContinue = mock(() => {})
    const { container, root } = await render(
      <QuestionnaireStep
        onContinue={onContinue}
        onSkip={() => {}}
        rewards={ledger}
        rewardSteps={['username', 'org']}
      />,
    )
    await act(async () => { fillName(container) })
    await act(async () => {
      requireElement<HTMLButtonElement>(container, '[data-testid="questionnaire-continue"]').click()
    })

    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(ledger.getEntry('username')?.amount).toBe(5)
    expect(ledger.getEntry('username')?.status).toBe('confirmed')
    expect(ledger.getEntry(FULL_ONBOARDING_BONUS_STEP)?.amount).toBe(50)
    expect(ledger.getEntry(FULL_ONBOARDING_BONUS_STEP)?.status).toBe('confirmed')

    await unmount(root)
  })
})

describe('QuestionnaireStep bubbles', () => {
  it('passes bubble selections through to the parent', async () => {
    const onBubblesChange = mock(() => {})
    const { container, root } = await render(
      <QuestionnaireStep onContinue={() => {}} onSkip={() => {}} onBubblesChange={onBubblesChange} />,
    )

    const bubble = requireElement<HTMLButtonElement>(container, '[data-bubble-id="softwareDevelopment"]')
    await act(async () => { bubble.click() })

    expect(onBubblesChange).toHaveBeenCalledTimes(1)
    const selection = (onBubblesChange.mock.calls as unknown as Array<[Record<string, string[]>]>)[0][0]
    expect(selection.professionalInterests).toContain('softwareDevelopment')

    // deepInterests is ranked from the professional selection, not dropped.
    const deep = requireElement(container, '[data-testid="interest-bubbles-deepInterests"]')
    expect(deep.querySelector('[data-bubble-id="openSource"]')).not.toBeNull()

    await unmount(root)
  })
})

describe('QuestionnaireStep permission hydration', () => {
  it('hydrates probed OS statuses and routes grants through the bridge', async () => {
    const opened: string[] = []
    const api = {
      getOnboardingPermissionsStatus: mock(async () => ({
        platform: 'darwin',
        statuses: {
          screenRecording: 'denied',
          fullDiskAccess: 'granted',
          automation: 'unknown',
          accessibility: 'unsupported',
        },
      })),
      openOnboardingPermissionSettings: mock(async (key: string) => {
        opened.push(key)
        return { opened: true }
      }),
    }
    Object.assign(window, { electronAPI: api })
    try {
      const { container, root } = await render(
        <QuestionnaireStep onContinue={() => {}} onSkip={() => {}} platform="mac" />,
      )
      await flush()

      expect(
        requireElement(container, '[data-testid="permission-status-screenRecording"]').textContent,
      ).toBe('onboarding.permissions.status.denied')
      expect(
        requireElement(container, '[data-testid="permission-status-fullDiskAccess"]').textContent,
      ).toBe('onboarding.permissions.status.granted')
      // `unknown` maps to not-determined; `unsupported` stays first-class and
      // offers no grant action.
      expect(
        requireElement(container, '[data-testid="permission-status-automation"]').textContent,
      ).toBe('onboarding.permissions.status.notDetermined')
      expect(
        requireElement(container, '[data-testid="permission-status-accessibility"]').textContent,
      ).toBe('onboarding.permissions.status.unsupported')
      expect(container.querySelector('[data-testid="permission-grant-accessibility"]')).toBeNull()

      const grant = requireElement<HTMLButtonElement>(
        container,
        '[data-testid="permission-grant-screenRecording"]',
      )
      await act(async () => { grant.click() })
      await flush()

      expect(opened).toEqual(['screenRecording'])

      await unmount(root)
    } finally {
      Reflect.deleteProperty(window, 'electronAPI')
    }
  })
})