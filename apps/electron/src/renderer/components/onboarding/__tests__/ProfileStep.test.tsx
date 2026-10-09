/**
 * ProfileStep — the onboarding «profile» questionnaire.
 *
 * Runs against happy-dom with i18n stubbed to key passthrough and the
 * (parallel-task) permissions column mocked, so this suite covers the step's
 * own gating and «А предложи сам?» states. Form state is seeded through
 * `initialValue` because synthetic text input does not propagate through
 * React's change handling under happy-dom.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ProfileStepProps } from '../ProfileStep'
import type { SuggestPreferencesInput } from '../profile-suggest'
import { DEFAULT_PROFILE_FORM, type ProfileDraftStorage, type ProfileFormValue } from '../profile-form'

useDomForFile()

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }) }))

let ProfileStep: (props: ProfileStepProps) => React.ReactElement

beforeAll(async () => {
  ;({ ProfileStep } = await import('../ProfileStep'))
})

afterEach(() => { resetDom() })

function memoryStorage(): ProfileDraftStorage {
  return { getItem: () => null, setItem: () => {} }
}

function form(overrides: Partial<ProfileFormValue> = {}): ProfileFormValue {
  return { ...DEFAULT_PROFILE_FORM, ...overrides }
}

const noProvider = async (): Promise<unknown> => ({ ok: false, reason: 'no-provider' })

interface Mounted {
  container: HTMLElement
  unmount: () => Promise<void>
}

async function mount(overrides: Partial<ProfileStepProps> = {}): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const props: ProfileStepProps = {
    onContinue: () => {},
    onSkip: () => {},
    storage: memoryStorage(),
    suggestPreferences: noProvider,
    initialValue: form(),
    ...overrides,
  }
  await act(async () => { root.render(React.createElement(ProfileStep, props)) })
  return {
    container,
    unmount: async () => {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

function button(container: HTMLElement, testid: string): HTMLButtonElement {
  return container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement
}

describe('ProfileStep layout and gating', () => {
  it('renders both columns plus the bottom actions', async () => {
    const mounted = await mount()
    expect(mounted.container.querySelector('[data-testid="onboarding-profile-step"]')).not.toBeNull()
    expect(mounted.container.querySelector('[data-testid="profile-permissions-column"]')).not.toBeNull()
    expect(button(mounted.container, 'profile-skip')).not.toBeNull()
    expect(button(mounted.container, 'profile-continue')).not.toBeNull()
    expect(button(mounted.container, 'profile-suggest')).not.toBeNull()
    await mounted.unmount()
  })

  it('greys out Continue until the required name is filled', async () => {
    const empty = await mount({ initialValue: form({ name: '' }) })
    expect(button(empty.container, 'profile-continue').disabled).toBe(true)
    await empty.unmount()

    const filled = await mount({ initialValue: form({ name: 'Алиса' }) })
    expect(button(filled.container, 'profile-continue').disabled).toBe(false)
    await filled.unmount()
  })

  it('advances via Continue and via Skip', async () => {
    const calls: string[] = []
    const mounted = await mount({
      initialValue: form({ name: 'Алиса' }),
      onContinue: () => calls.push('continue'),
      onSkip: () => calls.push('skip'),
    })
    await act(async () => { button(mounted.container, 'profile-continue').click() })
    await act(async () => { button(mounted.container, 'profile-skip').click() })
    expect(calls).toEqual(['continue', 'skip'])
    await mounted.unmount()
  })
})

describe('ProfileStep «А предложи сам?»', () => {
  it('surfaces the no-provider state', async () => {
    const mounted = await mount()
    await act(async () => { button(mounted.container, 'profile-suggest').click() })
    expect(mounted.container.querySelector('[data-testid="profile-suggest-error"]')?.textContent)
      .toBe('onboarding.profile.suggestNoProvider')
    await mounted.unmount()
  })

  it('treats a missing transport as no-provider', async () => {
    const mounted = await mount({ suggestPreferences: undefined })
    await act(async () => { button(mounted.container, 'profile-suggest').click() })
    expect(mounted.container.querySelector('[data-testid="profile-suggest-error"]')?.textContent)
      .toBe('onboarding.profile.suggestNoProvider')
    await mounted.unmount()
  })

  it('fills an empty preferences textarea with the suggestion', async () => {
    const mounted = await mount({
      initialValue: form({ preferences: '' }),
      suggestPreferences: async () => ({ ok: true, text: 'Черновик предпочтений' }),
    })
    await act(async () => { button(mounted.container, 'profile-suggest').click() })
    const textarea = mounted.container.querySelector('#profile-preferences') as HTMLTextAreaElement
    expect(textarea.value).toBe('Черновик предпочтений')
    await mounted.unmount()
  })

  it('asks before replacing a non-empty textarea, then replaces', async () => {
    const captured: SuggestPreferencesInput[] = []
    const mounted = await mount({
      initialValue: form({ name: 'Алиса', preferences: 'Мой текст' }),
      suggestPreferences: async (input) => {
        captured.push(input)
        return { ok: true, text: 'Новый черновик' }
      },
    })
    await act(async () => { button(mounted.container, 'profile-suggest').click() })

    expect(mounted.container.querySelector('[data-testid="profile-suggest-confirm"]')).not.toBeNull()
    const textarea = mounted.container.querySelector('#profile-preferences') as HTMLTextAreaElement
    expect(textarea.value).toBe('Мой текст')

    await act(async () => { button(mounted.container, 'profile-suggest-replace').click() })
    expect((mounted.container.querySelector('#profile-preferences') as HTMLTextAreaElement).value).toBe('Новый черновик')
    expect(captured[0].name).toBe('Алиса')
    expect(captured[0].timezone).toBe('Europe/Moscow')
    await mounted.unmount()
  })
})