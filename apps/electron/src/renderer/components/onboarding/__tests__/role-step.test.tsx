/**
 * RoleStep — the full-width «Who are you?» step saves the developer answer
 * plus the work style (agents, formats, answer and collaboration style).
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { RoleStep as RoleStepComponent } from '../RoleStep'

useDomForFile()

mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}))

let RoleStep: typeof RoleStepComponent
beforeAll(async () => {
  ({ RoleStep } = await import('../RoleStep'))
})
afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
  resetDom()
})

const q = (c: HTMLElement, s: string) => {
  const el = c.querySelector<HTMLElement>(s)
  if (!el) throw new Error(`missing ${s}`)
  return el
}

/** Set a controlled input's value the way React's change tracking expects. */
function setNativeValue(input: HTMLInputElement, value: string) {
  let proto: object | null = Object.getPrototypeOf(input)
  let setter: ((v: string) => void) | undefined
  while (proto && !setter) {
    setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    proto = Object.getPrototypeOf(proto)
  }
  // React may use its key-event input polyfill under happy-dom (see the
  // profile-questionnaire test): focus, write, then fire both event families.
  input.focus()
  setter!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }))
}

describe('RoleStep', () => {
  it('saves the developer answer with the chosen work style', async () => {
    const patches: unknown[] = []
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      saveEnvironmentSetup: async (patch: unknown) => { patches.push(patch); return {} },
    }
    const onContinue = mock(() => {})
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<RoleStep onContinue={onContinue} />) })

    const click = async (s: string) => { await act(async () => { q(container, s).click() }) }
    await click('[data-testid="role-developer-yes"]')
    await click('[data-testid="role-agent-claudeCode"]')
    await click('[data-testid="role-agent-geminiCli"]')
    await click('[data-testid="role-format-pdf"]')
    await click('[data-testid="role-format-docx"]')
    await click('[data-testid="role-related-other"]')
    const slide = async (key: string, value: number) => {
      const input = q(container, `[data-testid="role-scale-${key}"] input`) as HTMLInputElement
      await act(async () => {
        setNativeValue(input, String(value))
      })
    }
    await slide('detail', 2)
    await slide('tone', 8)
    await slide('layout', 9)
    // Double-click resets a slider to «no preference».
    await act(async () => { q(container, '[data-testid="role-scale-layout"] input').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const other = q(container, '[data-testid="role-other-input"]') as HTMLInputElement
    expect(other.maxLength).toBe(32)
    await act(async () => {
      setNativeValue(other, 'Бариста')
    })

    expect(q(container, '[data-testid="role-agent-claudeCode"]').getAttribute('aria-pressed')).toBe('true')
    const buttons = Array.from(container.querySelectorAll('button'))
    const cont = buttons.find((b) => b.textContent === 'common.continue')!
    await act(async () => { cont.click() })

    expect(onContinue).toHaveBeenCalledTimes(1)
    expect((patches[0] as { role: unknown }).role).toEqual({
      status: 'answered',
      value: {
        isDeveloper: true,
        relatedRoles: ['other'],
        otherRole: 'Бариста',
        isDeveloperExplicit: true,
        workStyle: {
          agents: ['claudeCode', 'geminiCli'],
          formats: ['docx', 'pdf'],
          primaryFormat: 'pdf',
          scales: { detail: 2, tone: 8 },
        },
      },
    })
    await act(async () => { root.unmount() })
  })

  it('starts with no developer choice and saves it as not explicit', async () => {
    const patches: unknown[] = []
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      saveEnvironmentSetup: async (patch: unknown) => { patches.push(patch); return {} },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<RoleStep onContinue={() => {}} />) })
    expect(q(container, '[data-testid="role-developer-yes"]').getAttribute('aria-pressed')).toBe('false')
    expect(q(container, '[data-testid="role-developer-no"]').getAttribute('aria-pressed')).toBe('false')
    // Each slider is labelled at both ends and starts as «no preference».
    expect(q(container, '[data-testid="role-scale-detail"]').dataset.set).toBe('false')
    expect(container.textContent).toContain('onboarding.role.detail.concise')
    expect(container.textContent).toContain('onboarding.role.detail.detailed')
    const cont = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'common.continue')!
    await act(async () => { cont.click() })
    expect((patches[0] as { role: unknown }).role).toEqual({ status: 'answered', value: { isDeveloper: false, relatedRoles: [] } })
    await act(async () => { root.unmount() })
  })

  it('skip records no work style', async () => {
    const patches: unknown[] = []
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      saveEnvironmentSetup: async (patch: unknown) => { patches.push(patch); return {} },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<RoleStep onContinue={() => {}} />) })
    await act(async () => { q(container, '[data-testid="role-format-xlsx"]').click() })
    await act(async () => { q(container, '[data-testid="role-skip"]').click() })
    expect((patches[0] as { role: unknown }).role).toEqual({ status: 'skipped', value: { isDeveloper: false, relatedRoles: [] } })
    await act(async () => { root.unmount() })
  })
})
