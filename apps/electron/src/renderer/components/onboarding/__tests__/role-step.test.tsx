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
    await click('[data-testid="role-pair-detail"] [data-value="concise"]')
    await click('[data-testid="role-pair-layout"] [data-value="bullets"]')
    // Clicking the active option clears it.
    await click('[data-testid="role-pair-layout"] [data-value="bullets"]')
    await click('[data-testid="role-pair-clarify"] [data-value="askFirst"]')
    await click('[data-testid="role-pair-collaboration"] [data-value="reasonTogether"]')

    expect(q(container, '[data-testid="role-agent-claudeCode"]').getAttribute('aria-pressed')).toBe('true')
    const buttons = Array.from(container.querySelectorAll('button'))
    const cont = buttons.find((b) => b.textContent === 'common.continue')!
    await act(async () => { cont.click() })

    expect(onContinue).toHaveBeenCalledTimes(1)
    expect((patches[0] as { role: unknown }).role).toEqual({
      status: 'answered',
      value: {
        isDeveloper: true,
        relatedRoles: [],
        workStyle: {
          agents: ['claudeCode', 'geminiCli'],
          formats: ['pdf'],
          detail: 'concise',
          clarify: 'askFirst',
          collaboration: 'reasonTogether',
        },
      },
    })
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
