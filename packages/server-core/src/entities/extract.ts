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

import {
  classifyWikilinkTarget,
  entityRefKey,
  parseEntityRouteOrLegacy,
  type EntityRef,
} from '@rox/core/entities'

export interface ExtractedLink {
  to: EntityRef
  /**
   * Set only for block embeds (`entityEmbed` TipTap nodes). Absent means the
   * default mention/wikilink relation chosen by the indexer.
   */
  relation?: 'embeds'
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
 * Lenient wikilink target parse shared by the text, mark and node paths.
 *
 * Delegates to the shared classifier in `@rox/core/entities`
 * (`classifyWikilinkTarget`) so the editor's mention/embed nodes and the
 * link index agree:
 * - Direct entity literals win (including kind aliases like `doc:hello`).
 * - `unexpected-fragment` re-parses the part before `#` and links to the
 *   entity (`[[note:abc#Heading]]` → `note:abc`).
 * - A `prefix:` that is not a known kind, or an id with leading whitespace,
 *   makes the whole target a plain note title (`[[Встреча: итоги]]`,
 *   `[[doc: plan]]`). Nothing is trimmed silently.
 */
export function parseWikilinkTarget(inner: string): EntityRef | null {
  return classifyWikilinkTarget(inner)?.ref ?? null
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
    const ref = parseWikilinkTarget(inner)
    if (!ref) continue
    const key = entityRefKey(ref)
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

/**
 * `rox://` routes parse through the single shared grammar in
 * `@rox/core/entities` (`parseEntityRouteOrLegacy`: kind-first entity routes
 * plus the frozen legacy shapes, all percent-decoded). The renderer
 * `route-parser.ts` remains the navigation source of truth; ambiguous or
 * malformed shapes return null and create no link.
 */
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
    const ref = parseEntityRouteOrLegacy(route)?.ref ?? null
    if (!ref) continue
    const key = entityRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ to: ref })
  }
  return out
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
    // Embeds dedupe separately so a mention and an embed of the same entity
    // both survive (different relations).
    const key = link.relation ? `${link.relation}|${entityRefKey(link.to)}` : entityRefKey(link.to)
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
        const ref = parseWikilinkTarget(trimmed)
        if (ref) pushRef(ref)
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
          const ref = parseWikilinkTarget(literal)
          if (ref) pushRef(ref)
        }
      }
    }
    for (const mark of node.marks ?? []) {
      if ((mark.type === 'wikilink' || mark.type === 'mention' || mark.type === 'entityMention') && typeof mark.attrs?.target === 'string') {
        const target = (mark.attrs.target as string).trim()
        if (target.length === 0) continue
        const ref = parseWikilinkTarget(target)
        if (ref) {
          const link: ExtractedLink = { to: ref }
          if (currentBlock) link.blockId = currentBlock
          push(link)
        }
      } else if (mark.type === 'mention' || mark.type === 'entityMention') {
        pushMentionTarget(mark.attrs?.ref ?? mark.attrs?.entityRef ?? mark.attrs)
      }
    }
    if (node.type === 'wikilink' || node.type === 'entityRef') {
      const target = node.attrs?.target ?? node.attrs?.ref
      if (typeof target === 'string') {
        const trimmed = target.trim()
        if (trimmed) {
          const ref = parseWikilinkTarget(trimmed)
          if (ref) {
            const link: ExtractedLink = { to: ref }
            if (currentBlock) link.blockId = currentBlock
            push(link)
          }
        }
      }
    } else if (node.type === 'mention' || node.type === 'entityMention') {
      pushMentionTarget(node.attrs?.ref ?? node.attrs?.entityRef ?? node.attrs?.target ?? node.attrs)
    } else if (node.type === 'entityEmbed') {
      // W1-08 block embed (`![[kind:id]]`): `attrs.ref` is the canonical ref.
      const target = node.attrs?.ref
      if (typeof target === 'string' && target.trim()) {
        const ref = parseWikilinkTarget(target.trim())
        if (ref) {
          const link: ExtractedLink = { to: ref, relation: 'embeds' }
          if (currentBlock) link.blockId = currentBlock
          push(link)
        }
      }
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
    const key = entityRefKey(link.to)
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