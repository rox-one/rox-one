/**
 * W1-08 (#1505) — grouping for the "Referenced in" panel (UI-SPEC §4.4):
 * Tasks / Docs / Projects / Goals / Meetings / Chats / Other.
 */
import { formatEntityRef, kindDescriptor, type EntityKind, type EntityLink } from '@rox/core/entities'

export const BACKLINK_GROUPS = ['tasks', 'docs', 'projects', 'goals', 'meetings', 'chats', 'other'] as const
export type BacklinkGroup = (typeof BACKLINK_GROUPS)[number]

const GOAL_KINDS = new Set<EntityKind>(['goal', 'goal-target', 'goal-check', 'check-in', 'okr-cycle', 'kpi', 'kpi-entry', 'review', 'milestone'])
const MEETING_KINDS = new Set<EntityKind>(['calendar-event', 'call', 'room', 'calendar'])
const CHAT_KINDS = new Set<EntityKind>(['session', 'channel', 'channel-message', 'mail-thread', 'comment'])

export function backlinkGroupOf(kind: EntityKind): BacklinkGroup {
  if (GOAL_KINDS.has(kind)) return 'goals'
  if (MEETING_KINDS.has(kind)) return 'meetings'
  if (CHAT_KINDS.has(kind)) return 'chats'
  switch (kindDescriptor(kind)?.searchCategory) {
    case 'tasks': return 'tasks'
    case 'docs':
    case 'pages':
    case 'files': return 'docs'
    case 'projects': return 'projects'
    case 'calendar': return 'meetings'
    case 'sessions':
    case 'chats':
    case 'messages': return 'chats'
    default: return 'other'
  }
}

export interface BacklinkSource {
  /** The referring entity (`link.from`). */
  key: string
  link: EntityLink
  /** All relations from this source to the target. */
  relations: EntityLink['relation'][]
}

/**
 * Group backlinks by the referring entity's kind. Multiple links from the
 * same source collapse into one row; empty groups are omitted and order
 * follows BACKLINK_GROUPS.
 */
export function groupBacklinks(links: readonly EntityLink[]): Array<{ group: BacklinkGroup; sources: BacklinkSource[] }> {
  const bySource = new Map<string, BacklinkSource>()
  for (const link of links) {
    const key = formatEntityRef(link.from)
    const existing = bySource.get(key)
    if (existing) {
      if (!existing.relations.includes(link.relation)) existing.relations.push(link.relation)
    } else {
      bySource.set(key, { key, link, relations: [link.relation] })
    }
  }
  const groups = new Map<BacklinkGroup, BacklinkSource[]>()
  for (const source of bySource.values()) {
    const group = backlinkGroupOf(source.link.from.kind)
    const list = groups.get(group) ?? []
    list.push(source)
    groups.set(group, list)
  }
  return BACKLINK_GROUPS.filter((group) => groups.has(group)).map((group) => ({ group, sources: groups.get(group)! }))
}
