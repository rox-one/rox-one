import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ProfileQuestionnaireColumn as ColumnComponent } from '../ProfileQuestionnaireColumn'
import {
  createDefaultProfileQuestionnaire,
  isProfileQuestionnaireComplete,
  parseProfileQuestionnaire,
  serializeProfileQuestionnaire,
  type ProfileQuestionnaire,
} from '../profile-questionnaire-model'

useDomForFile()

// The i18n mock returns keys, matching the sibling onboarding suites.
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let ProfileQuestionnaireColumn: typeof ColumnComponent

// Static import cannot work: the component graph must load after the
// react-i18next mock above is registered.
beforeAll(async () => {
  ({ ProfileQuestionnaireColumn } = await import('../ProfileQuestionnaireColumn'))
})

afterEach(() => { resetDom() })

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

async function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => { await promise })
}

function Harness({ onSuggest }: { onSuggest: () => Promise<string> }) {
  const [value, setValue] = React.useState<ProfileQuestionnaire>(() =>
    createDefaultProfileQuestionnaire(),
  )
  return (
    <ProfileQuestionnaireColumn
      value={value}
      onChange={(next) => setValue(next)}
      onSuggest={onSuggest}
    />
  )
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  // react-dom is evaluated before this suite installs the happy-dom globals,
  // so React falls back to its key-event input polyfill: the value tracker
  // only re-reads the field and synthesises onChange on a key event, never on
  // `input`/`change`. Focus first (the polyfill path requires it), write
  // through the native setter, then mirror both event families so the driver
  // works whether React picked the native or the polyfilled path.
  textarea.focus()
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }))
}

function requireElement<T extends Element>(container: HTMLElement, selector: string): T {
  const element = container.querySelector<T>(selector)
  if (!element) throw new Error(`missing element: ${selector}`)
  return element
}

describe('ProfileQuestionnaireColumn render', () => {
  it('renders every field, the Moscow/Russian defaults, the magic suggest button', async () => {
    const { container, root } = await render(<Harness onSuggest={async () => ''} />)
    await flush()

    expect(requireElement(container, '[data-testid="profile-questionnaire-column"]')).toBeTruthy()
    for (const key of [
      'onboarding.profile.fullName',
      'onboarding.profile.birthDate',
      'onboarding.profile.uiLanguage',
      'onboarding.profile.chatLanguage',
      'onboarding.profile.city',
      'onboarding.profile.timeZone',
      'onboarding.profile.preferences',
    ]) {
      expect(container.textContent).toContain(key)
    }

    expect(requireElement<HTMLInputElement>(container, 'input[type="date"]')).toBeTruthy()
    expect(requireElement(container, '[data-testid="profile-preferences"] textarea')).toBeTruthy()

    // Defaults: Russian language label and Moscow city show in their triggers.
    expect(container.textContent).toContain('Русский')
    expect(container.textContent).toContain('Москва')
    expect(container.textContent).toContain('Europe/Moscow')

    const button = requireElement<HTMLButtonElement>(container, '[data-testid="profile-suggest-button"]')
    expect(button.textContent).toContain('onboarding.profile.suggest')
    expect(button.className).toContain('rounded-full')
    expect(button.querySelector('svg')).not.toBeNull()

    await unmount(root)
  })
})

describe('ProfileQuestionnaireColumn suggest flow', () => {
  it('fills the preferences with the returned suggestion and clears the loading state', async () => {
    const onSuggest = mock(async () => 'Предложение ИИ')
    const { container, root } = await render(<Harness onSuggest={onSuggest} />)
    const button = requireElement<HTMLButtonElement>(container, '[data-testid="profile-suggest-button"]')
    const textarea = requireElement<HTMLTextAreaElement>(container, '[data-testid="profile-preferences"] textarea')

    await act(async () => { button.click() })
    await flush()

    expect(onSuggest).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe('Предложение ИИ')
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-busy')).toBe('false')

    await unmount(root)
  })

  it('does not clobber text edited while the suggestion is still generating', async () => {
    const deferred = Promise.withResolvers<string>()
    const onSuggest = mock(() => deferred.promise)
    const { container, root } = await render(<Harness onSuggest={onSuggest} />)
    const button = requireElement<HTMLButtonElement>(container, '[data-testid="profile-suggest-button"]')
    const textarea = requireElement<HTMLTextAreaElement>(container, '[data-testid="profile-preferences"] textarea')

    await act(async () => { button.click() })
    // Loading state is visible while the request is in flight.
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('onboarding.profile.suggesting')

    await act(async () => { setTextareaValue(textarea, 'Мои пожелания') })
    expect(textarea.value).toBe('Мои пожелания')

    await act(async () => { deferred.resolve('Предложение ИИ') })
    await flush()

    expect(textarea.value).toBe('Мои пожелания')
    expect(button.disabled).toBe(false)

    await unmount(root)
  })

  it('shows the error and re-enables the button when generation fails', async () => {
    const onSuggest = mock(async () => { throw new Error('suggest-unavailable') })
    const { container, root } = await render(<Harness onSuggest={onSuggest} />)
    const button = requireElement<HTMLButtonElement>(container, '[data-testid="profile-suggest-button"]')

    await act(async () => { button.click() })
    await flush()

    expect(requireElement(container, '[role="alert"]').textContent).toContain('suggest-unavailable')
    expect(button.disabled).toBe(false)

    await unmount(root)
  })
})

describe('profile questionnaire model', () => {
  it('requires the name and both languages before Continue is enabled', () => {
    const empty = createDefaultProfileQuestionnaire()
    expect(isProfileQuestionnaireComplete(empty)).toBe(false)
    expect(isProfileQuestionnaireComplete({ ...empty, fullName: '   ' })).toBe(false)
    expect(isProfileQuestionnaireComplete({ ...empty, fullName: 'Ада' })).toBe(true)
    expect(
      isProfileQuestionnaireComplete({
        ...empty,
        fullName: 'Ада',
        uiLanguage: 'auto',
        chatLanguage: 'en',
      }),
    ).toBe(true)
    expect(
      isProfileQuestionnaireComplete({
        ...empty,
        fullName: 'Ада',
        uiLanguage: '' as ProfileQuestionnaire['uiLanguage'],
      }),
    ).toBe(false)
  })

  it('defaults to Moscow (UTC+3) and Russian', () => {
    const defaults = createDefaultProfileQuestionnaire()
    expect(defaults.city).toBe('Москва')
    expect(defaults.timeZone).toBe('Europe/Moscow')
    expect(defaults.uiLanguage).toBe('ru')
    expect(defaults.chatLanguage).toBe('ru')
  })

  it('round-trips through plain JSON and drops invalid values onto the defaults', () => {
    const value: ProfileQuestionnaire = {
      fullName: '  Ада  ',
      birthDate: '1990-05-01',
      uiLanguage: 'en',
      chatLanguage: 'auto',
      city: 'Казань',
      timeZone: 'Europe/Moscow',
      preferences: 'Пиши кратко',
    }
    const json = serializeProfileQuestionnaire(value)
    expect(json.fullName).toBe('Ада')
    expect(parseProfileQuestionnaire(json)).toEqual({
      fullName: 'Ада',
      birthDate: '1990-05-01',
      uiLanguage: 'en',
      chatLanguage: 'auto',
      city: 'Казань',
      timeZone: 'Europe/Moscow',
      preferences: 'Пиши кратко',
    })

    const fallback = parseProfileQuestionnaire({
      uiLanguage: 'klingon',
      birthDate: '01.05.1990',
    })
    expect(fallback.uiLanguage).toBe('ru')
    expect(fallback.birthDate).toBe('')
    expect(parseProfileQuestionnaire(null)).toEqual(createDefaultProfileQuestionnaire())
  })
})