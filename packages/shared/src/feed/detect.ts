/**
 * Pure URL → source-type detection for «Источники ленты». No network: the
 * poller confirms the type (RSS vs Atom vs plain page) on first fetch.
 */
import type { FeedSourceKind } from './types'

export interface DetectedSource {
  kind: FeedSourceKind
  url: string
  /** Feed URL derivable without fetching (YouTube channel/playlist, GitHub). */
  feedUrl?: string
  handle?: string
  title?: string
}

const X_RESERVED = new Set(['home', 'explore', 'search', 'i', 'settings', 'notifications', 'messages', 'intent', 'share', 'hashtag'])
const GH_RESERVED = new Set(['orgs', 'settings', 'marketplace', 'explore', 'topics', 'features', 'about', 'login', 'notifications', 'pulls', 'issues', 'sponsors'])

/** Normalize user input to an absolute http(s) URL, or null. */
export function normalizeFeedUrl(input: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const handle = /^@([A-Za-z0-9_]{1,15})$/.exec(raw)
  if (handle) return `https://x.com/${handle[1]}`
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname || !u.hostname.includes('.')) return null
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

function host(u: URL): string {
  return u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
}

export function detectFeedSource(input: string): DetectedSource | null {
  const url = normalizeFeedUrl(input)
  if (!url) return null
  const u = new URL(url)
  const h = host(u)
  const parts = u.pathname.split('/').filter(Boolean)

  if (h === 'x.com' || h === 'twitter.com') {
    const name = parts[0]
    if (name && !X_RESERVED.has(name.toLowerCase()) && /^[A-Za-z0-9_]{1,15}$/.test(name)) {
      return { kind: 'x', url: `https://x.com/${name}`, handle: name, title: `@${name}` }
    }
    return { kind: 'x', url }
  }

  if (h === 'youtube.com' || h === 'youtu.be') {
    const list = u.searchParams.get('list')
    if (list) return { kind: 'youtube', url, feedUrl: `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(list)}` }
    if (parts[0] === 'channel' && parts[1]) {
      return { kind: 'youtube', url, feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(parts[1])}` }
    }
    if (parts[0] === 'feeds') return { kind: 'youtube', url, feedUrl: url }
    // @handle, /c/name, /user/name — feed URL comes from page autodiscovery.
    return { kind: 'youtube', url }
  }

  if (h === 'github.com') {
    const [owner, repo] = parts
    if (owner && !GH_RESERVED.has(owner.toLowerCase())) {
      if (repo) {
        const r = repo.replace(/\.git$/, '')
        if (/\.atom$/.test(r)) return { kind: 'github', url, feedUrl: url, title: owner }
        const sub = parts[2]
        if (sub === 'commits') return { kind: 'github', url, feedUrl: `https://github.com/${owner}/${r}/commits.atom`, title: `${owner}/${r}` }
        if (sub === 'tags') return { kind: 'github', url, feedUrl: `https://github.com/${owner}/${r}/tags.atom`, title: `${owner}/${r}` }
        return { kind: 'github', url: `https://github.com/${owner}/${r}`, feedUrl: `https://github.com/${owner}/${r}/releases.atom`, title: `${owner}/${r}` }
      }
      const o = owner.replace(/\.atom$/, '')
      return { kind: 'github', url: `https://github.com/${o}`, feedUrl: `https://github.com/${o}.atom`, title: o }
    }
  }

  const path = u.pathname.toLowerCase()
  if (/\.(rss|atom|xml|rdf)$/.test(path) || /\/(feed|rss|atom)(\/|\.xml)?$/.test(path) || u.searchParams.has('feed')) {
    return { kind: 'rss', url, feedUrl: url }
  }
  return { kind: 'unknown', url }
}
