import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

export type DocumentFoldKind = 'heading' | 'taskList'

export interface DocumentFoldingJSON {
  version: 1
  foldedIds: string[]
}

export interface DocumentFoldingLabels {
  collapseSection: string
  collapseTaskList: string
  expandSection: string
  expandTaskList: string
}

export interface DocumentFoldTarget {
  id: string
  baseId: string
  kind: DocumentFoldKind
  from: number
  to: number
  contentFrom: number
  contentTo: number
  text: string
  index: number
  level?: 1 | 2 | 3
}

export interface DocumentFoldHiddenRange {
  id: string
  kind: DocumentFoldKind
  from: number
  to: number
}

export interface DocumentFoldingOptions {
  headingLevels: readonly (1 | 2 | 3)[]
  includeTopLevelTaskLists: boolean
  initialState: DocumentFoldingJSON | string[] | null
  labels: DocumentFoldingLabels
  onChange?: (state: DocumentFoldingJSON) => void
}

export type DocumentFoldingAction =
  | { type: 'toggle'; id: string }
  | { type: 'fold'; id: string }
  | { type: 'unfold'; id: string }
  | { type: 'set'; foldedIds: string[] }
  | { type: 'replace'; state: DocumentFoldingJSON | string[] | null | undefined }
  | { type: 'clear' }

interface TopLevelBlock {
  node: ProseMirrorNode
  from: number
  to: number
  index: number
}

export const DOCUMENT_FOLDING_VERSION = 1 as const
export const DocumentFoldingPluginKey = new PluginKey<DocumentFoldingJSON>('documentFolding')

const DEFAULT_OPTIONS: DocumentFoldingOptions = {
  headingLevels: [1, 2, 3],
  includeTopLevelTaskLists: true,
  initialState: null,
  labels: {
    collapseSection: 'Collapse section',
    collapseTaskList: 'Collapse task list',
    expandSection: 'Expand section',
    expandTaskList: 'Expand task list',
  },
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    documentFolding: {
      toggleDocumentFold: (id: string) => ReturnType
      foldDocumentTarget: (id: string) => ReturnType
      unfoldDocumentTarget: (id: string) => ReturnType
      setDocumentFoldingState: (state: DocumentFoldingJSON | string[] | null | undefined) => ReturnType
      clearDocumentFoldingState: () => ReturnType
    }
  }
}

function sameFoldIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

function sameFoldingState(left: DocumentFoldingJSON, right: DocumentFoldingJSON): boolean {
  return left.version === right.version && sameFoldIds(left.foldedIds, right.foldedIds)
}

function resolveDocumentFoldingOptions(options: Partial<DocumentFoldingOptions> = {}): DocumentFoldingOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
  }
}

function textSlug(text: string): string {
  const slug = text
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'untitled'
}

function baseIdForBlock(block: TopLevelBlock): string | null {
  const text = textSlug(block.node.textContent)

  if (block.node.type.name === 'heading') {
    const level = Number(block.node.attrs.level)
    if (level !== 1 && level !== 2 && level !== 3) return null
    return `heading:${level}:${text}`
  }

  if (block.node.type.name === 'taskList') {
    return `task-list:${text}`
  }

  return null
}

function withOccurrence(baseId: string, seenBaseIds: Map<string, number>): string {
  const count = seenBaseIds.get(baseId) ?? 0
  seenBaseIds.set(baseId, count + 1)
  return count === 0 ? baseId : `${baseId}:${count + 1}`
}

function getTopLevelBlocks(doc: ProseMirrorNode): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = []

  doc.forEach((node, offset, index) => {
    blocks.push({
      node,
      from: offset,
      to: offset + node.nodeSize,
      index,
    })
  })

  return blocks
}

function isHeadingTarget(block: TopLevelBlock, headingLevels: ReadonlySet<number>): boolean {
  return block.node.type.name === 'heading' && headingLevels.has(Number(block.node.attrs.level))
}

function isTopLevelTaskListTarget(block: TopLevelBlock, includeTopLevelTaskLists: boolean): boolean {
  return includeTopLevelTaskLists && block.node.type.name === 'taskList'
}

function getHeadingContentEnd(blocks: readonly TopLevelBlock[], startIndex: number, level: number): number {
  for (let index = startIndex + 1; index < blocks.length; index += 1) {
    const candidate = blocks[index]
    if (candidate?.node.type.name !== 'heading') continue

    const candidateLevel = Number(candidate.node.attrs.level)
    if (candidateLevel <= level) return candidate.from
  }

  return blocks.at(-1)?.to ?? blocks[startIndex]?.to ?? 0
}

export function collectDocumentFoldTargets(
  doc: ProseMirrorNode,
  options: Partial<Pick<DocumentFoldingOptions, 'headingLevels' | 'includeTopLevelTaskLists'>> = {},
): DocumentFoldTarget[] {
  const headingLevels = new Set(options.headingLevels ?? DEFAULT_OPTIONS.headingLevels)
  const includeTopLevelTaskLists = options.includeTopLevelTaskLists ?? DEFAULT_OPTIONS.includeTopLevelTaskLists
  const blocks = getTopLevelBlocks(doc)
  const seenBaseIds = new Map<string, number>()
  const targets: DocumentFoldTarget[] = []

  blocks.forEach((block, blockIndex) => {
    if (isHeadingTarget(block, headingLevels)) {
      const level = Number(block.node.attrs.level) as 1 | 2 | 3
      const contentFrom = block.to
      const contentTo = getHeadingContentEnd(blocks, blockIndex, level)
      if (contentFrom >= contentTo) return

      const baseId = baseIdForBlock(block)
      if (!baseId) return

      targets.push({
        id: withOccurrence(baseId, seenBaseIds),
        baseId,
        kind: 'heading',
        from: block.from,
        to: block.to,
        contentFrom,
        contentTo,
        text: block.node.textContent,
        index: block.index,
        level,
      })
      return
    }

    if (isTopLevelTaskListTarget(block, includeTopLevelTaskLists)) {
      const baseId = baseIdForBlock(block)
      if (!baseId) return

      targets.push({
        id: withOccurrence(baseId, seenBaseIds),
        baseId,
        kind: 'taskList',
        from: block.from,
        to: block.to,
        contentFrom: block.from,
        contentTo: block.to,
        text: block.node.textContent,
        index: block.index,
      })
    }
  })

  return targets
}

export function parseDocumentFoldingState(value: DocumentFoldingJSON | string[] | null | undefined): DocumentFoldingJSON {
  if (Array.isArray(value)) {
    return {
      version: DOCUMENT_FOLDING_VERSION,
      foldedIds: value.filter((id): id is string => typeof id === 'string' && id.length > 0),
    }
  }

  if (value?.version === DOCUMENT_FOLDING_VERSION && Array.isArray(value.foldedIds)) {
    return {
      version: DOCUMENT_FOLDING_VERSION,
      foldedIds: value.foldedIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
    }
  }

  return {
    version: DOCUMENT_FOLDING_VERSION,
    foldedIds: [],
  }
}

export function normalizeDocumentFoldingState(
  value: DocumentFoldingJSON | string[] | null | undefined,
  targets: readonly DocumentFoldTarget[],
): DocumentFoldingJSON {
  const parsed = parseDocumentFoldingState(value)
  const requested = new Set(parsed.foldedIds)

  return {
    version: DOCUMENT_FOLDING_VERSION,
    foldedIds: targets.map(target => target.id).filter(id => requested.has(id)),
  }
}

export function applyDocumentFoldingAction(
  currentState: DocumentFoldingJSON,
  action: DocumentFoldingAction | null | undefined,
  targets: readonly DocumentFoldTarget[],
): DocumentFoldingJSON {
  if (!action) return normalizeDocumentFoldingState(currentState, targets)

  const current = new Set(normalizeDocumentFoldingState(currentState, targets).foldedIds)

  switch (action.type) {
    case 'toggle':
      if (current.has(action.id)) current.delete(action.id)
      else current.add(action.id)
      break
    case 'fold':
      current.add(action.id)
      break
    case 'unfold':
      current.delete(action.id)
      break
    case 'set':
      return normalizeDocumentFoldingState(action.foldedIds, targets)
    case 'replace':
      return normalizeDocumentFoldingState(action.state, targets)
    case 'clear':
      return {
        version: DOCUMENT_FOLDING_VERSION,
        foldedIds: [],
      }
  }

  return normalizeDocumentFoldingState([...current], targets)
}

export function computeDocumentFoldHiddenRanges(
  doc: ProseMirrorNode,
  foldingState: DocumentFoldingJSON | string[] | null | undefined,
  options: Partial<Pick<DocumentFoldingOptions, 'headingLevels' | 'includeTopLevelTaskLists'>> = {},
): DocumentFoldHiddenRange[] {
  const targets = collectDocumentFoldTargets(doc, options)
  const normalizedState = normalizeDocumentFoldingState(foldingState, targets)
  const foldedIds = new Set(normalizedState.foldedIds)

  return targets
    .filter(target => foldedIds.has(target.id) && target.contentFrom < target.contentTo)
    .map(target => ({
      id: target.id,
      kind: target.kind,
      from: target.contentFrom,
      to: target.contentTo,
    }))
}

export function getDocumentFoldingState(
  state: EditorState,
  options: Partial<Pick<DocumentFoldingOptions, 'headingLevels' | 'includeTopLevelTaskLists'>> = {},
): DocumentFoldingJSON {
  return normalizeDocumentFoldingState(DocumentFoldingPluginKey.getState(state) ?? {
    version: DOCUMENT_FOLDING_VERSION,
    foldedIds: [],
  }, collectDocumentFoldTargets(state.doc, options))
}

function isDocumentFoldingAction(value: unknown): value is DocumentFoldingAction {
  if (typeof value !== 'object' || value == null) return false
  const type = (value as { type?: unknown }).type
  return type === 'toggle'
    || type === 'fold'
    || type === 'unfold'
    || type === 'set'
    || type === 'replace'
    || type === 'clear'
}

function dispatchFoldingAction(view: EditorView, action: DocumentFoldingAction): void {
  view.dispatch(view.state.tr.setMeta(DocumentFoldingPluginKey, action))
}

function createFoldToggle(
  view: EditorView,
  target: DocumentFoldTarget,
  folded: boolean,
  labels: DocumentFoldingLabels,
): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'tiptap-document-fold-toggle'
  button.contentEditable = 'false'
  button.dataset.documentFoldId = target.id
  button.dataset.documentFoldKind = target.kind
  button.dataset.folded = String(folded)
  button.setAttribute('aria-expanded', String(!folded))
  const label = target.kind === 'heading'
    ? (folded ? labels.expandSection : labels.collapseSection)
    : (folded ? labels.expandTaskList : labels.collapseTaskList)
  button.setAttribute('aria-label', label)
  button.title = label
  button.textContent = folded ? '>' : 'v'

  const toggle = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    dispatchFoldingAction(view, { type: 'toggle', id: target.id })
  }

  button.addEventListener('mousedown', event => event.preventDefault())
  button.addEventListener('click', toggle)
  button.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    toggle(event)
  })

  return button
}

function buildDocumentFoldingDecorations(
  state: EditorState,
  options: DocumentFoldingOptions,
): DecorationSet {
  const targets = collectDocumentFoldTargets(state.doc, options)
  const foldingState = normalizeDocumentFoldingState(getDocumentFoldingState(state, options), targets)
  const foldedIds = new Set(foldingState.foldedIds)
  const decorations: Decoration[] = []
  const hiddenRanges = computeDocumentFoldHiddenRanges(state.doc, foldingState, options)

  for (const target of targets) {
    const folded = foldedIds.has(target.id)

    decorations.push(
      Decoration.widget(
        target.from,
        (widgetView: EditorView) => createFoldToggle(widgetView, target, folded, options.labels),
        {
          key: `document-fold-toggle:${target.id}:${folded ? 'closed' : 'open'}`,
          side: -1,
        },
      ),
    )

    if (!folded) continue
  }

  if (hiddenRanges.length > 0) {
    const hiddenByRange = hiddenRanges
    state.doc.forEach((node, offset) => {
      const from = offset
      const to = offset + node.nodeSize
      const hidden = hiddenByRange.find(range => from >= range.from && to <= range.to)
      if (!hidden) return

      decorations.push(
        Decoration.node(from, to, {
          class: 'tiptap-document-fold-hidden',
          'data-document-fold-hidden': 'true',
          'data-document-fold-parent-id': hidden.id,
          'aria-hidden': 'true',
        }),
      )
    })
  }

  return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty
}

export function createDocumentFoldingPlugin(options: Partial<DocumentFoldingOptions> = {}): Plugin<DocumentFoldingJSON> {
  const resolvedOptions = resolveDocumentFoldingOptions(options)

  return new Plugin<DocumentFoldingJSON>({
    key: DocumentFoldingPluginKey,
    state: {
      init: () => parseDocumentFoldingState(resolvedOptions.initialState),
      apply: (tr, value, _oldState, newState) => {
        const targets = collectDocumentFoldTargets(newState.doc, resolvedOptions)
        const meta = tr.getMeta(DocumentFoldingPluginKey)
        const action = isDocumentFoldingAction(meta) ? meta : null

        if (action) return applyDocumentFoldingAction(value, action, targets)
        return value
      },
    },
    props: {
      decorations(state) {
        return buildDocumentFoldingDecorations(state, resolvedOptions)
      },
    },
    view: (view) => {
      let previous = getDocumentFoldingState(view.state, resolvedOptions)

      return {
        update: (nextView) => {
          const current = getDocumentFoldingState(nextView.state, resolvedOptions)
          if (sameFoldingState(previous, current)) return
          previous = current
          resolvedOptions.onChange?.(current)
        },
        destroy: () => undefined,
      }
    },
  })
}

export const DocumentFolding = Extension.create<DocumentFoldingOptions>({
  name: 'documentFolding',

  addOptions() {
    return resolveDocumentFoldingOptions()
  },

  addCommands() {
    return {
      toggleDocumentFold: id => ({ tr, dispatch }) => {
        dispatch?.(tr.setMeta(DocumentFoldingPluginKey, { type: 'toggle', id } satisfies DocumentFoldingAction))
        return true
      },
      foldDocumentTarget: id => ({ tr, dispatch }) => {
        dispatch?.(tr.setMeta(DocumentFoldingPluginKey, { type: 'fold', id } satisfies DocumentFoldingAction))
        return true
      },
      unfoldDocumentTarget: id => ({ tr, dispatch }) => {
        dispatch?.(tr.setMeta(DocumentFoldingPluginKey, { type: 'unfold', id } satisfies DocumentFoldingAction))
        return true
      },
      setDocumentFoldingState: state => ({ tr, dispatch }) => {
        dispatch?.(tr.setMeta(DocumentFoldingPluginKey, { type: 'replace', state } satisfies DocumentFoldingAction))
        return true
      },
      clearDocumentFoldingState: () => ({ tr, dispatch }) => {
        dispatch?.(tr.setMeta(DocumentFoldingPluginKey, { type: 'clear' } satisfies DocumentFoldingAction))
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [createDocumentFoldingPlugin(this.options)]
  },
})

export function createDocumentFolding(options: Partial<DocumentFoldingOptions> = {}) {
  return DocumentFolding.configure(options)
}
