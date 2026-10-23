import { createBlockMarkdownSpec, Node, type JSONContent } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import * as React from 'react'
import i18n from 'i18next'
import { installLegacyTabs, serializeLegacyTab, serializeLegacyTabs } from './legacy-tabs'

export interface RoxTabsAttrs {
  /** Personal selection is NodeView-local; not serialized. */
}

export interface RoxTabAttrs {
  title: string
}

export interface RoxTabsLabels {
  addTab: string
  removeTab: string
  renameTab: string
  defaultTitle: string
}

export interface RoxTabsOptions {
  labels: RoxTabsLabels
}

const MIN_TABS = 1
const MAX_TABS = 8
const DEFAULT_TAB_COUNT = 2

function translateLabel(key: string, fallback: string, options?: Record<string, unknown>): string {
  const value = i18n.t(key, options as never)
  return typeof value === 'string' && value.length > 0 && value !== key ? value : fallback
}

const DEFAULT_ROX_TABS_LABELS: RoxTabsLabels = {
  addTab: translateLabel('notes.tabs.add', 'Add tab'),
  removeTab: translateLabel('notes.tabs.remove', 'Remove tab'),
  renameTab: translateLabel('notes.tabs.rename', 'Rename tab'),
  defaultTitle: translateLabel('notes.tabs.defaultTitle', 'Tab {{n}}', { n: '{{n}}' }),
}

function defaultTitleFor(index: number, labels: RoxTabsLabels = DEFAULT_ROX_TABS_LABELS): string {
  const template = typeof labels.defaultTitle === 'string' && labels.defaultTitle.length > 0
    ? labels.defaultTitle
    : 'Tab {{n}}'
  if (template.includes('{{n}}')) return template.replace(/\{\{\s*n\s*\}\}/g, String(index + 1))
  return `${template} ${index + 1}`.trim()
}

function createTabContent(title: string): JSONContent {
  return {
    type: 'roxTab',
    attrs: { title },
    content: [{ type: 'paragraph' }],
  }
}

export function createRoxTabsContent(
  count: number = DEFAULT_TAB_COUNT,
  titles?: string[],
  labels: RoxTabsLabels = DEFAULT_ROX_TABS_LABELS,
): JSONContent {
  const requested = Number.isFinite(count) ? Math.floor(count) : DEFAULT_TAB_COUNT
  const tabCount = Math.max(MIN_TABS, Math.min(MAX_TABS, requested > 0 ? requested : DEFAULT_TAB_COUNT))
  return {
    type: 'roxTabs',
    content: Array.from({ length: tabCount }, (_, index) =>
      createTabContent(titles?.[index]?.trim() || defaultTitleFor(index, labels)),
    ),
  }
}

export function insertRoxTabsContent(
  editor: {
    chain: () => {
      focus: () => any
      insertContentAt: (pos: number, payload: JSONContent) => any
      run: () => any
    }
    state: { selection: { from: number } }
  },
  count: number = DEFAULT_TAB_COUNT,
  insertPos?: number,
): void {
  const targetPos = insertPos ?? editor.state.selection.from
  editor.chain().focus().insertContentAt(targetPos, createRoxTabsContent(count)).run()
}

const roxTabsMarkdown = createBlockMarkdownSpec({
  nodeName: 'roxTabs',
  name: 'rox-tabs',
  content: 'block',
})

const roxTabMarkdown = createBlockMarkdownSpec({
  nodeName: 'roxTab',
  name: 'rox-tab',
  content: 'block',
  allowedAttributes: ['title'],
  defaultAttributes: { title: '' },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    roxTabs: {
      insertRoxTabs: (count?: number) => ReturnType
    }
  }
}

function readChildTitles(node: { childCount: number; child: (index: number) => { attrs: { title?: string } } }): string[] {
  return Array.from({ length: node.childCount }, (_, index) => {
    const title = String(node.child(index).attrs.title ?? '').trim()
    return title || defaultTitleFor(index)
  })
}

function TabsNodeView({
  node,
  editor,
  getPos,
  labels,
}: {
  node: {
    childCount: number
    child: (index: number) => { attrs: { title?: string }; nodeSize: number }
    nodeSize: number
  }
  editor: {
    isEditable: boolean
    view: { dispatch: (tr: any) => void; state: { tr: any; doc: any; schema: any } }
    chain: () => any
  }
  getPos: (() => number | undefined) | boolean
  labels: RoxTabsLabels
}) {
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [renamingIndex, setRenamingIndex] = React.useState<number | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')
  const tablistRef = React.useRef<HTMLDivElement | null>(null)
  const renameInputRef = React.useRef<HTMLInputElement | null>(null)
  const titles = React.useMemo(() => readChildTitles(node), [node])
  const count = node.childCount

  React.useEffect(() => {
    if (activeIndex >= count) setActiveIndex(Math.max(0, count - 1))
  }, [activeIndex, count])

  React.useEffect(() => {
    if (renamingIndex == null) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingIndex])

  const resolvePos = React.useCallback((): number | null => {
    if (typeof getPos !== 'function') return null
    const pos = getPos()
    return typeof pos === 'number' ? pos : null
  }, [getPos])

  const focusTabButton = React.useCallback((index: number) => {
    const root = tablistRef.current
    if (!root) return
    const button = root.querySelector<HTMLButtonElement>(`[data-tab-index="${index}"]`)
    button?.focus()
  }, [])

  const selectTab = React.useCallback((index: number) => {
    if (index < 0 || index >= count) return
    setActiveIndex(index)
  }, [count])

  const onTabKeyDown = React.useCallback((index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      if (count === 0) return
      let next = index
      if (event.key === 'ArrowRight') next = (index + 1) % count
      else if (event.key === 'ArrowLeft') next = (index - 1 + count) % count
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = count - 1
      selectTab(next)
      queueMicrotask(() => focusTabButton(next))
      return
    }
  }, [count, focusTabButton, selectTab])

  const commitTitle = React.useCallback((index: number, raw: string) => {
    if (!editor.isEditable) return
    const pos = resolvePos()
    if (pos == null) return
    let childPos = pos + 1
    for (let i = 0; i < index; i += 1) childPos += node.child(i).nodeSize
    const nextTitle = raw.trim() || defaultTitleFor(index, labels)
    const current = String(node.child(index).attrs.title ?? '')
    if (current === nextTitle) return
    const tr = editor.view.state.tr.setNodeMarkup(childPos, undefined, {
      ...node.child(index).attrs,
      title: nextTitle,
    })
    editor.view.dispatch(tr)
  }, [editor, labels, node, resolvePos])

  const addTab = React.useCallback(() => {
    if (!editor.isEditable || count >= MAX_TABS) return
    const pos = resolvePos()
    if (pos == null) return
    const insertAt = pos + node.nodeSize - 1
    const title = defaultTitleFor(count, labels)
    editor.chain().focus().insertContentAt(insertAt, createTabContent(title)).run()
    setActiveIndex(count)
  }, [count, editor, labels, node.nodeSize, resolvePos])

  const removeTab = React.useCallback((index: number) => {
    if (!editor.isEditable || count <= MIN_TABS) return
    const pos = resolvePos()
    if (pos == null) return
    let childPos = pos + 1
    for (let i = 0; i < index; i += 1) childPos += node.child(i).nodeSize
    const child = node.child(index)
    const tr = editor.view.state.tr.delete(childPos, childPos + child.nodeSize)
    editor.view.dispatch(tr)
    setActiveIndex(current => {
      if (index < current) return current - 1
      if (index === current) return Math.max(0, Math.min(current, count - 2))
      return current
    })
  }, [count, editor, node, resolvePos])

  return (
    <NodeViewWrapper
      className="tiptap-rox-tabs"
      data-type="rox-tabs"
      data-active-index={activeIndex}
      data-tabs-count={count}
    >
      <div
        ref={tablistRef}
        className="tiptap-rox-tabs-list"
        role="tablist"
        aria-orientation="horizontal"
        contentEditable={false}
      >
        {titles.map((title, index) => {
          const selected = index === activeIndex
          return (
            <div key={`rox-tab-chip-${index}`} className="tiptap-rox-tabs-chip">
              {renamingIndex === index ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  className="tiptap-rox-tabs-tab tiptap-rox-tabs-rename-input is-active"
                  aria-label={labels.renameTab}
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => {
                    commitTitle(index, renameDraft)
                    setRenamingIndex(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.stopPropagation()
                      commitTitle(index, renameDraft)
                      setRenamingIndex(null)
                      queueMicrotask(() => focusTabButton(index))
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      setRenameDraft(title)
                      setRenamingIndex(null)
                      queueMicrotask(() => focusTabButton(index))
                    }
                  }}
                />
              ) : (
              <button
                type="button"
                role="tab"
                id={`rox-tab-${typeof getPos === 'function' ? getPos() : 'x'}-${index}`}
                data-tab-index={index}
                className={`tiptap-rox-tabs-tab${selected ? ' is-active' : ''}`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                title={labels.renameTab}
                onClick={() => selectTab(index)}
                onDoubleClick={(event) => {
                  if (!editor.isEditable) return
                  event.preventDefault()
                  event.stopPropagation()
                  setRenameDraft(title)
                  setRenamingIndex(index)
                }}
                onKeyDown={(event) => {
                  onTabKeyDown(index, event)
                }}
              >
                {title}
              </button>
              )}
              {editor.isEditable && count > MIN_TABS ? (
                <button
                  type="button"
                  className="tiptap-rox-tabs-remove"
                  aria-label={`${labels.removeTab}: ${title}`}
                  title={labels.removeTab}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    removeTab(index)
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          )
        })}
        {editor.isEditable && count < MAX_TABS ? (
          <button
            type="button"
            className="tiptap-rox-tabs-add"
            aria-label={labels.addTab}
            title={labels.addTab}
            onClick={(event) => {
              event.preventDefault()
              addTab()
            }}
          >
            +
          </button>
        ) : null}
      </div>
      <NodeViewContent className="tiptap-rox-tabs-panels" />
    </NodeViewWrapper>
  )
}

function TabNodeView({
  node,
  getPos,
}: {
  node: { attrs: { title?: string } }
  getPos: (() => number | undefined) | boolean
}) {
  const pos = typeof getPos === 'function' ? getPos() : undefined
  // Index among siblings is resolved via CSS from parent data-active-index;
  // aria attributes stay stable for the panel itself.
  return (
    <NodeViewWrapper
      className="tiptap-rox-tab"
      data-type="rox-tab"
      data-title={node.attrs.title ?? ''}
      role="tabpanel"
      id={typeof pos === 'number' ? `rox-tab-panel-at-${pos}` : undefined}
    >
      <NodeViewContent className="tiptap-rox-tab-content" />
    </NodeViewWrapper>
  )
}

export const RoxTabsBlock = Node.create<RoxTabsOptions>({
  name: 'roxTabs',

  group: 'block',
  content: 'roxTab+',
  isolating: true,
  defining: true,
  selectable: true,

  addOptions() {
    return { labels: DEFAULT_ROX_TABS_LABELS }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="rox-tabs"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'rox-tabs' }]
  },

  ...roxTabsMarkdown,

  addStorage() {
    return {
      markdown: {
        serialize: serializeLegacyTabs,
        parse: { setup: installLegacyTabs },
      },
    }
  },

  addCommands() {
    return {
      insertRoxTabs:
        (count: number = DEFAULT_TAB_COUNT) =>
        ({ chain, state }) => {
          const targetPos = state.selection.from
          return chain().focus().insertContentAt(targetPos, createRoxTabsContent(count, undefined, this.options.labels)).run()
        },
    }
  },

  addNodeView() {
    const labels = { ...DEFAULT_ROX_TABS_LABELS, ...this.options.labels }
    return ReactNodeViewRenderer((props: any) => <TabsNodeView {...props} labels={labels} />)
  },
})

export const RoxTabBlock = Node.create({
  name: 'roxTab',

  group: 'block',
  content: 'block+',
  isolating: true,
  defining: true,
  selectable: false,

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') ?? element.getAttribute('title') ?? '',
        renderHTML: (attributes) => (attributes.title ? { 'data-title': attributes.title } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="rox-tab"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'rox-tab' }]
  },

  ...roxTabMarkdown,

  addStorage() {
    return { markdown: { serialize: serializeLegacyTab } }
  },

  addNodeView() {
    return ReactNodeViewRenderer((props: any) => <TabNodeView {...props} />)
  },
})

export function isRoxTabsNode(value: unknown): value is { type: string } {
  return Boolean(value && typeof value === 'object' && (value as { type?: string }).type === 'roxTabs')
}
