/**
 * App-renderer session policy for the main process.
 *
 * Model-generated OpenUI programs can render citation favicons through the
 * vendor `SourceFaviconImage`, which fetches `https://www.google.com/s2/favicons`
 * and leaks the cited hostnames to Google with no user action. The vendor
 * component already degrades to a globe icon when the image fails, so the app
 * renderer session cancels those requests outright.
 *
 * Electron allows only one `webRequest.onBeforeRequest` listener per event per
 * session. Verified: `session.defaultSession` has no other request listener —
 * `browser-pane-manager` registers `onBeforeRequest` only on browser-pane and
 * extension partitions, `meetings/local-ipc` sets permission handlers, and
 * `network-proxy` only calls `setProxy`. Install once at startup, before the
 * first window loads.
 */

const BLOCKED_FAVICON_URL_PREFIX = 'https://www.google.com/s2/favicons'

/** Electron URL filter for the requests this policy cancels. */
export const RENDERER_BLOCKED_REQUEST_URLS = [`${BLOCKED_FAVICON_URL_PREFIX}*`] as const

/** Minimal structural view of the Electron session surface this policy needs. */
export interface RendererPolicySession {
  readonly webRequest: {
    onBeforeRequest(
      filter: { readonly urls: readonly string[] },
      listener: (
        details: { readonly url: string },
        callback: (result: { readonly cancel: boolean }) => void,
      ) => void,
    ): void
  }
}

/** Cancels third-party citation-favicon fetches on the app renderer session. */
export function installRendererSessionPolicy(session: RendererPolicySession): void {
  session.webRequest.onBeforeRequest({ urls: RENDERER_BLOCKED_REQUEST_URLS }, (details, callback) => {
    callback({ cancel: details.url.startsWith(BLOCKED_FAVICON_URL_PREFIX) })
  })
}
