import * as React from 'react'
import i18n from 'i18next'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from './extensions/AnimatedTaskItem'
import { Mathematics } from '@tiptap/extension-mathematics'
import Image from '@tiptap/extension-image'
import FileHandler from '@tiptap/extension-file-handler'
import { Markdown as OfficialMarkdown } from '@tiptap/markdown'
import { Markdown as LegacyMarkdown } from 'tiptap-markdown'
import { LegacyMixedTaskLists } from './legacy-mixed-task-lists'
import { RetainedTrailingNode } from './retained-trailing-node'
import { tiptapCodeBlock } from './TiptapCodeBlockView'
import { TiptapBubbleMenus, INLINE_MATH_EDIT_EVENT } from './TiptapBubbleMenus'
import { TiptapSlashMenu } from './TiptapSlashMenu'
import { MermaidBlock } from './extensions/MermaidBlock'
import { looksLikeMermaidSource } from './mermaid-source'
import { LatexBlock } from './extensions/LatexBlock'
import { RichBlockInteractions } from './extensions/RichBlockInteractions'
import { WikiLink } from './extensions/WikiLink'
import { HashTag } from './extensions/HashTag'
import { MarkdownComment } from './extensions/MarkdownComment'
import { DocumentFolding, type DocumentFoldingJSON } from './extensions/DocumentFolding'
import { RoxColumnsBlock, RoxColumnBlock } from './extensions/ColumnsBlock'
import { RoxBlockCallout, PortableCalloutBlockquote } from './extensions/rox-block-syntax'
import { cn } from '../../lib/utils'
import { useShikiTheme } from '../../context/ShikiThemeContext'
import { tiptapShikiThemeModes, updateTiptapShikiTheme } from './tiptap-shiki-theme'
import 'katex/dist/katex.min.css'
import './tiptap-editor.css'
import './extensions/animated-task-item.css'

export type MarkdownEngine = 'legacy' | 'official'
export type TiptapEditorHandle = NonNullable<ReturnType<typeof useEditor>>

export function readFoldingPreference(key?: string): DocumentFoldingJSON | null {
  if (!key || typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    return value?.version === 1 && Array.isArray(value.foldedIds) ? value : null
  } catch { return null }
}

export function writeFoldingPreference(key: string | undefined, value: DocumentFoldingJSON): void {
  if (!key || typeof window === 'undefined') return
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* Optional UI preference. */ }
}


function getLegacyMarkdown(editor: { storage: { markdown?: { getMarkdown?: () => string } } }): string {
  return editor.storage.markdown?.getMarkdown?.() ?? ''
}

function getOfficialMarkdown(editor: { getMarkdown?: () => string }): string {
  return editor.getMarkdown?.() ?? ''
}

function forceShikiDecorations(editor: any) {
  try {
    if (editor?.isDestroyed) return
    const tr = editor.view?.state.tr.setMeta('shikiPluginForceDecoration', true)
    if (tr) {
      editor.view?.dispatch(tr)
    }
  } catch {
    // Best-effort refresh only.
  }
}

function scheduleShikiRefresh(editor: any) {
  forceShikiDecorations(editor)

  for (const delay of [80, 220, 450]) {
    setTimeout(() => {
      forceShikiDecorations(editor)
    }, delay)
  }
}

const INLINE_DOUBLE_DOLLAR_REGEX = /\$\$([^\n]+?)\$\$/g
// Currency marker used during official parse to avoid accidental math tokenization.
const CURRENCY_MARKER = '¤'
const CURRENCY_RANGE_REGEX = /\$(\d[\dA-Za-z.,]*\s*[–-]\s*)\$(\d[\dA-Za-z.,]*)/g
const CURRENCY_AMOUNT_REGEX = /\$(\d[\dA-Za-z.,]*)/g

/**
 * Normalize markdown for official TipTap parser:
 * - Keep product policy: users write math with $$...$$
 * - Convert same-line $$...$$ to inline $...$ (TipTap inline math)
 * - Escape currency-like dollars ($100, $2M...) so they don't become inline math nodes
 */
export function preprocessMarkdownForOfficial(markdown: string): string {
  let index = 0
  const placeholders = new Map<string, string>()

  const withPlaceholders = markdown.replace(INLINE_DOUBLE_DOLLAR_REGEX, (_, latex: string) => {
    const key = `@@CA_INLINE_MATH_${index++}@@`
    placeholders.set(key, latex)
    return key
  })

  const rangeProtected = withPlaceholders.replace(
    CURRENCY_RANGE_REGEX,
    (_match, left: string, right: string) => `${CURRENCY_MARKER}${left}${CURRENCY_MARKER}${right}`
  )

  const amountProtected = rangeProtected.replace(
    CURRENCY_AMOUNT_REGEX,
    (_match, amount: string) => `${CURRENCY_MARKER}${amount}`
  )

  return amountProtected.replace(/@@CA_INLINE_MATH_\d+@@/g, (key) => {
    const latex = placeholders.get(key) ?? ''
    return `$${latex}$`
  })
}

/** Undo parser-safety escaping in serialized markdown. */
export function postprocessMarkdownFromOfficial(markdown: string): string {
  return markdown.replaceAll(CURRENCY_MARKER, '$')
}

const MERMAID_FILE_EXTENSIONS = new Set(['mmd', 'mermaid'])

export function isMermaidFilename(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop()
  return ext != null && MERMAID_FILE_EXTENSIONS.has(ext)
}

export function extractMermaidSource(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fenced = trimmed.match(/^```mermaid\s*\n([\s\S]*?)\n```$/i)
  if (fenced?.[1]) {
    const source = fenced[1].trim()
    return source.length > 0 ? source : null
  }

  return looksLikeMermaidSource(trimmed) ? trimmed : null
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error(i18n.t('editor.failedToReadFileAsDataUrl')))
    }
    reader.onerror = () => reject(reader.error ?? new Error(i18n.t('editor.failedToReadFile')))
    reader.readAsDataURL(file)
  })
}

async function readImageDimensions(src: string): Promise<{ width: number; height: number } | null> {
  return await new Promise((resolve) => {
    const image = new globalThis.Image()
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        resolve(null)
        return
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function insertMermaidBlock(editor: NonNullable<ReturnType<typeof useEditor>>, source: string, pos?: number) {
  const payload = {
    type: 'mermaidBlock',
    attrs: { code: source },
  }

  const chain = editor.chain().focus()
  if (typeof pos === 'number') chain.setTextSelection(pos)
  chain.insertContent(payload).run()
}

function insertImageNode(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  src: string,
  pos?: number,
  dimensions?: { width: number; height: number } | null,
) {
  const chain = editor.chain().focus()
  if (typeof pos === 'number') chain.setTextSelection(pos)
  chain.setImage({
    src,
    ...(dimensions?.width && dimensions?.height
      ? { width: dimensions.width, height: dimensions.height }
      : {}),
  }).run()
}

async function handleDroppedOrPastedFiles(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  files: File[],
  pos?: number,
): Promise<void> {
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const src = await readFileAsDataUrl(file)
      const dimensions = await readImageDimensions(src)
      insertImageNode(editor, src, pos, dimensions)
      continue
    }

    if (!isMermaidFilename(file.name)) continue
    const text = await file.text()
    const source = extractMermaidSource(text) ?? text.trim()
    if (!source) continue
    insertMermaidBlock(editor, source, pos)
  }
}

export interface TiptapMarkdownEditorProps {
  /** Markdown string content */
  content: string
  /** Called when content changes */
  onUpdate?: (markdown: string) => void
  /** Placeholder text when empty */
  placeholder?: string
  className?: string
  /** Whether the editor is editable */
  editable?: boolean
  /** Exposes the editor instance for host-level integrations such as custom autocomplete. */
  onEditorReady?: (editor: TiptapEditorHandle | null) => void
  /** Called when the user clicks a [[wiki link]] in the editor. */
  onWikiLinkClick?: (target: string) => void
  /** Called when the user clicks a #tag in the editor. */
  onTagClick?: (tag: string) => void
  /** Workspace/document-scoped UI preference, separate from Markdown content. */
  foldingStorageKey?: string
  /**
   * Migration flag for markdown engine foundations.
   * - `legacy`: tiptap-markdown (default for safe rollout)
   * - `official`: @tiptap/markdown + mathematics extension
   */
  markdownEngine?: MarkdownEngine
}

export function TiptapMarkdownEditor({
  content,
  onUpdate,
  placeholder,
  className,
  editable = true,
  onEditorReady,
  onWikiLinkClick,
  onTagClick,
  foldingStorageKey,
  markdownEngine = 'legacy',
}: TiptapMarkdownEditorProps) {
  const shikiTheme = useShikiTheme()
  const shikiModes = React.useRef(tiptapShikiThemeModes(shikiTheme))
  const onUpdateRef = React.useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const lastEmittedMarkdownRef = React.useRef<string | null>(null)

  const onWikiLinkClickRef = React.useRef(onWikiLinkClick)
  onWikiLinkClickRef.current = onWikiLinkClick

  const onTagClickRef = React.useRef(onTagClick)
  onTagClickRef.current = onTagClick

  // Ref for the editor instance — used by the Mathematics onClick callback
  // which is created at extension-configure time (before useEditor returns).
  const editorRef = React.useRef<ReturnType<typeof useEditor>>(null!)

  const useOfficialMarkdown = markdownEngine === 'official'

  const extensions = React.useMemo(() => {
    const base = [
      StarterKit.configure({
        codeBlock: false,
        blockquote: false,
        trailingNode: false,
        heading: { levels: [1, 2, 3] },
      }),
      RetainedTrailingNode,
      PortableCalloutBlockquote,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      tiptapCodeBlock.configure({
        themes: shikiModes.current,
      }),
      MermaidBlock,
      LatexBlock,
      Placeholder.configure({ placeholder: placeholder ?? i18n.t('editor.placeholder') }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      FileHandler.configure({
        onPaste: async (editor, files) => {
          if (!editable || files.length === 0) return
          await handleDroppedOrPastedFiles(editor as NonNullable<ReturnType<typeof useEditor>>, files)
        },
        onDrop: async (editor, files, pos) => {
          if (!editable || files.length === 0) return
          await handleDroppedOrPastedFiles(editor as NonNullable<ReturnType<typeof useEditor>>, files, pos)
        },
      }),
      RichBlockInteractions,
      RoxColumnsBlock.configure({ labels: { resizeColumn: i18n.t('notes.columns.resize') } }),
      RoxColumnBlock,
      DocumentFolding.configure({
        initialState: readFoldingPreference(foldingStorageKey),
        labels: {
          collapseSection: i18n.t('notes.folding.collapseSection'),
          collapseTaskList: i18n.t('notes.folding.collapseTaskList'),
          expandSection: i18n.t('notes.folding.expandSection'),
          expandTaskList: i18n.t('notes.folding.expandTaskList'),
        },
        onChange: state => writeFoldingPreference(foldingStorageKey, state),
      }),
      RoxBlockCallout.configure({ labels: { collapse: i18n.t('notes.blocks.collapse'), expand: i18n.t('notes.blocks.expand') } }),
      WikiLink.configure({
        onWikiLinkClick: (target) => onWikiLinkClickRef.current?.(target),
      }),
      HashTag.configure({
        onTagClick: (tag) => onTagClickRef.current?.(tag),
      }),
      Extension.create({
        name: 'horizontalRuleShortcut',
        addKeyboardShortcuts() {
          return {
            'Mod-Shift--': () => this.editor.commands.setHorizontalRule(),
          }
        },
      }),
      ...(editable ? [TiptapSlashMenu] : []),
    ]

    if (useOfficialMarkdown) {
      return [
        ...base,
        Mathematics.configure({
          inlineOptions: {
            onClick: (_node, pos) => {
              const e = editorRef.current
              if (!e) return
              e.chain().focus().setNodeSelection(pos).run()
              // Emit after selection so BubbleMenu mounts, then the event activates the input
              queueMicrotask(() => (e as any).emit(INLINE_MATH_EDIT_EVENT))
            },
          },
          katexOptions: {
            throwOnError: false,
            strict: false,
          },
        }),
        OfficialMarkdown.configure({
          markedOptions: {
            gfm: true,
          },
        }),
      ]
    }

    return [
      ...base,
      LegacyMixedTaskLists,
      MarkdownComment,
      LegacyMarkdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ]
  }, [placeholder, useOfficialMarkdown, foldingStorageKey])

  const initialContent = useOfficialMarkdown
    ? preprocessMarkdownForOfficial(content)
    : content

  const editor = useEditor({
    extensions,
    content: initialContent,
    ...(useOfficialMarkdown ? { contentType: 'markdown' as const } : {}),
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap-prose outline-none',
      },
      handlePaste: (_view, event) => {
        if (!editable) return false
        if (event.clipboardData?.files?.length) return false

        const text = event.clipboardData?.getData('text/plain') ?? ''
        const source = extractMermaidSource(text)
        if (!source) return false

        const activeEditor = editorRef.current
        if (!activeEditor) return false
        insertMermaidBlock(activeEditor, source)
        return true
      },
      handleDrop: (view, event) => {
        if (!editable) return false
        if (event.dataTransfer?.files?.length) return false

        const text = event.dataTransfer?.getData('text/plain') ?? ''
        const source = extractMermaidSource(text)
        if (!source) return false

        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        const activeEditor = editorRef.current
        if (!activeEditor) return false
        insertMermaidBlock(activeEditor, source, pos)
        return true
      },
    },
    onCreate: ({ editor }) => {
      queueMicrotask(() => {
        scheduleShikiRefresh(editor)
      })
    },
    onUpdate: ({ editor }) => {
      const md = useOfficialMarkdown
        ? postprocessMarkdownFromOfficial(getOfficialMarkdown(editor as { getMarkdown?: () => string }))
        : getLegacyMarkdown(editor as { storage: { markdown?: { getMarkdown?: () => string } } })
      lastEmittedMarkdownRef.current = md
      onUpdateRef.current?.(md)
    },
  }, [useOfficialMarkdown, extensions])

  // Keep editorRef in sync for the Mathematics onClick callback
  editorRef.current = editor

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    updateTiptapShikiTheme(editor, shikiModes.current, shikiTheme)
    scheduleShikiRefresh(editor)
  }, [editor, shikiTheme])

  React.useEffect(() => {
    onEditorReady?.(editor as TiptapEditorHandle | null)
    return () => onEditorReady?.(null)
  }, [editor, onEditorReady])

  // Sync editable prop
  React.useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      // Changing authority is not a content edit or a request to save.
      editor.setEditable(editable, false)
    }
  }, [editor, editable])

  // Sync content when the selected task changes (key prop handles this,
  // but as a safety net for direct content prop changes)
  const prevContentRef = React.useRef(content)
  React.useEffect(() => {
    if (editor && content !== prevContentRef.current) {
      prevContentRef.current = content

      // Preserve selection for our own controlled echo. Host edits (for example
      // an Inspector checkbox) still update a focused editor without another save.
      if (content === lastEmittedMarkdownRef.current) {
        lastEmittedMarkdownRef.current = null
        return
      }

      const currentMd = useOfficialMarkdown
        ? postprocessMarkdownFromOfficial(getOfficialMarkdown(editor as { getMarkdown?: () => string }))
        : getLegacyMarkdown(editor as { storage: { markdown?: { getMarkdown?: () => string } } })

      if (currentMd !== content) {
        if (useOfficialMarkdown) {
          const normalized = preprocessMarkdownForOfficial(content)
          const options: { contentType: 'markdown'; emitUpdate: false } = { contentType: 'markdown', emitUpdate: false }
          editor.commands.setContent(normalized, options)
        } else {
          editor.commands.setContent(content, { emitUpdate: false })
        }

        queueMicrotask(() => {
          if (!editor.isDestroyed) {
            scheduleShikiRefresh(editor)
          }
        })
      }
    }
  }, [editor, content, useOfficialMarkdown])

  return (
    <div className={cn('tiptap-editor', className)}>
      <EditorContent editor={editor} />
      {editor && editable && <TiptapBubbleMenus editor={editor} />}
    </div>
  )
}
