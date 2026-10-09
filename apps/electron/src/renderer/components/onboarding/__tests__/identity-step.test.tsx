/**
 * IdentityStep — validation, reserved-address derivation, coin-badge states
 * and the availability state machine (available / taken / unknown-offline).
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IdentityStep as IdentityStepComponent } from '../IdentityStep'

useDomForFile()

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}))

let IdentityStep: typeof IdentityStepComponent

// Static import cannot work: the component graph must load after the mocks.
beforeAll(async () => {
  ({ IdentityStep } = await import('../IdentityStep'))
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

function requireElement<T extends Element>(container: HTMLElement, selector: string): T {
  const element = container.querySelector<T>(selector)
  if (!element) throw new Error(`missing element: ${selector}`)
  return element
}

/** Type a username and let the debounced availability verdict settle. */
async function typeUsername(container: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    setInputValue(requireElement<HTMLInputElement>(container, '#identity-username'), value)
  })
  await flush()
  await flush()
}

function goldBadges(container: HTMLElement): number {
  return container.querySelectorAll('[data-testid="identity-coin-badge"][data-state="gold"]').length
}

describe('IdentityStep reserved addresses', () => {
  it('shows the bold green addresses for an available handle and the derived organization', async () => {
    const fetchAvailability = mock(async () => ({ available: true }))
    const onAvailabilityChecked = mock(() => {})
    const { container, root } = await render(
      <IdentityStep
        onContinue={() => {}}
        fetchAvailability={fetchAvailability}
        onAvailabilityChecked={onAvailabilityChecked}
        debounceMs={0}
      />,
    )

    // A handle must satisfy the 4–16 contract (see onboarding-username.ts);
    // 'Ada1' keeps the uppercase→lowercase address derivation under test.
    await typeUsername(container, 'Ada1')

    expect(fetchAvailability).toHaveBeenCalledTimes(1)
    expect(onAvailabilityChecked).toHaveBeenCalledWith('Ada1', 'available')

    const addresses = requireElement(container, '[data-testid="identity-reserved-addresses"]')
    expect(addresses.textContent).toContain('rox.one/@ada1')
    expect(addresses.textContent).toContain('rox.one/@ada1_org')
    expect(addresses.textContent).toContain('ada1@rox.one')
    // Addresses are bold, the block itself is the small green type.
    expect(addresses.querySelectorAll('strong').length).toBeGreaterThanOrEqual(3)
    expect(addresses.className).toContain('text-emerald-600')

    // Username and organization coins turn gold; Telegram/GitHub stay grey.
    expect(goldBadges(container)).toBeGreaterThanOrEqual(2)

    await unmount(root)
  })

  it('uses an explicit valid organization over the derived default', async () => {
    const { container, root } = await render(
      <IdentityStep onContinue={() => {}} fetchAvailability={async () => ({ available: true })} debounceMs={0} />,
    )
    await typeUsername(container, 'ada_rox')
    await act(async () => {
      setInputValue(requireElement<HTMLInputElement>(container, '#identity-organization'), 'rox-team')
    })
    await flush()

    const addresses = requireElement(container, '[data-testid="identity-reserved-addresses"]')
    expect(addresses.textContent).toContain('rox.one/@rox-team')
    expect(addresses.textContent).toContain('ada_rox@rox.one')

    await unmount(root)
  })
})

describe('IdentityStep availability states', () => {
  it('blocks Continue and hides the green block for a taken handle', async () => {
    const { container, root } = await render(
      <IdentityStep onContinue={() => {}} fetchAvailability={async () => ({ available: false })} debounceMs={0} />,
    )
    await typeUsername(container, 'takenname')

    expect(container.querySelector('[data-testid="identity-reserved-addresses"]')).toBeNull()
    expect(container.textContent).toContain('onboarding.identity.taken')
    expect(requireElement<HTMLButtonElement>(container, '[data-testid="identity-continue"]').disabled).toBe(true)

    await unmount(root)
  })

  it('treats an offline probe as unknown and still allows Continue', async () => {
    const { container, root } = await render(
      <IdentityStep
        onContinue={() => {}}
        fetchAvailability={async () => { throw new Error('offline') }}
        debounceMs={0}
      />,
    )
    await typeUsername(container, 'offline_ok')

    expect(container.querySelector('[data-testid="identity-reserved-addresses"]')).toBeNull()
    expect(container.textContent).toContain('onboarding.identity.unknown')
    expect(requireElement<HTMLButtonElement>(container, '[data-testid="identity-continue"]').disabled).toBe(false)

    await unmount(root)
  })

  it('rejects a too-short handle without probing the network', async () => {
    const fetchAvailability = mock(async () => ({ available: true }))
    const { container, root } = await render(
      <IdentityStep onContinue={() => {}} fetchAvailability={fetchAvailability} debounceMs={0} />,
    )
    await typeUsername(container, 'ab')

    expect(fetchAvailability).not.toHaveBeenCalled()
    expect(container.textContent).toContain('onboarding.identity.invalid')
    expect(requireElement<HTMLButtonElement>(container, '[data-testid="identity-continue"]').disabled).toBe(true)

    await unmount(root)
  })
})

describe('IdentityStep reward badges', () => {
  it('turns the Telegram/GitHub coins gold from the passed-in reward state', async () => {
    const { container, root } = await render(
      <IdentityStep
        onContinue={() => {}}
        fetchAvailability={async () => ({ available: true })}
        rewards={{ telegram: true, github: true }}
        debounceMs={0}
      />,
    )
    await typeUsername(container, 'ada')

    const telegram = requireElement(container, '[data-testid="identity-link-telegram"]')
    expect(telegram.querySelector('[data-testid="identity-coin-badge"]')?.getAttribute('data-state')).toBe('gold')
    const github = requireElement(container, '[data-testid="identity-link-github"]')
    expect(github.querySelector('[data-testid="identity-coin-badge"]')?.getAttribute('data-state')).toBe('gold')

    await unmount(root)
  })

  it('fires the stub link callbacks and shows the waiting state', async () => {
    const onLinkTelegram = mock(() => {})
    const { container, root } = await render(
      <IdentityStep onContinue={() => {}} onLinkTelegram={onLinkTelegram} fetchAvailability={async () => null} debounceMs={0} />,
    )

    await act(async () => { requireElement<HTMLButtonElement>(container, '[data-testid="identity-link-telegram"]').click() })

    expect(onLinkTelegram).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="identity-linking"]')).not.toBeNull()

    await unmount(root)
  })
})