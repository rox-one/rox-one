/**
 * Issue 06 leftover: named entities, ranked link suggestions, and footnote chrome.
 * Pure Markdown projections — no SQLite, no network.
 */

export type VaultEntityKind = 'person' | 'org' | 'place' | 'date' | 'note' | 'mention'

export type VaultCatalogEntry = {
  id: string
  title: string
  aliases: string[]
}

export type VaultInsightLink = {
  target: string
  alias?: string
  line: number
}

export type VaultNamedEntity = {
  id: string
  name: string
  kind: VaultEntityKind
  documentId: string
  line: number
  evidence: string
}

export type VaultLinkSuggestion = {
  targetId: string
  targetTitle: string
  mention: string
  line: number
  score: number
  reason: 'title' | 'alias' | 'prefix'
  preview: string
}

export type VaultBrokenLink = {
  target: string
  line: number
  preview: string
}

export type VaultEntityMerge = {
  fromId: string
  fromName: string
  toId: string
  toName: string
  reason: 'normalized' | 'alias'
}

export type VaultFootnoteChrome = {
  id: string
  hasRef: boolean
  hasDef: boolean
  orphan: boolean
  unused: boolean
  line: number
  text: string
}

export type VaultInsights = {
  entities: VaultNamedEntity[]
  linkSuggestions: VaultLinkSuggestion[]
  unlinkedMentions: VaultLinkSuggestion[]
  brokenLinks: VaultBrokenLink[]
  suggestedMerges: VaultEntityMerge[]
  footnotes: VaultFootnoteChrome[]
}

const SPECIAL_TARGET_RE = /^(session:|@session\/|calendar:|https?:\/\/)/i
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/g
const PROPER_RE = /\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*){1,3}/gu
const WIKILINK_RE = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g
const FENCE_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`[^`]+`/g
const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.*)$/gm
const FOOTNOTE_REF_RE = /\[\^([^\]]+)\]/g

const STOP_PROPER = new Set([
  'the', 'this', 'that', 'these', 'those', 'when', 'then', 'and', 'but', 'for', 'with',
  'from', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'это', 'этот', 'эта', 'эти', 'когда', 'если', 'или', 'для',
])

export function entityIdFor(name: string): string {
  return name.trim().toLowerCase().replace(/\.md$/i, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]+/gu, '')
}

export function normalizeVaultTarget(value: string): string {
  return value.trim().replace(/\.md$/i, '').replace(/\\/g, '/').toLowerCase()
}

export function aliasesFromProperties(properties: Record<string, unknown> | undefined): string[] {
  if (!properties) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (value: unknown) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed.length < 2) return
    const key = normalizeVaultTarget(trimmed)
    if (seen.has(key)) return
    seen.add(key)
    out.push(trimmed)
  }
  const add = (raw: unknown) => {
    if (Array.isArray(raw)) {
      for (const item of raw) push(item)
      return
    }
    if (typeof raw === 'string') {
      for (const part of raw.split(/[,\n]+/)) push(part)
    }
  }
  add(properties.aliases)
  add(properties.alias)
  return out
}

export function lineForIndex(content: string, index: number): number {
  return content.slice(0, Math.max(0, index)).split(/\r?\n/).length
}

function linePreview(content: string, line: number): string {
  return (content.split(/\r?\n/)[line - 1] ?? '').trim()
}

function stripProtected(content: string): string {
  return content.replace(FENCE_RE, (block) => ' '.repeat(block.length)).replace(INLINE_CODE_RE, (code) => ' '.repeat(code.length))
}

function catalogNeedles(entry: VaultCatalogEntry): Array<{ needle: string; reason: 'title' | 'alias' }> {
  const out: Array<{ needle: string; reason: 'title' | 'alias' }> = []
  const seen = new Set<string>()
  const push = (needle: string, reason: 'title' | 'alias') => {
    const trimmed = needle.trim()
    if (trimmed.length < 2) return
    const key = normalizeVaultTarget(trimmed)
    if (seen.has(key)) return
    seen.add(key)
    out.push({ needle: trimmed, reason })
  }
  push(entry.title, 'title')
  const leaf = entry.id.split('/').pop()
  if (leaf) push(leaf.replace(/-/g, ' '), 'title')
  for (const alias of entry.aliases) push(alias, 'alias')
  return out.sort((a, b) => b.needle.length - a.needle.length)
}

function isResolvedTarget(catalog: readonly VaultCatalogEntry[], target: string): boolean {
  const needle = normalizeVaultTarget(target)
  return catalog.some((entry) => {
    if (normalizeVaultTarget(entry.id) === needle) return true
    if (normalizeVaultTarget(entry.title) === needle) return true
    if (normalizeVaultTarget(entry.id.split('/').pop() ?? '') === needle) return true
    return entry.aliases.some((alias) => normalizeVaultTarget(alias) === needle)
  })
}

function kindForName(name: string, matchedNote: boolean): VaultEntityKind {
  if (matchedNote) return 'note'
  if (/^\d{4}-\d{2}-\d{2}$/.test(name)) return 'date'
  if (/\b(inc|llc|gmbh|ltd|corp|university|университет)\b/i.test(name)) return 'org'
  if (/\s/.test(name)) return 'person'
  return 'mention'
}

function protectedRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  for (const re of [FENCE_RE, INLINE_CODE_RE, WIKILINK_RE]) {
    const copy = new RegExp(re.source, re.flags)
    let match: RegExpExecArray | null
    while ((match = copy.exec(content)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  return ranges
}

function isInside(ranges: Array<{ start: number; end: number }>, index: number): boolean {
  return ranges.some((range) => index >= range.start && index < range.end)
}

export function extractNamedEntities(
  documentId: string,
  content: string,
  catalog: readonly VaultCatalogEntry[],
  properties: Record<string, unknown> = {},
): VaultNamedEntity[] {
  const entities: VaultNamedEntity[] = []
  const seen = new Set<string>()
  const add = (name: string, line: number, evidence: string, kind?: VaultEntityKind) => {
    const trimmed = name.trim()
    if (trimmed.length < 2) return
    const id = entityIdFor(trimmed)
    const key = `${id}:${line}`
    if (seen.has(key)) return
    seen.add(key)
    const matchedNote = isResolvedTarget(catalog, trimmed)
    entities.push({
      id,
      name: trimmed,
      kind: kind ?? kindForName(trimmed, matchedNote),
      documentId,
      line,
      evidence,
    })
  }

  for (const key of ['people', 'entities', 'orgs', 'places'] as const) {
    const raw = properties[key]
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n]+/) : []
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) continue
      const kind: VaultEntityKind = key === 'people' ? 'person' : key === 'orgs' ? 'org' : key === 'places' ? 'place' : 'mention'
      add(value, 1, value.trim(), kind)
    }
  }

  const ranges = protectedRanges(content)
  const stripped = stripProtected(content)
  for (const match of stripped.matchAll(DATE_RE)) {
    const index = match.index ?? 0
    if (isInside(ranges, index)) continue
    add(match[1]!, lineForIndex(content, index), linePreview(content, lineForIndex(content, index)), 'date')
  }

  for (const match of stripped.matchAll(PROPER_RE)) {
    const parts = match[0]!.trim().split(/\s+/)
    while (parts.length && STOP_PROPER.has(parts[0]!.toLowerCase())) parts.shift()
    const phrase = parts.join(' ')
    if (parts.length < 2) continue
    const index = match.index ?? 0
    if (isInside(ranges, index)) continue
    add(phrase, lineForIndex(content, index), linePreview(content, lineForIndex(content, index)))
  }

  for (const match of content.matchAll(WIKILINK_RE)) {
    const target = match[1]!.trim()
    if (!target || SPECIAL_TARGET_RE.test(target)) continue
    const index = match.index ?? 0
    add(match[2]?.trim() || target, lineForIndex(content, index), linePreview(content, lineForIndex(content, index)))
  }

  for (const entry of catalog) {
    if (entry.id === documentId) continue
    for (const { needle } of catalogNeedles(entry)) {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(?<![\\w[|])(${escaped})(?![\\w\\]|])`, 'giu')
      let match: RegExpExecArray | null
      while ((match = re.exec(content)) !== null) {
        const index = match.index ?? 0
        if (isInside(ranges, index)) continue
        add(match[1] ?? needle, lineForIndex(content, index), linePreview(content, lineForIndex(content, index)))
      }
    }
  }

  return entities
}

export function rankLinkSuggestions(
  documentId: string,
  content: string,
  catalog: readonly VaultCatalogEntry[],
): VaultLinkSuggestion[] {
  const suggestions: VaultLinkSuggestion[] = []
  const ranges = protectedRanges(content)
  const others = catalog.filter((entry) => entry.id !== documentId)

  for (const entry of others) {
    for (const { needle, reason } of catalogNeedles(entry)) {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(?<![\\w[|])(${escaped})(?![\\w\\]|])`, 'giu')
      let match: RegExpExecArray | null
      let hits = 0
      while ((match = re.exec(content)) !== null) {
        const index = match.index ?? 0
        if (isInside(ranges, index)) continue
        hits += 1
        const line = lineForIndex(content, index)
        const prefix = reason === 'alias' ? 'alias' : needle.length === entry.title.length ? 'title' : 'prefix'
        const score = (prefix === 'title' ? 100 : prefix === 'alias' ? 90 : 50 + Math.min(needle.length, 20)) + Math.min(hits - 1, 5) * 5
        suggestions.push({
          targetId: entry.id,
          targetTitle: entry.title,
          mention: match[1] ?? needle,
          line,
          score,
          reason: prefix,
          preview: linePreview(content, line),
        })
      }
    }
  }

  const best = new Map<string, VaultLinkSuggestion>()
  for (const suggestion of suggestions) {
    const key = `${suggestion.targetId}:${suggestion.line}:${normalizeVaultTarget(suggestion.mention)}`
    const current = best.get(key)
    if (!current || suggestion.score > current.score) best.set(key, suggestion)
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.line - b.line).slice(0, 24)
}

export function diagnoseBrokenLinks(
  links: readonly VaultInsightLink[],
  content: string,
  catalog: readonly VaultCatalogEntry[],
): VaultBrokenLink[] {
  const out: VaultBrokenLink[] = []
  const seen = new Set<string>()
  for (const link of links) {
    if (SPECIAL_TARGET_RE.test(link.target)) continue
    if (isResolvedTarget(catalog, link.target)) continue
    const key = `${normalizeVaultTarget(link.target)}:${link.line}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      target: link.target,
      line: link.line,
      preview: linePreview(content, link.line),
    })
  }
  return out
}

export function suggestEntityMerges(
  entities: readonly VaultNamedEntity[],
  catalog: readonly VaultCatalogEntry[] = [],
): VaultEntityMerge[] {
  const byId = new Map<string, VaultNamedEntity[]>()
  for (const entity of entities) {
    const list = byId.get(entity.id) ?? []
    list.push(entity)
    byId.set(entity.id, list)
  }
  const merges: VaultEntityMerge[] = []
  const seen = new Set<string>()
  const push = (fromName: string, toName: string, reason: VaultEntityMerge['reason']) => {
    if (normalizeVaultTarget(fromName) === normalizeVaultTarget(toName)) return
    const key = `${entityIdFor(fromName)}->${entityIdFor(toName)}`
    if (seen.has(key)) return
    seen.add(key)
    merges.push({
      fromId: entityIdFor(fromName),
      fromName,
      toId: entityIdFor(toName),
      toName,
      reason,
    })
  }
  for (const group of byId.values()) {
    const names = [...new Set(group.map((item) => item.name))]
    if (names.length < 2) continue
    const canonical = names.find((name) => group.some((item) => item.kind === 'note' && item.name === name))
      ?? names.slice().sort((a, b) => b.length - a.length)[0]!
    for (const name of names) push(name, canonical, 'normalized')
  }
  for (const entry of catalog) {
    for (const alias of entry.aliases) {
      const mentioned = entities.some((item) => normalizeVaultTarget(item.name) === normalizeVaultTarget(alias))
        || entities.some((item) => normalizeVaultTarget(item.name) === normalizeVaultTarget(entry.title))
      if (!mentioned) continue
      const aliasHit = entities.find((item) => normalizeVaultTarget(item.name) === normalizeVaultTarget(alias))
      if (!aliasHit) continue
      push(aliasHit.name, entry.title, 'alias')
    }
  }
  return merges.slice(0, 12)
}

export function diagnoseFootnotes(content: string): VaultFootnoteChrome[] {
  const defs = new Map<string, { line: number; text: string }>()
  const refs = new Map<string, number>()
  for (const match of content.matchAll(FOOTNOTE_DEF_RE)) {
    const id = match[1]!.trim()
    if (!defs.has(id)) {
      defs.set(id, { line: lineForIndex(content, match.index ?? 0), text: (match[2] ?? '').trim() })
    }
  }
  for (const match of content.matchAll(FOOTNOTE_REF_RE)) {
    const id = match[1]!.trim()
    if (content.slice(match.index ?? 0).startsWith(`[^${id}]:`)) continue
    if (!refs.has(id)) refs.set(id, lineForIndex(content, match.index ?? 0))
  }
  const ids = new Set([...defs.keys(), ...refs.keys()])
  return [...ids].sort((a, b) => a.localeCompare(b)).map((id) => {
    const def = defs.get(id)
    const refLine = refs.get(id)
    const hasDef = Boolean(def)
    const hasRef = refLine !== undefined
    return {
      id,
      hasRef,
      hasDef,
      orphan: hasRef && !hasDef,
      unused: hasDef && !hasRef,
      line: refLine ?? def?.line ?? 1,
      text: def?.text ?? '',
    }
  })
}

export function buildVaultInsights(input: {
  documentId: string
  content: string
  links: readonly VaultInsightLink[]
  catalog: readonly VaultCatalogEntry[]
  properties?: Record<string, unknown>
}): VaultInsights {
  const entities = extractNamedEntities(input.documentId, input.content, input.catalog, input.properties)
  const linkSuggestions = rankLinkSuggestions(input.documentId, input.content, input.catalog)
  return {
    entities,
    linkSuggestions,
    unlinkedMentions: linkSuggestions,
    brokenLinks: diagnoseBrokenLinks(input.links, input.content, input.catalog),
    suggestedMerges: suggestEntityMerges(entities, input.catalog),
    footnotes: diagnoseFootnotes(input.content),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function applyLinkSuggestion(markdown: string, mention: string, targetTitle: string): string {
  const escaped = escapeRegExp(mention)
  const re = new RegExp(`(?<!\\[\\[)(?<![\\w|])(${escaped})(?![\\w\\]|])`, 'iu')
  const replacement = normalizeVaultTarget(mention) === normalizeVaultTarget(targetTitle)
    ? `[[${targetTitle}]]`
    : `[[${targetTitle}|${mention}]]`
  return markdown.replace(re, replacement)
}

export function applyEntityMerge(markdown: string, fromName: string, toName: string): string {
  return applyLinkSuggestion(markdown, fromName, toName)
}

export function undoEntityMerge(markdown: string, fromName: string, toName: string): string {
  const needle = `[[${toName}|${fromName}]]`
  return markdown.split(needle).join(fromName)
}

export function nextFootnoteId(markdown: string): string {
  const used = new Set<string>()
  for (const match of markdown.matchAll(FOOTNOTE_REF_RE)) used.add(match[1]!.trim())
  let n = 1
  while (used.has(String(n))) n += 1
  return String(n)
}

function footnoteBodyInsertIndex(markdown: string): number {
  const firstDef = markdown.search(/^\[\^[^\]]+\]:/m)
  const slice = firstDef >= 0 ? markdown.slice(0, firstDef) : markdown
  return slice.replace(/\s+$/, '').length
}

export function insertFootnote(markdown: string, body: string, insertAt?: number): { markdown: string; id: string } {
  const id = nextFootnoteId(markdown)
  const ref = `[^${id}]`
  const def = `[^${id}]: ${body.trim() || '…'}`
  const at = insertAt !== undefined && insertAt >= 0 && insertAt <= markdown.length
    ? insertAt
    : footnoteBodyInsertIndex(markdown)
  let next = `${markdown.slice(0, at)}${ref}${markdown.slice(at)}`
  if (!/^\[\^[^\]]+\]:/m.test(next)) {
    next = `${next.replace(/\s+$/, '')}\n\n${def}\n`
  } else {
    next = `${next.replace(/\s+$/, '')}\n${def}\n`
  }
  return { markdown: next, id }
}

export function updateFootnoteDefinition(markdown: string, id: string, body: string): string {
  const re = new RegExp(`^\\[\\^${escapeRegExp(id)}\\]:\\s*.*$`, 'm')
  const line = `[^${id}]: ${body.trim()}`
  if (re.test(markdown)) return markdown.replace(re, line)
  return `${markdown.replace(/\s+$/, '')}\n\n${line}\n`
}

export function removeFootnote(markdown: string, id: string): string {
  const def = new RegExp(`^\\[\\^${escapeRegExp(id)}\\]:\\s*.*$\\n?`, 'm')
  const ref = new RegExp(`\\[\\^${escapeRegExp(id)}\\](?!:)`, 'g')
  return markdown.replace(def, '').replace(ref, '')
}
