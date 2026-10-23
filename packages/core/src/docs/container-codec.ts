/**
 * LSX-WP-031 — semantic container codec for tabs/columns.
 *
 * Rich wire format keeps portable Pandoc containers (`:::rox-tabs` / `:::rox-tab`,
 * `:::rox-columns` / `:::rox-column`) so child block IDs, tasks and comments stay
 * addressable. Basic Markdown export *expands* every pane/column into labeled
 * sections so indexers and plain Markdown tools never lose nested content.
 *
 * Negative control: serializing a container as an opaque fence that drops
 * children (for example a single ```json fence of metadata) is rejected by
 * `assertBasicExportRevealsChildren`.
 */

export type ContainerKind = 'tabs' | 'columns' | 'unknown'

export interface ParsedContainerRegion {
  kind: ContainerKind
  rawKind: string
  start: number
  end: number
  /** Inclusive line indices into the source split by `\n`. */
  startLine: number
  endLine: number
  title?: string
  childrenText: string
}

const OPEN_RE = /^[ \t]*:::(rox-tabs|rox-tab|tabs|tab|rox-columns|rox-column|columns|column|[A-Za-z][\w-]*)(?:\s+(\{[^}]*\}|\d+))?[ \t]*$/
const CLOSE_RE = /^[ \t]*:::[ \t]*$/
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/

function parseTitleAttr(attrs: string | undefined): string | undefined {
  if (!attrs) return undefined
  const match = /title\s*=\s*"([^"]*)"/.exec(attrs) ?? /title\s*=\s*'([^']*)'/.exec(attrs)
  return match?.[1]
}

function normalizeKind(raw: string): ContainerKind {
  if (raw === 'rox-tabs' || raw === 'tabs' || raw === 'rox-tab' || raw === 'tab') return 'tabs'
  if (raw === 'rox-columns' || raw === 'columns' || raw === 'rox-column' || raw === 'column') return 'columns'
  return 'unknown'
}

function isLeafKind(raw: string): boolean {
  return raw === 'rox-tab' || raw === 'tab' || raw === 'rox-column' || raw === 'column'
}

function isRootKind(raw: string): boolean {
  return raw === 'rox-tabs' || raw === 'tabs' || raw === 'rox-columns' || raw === 'columns'
}

/**
 * Scan top-level and nested `:::` containers. Nested leaves stay attached to
 * their root via `childrenText` on the root region; unknown roots are retained
 * verbatim (readable) for future formats.
 */
export function locateContainerRegions(source: string): ParsedContainerRegion[] {
  const lines = source.split('\n')
  const regions: ParsedContainerRegion[] = []
  let cursor = 0
  const lineStarts: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    lineStarts.push(cursor)
    cursor += lines[i]!.length + (i < lines.length - 1 ? 1 : 0)
  }

  let index = 0
  while (index < lines.length) {
    const open = OPEN_RE.exec(lines[index]!)
    if (!open) {
      index += 1
      continue
    }
    const rawKind = open[1]!
    let depth = 1
    let fence: string | undefined
    let end = index + 1
    for (; end < lines.length; end += 1) {
      const value = lines[end]!
      const fenceOpen = FENCE_OPEN_RE.exec(value)?.[1]
      if (fence) {
        if (fenceOpen && fenceOpen[0] === fence[0] && fenceOpen.length >= fence.length && new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*$`).test(value)) {
          fence = undefined
        }
        continue
      }
      if (fenceOpen) {
        fence = fenceOpen
        continue
      }
      if (OPEN_RE.test(value)) depth += 1
      else if (CLOSE_RE.test(value)) {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0) {
      index += 1
      continue
    }
    const start = lineStarts[index]!
    const endPos = end < lines.length - 1 || source.endsWith('\n')
      ? lineStarts[end]! + lines[end]!.length + (end < lines.length - 1 ? 1 : 0)
      : source.length
    const inner = lines.slice(index + 1, end).join('\n')
    regions.push({
      kind: normalizeKind(rawKind),
      rawKind,
      start,
      end: Math.min(endPos, source.length),
      startLine: index,
      endLine: end,
      title: parseTitleAttr(open[2]),
      childrenText: inner,
    })
    index = end + 1
  }
  return regions
}

function expandLeafSections(inner: string, leafNames: RegExp, headingPrefix: string): string {
  const lines = inner.split('\n')
  const parts: string[] = []
  let index = 0
  let leafIndex = 0
  while (index < lines.length) {
    const open = OPEN_RE.exec(lines[index]!)
    if (!open || !leafNames.test(open[1]!)) {
      // Preserve non-leaf preamble (should be rare).
      if (lines[index]!.trim()) parts.push(lines[index]!)
      index += 1
      continue
    }
    let depth = 1
    let fence: string | undefined
    let end = index + 1
    for (; end < lines.length; end += 1) {
      const value = lines[end]!
      const fenceOpen = FENCE_OPEN_RE.exec(value)?.[1]
      if (fence) {
        if (fenceOpen && fenceOpen[0] === fence[0] && fenceOpen.length >= fence.length && new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*$`).test(value)) {
          fence = undefined
        }
        continue
      }
      if (fenceOpen) {
        fence = fenceOpen
        continue
      }
      if (OPEN_RE.test(value)) depth += 1
      else if (CLOSE_RE.test(value)) {
        depth -= 1
        if (depth === 0) break
      }
    }
    leafIndex += 1
    const title = parseTitleAttr(open[2]) || `${headingPrefix} ${leafIndex}`
    const body = lines.slice(index + 1, end).join('\n').trim()
    // Recurse so nested tabs/columns inside a pane/column body also expand.
    const nested = body.length > 0
      ? expandContainersForBasicMarkdown(body).replace(/\n$/, '')
      : ''
    parts.push(`### ${title}`)
    parts.push('')
    parts.push(nested)
    parts.push('')
    index = end + 1
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Expand known semantic tabs/columns into labeled Markdown sections.
 * Unknown containers are retained byte-for-byte (readable), never stripped.
 * Nested containers inside expanded pane/column bodies are expanded recursively
 * (locateContainerRegions only sees top-level roots per scan).
 */
export function expandContainersForBasicMarkdown(source: string): string {
  const trailingNewline = source.endsWith('\n')
  // Process from the end so offsets stay valid. Re-scan until no known roots remain
  // so nested regions that surface after a parent rewrite also expand.
  let result = source
  for (let pass = 0; pass < 32; pass += 1) {
    const roots = locateContainerRegions(result)
      .filter(region => isRootKind(region.rawKind))
      .sort((a, b) => b.start - a.start)
    if (roots.length === 0) break
    let changed = false
    for (const region of roots) {
      const leaf = region.kind === 'tabs'
        ? /^(?:rox-tab|tab)$/
        : /^(?:rox-column|column)$/
      const heading = region.kind === 'tabs' ? 'Tab' : 'Column'
      const expanded = expandLeafSections(region.childrenText, leaf, heading)
      const next = `${result.slice(0, region.start)}${expanded}${result.slice(region.end)}`
      if (next !== result) {
        result = next
        changed = true
      }
    }
    if (!changed) break
  }
  return result.replace(/\n{3,}/g, '\n\n').trim() + (trailingNewline ? '\n' : '')
}

/** List unknown container kinds that remain readable in the source. */
export function listRetainedUnknownContainers(source: string): string[] {
  return locateContainerRegions(source)
    .filter(region => region.kind === 'unknown' && !isLeafKind(region.rawKind))
    .map(region => region.rawKind)
}

/**
 * Mutant/negative control: an opaque fence that hides children fails when the
 * basic export no longer contains nested body text or block anchors.
 */
export function serializeContainerAsOpaqueFence(meta: Record<string, unknown>, _childrenMarkdown: string): string {
  // Intentionally drops children — seeded broken control for WP-031.
  return `\`\`\`rox-container-opaque\n${JSON.stringify(meta)}\n\`\`\`\n`
}

export function assertBasicExportRevealsChildren(
  basicExport: string,
  requiredSnippets: string[],
): void {
  for (const snippet of requiredSnippets) {
    if (!basicExport.includes(snippet)) {
      throw new Error(`Basic Markdown export must reveal child content: missing ${JSON.stringify(snippet)}`)
    }
  }
  if (/```rox-container-opaque\b/.test(basicExport) && requiredSnippets.some(snippet => !basicExport.includes(snippet))) {
    throw new Error('Opaque fence serialization dropped semantic children')
  }
}

export function isOpaqueFenceDroppingChildren(serialized: string, childSnippets: string[]): boolean {
  if (!/```rox-container-opaque\b/.test(serialized) && !/```json\b[\s\S]*"tabs"/.test(serialized)) {
    return false
  }
  return childSnippets.some(snippet => !serialized.includes(snippet))
}
