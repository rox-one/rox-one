/**
 * W1-02 — Link extraction from documents and messages.
 *
 * Extracts entity refs from plain text, TipTap JSON documents and chat
 * messages. Recognises `[[wikilinks]]` (→ `note:<target>`) and canonical
 * `kind:id[#fragment]` refs. Route-form `rox://` links are normalised to refs
 * by the renderer before persistence, so only the canonical grammar is parsed.
 */

import { parseEntityRef, type EntityRef } from '@rox/core/entities'

export interface ExtractedLink {
  to: EntityRef
  blockId?: string
  seq?: number
  line?: number
}

/** Matches `[[target#heading|alias]]` (mirrors the TipTap / vault wiki regexes). */
const WIKILINK_RE = /\[\[([^\]\n|#]+?)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g

/** Matches canonical `kind:id[#fragment]` refs in free text. */
const ENTITY_REF_RE = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*):([A-Za-z0-9_./-]+)(?:#([A-Za-z0-9_-]+))?/g

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

/** Canonical `kind:id` refs found in free text, with the 1-based line anchor. */
export function extractEntityRefsFromText(text: string): ExtractedLink[] {
  const out: ExtractedLink[] = []
  const seen = new Set<string>()
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i]!.matchAll(ENTITY_REF_RE)) {
      const literal = match[3] ? `${match[1]}:${match[2]}#${match[3]}` : `${match[1]}:${match[2]}`
      const parsed = parseEntityRef(literal)
      if (!parsed.ok) continue
      const key = `${parsed.value.kind}:${parsed.value.id}#${parsed.value.fragment ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ to: parsed.value, line: i + 1 })
    }
  }
  return out
}

/** Wikilink targets as `note` refs. */
export function wikilinkTargetsToRefs(text: string): ExtractedLink[] {
  return extractWikilinkTargets(text).map(target => ({ to: { kind: 'note' as const, id: target } }))
}

interface TiptapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
}

function nodeBlockId(node: TiptapNode): string | undefined {
  const id = node.attrs?.id ?? node.attrs?.blockId
  return typeof id === 'string' && id.length > 0 ? id : undefined
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
    for (const mark of node.marks ?? []) {
      if (mark.type === 'wikilink' && typeof mark.attrs?.target === 'string') {
        const target = mark.attrs.target
        if (target.length > 0) push({ to: { kind: 'note', id: target }, blockId: currentBlock })
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
    }
    if (node.text) {
      for (const link of wikilinkTargetsToRefs(node.text)) {
        if (currentBlock) link.blockId = currentBlock
        push(link)
      }
      for (const link of extractEntityRefsFromText(node.text)) {
        delete link.line
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

/** Extract outbound links from a chat message, anchored by its sequence. */
export function extractLinksFromMessage(message: ExtractableMessage): ExtractedLink[] {
  const out: ExtractedLink[] = []
  const seen = new Set<string>()
  const push = (link: ExtractedLink) => {
    const key = `${link.to.kind}:${link.to.id}#${link.to.fragment ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(link)
  }
  for (const link of extractEntityRefsFromText(message.content)) {
    delete link.line
    if (message.sequence !== undefined) link.seq = message.sequence
    push(link)
  }
  for (const link of wikilinkTargetsToRefs(message.content)) {
    if (message.sequence !== undefined) link.seq = message.sequence
    push(link)
  }
  return out
}