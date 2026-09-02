import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { NodeSelection, PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { InlineMenuSurface } from '../ui/InlineMenuSurface'
import { RICH_BLOCK_EDIT_EVENT } from './rich-block-events'
import { createRoxBlockContent, type RoxBlockKind } from './extensions/rox-block-syntax'
import { insertRoxColumnsContent } from './extensions/ColumnsBlock'

export interface SlashCommandItem {
  id: string
  title: string
  description?: string
  icon: SlashIconName
  group: string
  aliases?: string[]
  run: (editor: Editor, insertPos?: number) => void
}

/**
 * Labels are owned by the embedding screen rather than the extension. This
 * keeps the ProseMirror extension usable in non-React renderers while Notes
 * can pass the active locale through its normal `t()` contract.
 */
export interface SlashCommandLabels {
  empty: string
  groupFormat: string
  groupLists: string
  groupBlocks: string
  paragraphTitle: string
  paragraphDescription: string
  heading1Title: string
  heading1Description: string
  heading2Title: string
  heading2Description: string
  heading3Title: string
  heading3Description: string
  bulletListTitle: string
  bulletListDescription: string
  orderedListTitle: string
  orderedListDescription: string
  taskListTitle: string
  taskListDescription: string
  quoteTitle: string
  quoteDescription: string
  dividerTitle: string
  dividerDescription: string
  spoilerTitle: string
  spoilerDescription: string
  columns2Title: string
  columns2Description: string
  columns3Title: string
  columns3Description: string
  codeTitle: string
  codeDescription: string
  mermaidTitle: string
  mermaidDescription: string
  latexTitle: string
  latexDescription: string
  spoilerInsertTitle: string
  detailsInsertTitle: string
}

export interface TiptapSlashMenuOptions {
  labels: Partial<SlashCommandLabels>
}

export const DEFAULT_SLASH_COMMAND_LABELS: SlashCommandLabels = {
  empty: 'No commands found',
  groupFormat: 'Format',
  groupLists: 'Lists',
  groupBlocks: 'Blocks',
  paragraphTitle: 'Text',
  paragraphDescription: 'Turn into a normal paragraph',
  heading1Title: 'Heading 1',
  heading1Description: 'Large section heading',
  heading2Title: 'Heading 2',
  heading2Description: 'Medium section heading',
  heading3Title: 'Heading 3',
  heading3Description: 'Small section heading',
  bulletListTitle: 'Bullet List',
  bulletListDescription: 'Create a bulleted list',
  orderedListTitle: 'Numbered List',
  orderedListDescription: 'Create an ordered list',
  taskListTitle: 'Todo List',
  taskListDescription: 'Create a checkbox task list',
  quoteTitle: 'Quote',
  quoteDescription: 'Insert a block quote',
  dividerTitle: 'Horizontal Rule',
  dividerDescription: 'Insert a divider line',
  spoilerTitle: 'Spoiler',
  spoilerDescription: 'Insert a collapsible spoiler block',
  columns2Title: '2 Columns',
  columns2Description: 'Insert a balanced two-column layout',
  columns3Title: '3 Columns',
  columns3Description: 'Insert a balanced three-column layout',
  codeTitle: 'Code Block',
  codeDescription: 'Insert a fenced code block',
  mermaidTitle: 'Mermaid Diagram',
  mermaidDescription: 'Insert a mermaid diagram block',
  latexTitle: 'LaTeX Block',
  latexDescription: 'Insert a LaTeX math block',
  spoilerInsertTitle: 'Spoiler',
  detailsInsertTitle: 'Details',
}

export const SlashCommandPluginKey = new PluginKey('tiptapSlashMenu')

type SlashIconName =
  | 'pilcrow'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'list'
  | 'list-ordered'
  | 'list-checks'
  | 'quote'
  | 'text-quote'
  | 'minus'
  | 'code-xml'
  | 'square-code'
  | 'workflow'
  | 'sigma'
  | 'chevrons-up-down'
  | 'columns-2'
  | 'columns-3'

const LUCIDE_ICON_NODES: Record<SlashIconName, Array<[string, Record<string, string>]>> = {
  pilcrow: [
    ['path', { d: 'M13 4v16' }],
    ['path', { d: 'M17 4v16' }],
    ['path', { d: 'M19 4H9.5a4.5 4.5 0 0 0 0 9H13' }],
  ],
  'heading-1': [
    ['path', { d: 'M4 12h8' }],
    ['path', { d: 'M4 18V6' }],
    ['path', { d: 'M12 18V6' }],
    ['path', { d: 'm17 12 3-2v8' }],
  ],
  'heading-2': [
    ['path', { d: 'M4 12h8' }],
    ['path', { d: 'M4 18V6' }],
    ['path', { d: 'M12 18V6' }],
    ['path', { d: 'M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1' }],
  ],
  'heading-3': [
    ['path', { d: 'M4 12h8' }],
    ['path', { d: 'M4 18V6' }],
    ['path', { d: 'M12 18V6' }],
    ['path', { d: 'M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2' }],
    ['path', { d: 'M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2' }],
  ],
  list: [
    ['path', { d: 'M3 5h.01' }],
    ['path', { d: 'M3 12h.01' }],
    ['path', { d: 'M3 19h.01' }],
    ['path', { d: 'M8 5h13' }],
    ['path', { d: 'M8 12h13' }],
    ['path', { d: 'M8 19h13' }],
  ],
  'list-ordered': [
    ['path', { d: 'M11 5h10' }],
    ['path', { d: 'M11 12h10' }],
    ['path', { d: 'M11 19h10' }],
    ['path', { d: 'M4 4h1v5' }],
    ['path', { d: 'M4 9h2' }],
    ['path', { d: 'M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02' }],
  ],
  'list-checks': [
    ['path', { d: 'm3 17 2 2 4-4' }],
    ['path', { d: 'm3 7 2 2 4-4' }],
    ['path', { d: 'M13 6h8' }],
    ['path', { d: 'M13 12h8' }],
    ['path', { d: 'M13 18h8' }],
  ],
  quote: [
    ['path', { d: 'M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z' }],
    ['path', { d: 'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z' }],
  ],
  'text-quote': [
    ['path', { d: 'M17 5H3' }],
    ['path', { d: 'M21 12H8' }],
    ['path', { d: 'M21 19H8' }],
    ['path', { d: 'M3 12v7' }],
  ],
  minus: [['path', { d: 'M5 12h14' }]],
  'code-xml': [
    ['path', { d: 'm18 16 4-4-4-4' }],
    ['path', { d: 'm6 8-4 4 4 4' }],
    ['path', { d: 'm14.5 4-5 16' }],
  ],
  'square-code': [
    ['path', { d: 'm10 9-3 3 3 3' }],
    ['path', { d: 'm14 15 3-3-3-3' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
  ],
  workflow: [
    ['rect', { width: '8', height: '8', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M7 11v4a2 2 0 0 0 2 2h4' }],
    ['rect', { width: '8', height: '8', x: '13', y: '13', rx: '2' }],
  ],
  sigma: [
    ['path', { d: 'M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2' }],
  ],
  'chevrons-up-down': [
    ['path', { d: 'm7 15 5 5 5-5' }],
    ['path', { d: 'm7 9 5-5 5 5' }],
  ],
  'columns-2': [
    ['rect', { x: '3', y: '4', width: '7', height: '16', rx: '2' }],
    ['rect', { x: '14', y: '4', width: '7', height: '16', rx: '2' }],
  ],
  'columns-3': [
    ['rect', { x: '3', y: '4', width: '5', height: '16', rx: '2' }],
    ['rect', { x: '10', y: '4', width: '4', height: '16', rx: '2' }],
    ['rect', { x: '16', y: '4', width: '5', height: '16', rx: '2' }],
  ],
}

function createLucideIcon(name: SlashIconName): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  for (const [tag, attrs] of LUCIDE_ICON_NODES[name]) {
    const child = document.createElementNS(svgNs, tag)
    for (const [key, value] of Object.entries(attrs)) {
      child.setAttribute(key, value)
    }
    svg.appendChild(child)
  }

  return svg
}

export function isSlashSuggestionActive(editor: Editor): boolean {
  const pluginState = SlashCommandPluginKey.getState(editor.state) as
    | { active?: boolean; range?: { from: number; to: number } | null }
    | undefined

  return Boolean(pluginState?.active ?? pluginState?.range)
}

function insertRichBlockAndOpenEditor(
  editor: Editor,
  type: 'mermaidBlock' | 'latexBlock',
  code: string,
  insertPos?: number,
) {
  const targetPos = insertPos ?? editor.state.selection.from

  editor.chain().focus().insertContentAt(targetPos, {
    type,
    attrs: { code },
  }).run()

  editor.chain().focus().setNodeSelection(targetPos).run()
  queueMicrotask(() => (editor as any).emit(RICH_BLOCK_EDIT_EVENT))
}

const VISUAL_LANGUAGES = new Set(['mermaid', 'latex', 'math', 'tex', 'katex'])
const lastCodeLanguageByEditor = new WeakMap<Editor, string>()

function findLastCodeLanguageInDoc(editor: Editor): string | null {
  const { doc, selection } = editor.state
  let last: string | null = null

  doc.nodesBetween(0, selection.from, (node) => {
    if (node.type.name !== 'codeBlock') return
    const lang = String(node.attrs.language ?? '').trim().toLowerCase()
    if (!lang || VISUAL_LANGUAGES.has(lang)) return
    last = lang
  })

  return last
}

function resolvePreferredCodeLanguage(editor: Editor): string {
  const remembered = lastCodeLanguageByEditor.get(editor)
  if (remembered) return remembered

  if (editor.isActive('codeBlock')) {
    const current = String(editor.getAttributes('codeBlock').language ?? '').trim().toLowerCase()
    if (current && !VISUAL_LANGUAGES.has(current)) return current
  }

  const fromDoc = findLastCodeLanguageInDoc(editor)
  if (fromDoc) return fromDoc

  return 'plaintext'
}

function rememberCodeLanguage(editor: Editor, language: string) {
  const normalized = String(language).trim().toLowerCase()
  if (!normalized || VISUAL_LANGUAGES.has(normalized)) return
  lastCodeLanguageByEditor.set(editor, normalized)
}

function insertCodeBlockWithPlaceholder(editor: Editor, insertPos?: number) {
  const targetPos = insertPos ?? editor.state.selection.from
  const language = resolvePreferredCodeLanguage(editor)

  editor.chain().focus().insertContentAt(targetPos, {
    type: 'codeBlock',
    attrs: { language },
    content: [{ type: 'text', text: ' ' }],
  }).setTextSelection({ from: targetPos + 1, to: targetPos + 1 }).run()

  rememberCodeLanguage(editor, language)
}

function insertRoxBlock(editor: Editor, kind: RoxBlockKind, labels: SlashCommandLabels, insertPos?: number) {
  const targetPos = insertPos ?? editor.state.selection.from
  const title = kind === 'spoiler' ? labels.spoilerInsertTitle : labels.detailsInsertTitle

  editor.chain().focus().insertContentAt(targetPos, createRoxBlockContent(kind, title)).run()

  // The first body paragraph starts after the blockquote opening, marker
  // paragraph, and its closing token. Keeping focus there makes /spoiler a
  // direct writing action rather than a decorative insertion.
  editor.chain().focus().setTextSelection(targetPos + `[!${kind}]- ${title}`.length + 4).run()
}

export function createSlashCommandItems(
  _editor: Editor,
  partialLabels: Partial<SlashCommandLabels> = {},
): SlashCommandItem[] {
  const labels = { ...DEFAULT_SLASH_COMMAND_LABELS, ...partialLabels }
  return [
    {
      id: 'paragraph',
      title: labels.paragraphTitle,
      description: labels.paragraphDescription,
      icon: 'pilcrow',
      group: labels.groupFormat,
      aliases: ['paragraph', 'text', 'p'],
      run: (e) => {
        e.chain().focus().setParagraph().run()
      },
    },
    {
      id: 'heading-1',
      title: labels.heading1Title,
      description: labels.heading1Description,
      icon: 'heading-1',
      group: labels.groupFormat,
      aliases: ['h1', 'title', 'heading'],
      run: (e) => {
        e.chain().focus().toggleHeading({ level: 1 }).run()
      },
    },
    {
      id: 'heading-2',
      title: labels.heading2Title,
      description: labels.heading2Description,
      icon: 'heading-2',
      group: labels.groupFormat,
      aliases: ['h2', 'subtitle', 'heading'],
      run: (e) => {
        e.chain().focus().toggleHeading({ level: 2 }).run()
      },
    },
    {
      id: 'heading-3',
      title: labels.heading3Title,
      description: labels.heading3Description,
      icon: 'heading-3',
      group: labels.groupFormat,
      aliases: ['h3', 'subheading', 'heading'],
      run: (e) => {
        e.chain().focus().toggleHeading({ level: 3 }).run()
      },
    },
    {
      id: 'bullet-list',
      title: labels.bulletListTitle,
      description: labels.bulletListDescription,
      icon: 'list',
      group: labels.groupLists,
      aliases: ['ul', 'list', 'bullets'],
      run: (e) => {
        e.chain().focus().toggleBulletList().run()
      },
    },
    {
      id: 'ordered-list',
      title: labels.orderedListTitle,
      description: labels.orderedListDescription,
      icon: 'list-ordered',
      group: labels.groupLists,
      aliases: ['ol', 'list', 'numbers'],
      run: (e) => {
        e.chain().focus().toggleOrderedList().run()
      },
    },
    {
      id: 'task-list',
      title: labels.taskListTitle,
      description: labels.taskListDescription,
      icon: 'list-checks',
      group: labels.groupLists,
      aliases: ['todo', 'task', 'checklist', 'checkbox'],
      run: (e) => {
        e.chain().focus().toggleTaskList().run()
      },
    },
    {
      id: 'blockquote',
      title: labels.quoteTitle,
      description: labels.quoteDescription,
      icon: 'text-quote',
      group: labels.groupBlocks,
      aliases: ['blockquote', 'quote', 'callout'],
      run: (e, insertPos) => {
        const chain = e.chain().focus()
        if (typeof insertPos === 'number') chain.setTextSelection(insertPos)
        chain.setBlockquote().run()
      },
    },
    {
      id: 'horizontal-rule',
      title: labels.dividerTitle,
      description: labels.dividerDescription,
      icon: 'minus',
      group: labels.groupBlocks,
      aliases: ['hr', 'divider', 'line'],
      run: (e) => {
        e.chain().focus().setHorizontalRule().run()
      },
    },
    {
      id: 'spoiler-block',
      title: labels.spoilerTitle,
      description: labels.spoilerDescription,
      icon: 'chevrons-up-down',
      group: labels.groupBlocks,
      aliases: ['spoiler', 'details', 'спойлер', 'подробности'],
      run: (e, insertPos) => {
        insertRoxBlock(e, 'spoiler', labels, insertPos)
      },
    },
    {
      id: 'two-column-block',
      title: labels.columns2Title,
      description: labels.columns2Description,
      icon: 'columns-2',
      group: labels.groupBlocks,
      aliases: ['columns', 'two columns', 'split', 'layout'],
      run: (e, insertPos) => {
        insertRoxColumnsContent(e, 2, insertPos)
      },
    },
    {
      id: 'three-column-block',
      title: labels.columns3Title,
      description: labels.columns3Description,
      icon: 'columns-3',
      group: labels.groupBlocks,
      aliases: ['columns', 'three columns', 'grid', 'layout'],
      run: (e, insertPos) => {
        insertRoxColumnsContent(e, 3, insertPos)
      },
    },
    {
      id: 'code-block',
      title: labels.codeTitle,
      description: labels.codeDescription,
      icon: 'square-code',
      group: labels.groupBlocks,
      aliases: ['code', 'fence', 'snippet'],
      run: (e, insertPos) => {
        insertCodeBlockWithPlaceholder(e, insertPos)
      },
    },
    {
      id: 'mermaid-code-block',
      title: labels.mermaidTitle,
      description: labels.mermaidDescription,
      icon: 'workflow',
      group: labels.groupBlocks,
      aliases: ['mermaid', 'diagram', 'flowchart'],
      run: (e, insertPos) => {
        insertRichBlockAndOpenEditor(e, 'mermaidBlock', 'graph TD\n  A[Start] --> B[End]', insertPos)
      },
    },
    {
      id: 'latex-code-block',
      title: labels.latexTitle,
      description: labels.latexDescription,
      icon: 'sigma',
      group: labels.groupBlocks,
      aliases: ['latex', 'math', 'tex', 'katex'],
      run: (e, insertPos) => {
        insertRichBlockAndOpenEditor(e, 'latexBlock', 'E = mc^2', insertPos)
      },
    },
  ]
}

export function filterSlashCommandItems(items: SlashCommandItem[], query: string): SlashCommandItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return items

  return items.filter((item) => {
    if (item.title.toLowerCase().includes(normalized)) return true
    if (item.description?.toLowerCase().includes(normalized)) return true
    return item.aliases?.some((alias) => alias.toLowerCase().includes(normalized)) ?? false
  })
}

function getRectFromClientRect(clientRect?: (() => DOMRect | null) | null): DOMRect | null {
  if (!clientRect) return null
  return clientRect()
}

function renderMenuItems(
  container: HTMLElement,
  items: SlashCommandItem[],
  selectedIndex: number,
  labels: SlashCommandLabels,
) {
  const grouped = new Map<string, SlashCommandItem[]>()
  for (const item of items) {
    const existing = grouped.get(item.group)
    if (existing) {
      existing.push(item)
    } else {
      grouped.set(item.group, [item])
    }
  }

  container.innerHTML = ''

  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'tiptap-slash-empty'
    empty.textContent = labels.empty
    container.appendChild(empty)
    return
  }

  let itemIndex = 0
  for (const [groupName, groupItems] of grouped) {
    const group = document.createElement('div')
    group.className = 'tiptap-slash-group'

    const label = document.createElement('div')
    label.className = 'tiptap-slash-group-label'
    label.textContent = groupName
    group.appendChild(label)

    for (const item of groupItems) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = `tiptap-slash-item${itemIndex === selectedIndex ? ' is-selected' : ''}`
      row.dataset.index = String(itemIndex)

      const icon = document.createElement('div')
      icon.className = 'tiptap-slash-item-icon'
      icon.appendChild(createLucideIcon(item.icon))

      const title = document.createElement('div')
      title.className = 'tiptap-slash-item-title'
      title.textContent = item.title

      row.appendChild(icon)
      row.appendChild(title)
      group.appendChild(row)
      itemIndex += 1
    }

    container.appendChild(group)
  }
}

class SlashMenuView {
  private props: SuggestionProps<SlashCommandItem>

  private surface: InlineMenuSurface<SlashCommandItem>

  constructor(props: SuggestionProps<SlashCommandItem>, labels: SlashCommandLabels) {
    this.props = props

    this.surface = new InlineMenuSurface<SlashCommandItem>({
      className: 'tiptap-slash-menu popover-styled',
      onSelect: (item) => {
        this.props.command(item)
      },
      render: (container, items, selectedIndex) => {
        renderMenuItems(container, items, selectedIndex, labels)
      },
    })

    this.surface.mount()
    this.surface.update(props.items, 0)
    this.setPosition(props)
  }

  update(props: SuggestionProps<SlashCommandItem>) {
    this.props = props
    this.surface.update(props.items)
    this.setPosition(props)
  }

  onKeyDown(props: SuggestionKeyDownProps): boolean {
    if (props.event.key === 'Escape') {
      this.destroy()
      return true
    }

    if (props.event.key === 'ArrowDown') {
      this.surface.moveSelection(1)
      return true
    }

    if (props.event.key === 'ArrowUp') {
      this.surface.moveSelection(-1)
      return true
    }

    if (props.event.key === 'Enter') {
      const item = this.surface.getSelectedItem()
      if (!item) return true
      this.props.command(item)
      return true
    }

    return false
  }

  private setPosition(props: SuggestionProps<SlashCommandItem>) {
    const rect = getRectFromClientRect(props.clientRect)
    if (!rect) return

    this.surface.setPosition(rect.bottom + 8, rect.left)
  }

  destroy() {
    this.surface.destroy()
  }
}

export const TiptapSlashMenu = Extension.create<TiptapSlashMenuOptions>({
  name: 'tiptapSlashMenu',

  addOptions() {
    return { labels: {} }
  },

  addProseMirrorPlugins() {
    const labels = { ...DEFAULT_SLASH_COMMAND_LABELS, ...this.options.labels }
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        pluginKey: SlashCommandPluginKey,
        char: '/',
        startOfLine: false,
        allowedPrefixes: null,
        allowSpaces: true,
        items: ({ editor, query }) => {
          const items = createSlashCommandItems(editor, labels)
          return filterSlashCommandItems(items, query)
        },
        allow: ({ editor, state }) => {
          const { selection } = state

          if (!selection.empty) return false
          if (selection instanceof NodeSelection) return false
          if (editor.isActive('codeBlock')) return false
          if (editor.isActive('code')) return false

          return true
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).setTextSelection(range.from).run()
          props.run(editor, range.from)
        },
        render: () => {
          let menu: SlashMenuView | null = null

          return {
            onStart: (props) => {
              menu = new SlashMenuView(props, labels)
            },
            onUpdate: (props) => {
              menu?.update(props)
            },
            onKeyDown: (props) => {
              return menu?.onKeyDown(props) ?? false
            },
            onExit: () => {
              menu?.destroy()
              menu = null
            },
          }
        },
      }),
    ]
  },
})
