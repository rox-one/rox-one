import { describe, expect, it, mock } from 'bun:test'
import {
  installRendererSessionPolicy,
  RENDERER_BLOCKED_REQUEST_URLS,
  type RendererPolicySession,
} from '../renderer-session-policy.ts'

type RequestListener = (
  details: { url: string },
  callback: (result: { cancel: boolean }) => void,
) => void

function createHarness() {
  let filter: { urls: readonly string[] } | undefined
  let requestHandler: RequestListener | undefined
  const onBeforeRequest = mock((value: { urls: readonly string[] }, listener: RequestListener) => {
    filter = value
    requestHandler = listener
  })
  const session: RendererPolicySession = { webRequest: { onBeforeRequest } }

  installRendererSessionPolicy(session)

  return {
    onBeforeRequest,
    getFilter: () => filter,
    send: (url: string): { cancel: boolean } => {
      let result: { cancel: boolean } | undefined
      requestHandler!({ url }, value => { result = value })
      return result!
    },
  }
}

describe('installRendererSessionPolicy', () => {
  it('cancels citation favicon requests to Google', () => {
    const harness = createHarness()

    expect(harness.send('https://www.google.com/s2/favicons')).toEqual({ cancel: true })
    expect(harness.send('https://www.google.com/s2/favicons?domain=example.com&sz=32')).toEqual({
      cancel: true,
    })
  })

  it('lets every other request pass through', () => {
    const harness = createHarness()

    expect(harness.send('https://example.com/')).toEqual({ cancel: false })
    expect(harness.send('https://www.google.com/search?q=rox')).toEqual({ cancel: false })
    expect(harness.send('https://www.google.com/s2/favicon')).toEqual({ cancel: false })
    expect(harness.send('http://www.google.com/s2/favicons?domain=example.com')).toEqual({
      cancel: false,
    })
  })

  it('registers exactly one listener scoped to the favicon pattern', () => {
    const harness = createHarness()

    expect(harness.onBeforeRequest).toHaveBeenCalledTimes(1)
    expect(RENDERER_BLOCKED_REQUEST_URLS).toEqual(['https://www.google.com/s2/favicons*'])
    expect(harness.getFilter()).toEqual({ urls: ['https://www.google.com/s2/favicons*'] })
  })
})