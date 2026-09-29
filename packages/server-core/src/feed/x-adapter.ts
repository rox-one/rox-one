/**
 * «Подписки» — X (Twitter) adapter. There is no X client in the codebase and
 * we never scrape with browser cookies: the only live path is the official
 * X API v2 with a token the user pastes in «Источники ленты».
 *
 * - Home timeline (accounts you follow) needs an OAuth 2.0 *user-context*
 *   token (scopes tweet.read users.read) — GET /2/users/me then
 *   /2/users/:id/timelines/reverse_chronological.
 * - X-profile sources (x.com/<handle>) work with either token type —
 *   /2/users/by/username/:u then /2/users/:id/tweets.
 * Without a token the NotConnected adapter answers honestly.
 */
import type { XConnectionStatus } from '@craft-agent/shared/feed'
import type { FetchLike } from './fetcher'

export interface XPost {
  id: string
  text: string
  createdAt?: number
  authorId?: string
  authorName?: string
  authorUsername?: string
}

export interface XSubscriptionsAdapter {
  readonly connected: boolean
  status(): Promise<XConnectionStatus>
  /** Posts from accounts the user follows (newest first). */
  homeTimeline(opts?: { sinceId?: string; max?: number }): Promise<XPost[]>
  /** Recent posts of one profile. */
  userPosts(handle: string, opts?: { max?: number }): Promise<XPost[]>
}

export class XNotConnectedError extends Error {
  constructor() {
    super('x-not-connected')
    this.name = 'XNotConnectedError'
  }
}

export const notConnectedXAdapter: XSubscriptionsAdapter = {
  connected: false,
  async status() {
    return { state: 'not-connected' }
  },
  async homeTimeline() {
    throw new XNotConnectedError()
  },
  async userPosts() {
    throw new XNotConnectedError()
  },
}

export const X_API_BASE = 'https://api.x.com/2'

interface XApiUser { id: string; name?: string; username?: string }
interface XApiTweet { id: string; text: string; created_at?: string; author_id?: string }
interface XApiList { data?: XApiTweet[]; includes?: { users?: XApiUser[] }; errors?: Array<{ detail?: string; title?: string }> }

function toPosts(body: XApiList): XPost[] {
  const users = new Map((body.includes?.users ?? []).map((u) => [u.id, u]))
  return (body.data ?? []).map((t) => {
    const u = t.author_id ? users.get(t.author_id) : undefined
    const at = t.created_at ? Date.parse(t.created_at) : NaN
    return {
      id: t.id,
      text: t.text,
      ...(Number.isFinite(at) ? { createdAt: at } : {}),
      ...(t.author_id ? { authorId: t.author_id } : {}),
      ...(u?.name ? { authorName: u.name } : {}),
      ...(u?.username ? { authorUsername: u.username } : {}),
    }
  })
}

export function createXApiAdapter(token: string, fetchImpl: FetchLike = fetch, base = X_API_BASE): XSubscriptionsAdapter {
  let me: XApiUser | null = null
  const call = async <T>(path: string): Promise<T> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetchImpl(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal })
      const body = (await res.json().catch(() => ({}))) as T & { title?: string; detail?: string }
      if (!res.ok) throw new Error(`x-api-${res.status}${body?.detail ? `: ${body.detail}` : body?.title ? `: ${body.title}` : ''}`)
      return body
    } finally {
      clearTimeout(timer)
    }
  }
  const fields = 'tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name'
  const getMe = async (): Promise<XApiUser> => {
    if (me) return me
    const body = await call<{ data?: XApiUser }>('/users/me')
    if (!body.data?.id) throw new Error('x-api-no-user')
    me = body.data
    return me
  }
  return {
    connected: true,
    async status() {
      try {
        const u = await getMe()
        return { state: 'connected', ...(u.username ? { username: u.username } : {}) }
      } catch (e) {
        return { state: 'error', message: e instanceof Error ? e.message : String(e) }
      }
    },
    async homeTimeline(opts = {}) {
      const u = await getMe()
      const max = Math.min(100, Math.max(5, opts.max ?? 50))
      const since = opts.sinceId ? `&since_id=${encodeURIComponent(opts.sinceId)}` : ''
      return toPosts(await call<XApiList>(`/users/${u.id}/timelines/reverse_chronological?max_results=${max}&${fields}${since}`))
    },
    async userPosts(handle, opts = {}) {
      const clean = handle.replace(/^@/, '')
      const user = await call<{ data?: XApiUser }>(`/users/by/username/${encodeURIComponent(clean)}?user.fields=username,name`)
      if (!user.data?.id) throw new Error('x-api-user-not-found')
      const max = Math.min(100, Math.max(5, opts.max ?? 20))
      const body = await call<XApiList>(`/users/${user.data.id}/tweets?max_results=${max}&${fields}`)
      body.includes = { users: [...(body.includes?.users ?? []), user.data] }
      return toPosts(body)
    },
  }
}
