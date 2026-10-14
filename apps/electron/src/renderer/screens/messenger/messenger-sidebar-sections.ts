import type { SidebarSection, SidebarSectionItem } from '../sidebar-section'
import { nonEmptySections } from '../sidebar-section'

export interface MessengerBindingInput {
  id: string
  sessionId: string
  platform: string
  channelId: string
  threadId?: number
  channelName?: string
  enabled: boolean
  createdAt: number
}

export interface MessengerSessionInput {
  name?: string
  isFlagged?: boolean
  hasUnread?: boolean
  lastMessageAt?: number
}

export type MessengerChatKind = 'thread' | 'channel' | 'direct'

/**
 * Classify a binding. Bindings don't persist the platform chat type yet
 * (server follow-up: store `chatType` on the binding), so this uses the
 * platforms' id conventions: Telegram group/supergroup ids are negative,
 * WhatsApp groups end in `@g.us`, Lark group chats start with `oc_`,
 * Discord bindings are guild channels. Everything else is a direct chat.
 */
export function classifyBinding(b: Pick<MessengerBindingInput, 'platform' | 'channelId' | 'threadId'>): MessengerChatKind {
  if (b.threadId != null) return 'thread'
  const id = b.channelId
  switch (b.platform) {
    case 'telegram': return id.startsWith('-') ? 'channel' : 'direct'
    case 'whatsapp': return id.endsWith('@g.us') ? 'channel' : 'direct'
    case 'lark': return id.startsWith('oc_') ? 'channel' : 'direct'
    case 'discord': return 'channel'
    default: return 'direct'
  }
}

/**
 * Мессенджер second sidebar: Закреплённое (bound chats whose session is
 * pinned) → Каналы → Личные → Треды, newest activity first. Each row opens
 * the bound session.
 */
export function buildMessengerSidebarSections(
  bindings: readonly MessengerBindingInput[],
  sessions: ReadonlyMap<string, MessengerSessionInput>,
): SidebarSection[] {
  const live = bindings
    .filter((b) => b.enabled && sessions.has(b.sessionId))
    .map((b) => ({ b, s: sessions.get(b.sessionId)! }))
    .sort((x, y) => (y.s.lastMessageAt ?? y.b.createdAt) - (x.s.lastMessageAt ?? x.b.createdAt) || x.b.id.localeCompare(y.b.id))
  const groups: Record<'pinned' | MessengerChatKind, SidebarSectionItem[]> = { pinned: [], channel: [], direct: [], thread: [] }
  for (const { b, s } of live) {
    const kind = classifyBinding(b)
    const title = b.channelName?.trim() || s.name?.trim()
    const item: SidebarSectionItem = {
      id: b.id,
      ...(title ? { label: title } : { labelKey: 'screens.messenger.untitled' }),
      icon: `platform:${b.platform}`,
      secondary: b.platform,
      ...(s.hasUnread ? { badge: 'unread' as const } : {}),
      target: { kind: 'session', sessionId: b.sessionId },
    }
    groups[s.isFlagged ? 'pinned' : kind].push(item)
  }
  return nonEmptySections([
    { id: 'pinned', titleKey: 'screens.messenger.groups.pinned', items: groups.pinned, limit: 5, collapsible: true },
    { id: 'channels', titleKey: 'screens.messenger.groups.channels', items: groups.channel, limit: 8, collapsible: true },
    { id: 'direct', titleKey: 'screens.messenger.groups.direct', items: groups.direct, limit: 8, collapsible: true },
    { id: 'threads', titleKey: 'screens.messenger.groups.threads', items: groups.thread, limit: 8, collapsible: true },
  ])
}
