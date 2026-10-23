/**
 * Messenger → Лента fan-out (PR3).
 *
 * When a channel is followed («Следить в Ленте»), posted/ingested messages are
 * recorded here as team-tab FeedItems with `channelId` so the PR2 channel
 * filter can narrow them. Items live in localStorage (eu-swiss offline OK).
 */
import type { FeedItem } from '@rox/shared/feed'
import * as storage from '@/lib/local-storage'

const KEY = storage.KEYS.messengerFeedItems
const MAX_ITEMS = 400

export interface MessengerFeedItemRecord {
  id: string
  channelId: string
  messageId: string
  senderId: string
  text: string
  at: number
  channelName?: string
}

type Listener = () => void
const listeners = new Set<Listener>()

function readRaw(): MessengerFeedItemRecord[] {
  const raw = storage.get<unknown>(KEY, null)
  if (!Array.isArray(raw)) return []
  const out: MessengerFeedItemRecord[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const rec = row as Record<string, unknown>
    if (typeof rec.id !== 'string' || !rec.id) continue
    if (typeof rec.channelId !== 'string' || !rec.channelId) continue
    if (typeof rec.messageId !== 'string' || !rec.messageId) continue
    if (typeof rec.senderId !== 'string' || !rec.senderId) continue
    if (typeof rec.text !== 'string') continue
    if (typeof rec.at !== 'number' || !Number.isFinite(rec.at)) continue
    if (seen.has(rec.id)) continue
    seen.add(rec.id)
    out.push({
      id: rec.id,
      channelId: rec.channelId,
      messageId: rec.messageId,
      senderId: rec.senderId,
      text: rec.text.slice(0, 4000),
      at: rec.at,
      ...(typeof rec.channelName === 'string' && rec.channelName ? { channelName: rec.channelName } : {}),
    })
  }
  return out
}

let cache = readRaw()

function publish(next: MessengerFeedItemRecord[]): void {
  cache = next
  try {
    storage.set(KEY, next)
  } catch {
    // localStorage full / private mode — keep in-memory only
  }
  for (const listener of listeners) listener()
}

export function listMessengerFeedItems(): readonly MessengerFeedItemRecord[] {
  return cache
}

export function subscribeMessengerFeedItems(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function recordMessengerFeedItem(input: {
  channelId: string
  messageId: string
  senderId: string
  text: string
  at: number
  channelName?: string
}): MessengerFeedItemRecord | null {
  const { channelId, messageId, senderId, text, at, channelName } = input
  if (!channelId || !messageId || !senderId) return null
  const id = `messenger:${channelId}:${messageId}`
  if (cache.some((row) => row.id === id)) {
    return cache.find((row) => row.id === id) ?? null
  }
  const row: MessengerFeedItemRecord = {
    id,
    channelId,
    messageId,
    senderId,
    text: text.slice(0, 4000),
    at: Number.isFinite(at) ? at : Date.now(),
    ...(channelName ? { channelName } : {}),
  }
  // Newest first; trim tail.
  publish([row, ...cache].slice(0, MAX_ITEMS))
  return row
}

/** Map stored messenger rows into Лента team-tab FeedItems (with channelId). */
export function buildMessengerFeedItems(
  rows: readonly MessengerFeedItemRecord[],
  titleOf: (row: MessengerFeedItemRecord) => string,
): FeedItem[] {
  return rows.map((row) => ({
    id: row.id,
    tab: 'team' as const,
    kind: 'team-activity' as const,
    title: titleOf(row),
    summary: row.text.slice(0, 140),
    at: row.at,
    channelId: row.channelId,
    author: row.senderId,
    ref: { type: 'message' as const, id: row.messageId, parentId: row.channelId },
  }))
}

export function reloadMessengerFeedItems(): void {
  cache = readRaw()
  for (const listener of listeners) listener()
}
