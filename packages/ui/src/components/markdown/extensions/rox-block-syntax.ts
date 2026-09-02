/**
 * Portable Markdown markers for ROX-only presentation blocks.
 *
 * The wire format deliberately follows Obsidian callouts so a note keeps its
 * meaning outside the ROX editor. The TipTap decoration below purposefully
 * enhances the ordinary blockquote representation instead of introducing a
 * private node or HTML. That keeps the legacy Markdown serializer lossless.
 */
import { Extension, type JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
export type RoxBlockKind = 'spoiler' | 'details'

export type RoxBlockToggle = '+' | '-'

export interface RoxBlockMarker {
  kind: RoxBlockKind
  /** `+` starts expanded; `-` starts collapsed. */
  toggle: RoxBlockToggle
  /** An optional one-line label displayed by a renderer. */
  title?: string
}

/**
 * A callout represented by an ordinary ProseMirror `blockquote`.
 * Positions are document positions immediately before/after the respective
 * node, following the same convention as ProseMirror decorations.
 */
export interface RoxBlockTarget {
  marker: RoxBlockMarker
  quoteFrom: number
  quoteTo: number
  markerFrom: number
  markerTo: number
  markerTextFrom: number
  markerTextTo: number
  bodyFrom: number
  bodyTo: number
  /**
   * `@tiptap/markdown` can represent an ordinary Obsidian callout as one
   * paragraph with a newline in its text node. In that case the body is an
   * inline range; the legacy parser keeps it as following paragraph nodes.
   */
  bodyRanges: Array<{ from: number; to: number; inline: boolean }>
}

export interface RoxBlockLabels {
  collapse: string
  expand: string
}

export interface RoxBlockCalloutOptions {
  labels: RoxBlockLabels
}

const ROX_BLOCK_MARKER = /^\[!(spoiler|details)\]([+-])(?:[ \t]+(.*))?$/i

const DEFAULT_ROX_BLOCK_LABELS: RoxBlockLabels = {
  collapse: 'Collapse block',
  expand: 'Expand block',
}

function normalizeTitle(title: string | undefined): string | undefined {
  const normalized = title?.trim()
  return normalized ? normalized : undefined
}

/**
 * Parses exactly one Obsidian-compatible callout marker line.
 *
 * It intentionally rejects embedded newlines, unknown callout kinds, omitted
 * toggle markers, and trailing non-marker content. This keeps the result safe
 * to use as a block boundary in an editor implementation.
 */
export function parseRoxBlockMarker(value: string): RoxBlockMarker | null {
  if (value.includes('\n') || value.includes('\r')) {
    return null
  }

  const match = ROX_BLOCK_MARKER.exec(value)
  if (!match) {
    return null
  }

  const kind = match[1]?.toLowerCase()
  const toggle = match[2]
  if ((kind !== 'spoiler' && kind !== 'details') || (toggle !== '+' && toggle !== '-')) {
    return null
  }

  return {
    kind,
    toggle,
    title: normalizeTitle(match[3]),
  }
}

export function isRoxBlockMarker(value: string): boolean {
  return parseRoxBlockMarker(value) !== null
}

/** Serializes a marker in one canonical, portable Markdown form. */
export function formatRoxBlockMarker(marker: RoxBlockMarker): string {
  const title = normalizeTitle(marker.title)
  return `[!${marker.kind}]${marker.toggle}${title ? ` ${title}` : ''}`
}

/** A `-` callout is collapsed initially; `+` is expanded initially. */
export function isRoxBlockCollapsed(marker: Pick<RoxBlockMarker, 'toggle'>): boolean {
  return marker.toggle === '-'
}

/** Returns a new marker with only its initial presentation state changed. */
export function toggleRoxBlockMarker(marker: RoxBlockMarker): RoxBlockMarker {
  return {
    ...marker,
    toggle: marker.toggle === '-' ? '+' : '-',
  }
}

/**
 * Canonical source for a portable callout. Empty body lines stay quoted so a
 * later edit remains inside the callout in Obsidian and other Markdown tools.
 */
export function formatRoxBlockMarkdown(marker: RoxBlockMarker, body = ''): string {
  const markerLine = `> ${formatRoxBlockMarker(marker)}`
  if (body.length === 0) return `${markerLine}\n> `
  return [markerLine, ...body.split(/\r?\n/).map(line => `> ${line}`)].join('\n')
}

/**
 * JSON inserted by the slash menu. It intentionally uses only built-in
 * blockquote/paragraph nodes, which tiptap-markdown serializes as `>` lines.
 */
export function createRoxBlockContent(
  kind: RoxBlockKind,
  title = kind === 'spoiler' ? 'Spoiler' : 'Details',
): JSONContent {
  return {
    type: 'blockquote',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: formatRoxBlockMarker({ kind, toggle: '-', title }) }],
      },
      { type: 'paragraph' },
    ],
  }
}

/**
 * Finds Obsidian-compatible spoiler/details callouts inside a normal document.
 * A valid callout must start with a plain paragraph whose first line is a
 * marker. The official parser may retain quoted body text in that same
 * paragraph; styled or compound marker lines are still rejected.
 */
export function collectRoxBlockTargets(doc: ProseMirrorNode): RoxBlockTarget[] {
  const targets: RoxBlockTarget[] = []

  doc.descendants((node, quoteFrom) => {
    if (node.type.name !== 'blockquote' || node.childCount < 1) return

    const markerNode = node.firstChild
    if (!markerNode || markerNode.type.name !== 'paragraph') return

    const paragraphText = markerNode.textContent
    // `content.size` equals text length only for an unmarked, text-only
    // paragraph. Do not rewrite a styled/compound marker silently. The
    // official Markdown parser stores a normal quoted body as `marker\nbody`
    // in this same text node, so parse the first line but keep the remaining
    // range as a collapsible inline body.
    if (markerNode.content.size !== paragraphText.length) return
    const lineBreak = paragraphText.indexOf('\n')
    const markerText = lineBreak === -1 ? paragraphText : paragraphText.slice(0, lineBreak)
    const marker = parseRoxBlockMarker(markerText)
    if (!marker) return

    const markerFrom = quoteFrom + 1
    const markerTo = markerFrom + markerNode.nodeSize
    const markerTextFrom = markerFrom + 1
    const markerTextTo = markerTextFrom + markerText.length
    const bodyRanges: Array<{ from: number; to: number; inline: boolean }> = []
    if (lineBreak !== -1) {
      // Include the newline in the hidden range so no blank row remains when
      // the callout is collapsed. `markerTextTo` is a document position, not
      // a string offset, because the first paragraph begins at +1.
      bodyRanges.push({ from: markerTextTo, to: markerTo - 1, inline: true })
    }
    let childFrom = markerTo
    for (let index = 1; index < node.childCount; index += 1) {
      const child = node.child(index)
      bodyRanges.push({ from: childFrom, to: childFrom + child.nodeSize, inline: false })
      childFrom += child.nodeSize
    }

    targets.push({
      marker,
      quoteFrom,
      quoteTo: quoteFrom + node.nodeSize,
      markerFrom,
      markerTo,
      markerTextFrom,
      markerTextTo,
      bodyFrom: bodyRanges.at(0)?.from ?? markerTo,
      bodyTo: quoteFrom + node.nodeSize - 1,
      bodyRanges,
    })
  })

  return targets
}

export function toggleRoxBlockAt(view: EditorView, target: RoxBlockTarget): void {
  const next = formatRoxBlockMarker(toggleRoxBlockMarker(target.marker))
  view.dispatch(view.state.tr.insertText(next, target.markerTextFrom, target.markerTextTo))
}

export const RoxBlockCalloutPluginKey = new PluginKey<DecorationSet>('roxBlockCallout')

function createRoxBlockToggle(view: EditorView, target: RoxBlockTarget, labels: RoxBlockLabels): HTMLElement {
  const collapsed = isRoxBlockCollapsed(target.marker)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'tiptap-rox-block-toggle'
  button.contentEditable = 'false'
  button.dataset.roxBlockKind = target.marker.kind
  button.dataset.collapsed = String(collapsed)
  button.setAttribute('aria-expanded', String(!collapsed))
  button.setAttribute('aria-label', collapsed ? labels.expand : labels.collapse)
  button.title = collapsed ? labels.expand : labels.collapse
  button.textContent = collapsed ? '›' : '⌄'

  const toggle = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    toggleRoxBlockAt(view, target)
  }

  button.addEventListener('mousedown', event => event.preventDefault())
  button.addEventListener('click', toggle)
  button.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    toggle(event)
  })

  return button
}

export function buildRoxBlockDecorations(
  state: EditorState,
  labels: RoxBlockLabels = DEFAULT_ROX_BLOCK_LABELS,
): DecorationSet {
  const decorations: Decoration[] = []

  for (const target of collectRoxBlockTargets(state.doc)) {
    const collapsed = isRoxBlockCollapsed(target.marker)
    decorations.push(
      Decoration.node(target.quoteFrom, target.quoteTo, {
        class: `tiptap-rox-block tiptap-rox-block--${target.marker.kind}`,
        'data-rox-block-collapsed': String(collapsed),
        'data-rox-block-kind': target.marker.kind,
      }),
      Decoration.widget(
        target.markerTextFrom,
        widgetView => createRoxBlockToggle(widgetView, target, labels),
        {
          key: `rox-block-toggle:${target.quoteFrom}:${target.marker.toggle}`,
          side: -1,
        },
      ),
    )

    if (!collapsed) continue
    for (const bodyRange of target.bodyRanges) {
      decorations.push(
        (bodyRange.inline ? Decoration.inline : Decoration.node)(bodyRange.from, bodyRange.to, {
          class: 'tiptap-rox-block-content-hidden',
          'aria-hidden': 'true',
        }),
      )
    }
  }

  return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty
}

/**
 * Editable presentation layer for portable spoiler/details callouts.
 * Clicking the control rewrites only the marker's +/- character through the
 * canonical serializer, so collapse state is durable Markdown rather than
 * hidden editor-only state.
 */
export const RoxBlockCallout = Extension.create<RoxBlockCalloutOptions>({
  name: 'roxBlockCallout',

  addOptions() {
    return { labels: DEFAULT_ROX_BLOCK_LABELS }
  },

  addProseMirrorPlugins() {
    const labels = { ...DEFAULT_ROX_BLOCK_LABELS, ...this.options.labels }
    return [
      new Plugin({
        key: RoxBlockCalloutPluginKey,
        state: {
          init: (_config, state) => buildRoxBlockDecorations(state, labels),
          apply: (transaction, previous, _oldState, nextState) => {
            if (!transaction.docChanged) return previous
            return buildRoxBlockDecorations(nextState, labels)
          },
        },
        props: {
          decorations(state) {
            return RoxBlockCalloutPluginKey.getState(state) ?? null
          },
        },
      }),
    ]
  },
})
