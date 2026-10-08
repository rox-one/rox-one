/**
 * W1-02 — Link extraction from documents and messages.
 *
 * Explicit-syntax-only policy (product decision): only explicit syntax
 * creates links —
 * - `[[kind:id|label]]` / `![[kind:id]]` embeds / `[[plain note]]` wikilinks,
 * - `rox://...` deep links,
 * - structured mention nodes (`mention` / `entityRef` / `wikilink` nodes/marks).
 *
 * Bare `kind:id` in prose (e.g. `doc:2`, `user:admin`, `file:///Users/...`)
 * must NOT create links. The free-text regex path is disabled; route-form
 * `rox://` links are parsed here (conservatively — null on ambiguous shapes)
 * in addition to the renderer normalisation before persistence.
 */

import { parseEntityRef, type EntityRef } from '@rox/core/entities'

export interface ExtractedLink {
  to: EntityRef
  blockId?: string
  seq?: number
  line?: number
}

/** Matches `[[target#heading|alias]]` and `![[target|alias]]` embeds. */
const WIKILINK_RE = /!?\[\[([^\]\n|#]+?)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g

/** Wikilink targets, trimmed and de-duplicated in first-seen order. */
export function extractWikilinkTargets(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(WIKILINK_RE)) {
    const target = (match[1] ?? '').trim()
    if (!target || seen.has(target)) continue
    seen.add(target)
    out.push(target)
  }
  return out
}

/**
 * Disabled free-text path (explicit-syntax-only policy).
 *
 * Bare `kind:id` in prose — e.g. `doc:2`, `user:admin`, `file:///Users/...`,
 * `https://example.com/doc:2` — must NOT create links. Kept as an inert
 * export so existing imports keep compiling; always returns [].
 */
export function extractEntityRefsFromText(_text: string): ExtractedLink[] {
  return []
}

/** Wikilink targets as refs: entity literals first, plain targets fall back to `note`. Supports `![[...]]` embeds. */
export function wikilinkTargetsToRefs(text: string): ExtractedLink[] {
  const out: ExtractedLink[] = []
  const seen = new Set<string>()
  const FULL_RE = /!?\[\[([^\]\n|]+?)(?:\|[^\]\n]*)?\]\]/g
  for (const match of text.matchAll(FULL_RE)) {
    const inner = (match[1] ?? '').trim()
    if (!inner) continue
    const parsed = parseEntityRef(inner)
    let ref: EntityRef
    if (parsed.ok) {
      ref = parsed.value
    } else {
      const hashIndex = inner.indexOf('#')
      const target = (hashIndex === -1 ? inner : inner.slice(0, hashIndex)).trim()
      if (!target || target.includes(':')) continue
      ref = { kind: 'note' as const, id: target }
    }
    const key = `${ref.kind}:${ref.id}#${ref.fragment ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ to: ref })
  }
  return out
}

interface TiptapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
}

/** Matches `rox://...` deep links (trailing punctuation trimmed at parse time). */
const ROX_URL_RE = /\brox:\/\/[^\s\]\)"'<>]+/g

const DOCS_KINDS: Record<string, EntityRef['kind']> = {
  file: 'file',
  folder: 'folder',
  link: 'drive-link',
  wiki: 'wiki-space',
}

const CALENDAR_KINDS: Record<string, EntityRef['kind']> = {
  event: 'calendar-event',
  reminder: 'reminder',
  cal: 'calendar',
  room: 'room',
}

const CONTACT_KINDS: Record<string, EntityRef['kind']> = {
  company: 'crm-company',
  person: 'person',
  department: 'department',
  invitations: 'invitation',
}

function nonEmptyId(value: string): boolean {
  try {
    return decodeURIComponent(value).length > 0
  } catch {
    return false
  }
}

function decodeId(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

/**
 * Map a bare app route (no `rox://` scheme) to a ref.
 *
 * Conservative link-only matcher for `rox://` extraction. The renderer
 * `route-parser.ts` remains the navigation source of truth; ambiguous or
 * malformed shapes return null and create no link. Covers the frozen legacy
 * routes 1:1 plus the kind-first entity routes.
 */
function roxRouteToRef(route: string): EntityRef | null {
  const queryIndex = route.indexOf('?')
  const hashIndex = route.indexOf('#')
  const cut = queryIndex === -1 ? route.length : queryIndex
  const hashCut = hashIndex === -1 ? route.length : hashIndex
  const end = Math.min(cut, hashCut)
  const pathPart = route.slice(0, end)
  const queryPart = queryIndex === -1 ? undefined : route.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex)
  const fragmentRaw = hashIndex === -1 ? undefined : route.slice(hashIndex + 1)
  if (fragmentRaw !== undefined && fragmentRaw.length === 0) return null
  const segments = pathPart.split('/')
  if (segments.some(segment => !segment)) return null
  for (const segment of segments) {
    try {
      decodeURIComponent(segment)
    } catch {
      return null
    }
  }
  const query = queryPart === undefined ? new Map<string, string>() : new URLSearchParams(queryPart)
  const first = segments[0]
  const id = (index: number): string | null => (segments[index] !== undefined && nonEmptyId(segments[index]!) ? decodeId(segments[index]!) : null)

  // Frozen legacy routes (1:1 kind mapping).
  const legacyTwo: Record<string, EntityRef['kind']> = {
    'notes/note': 'note',
    'tasks/task': 'task',
    'projects/project': 'project',
    'pages/page': 'page',
    'skills/skill': 'skill',
    'sources/source': 'source',
    'automations/automation': 'automation',
    'meetings/meeting': 'call',
  }
  if (segments.length === 3 && segments[1] !== undefined) {
    const key = `${first}/${segments[1]}`
    const kind = legacyTwo[key]
    if (kind) {
      if (queryPart !== undefined && queryPart.length > 0) return null
      if (fragmentRaw !== undefined) return null
      const v = id(2)
      // allSessions/session is handled above; it maps to session, not note.
      if (key === 'notes/note' || key === 'tasks/task' || key === 'projects/project' || key === 'pages/page' || key === 'skills/skill' || key === 'sources/source' || key === 'automations/automation' || key === 'meetings/meeting') {
        if (!v) return null
        if (key === 'meetings/meeting') return { kind: 'call', id: v }
        return { kind, id: v } as EntityRef
      }
    }
  }
  if (first === 'allSessions' && segments.length === 3 && segments[1] === 'session') {
    const v = id(2)
    if (!v || (queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined) return null
    return { kind: 'session', id: v }
  }
  if ((first === 'inbox' || first === 'feed') && segments.length === 3 && segments[1] === 'item') {
    if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined) return null
    const v = id(2)
    if (!v) return null
    return first === 'inbox' ? { kind: 'mail-thread', id: v } : { kind: 'feed-item', id: v }
  }

  // Kind-first entity routes.
  if (first === 'docs') {
    if ((queryPart !== undefined && queryPart.length > 0) || segments.length < 3) return null
    const kind = DOCS_KINDS[segments[1]!]
    if (!kind) return null
    const v = id(2)
    if (!v) return null
    if (kind === 'wiki-space') {
      if (fragmentRaw !== undefined) return null
      const frag = segments.length > 3 ? segments.slice(3).join('/') : undefined
      if (frag !== undefined && frag.length === 0) return null
      return frag ? { kind, id: v, fragment: frag } : { kind, id: v }
    }
    if (segments.length !== 3 || fragmentRaw !== undefined) return null
    return { kind, id: v }
  }
  if (first === 'messenger') {
    if (segments.length !== 2 || fragmentRaw !== undefined) return null
    const v = id(1)
    if (!v) return null
    const seq = query.size === 1 ? query.get('seq') : null
    if (seq) {
      if (!nonEmptyId(seq)) return null
      const decoded = decodeId(seq)
      if (!decoded) return null
      return { kind: 'channel-message', id: v, fragment: decoded }
    }
    if (queryPart !== undefined && queryPart.length > 0) return null
    return { kind: 'channel', id: v }
  }
  if (first === 'calendar') {
    if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined || segments.length !== 3) return null
    const kind = CALENDAR_KINDS[segments[1]!]
    const v = id(2)
    return kind && v ? { kind, id: v } : null
  }
  if (first === 'goals') {
    const head = segments[1]
    if (head === 'goal') {
      if (segments.length !== 3) return null
      if (queryPart !== undefined && queryPart.length > 0) return null
      const v = id(2)
      if (!v) return null
      if (fragmentRaw === undefined) return { kind: 'goal', id: v }
      const frag = (() => {
        try {
          return decodeURIComponent(fragmentRaw)
        } catch {
          return null
        }
      })()
      if (!frag) return null
      if (frag.startsWith('t-') && frag.length > 2) return { kind: 'goal-target', id: v, fragment: frag.slice(2) }
      if (frag.startsWith('k-') && frag.length > 2) return { kind: 'goal-check', id: v, fragment: frag.slice(2) }
      return null
    }
    if (head === 'space') {
      if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined) return null
      const v = id(2)
      if (!v) return null
      if (segments.length === 3) return { kind: 'space', id: v }
      if (segments.length >= 4 && segments[3] === 'kpis') {
        const frag = segments.length > 4 ? segments.slice(4).join('/') : undefined
        return frag ? { kind: 'kpi', id: v, fragment: frag } : { kind: 'kpi', id: v }
      }
      return null
    }
    if (head === 'okrs') {
      if (segments.length !== 2 || fragmentRaw !== undefined) return null
      const cycle = query.size === 1 ? query.get('cycle') : null
      if (!cycle || !nonEmptyId(cycle)) return null
      const decoded = decodeId(cycle)
      return decoded ? { kind: 'okr-cycle', id: decoded } : null
    }
    if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined || segments.length !== 3) return null
    const v = id(2)
    if (!v) return null
    if (head === 'check-in') return { kind: 'check-in', id: v }
    if (head === 'review') return { kind: 'review', id: v }
    if (head === 'kpis') return { kind: 'kpi-entry', id: v }
    if (head === 'templates') return { kind: 'project-template', id: v }
    return null
  }
  if (first === 'contacts') {
    if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined || segments.length !== 3) return null
    const kind = CONTACT_KINDS[segments[1]!]
    const v = id(2)
    return kind && v ? { kind, id: v } : null
  }
  if (first === 'workflows') {
    if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined) return null
    if (segments.length === 2) {
      if (segments[1] === 'run') return null
      const v = id(1)
      return v ? { kind: 'workflow', id: v } : null
    }
    if (segments.length === 3 && segments[1] === 'run') {
      const v = id(2)
      return v ? { kind: 'workflow-run', id: v } : null
    }
    return null
  }
  if (first === 'base') {
    if (fragmentRaw !== undefined) return null
    if (segments.length === 2) {
      if (queryPart !== undefined && queryPart.length > 0) return null
      const v = id(1)
      return v ? { kind: 'base', id: v } : null
    }
    if (segments.length === 3) {
      if (queryPart !== undefined && queryPart.length > 0) return null
      const v = id(1)
      const table = id(2)
      return v && table ? { kind: 'base-table', id: v, fragment: table } : null
    }
    if (segments.length === 4) {
      const v = id(1)
      if (!v || !nonEmptyId(segments[2]!) || !nonEmptyId(segments[3]!)) return null
      const table = decodeId(segments[2]!)
      const view = decodeId(segments[3]!)
      if (!table || !view) return null
      const record = query.size === 0 ? null : query.size === 1 ? query.get('record') : ''
      if (record) {
        if (!nonEmptyId(record)) return null
        const decoded = decodeId(record)
        if (!decoded) return null
        return { kind: 'base-record', id: v, fragment: `${table}/${view}/${decoded}` }
      }
      if (queryPart !== undefined && queryPart.length > 0) return null
      return { kind: 'base-view', id: v, fragment: `${table}/${view}` }
    }
    return null
  }
  if (first === 'tasks' && segments.length === 3 && fragmentRaw === undefined) {
    const v = id(2)
    if (!v) return null
    if (segments[1] === 'group') {
      if (queryPart !== undefined && queryPart.length > 0) return null
      return { kind: 'task-list-group', id: v }
    }
    if (segments[1] !== 'list') return null
    const section = query.size === 1 ? query.get('section') : null
    if (section) {
      if (!nonEmptyId(section)) return null
      const decoded = decodeId(section)
      return decoded ? { kind: 'task-section', id: v, fragment: decoded } : null
    }
    if (queryPart !== undefined && queryPart.length > 0) return null
    return { kind: 'task-list', id: v }
  }
  if (first === 'projects' && segments.length === 3 && segments[1] === 'milestone') {
    if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined) return null
    const v = id(2)
    return v ? { kind: 'milestone', id: v } : null
  }
  if (first === 'settings' && segments.length === 3 && segments[1] === 'licences') {
    if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined) return null
    const v = id(2)
    return v ? { kind: 'license-component', id: v } : null
  }
  if (first === 'home' && segments.length === 3 && segments[1] === 'apps') {
    if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined) return null
    const v = id(2)
    return v ? { kind: 'app', id: v } : null
  }
  if ((first === 'forms' || first === 'comments') && segments.length === 2) {
    if ((queryPart !== undefined && queryPart.length > 0) || fragmentRaw !== undefined) return null
    const v = id(1)
    if (!v) return null
    return first === 'forms' ? { kind: 'form', id: v } : { kind: 'comment', id: v }
  }
  return null
}

/** `rox://...` deep links in text, mapped to refs (conservative: ambiguous shapes yield nothing). */
export function extractRoxDeepLinks(text: string): ExtractedLink[] {
  const out: ExtractedLink[] = []
  const seen = new Set<string>()
  for (const raw of text.matchAll(ROX_URL_RE)) {
    let token = raw[0].replace(/[.,;!?)]+$/, '')
    let url: URL
    try {
      url = new URL(token)
    } catch {
      continue
    }
    if (url.protocol !== 'rox:') continue
    const host = url.hostname
    if (!host || host === 'action' || host === 'auth-callback' || host === 'runtime') continue
    let route: string
    if (host === 'workspace') {
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length < 2) continue
      route = parts.slice(1).join('/') + url.search + url.hash
    } else {
      route = `${host}${url.pathname}${url.search}${url.hash}`
    }
    // Strip a single leading slash artefact from URL pathname joins (none expected).
    route = route.replace(/^\/+/, '')
    const ref = roxRouteToRef(route)
    if (!ref) continue
    const key = `${ref.kind}:${ref.id}#${ref.fragment ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ to: ref })
  }
  return out
}

interface TiptapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
}

function nodeBlockId(node: TiptapNode): string | undefined {
  const blockId = node.attrs?.blockId
  if (typeof blockId === 'string' && blockId.length > 0) return blockId
  // TipTap exposes block ids as `attrs.id` on block containers. Inline
  // mention/entity nodes carry the entity id in `attrs.id`, which must NOT
  // be mistaken for a block anchor.
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem' || node.type === 'blockquote' || node.content) {
    const id = node.attrs?.id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return undefined
}

/**
 * Walk a TipTap JSON document and collect outbound links, attributing each to
 * the nearest enclosing block id (TipTap exposes block ids as node attrs).
 */
export function extractLinksFromTiptapDoc(doc: TiptapNode): ExtractedLink[] {
  const out: ExtractedLink[] = []
  const seen = new Set<string>()

  const push = (link: ExtractedLink) => {
    const key = `${link.to.kind}:${link.to.id}#${link.to.fragment ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(link)
  }

  const walk = (node: TiptapNode, blockId: string | undefined): void => {
    const currentBlock = nodeBlockId(node) ?? blockId
    const pushRef = (ref: EntityRef) => {
      const link: ExtractedLink = { to: ref }
      if (currentBlock) link.blockId = currentBlock
      push(link)
    }

    const pushMentionTarget = (target: unknown) => {
      if (typeof target === 'string') {
        const trimmed = target.trim()
        if (!trimmed) return
        const parsed = parseEntityRef(trimmed)
        if (parsed.ok) pushRef(parsed.value)
        return
      }
      if (target && typeof target === 'object') {
        const record = target as Record<string, unknown>
        const kind = record.kind
        const id = record.id
        if (typeof kind === 'string' && typeof id === 'string' && kind.length > 0 && id.length > 0) {
          const fragment = record.fragment
          const literal =
            typeof fragment === 'string' && fragment.length > 0 ? `${kind}:${id}#${fragment}` : `${kind}:${id}`
          const parsed = parseEntityRef(literal)
          if (parsed.ok) pushRef(parsed.value)
        }
      }
    }
    for (const mark of node.marks ?? []) {
      if ((mark.type === 'wikilink' || mark.type === 'mention' || mark.type === 'entityMention') && typeof mark.attrs?.target === 'string') {
        const target = (mark.attrs.target as string).trim()
        if (target.length === 0) continue
        const parsed = parseEntityRef(target)
        if (parsed.ok) {
          const link: ExtractedLink = { to: parsed.value }
          if (currentBlock) link.blockId = currentBlock
          push(link)
        } else if (!target.includes(':')) {
          const hashIndex = target.indexOf('#')
          const plain = (hashIndex === -1 ? target : target.slice(0, hashIndex)).trim()
          if (plain.length > 0) push({ to: { kind: 'note', id: plain }, blockId: currentBlock })
        }
      } else if (mark.type === 'mention' || mark.type === 'entityMention') {
        pushMentionTarget(mark.attrs?.ref ?? mark.attrs?.entityRef ?? mark.attrs)
      }
    }
    if (node.type === 'wikilink' || node.type === 'entityRef') {
      const target = node.attrs?.target ?? node.attrs?.ref
      if (typeof target === 'string') {
        const parsed = parseEntityRef(target)
        if (parsed.ok) {
          const link: ExtractedLink = { to: parsed.value }
          if (currentBlock) link.blockId = currentBlock
          push(link)
        }
      }
    } else if (node.type === 'mention' || node.type === 'entityMention') {
      pushMentionTarget(node.attrs?.ref ?? node.attrs?.entityRef ?? node.attrs?.target ?? node.attrs)
    }
    if (node.text) {
      for (const link of wikilinkTargetsToRefs(node.text)) {
        if (currentBlock) link.blockId = currentBlock
        push(link)
      }
      for (const link of extractRoxDeepLinks(node.text)) {
        if (currentBlock) link.blockId = currentBlock
        push(link)
      }
    }
    for (const child of node.content ?? []) walk(child, currentBlock)
  }

  walk(doc, undefined)
  return out
}

export interface ExtractableMessage {
  content: string
  /** Message sequence within its channel; recorded as the link anchor. */
  sequence?: number
}

/** Extract outbound links from a chat message, anchored by its sequence. Explicit syntax only. */
export function extractLinksFromMessage(message: ExtractableMessage): ExtractedLink[] {
  const out: ExtractedLink[] = []
  const seen = new Set<string>()
  const push = (link: ExtractedLink) => {
    const key = `${link.to.kind}:${link.to.id}#${link.to.fragment ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(link)
  }
  for (const link of wikilinkTargetsToRefs(message.content)) {
    if (message.sequence !== undefined) link.seq = message.sequence
    push(link)
  }
  for (const link of extractRoxDeepLinks(message.content)) {
    if (message.sequence !== undefined) link.seq = message.sequence
    push(link)
  }
  return out
}