/**
 * Messenger → Лента channel filter hook (PR2).
 *
 * When the user follows a public channel («Следить в Ленте»), the channel id
 * is recorded here so Лента can filter team/messenger items by `channelId`
 * (same shape as `feedItem.channelId` in the messenger contract). Fan-out of
 * live messenger events into FeedItem rows is PR3; this module only keeps the
 * subscribed-channel set the filter infra already needs.
 */
import * as storage from '@/lib/local-storage'

export interface MessengerFeedChannel {
  channelId: string
  name: string
  orgId: string
  subscribedAt: number
}

const KEY = storage.KEYS.messengerFeedChannels

type Listener = () => void
const listeners = new Set<Listener>()

function readRaw(): MessengerFeedChannel[] {
  const raw = storage.get<unknown>(KEY, null)
  if (!Array.isArray(raw)) return []
  const out: MessengerFeedChannel[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const rec = row as Record<string, unknown>
    if (typeof rec.channelId !== 'string' || !rec.channelId) continue
    if (seen.has(rec.channelId)) continue
    seen.add(rec.channelId)
    out.push({
      channelId: rec.channelId,
      name: typeof rec.name === 'string' && rec.name ? rec.name : rec.channelId,
      orgId: typeof rec.orgId === 'string' ? rec.orgId : '',
      subscribedAt: typeof rec.subscribedAt === 'number' ? rec.subscribedAt : 0,
    })
  }
  return out
}

let cache = readRaw()

function publish(next: MessengerFeedChannel[]): void {
  cache = next
  try {
    storage.set(KEY, next)
  } catch {
    // localStorage full / private mode — keep in-memory only
  }
  for (const listener of listeners) listener()
}

export function listMessengerFeedChannels(): readonly MessengerFeedChannel[] {
  return cache
}

export function setMessengerFeedChannel(input: {
  channelId: string
  name: string
  orgId: string
  subscribed: boolean
}): readonly MessengerFeedChannel[] {
  const { channelId, name, orgId, subscribed } = input
  if (!channelId) return cache
  const without = cache.filter((c) => c.channelId !== channelId)
  const next = subscribed
    ? [...without, { channelId, name: name || channelId, orgId, subscribedAt: Date.now() }]
    : without
  publish(next)
  return next
}

export function subscribeMessengerFeedChannels(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function reloadMessengerFeedChannels(): void {
  cache = readRaw()
  for (const listener of listeners) listener()
}

/** Pure filter helper for FeedView / FeedItem rows that carry `channelId`. */
export function matchesMessengerChannelFilter(
  item: { channelId?: string | null },
  channelId: string | null | undefined,
): boolean {
  if (!channelId) return true
  return item.channelId === channelId
}

/**
 * Sync Лента channel filters from the team-chat roster (viewerSubscribed),
 * not only from the follow-button click path.
 */
export function hydrateMessengerFeedChannelsFromRoster(
  orgId: string,
  channels: readonly { id: string; name: string; isDefault?: boolean; viewerSubscribed: boolean }[],
  labelOf: (channel: { id: string; name: string; isDefault?: boolean }) => string,
): void {
  if (!orgId) return
  const subscribedIds = new Set<string>()
  for (const channel of channels) {
    if (!channel.viewerSubscribed) continue
    subscribedIds.add(channel.id)
    setMessengerFeedChannel({
      channelId: channel.id,
      name: labelOf(channel),
      orgId,
      subscribed: true,
    })
  }
  for (const stored of [...listMessengerFeedChannels()]) {
    if (stored.orgId === orgId && !subscribedIds.has(stored.channelId)) {
      setMessengerFeedChannel({
        channelId: stored.channelId,
        name: stored.name,
        orgId: stored.orgId,
        subscribed: false,
      })
    }
  }
}

