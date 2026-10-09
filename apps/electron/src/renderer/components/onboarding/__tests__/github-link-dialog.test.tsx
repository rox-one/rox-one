/**
 * GitHubLinkDialog — states, polling and the one-shot `onLinked`.
 *
 * The dialog is driven by an injected fake client so no network or Electron
 * bridge is involved; the fake mirrors the real client's surface (start / poll
 * / get) and returns only public codes and the linked profile.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GithubLinkError } from '@rox/shared/identity'
import type { GithubLinkClient, GithubLinkPoll, GithubLinkProfile } from '@rox/shared/identity'
import type { GithubLinkDialog as GithubLinkDialogComponent } from '../github-link/GithubLinkDialog'

useDomForFile()

// @radix-ui/react-focus-scope walks the DOM with NodeFilter; the shared
// happy-dom helper does not install it (the sibling Telegram suite added the
// same shim for the first Dialog render).
const domGlobals = globalThis as unknown as Record<string, unknown>
const domWindow = domGlobals.window as unknown as Record<string, unknown>
for (const key of ['NodeFilter', 'HTMLIFrameElement']) {
  if (domGlobals[key] === undefined && domWindow[key] !== undefined) domGlobals[key] = domWindow[key]
}

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options.count === 'number' ? `${key} ${options.count}` : key,
  }),
}))

let GithubLinkDialog: typeof GithubLinkDialogComponent

// Static imports cannot work: the component graph must load after the
// browser-only mocks above are registered.
beforeAll(async () => {
  ;({ GithubLinkDialog } = await import('../github-link/GithubLinkDialog'))
})

afterEach(() => { resetDom() })
beforeEach(() => { Reflect.deleteProperty(window, 'electronAPI') })

const LINKED_PROFILE: GithubLinkProfile = {
  githubLogin: 'octocat',
  githubId: 583231,
  avatarUrl: 'https://avatars/x',
  linkedAt: 5,
}

interface FakeModel {
  /** Poll outcome per 1-based call. Defaults to `pending`. */
  poll?: (call: number) => GithubLinkPoll
}

function fakeClient(model: FakeModel = {}) {
  const state = { startCalls: 0, pollCalls: 0 }
  const client: GithubLinkClient = {
    start: mock(async () => {
      state.startCalls += 1
      return { flowId: 'flow-1', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', interval: 0.02, expiresIn: 600 }
    }),
    poll: mock(async () => {
      state.pollCalls += 1
      return model.poll ? model.poll(state.pollCalls) : { status: 'pending' as const }
    }),
    get: mock(async () => null),
  }
  return { client, state }
}

async function render(node: React.ReactElement): Promise<Root> {
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

describe('GithubLinkDialog', () => {
  it('starts a link, opens the verification page and shows the user code', async () => {
    const { client } = fakeClient()
    const opened: string[] = []
    const root = await render(
      <GithubLinkDialog
        open
        onOpenChange={() => {}}
        client={client}
        workspaceId="ws"
        openExternal={(url) => { opened.push(url) }}
      />,
    )

    await click('github-link-open')
    expect(client.start).toHaveBeenCalledTimes(1)
    expect(opened).toEqual(['https://github.com/login/device'])
    expect(byTestId('github-link-waiting')).toBeTruthy()
    expect(byTestId('github-link-usercode')?.textContent).toBe('ABCD-1234')
    expect(byTestId('github-link-countdown')?.textContent).toMatch(/^\d{2}:\d{2}$/)
    await unmount(root)
  })

  it('moves waiting → linked, renders the profile and fires onLinked exactly once', async () => {
    const { client, state } = fakeClient({
      poll: (call) => (call === 1 ? { status: 'pending' } : { status: 'linked', profile: LINKED_PROFILE }),
    })
    const onLinked = mock(() => {})
    const root = await render(
      <GithubLinkDialog open onOpenChange={() => {}} client={client} workspaceId="ws" onLinked={onLinked} />,
    )

    await click('github-link-open')
    await wait(60)

    expect(byTestId('github-link-confirmed')).toBeTruthy()
    expect(byTestId('github-link-login')?.textContent).toContain('octocat')
    expect(byTestId('github-link-avatar')?.getAttribute('src')).toBe('https://avatars/x')
    expect(onLinked).toHaveBeenCalledTimes(1)
    const polls = state.pollCalls

    // The flow is consumed: no further polls, still exactly one notification.
    await wait(60)
    expect(state.pollCalls).toBe(polls)
    expect(onLinked).toHaveBeenCalledTimes(1)
    await unmount(root)
  })

  it('keeps waiting through a transient poll failure, then links', async () => {
    let failed = false
    const { client } = fakeClient({
      poll: () => {
        if (!failed) {
          failed = true
          throw new GithubLinkError('network')
        }
        return { status: 'linked', profile: LINKED_PROFILE }
      },
    })
    const root = await render(
      <GithubLinkDialog open onOpenChange={() => {}} client={client} workspaceId="ws" onLinked={() => {}} />,
    )

    await click('github-link-open')
    await wait(20)
    expect(byTestId('github-link-waiting')).toBeTruthy()

    await wait(60)
    expect(byTestId('github-link-confirmed')).toBeTruthy()
    await unmount(root)
  })

  it('offers a restart once the flow expires', async () => {
    const { client, state } = fakeClient({ poll: () => ({ status: 'expired' }) })
    const root = await render(
      <GithubLinkDialog open onOpenChange={() => {}} client={client} workspaceId="ws" />,
    )

    await click('github-link-open')
    await wait(60)
    expect(byTestId('github-link-expired')).toBeTruthy()

    await click('github-link-restart')
    expect(state.startCalls).toBe(2)
    expect(byTestId('github-link-waiting')).toBeTruthy()
    await unmount(root)
  })

  it('states linking is unavailable when no client or bridge exists', async () => {
    const root = await render(<GithubLinkDialog open onOpenChange={() => {}} workspaceId="ws" />)
    await click('github-link-open')
    expect(byTestId('github-link-unavailable')).toBeTruthy()
    expect(byTestId('github-link-retry')).toBeTruthy()
    await unmount(root)
  })
})