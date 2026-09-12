/**
 * Queue a URL for the retained inspector browser (Issue 14).
 * The inspector pane may not be mounted yet when a chat link is clicked.
 */

import { INTERNAL_BROWSER_OPEN_EVENT } from '@craft-agent/shared/browser/retained-pane'

let pendingUrl: string | undefined

export function queueInternalBrowserUrl(url: string): void {
  pendingUrl = url
  window.dispatchEvent(new CustomEvent(INTERNAL_BROWSER_OPEN_EVENT, { detail: { url } }))
}

export function takePendingInternalBrowserUrl(): string | undefined {
  const url = pendingUrl
  pendingUrl = undefined
  return url
}
