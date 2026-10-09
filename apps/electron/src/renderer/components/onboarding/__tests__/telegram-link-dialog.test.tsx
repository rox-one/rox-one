import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TelegramLinkError, type TelegramLinkStatus } from '@rox/shared/telegram-link/client'
import type { TelegramLinkDialog as TelegramLinkDialogComponent } from '../telegram-link/TelegramLinkDialog'

useDomForFile()

// @radix-ui/react-focus-scope walks the DOM with NodeFilter; the shared
// happy-dom helper does not install it (no prior suite rendered a Dialog).
const domGlobals = globalThis as unknown as Record<string, unknown>
const domWindow = domGlobals.window as unknown as Record<string, unknown>
for (const key of ['NodeFilter', 'HTMLIFrameElement']) {
  if (domGlobals[key] === undefined && domWindow[key] !== undefined) domGlobals[key] = domWindow[key]
}

// The UI package pulls browser-only assets and i18n; stub both like the
// sibling onboarding suites so the component renders under Bun. The stub
// still interpolates options, so copy composed at runtime (e.g. the masked
// phone in `codeSentTo`) is observable in textContent rather than collapsing
// to the bare key.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options.phone === 'string' ? `${key} ${options.phone}` : key,
  }),
}))

let TelegramLinkDialog: typeof TelegramLinkDialogComponent

// Static imports cannot work: the component graph must load after the
// browser-only mocks above are registered.
beforeAll(async () => {
  ;({ TelegramLinkDialog } = await import('../telegram-link/TelegramLinkDialog'))
})

afterEach(() => { resetDom() })
beforeEach(() => { Reflect.deleteProperty(window, 'electronAPI') })

interface FakeState {
  status: TelegramLinkStatus
  startCalls: number
  confirmCalls: string[]
}

function fakeClient(model: {
  status?: TelegramLinkStatus
  expiresInMs?: number
  confirmError?: TelegramLinkError
} = {}) {
  const state: FakeState = {
    status: model.status ?? { status: 'waiting' },
    startCalls: 0,
    confirmCalls: [],
  }
  const client = {
    start: mock(async () => {
      state.startCalls += 1
      return {
        linkId: `link-${state.startCalls}`,
        deepLink: 'https://t.me/rox_bot?start=1',
        expiresAt: Date.now() + (model.expiresInMs ?? 30 * 60_000),
      }
    }),
    status: mock(async () => state.status),
    confirm: mock(async (_linkId: string, code: string) => {
      state.confirmCalls.push(code)
      if (model.confirmError) throw model.confirmError
      return { status: 'confirmed' as const }
    }),
  }
  return { client, state }
}

async function render(node: React.ReactElement): Promise<Root> {
  // React warns (and can misreconcile) when one container is passed to
  // createRoot twice; document.body is reused across cases, so mount on a
  // fresh child. DialogContent still portals into document.body.
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return root
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}

async function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  await act(async () => { await promise })
}

async function click(id: string): Promise<void> {
  const element = byTestId(id)
  if (!element) throw new Error(`missing ${id}`)
  await act(async () => { element.click() })
  await wait(0)
}

function typeInto(input: HTMLInputElement, value: string): void {
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

const POLL = { pollMs: 15, tickMs: 15 }

describe('TelegramLinkDialog', () => {
  it('starts a link, renders the countdown and opens the deep link', async () => {
    const { client } = fakeClient()
    const opened: string[] = []
    const root = await render(
      <TelegramLinkDialog
        open
        onOpenChange={() => {}}
        client={client}
        accountId="acct-1"
        openExternal={(url) => { opened.push(url) }}
        {...POLL}
      />,
    )

    await click('telegram-link-open')
    expect(client.start).toHaveBeenCalledWith('acct-1')
    expect(opened).toEqual(['https://t.me/rox_bot?start=1'])
    expect(byTestId('telegram-link-countdown')?.textContent).toMatch(/^\d{2}:\d{2}$/)
    expect(byTestId('telegram-link-countdown')?.textContent).toMatch(/^(29|30):/)
    await unmount(root)
  })

  it('moves waiting → code → confirmed, auto-verifying the 8th character', async () => {
    const { client, state } = fakeClient()
    const onLinked = mock(() => {})
    const root = await render(
      <TelegramLinkDialog open onOpenChange={() => {}} client={client} onLinked={onLinked} {...POLL} />,
    )

    await click('telegram-link-open')
    expect(byTestId('telegram-link-countdown')).toBeTruthy()

    state.status = { status: 'code_issued' }
    await wait(40)
    const input = byTestId('telegram-link-code') as HTMLInputElement | null
    expect(input).not.toBeNull()

    await act(async () => { typeInto(input!, 'abcd-2345') })
    await wait(0)
    expect(client.confirm).toHaveBeenCalledWith('link-1', 'ABCD2345')
    expect(byTestId('telegram-link-confirmed')).toBeTruthy()
    expect(onLinked).toHaveBeenCalledTimes(1)
    await unmount(root)
  })

  it('pre-fills the manual field when the service auto-returns the code', async () => {
    const { client, state } = fakeClient()
    state.status = { status: 'code_issued', code: 'ZZZZ9999', phoneMasked: '+7 *** 12' }
    const onLinked = mock(() => {})
    const root = await render(
      <TelegramLinkDialog open onOpenChange={() => {}} client={client} onLinked={onLinked} {...POLL} />,
    )

    await click('telegram-link-open')
    await wait(40)
    const input = byTestId('telegram-link-code') as HTMLInputElement | null
    expect(input?.value).toBe('ZZZZ9999')
    // A pre-filled code is not auto-submitted without the user's consent…
    expect(client.confirm).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('+7 *** 12')

    // …until the explicit verify action is used.
    await click('telegram-link-submit')
    expect(client.confirm).toHaveBeenCalledWith('link-1', 'ZZZZ9999')
    expect(byTestId('telegram-link-confirmed')).toBeTruthy()
    expect(onLinked).toHaveBeenCalledTimes(1)
    await unmount(root)
  })

  it('keeps the code field and reports an incorrect code', async () => {
    const { client, state } = fakeClient({ confirmError: new TelegramLinkError('invalid_code') })
    state.status = { status: 'code_issued' }
    const root = await render(<TelegramLinkDialog open onOpenChange={() => {}} client={client} {...POLL} />)

    await click('telegram-link-open')
    await wait(40)
    await act(async () => { typeInto(byTestId('telegram-link-code') as HTMLInputElement, 'AAAA1111') })
    await wait(0)

    expect(byTestId('telegram-link-error')).toBeTruthy()
    expect(byTestId('telegram-link-code')).toBeTruthy()
    await unmount(root)
  })

  it('offers a restart once the link expires', async () => {
    const model = { expiresInMs: 30 }
    const { client, state } = fakeClient(model)
    const root = await render(<TelegramLinkDialog open onOpenChange={() => {}} client={client} {...POLL} />)

    await click('telegram-link-open')
    await wait(80)
    expect(byTestId('telegram-link-expired')).toBeTruthy()

    model.expiresInMs = 60_000
    await click('telegram-link-restart')
    expect(state.startCalls).toBe(2)
    expect(byTestId('telegram-link-countdown')).toBeTruthy()
    await unmount(root)
  })

  it('states the service is unavailable when no client or bridge exists', async () => {
    const root = await render(<TelegramLinkDialog open onOpenChange={() => {}} {...POLL} />)
    await click('telegram-link-open')
    expect(byTestId('telegram-link-unavailable')).toBeTruthy()
    expect(byTestId('telegram-link-retry')).toBeTruthy()
    await unmount(root)
  })
})