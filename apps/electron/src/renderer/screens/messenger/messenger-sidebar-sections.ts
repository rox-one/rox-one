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
  /** Platform chat type, once the server records it on the binding. */
  chatType?: string
}

export interface MessengerSessionInput {
  name?: string
  isFlagged?: boolean
  hasUnread?: boolean
  lastMessageAt?: number
}

export type MessengerChatKind = 'thread' | 'channel' | 'direct' | 'chat'

/**
 * Classify a binding by the platform chat type the server records
 * (`chatType`). Until the server persists it, a binding without a type goes
 * into the neutral «Чаты» group: no guessing from id conventions.
 */
export function classifyBinding(b: Pick<MessengerBindingInput, 'threadId' | 'chatType'>): MessengerChatKind {
  if (b.threadId != null) return 'thread'
  switch (b.chatType) {
    case 'private': case 'direct': case 'dm': return 'direct'
    case 'group': case 'supergroup': case 'channel': return 'channel'
    default: return 'chat'
  }
}

export interface MessengerSessionProjection extends MessengerSessionInput { id: string }

/** Only the session fields the sidebar reads (keeps streaming ticks from republishing). */
export function projectMessengerSessions(metas: Iterable<MessengerSessionProjection>): MessengerSessionProjection[] {
  const out: MessengerSessionProjection[] = []
  for (const m of metas) out.push({ id: m.id, name: m.name, isFlagged: m.isFlagged, hasUnread: m.hasUnread, lastMessageAt: m.lastMessageAt })
  return out
}

export function sameMessengerSessions(a: readonly MessengerSessionProjection[], b: readonly MessengerSessionProjection[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => {
    const y = b[i]!
    return x.id === y.id && x.name === y.name && x.isFlagged === y.isFlagged && x.hasUnread === y.hasUnread && x.lastMessageAt === y.lastMessageAt
  }))
}

/**
 * Мессенджер second sidebar: Закреплённое (bound chats whose session is
 * pinned) → Каналы → Личные → Чаты (type unknown) → Треды, newest activity first. Each row opens
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
  const groups: Record<'pinned' | MessengerChatKind, SidebarSectionItem[]> = { pinned: [], channel: [], direct: [], chat: [], thread: [] }
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
    { id: 'chats', titleKey: 'screens.messenger.groups.chats', items: groups.chat, limit: 8, collapsible: true },
    { id: 'threads', titleKey: 'screens.messenger.groups.threads', items: groups.thread, limit: 8, collapsible: true },
  ])
}
