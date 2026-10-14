/**
 * Browser history/bookmarks model (renderer-local; no server API yet).
 * Lives in lib so core atoms don't depend on screen modules.
 */

export interface BrowserLink {
  url: string
  title: string
  /** Last visit / bookmark time (ms). */
  at: number
}

export const BROWSER_HISTORY_MAX = 200

/** Only real web pages go into history/bookmarks (no about:, data:, file:, internal schemes). */
export function isRecordableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * History never keeps query strings or fragments: they routinely carry OAuth
 * codes, tokens and session ids.
 */
export function historyUrl(url: string): string {
  try {
    const u = new URL(url)
    u.search = ''
    u.hash = ''
    u.username = ''
    u.password = ''
    return u.href
  } catch {
    return url.split(/[?#]/)[0]!
  }
}

/** Agent-driven tabs (owned by / bound to a session, or under agent control) never enter history. */
export function isAgentDrivenTab(info: { ownerType?: string; boundSessionId?: string | null; agentControlActive?: boolean }): boolean {
  return info.ownerType === 'session' || Boolean(info.boundSessionId) || info.agentControlActive === true
}

/** Push a visit: stripped URL, dedupe by URL (newest wins, title refreshed), newest first, capped. */
export function recordVisit(history: readonly BrowserLink[], visit: BrowserLink, max = BROWSER_HISTORY_MAX): BrowserLink[] {
  if (!isRecordableUrl(visit.url)) return history as BrowserLink[]
  const url = historyUrl(visit.url)
  const head = history[0]
  if (head && head.url === url && head.title === visit.title) return history as BrowserLink[]
  return [{ ...visit, url }, ...history.filter((h) => h.url !== url)].slice(0, max)
}

export function toggleBookmark(bookmarks: readonly BrowserLink[], link: BrowserLink): BrowserLink[] {
  return bookmarks.some((b) => b.url === link.url) ? bookmarks.filter((b) => b.url !== link.url) : [...bookmarks, link]
}

/** History is scoped per workspace; unbound windows share the '_' bucket. */
export type BrowserHistoryByWorkspace = Readonly<Record<string, readonly BrowserLink[]>>
export const historyKey = (workspaceId: string | null | undefined): string => workspaceId || '_'
