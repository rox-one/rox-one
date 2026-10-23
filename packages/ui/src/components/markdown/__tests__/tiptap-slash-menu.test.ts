import { describe, it, expect } from 'bun:test'
import type { Editor } from '@tiptap/core'
import { createSlashCommandItems, filterSlashCommandItems } from '../TiptapSlashMenu'
import { RICH_BLOCK_EDIT_EVENT } from '../rich-block-events'

function createMockEditor() {
  const calls: string[] = []

  const chainApi = {
    focus: () => {
      calls.push('focus')
      return chainApi
    },
    setParagraph: () => {
      calls.push('setParagraph')
      return chainApi
    },
    toggleHeading: ({ level }: { level: number }) => {
      calls.push(`toggleHeading:${level}`)
      return chainApi
    },
    toggleBulletList: () => {
      calls.push('toggleBulletList')
      return chainApi
    },
    toggleOrderedList: () => {
      calls.push('toggleOrderedList')
      return chainApi
    },
    toggleTaskList: () => {
      calls.push('toggleTaskList')
      return chainApi
    },
    setBlockquote: () => {
      calls.push('setBlockquote')
      return chainApi
    },
    setHorizontalRule: () => {
      calls.push('setHorizontalRule')
      return chainApi
    },
    setCodeBlock: ({ language }: { language: string }) => {
      calls.push(`setCodeBlock:${language}`)
      return chainApi
    },
    insertContent: (payload: unknown) => {
      calls.push(`insertContent:${JSON.stringify(payload)}`)
      return chainApi
    },
    insertContentAt: (pos: number, payload: unknown) => {
      calls.push(`insertContentAt:${pos}:${JSON.stringify(payload)}`)
      return chainApi
    },
    setTextSelection: (selection: number | { from: number; to: number }) => {
      calls.push(`setTextSelection:${JSON.stringify(selection)}`)
      selectionFrom = typeof selection === 'number' ? selection : selection.from
      return chainApi
    },
    setNodeSelection: (pos: number) => {
      calls.push(`setNodeSelection:${pos}`)
      return chainApi
    },
    splitBlock: () => {
      calls.push('splitBlock')
      applySplitBlock()
      return chainApi
    },
    command: (fn: (props: {
      state: unknown
      commands: {
        splitBlock: () => boolean
        setTextSelection: (selection: number | { from: number; to: number }) => boolean
      }
    }) => boolean) => {
      calls.push('command')
      fn({
        state: {
          selection: {
            from: selectionFrom,
            $from: {
              parentOffset,
              parent: { content: { size: parentContentSize } },
              before: () => Math.max(0, selectionFrom - parentOffset - 1),
            },
          },
        },
        commands: {
          splitBlock: () => {
            calls.push('splitBlock')
            applySplitBlock()
            return true
          },
          setTextSelection: (selection: number | { from: number; to: number }) => {
            calls.push(`setTextSelection:${JSON.stringify(selection)}`)
            selectionFrom = typeof selection === 'number' ? selection : selection.from
            // Move into empty sibling created by start-split (real PM leaves caret in content).
            if (pendingEmptyPos !== null && selectionFrom === pendingEmptyPos) {
              parentContentSize = 0
              parentOffset = 0
              pendingEmptyPos = null
            }
            return true
          },
        },
      })
      return chainApi
    },
    run: () => {
      calls.push('run')
      return true
    },
  }

  let selectionFrom = 5
  let parentOffset = 0
  let parentContentSize = 0
  /** Position of empty sibling after a start-split; selection stays in content until moved. */
  let pendingEmptyPos: number | null = null

  /**
   * Mirror ProseMirror splitBlock for embed isolation:
   * - mid/end (offset > 0): caret moves to start of remaining textblock (suffix or empty).
   * - start of non-empty: empty sibling is created BEFORE, but selection stays in the
   *   content half (parentContentSize unchanged) until setTextSelection(emptyPos).
   */
  function applySplitBlock() {
    if (parentOffset > 0) {
      parentContentSize = Math.max(0, parentContentSize - parentOffset)
      parentOffset = 0
      return
    }
    if (parentContentSize > 0) {
      // Real PM: do NOT clear content — caret remains in the content half.
      pendingEmptyPos = selectionFrom - parentOffset // === before() + 1
    }
  }

  const editor = {
    state: {
      selection: {
        from: 5,
        get $from() {
          return {
            parentOffset,
            parent: { content: { size: parentContentSize } },
          }
        },
      },
      doc: {
        nodesBetween: () => {},
        resolve: () => ({
          parentOffset,
          parent: { isTextblock: true, content: { size: parentContentSize } },
        }),
      },
    },
    can: () => ({
      setCodeBlock: () => true,
    }),
    isActive: () => false,
    getAttributes: () => ({}),
    chain: () => chainApi,
    emit: (event: string) => {
      calls.push(`emit:${event}`)
    },
  }

  return {
    editor: editor as unknown as Editor,
    calls,
    setParentOffset: (value: number) => {
      parentOffset = value
    },
    setParentContentSize: (value: number) => {
      parentContentSize = value
    },
  }
}

describe('tiptap slash menu', () => {
  it('filters by title, description, and aliases', () => {
    const { editor } = createMockEditor()
    const items = createSlashCommandItems(editor)

    expect(filterSlashCommandItems(items, 'heading').some((item) => item.id === 'heading-1')).toBe(true)
    expect(filterSlashCommandItems(items, 'divider').some((item) => item.id === 'horizontal-rule')).toBe(true)
    expect(filterSlashCommandItems(items, 'flow').some((item) => item.id === 'mermaid-code-block')).toBe(true)
    expect(filterSlashCommandItems(items, 'checklist').some((item) => item.id === 'task-list')).toBe(true)
  })

  it('returns all items for empty query and includes icons', () => {
    const { editor } = createMockEditor()
    const items = createSlashCommandItems(editor)
    const filtered = filterSlashCommandItems(items, '   ')

    expect(filtered.length).toBe(items.length)
    expect(filtered.every((item) => item.icon.length > 0)).toBe(true)
    expect(filtered.some((item) => (item as { group: string }).group === 'Visual')).toBe(false)
  })

  it('maps commands to expected chain calls', async () => {
    const { editor, calls } = createMockEditor()
    const items = createSlashCommandItems(editor)

    const heading = items.find((item) => item.id === 'heading-1')
    heading?.run(editor)
    expect(calls.slice(-3)).toEqual(['focus', 'toggleHeading:1', 'run'])

    const code = items.find((item) => item.id === 'code-block')
    code?.run(editor)
    expect(calls).toContain('insertContentAt:5:{"type":"codeBlock","attrs":{"language":"plaintext"},"content":[{"type":"text","text":" "}]}')
    expect(calls).toContain('setTextSelection:{"from":6,"to":6}')

    const taskList = items.find((item) => item.id === 'task-list')
    taskList?.run(editor)
    expect(calls.slice(-3)).toEqual(['focus', 'toggleTaskList', 'run'])

    const quote = items.find((item) => item.id === 'blockquote')
    quote?.run(editor, 5)
    expect(calls.slice(-4)).toEqual(['focus', 'setTextSelection:5', 'setBlockquote', 'run'])
    expect(calls).not.toContain('toggleBlockquote')

    const mermaid = items.find((item) => item.id === 'mermaid-code-block')
    mermaid?.run(editor, 5)
    await Promise.resolve()

    expect(calls).toContain('insertContentAt:5:{"type":"mermaidBlock","attrs":{"code":"graph TD\\n  A[Start] --> B[End]"}}')
    expect(calls).toContain('setNodeSelection:5')
    expect(calls).toContain(`emit:${RICH_BLOCK_EDIT_EVENT}`)

    const latex = items.find((item) => item.id === 'latex-code-block')
    latex?.run(editor, 5)
    await Promise.resolve()

    expect(calls).toContain('insertContentAt:5:{"type":"latexBlock","attrs":{"code":"E = mc^2"}}')
  })

  it('includes footnote, table, columns, tabs, callout kinds, spoiler and embed commands', () => {
    const { editor, calls } = createMockEditor()
    const items = createSlashCommandItems(editor)
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining([
      'footnote',
      'table',
      'columns-2',
      'columns-3',
      'tabs',
      'callout-note',
      'callout-info',
      'callout-warning',
      'callout-tip',
      'callout-success',
      'callout-question',
      'spoiler',
      'callout-details',
      'embed',
    ]))
    items.find((item) => item.id === 'footnote')?.run(editor)
    expect(calls).toContain('insertContent:"See note.[^1]\\n\\n[^1]: "')
    items.find((item) => item.id === 'table')?.run(editor)
    expect(calls.some((call) => call.startsWith('insertContent:') && call.includes('| A | B |') && call.includes('hardBreak'))).toBe(true)
    expect(calls.some((call) => call.includes('| A | B |\\n| ---'))).toBe(false)
    items.find((item) => item.id === 'columns-2')?.run(editor)
    expect(calls.some((call) => call.startsWith('insertContentAt:') && call.includes('roxColumns'))).toBe(true)
    items.find((item) => item.id === 'tabs')?.run(editor)
    expect(calls.some((call) => call.startsWith('insertContentAt:') && call.includes('roxTabs'))).toBe(true)
  })

  it('embed inserts ![[ at insertPos in empty paragraph (no split)', () => {
    const { editor, calls } = createMockEditor()
    const items = createSlashCommandItems(editor)
    const embed = items.find((item) => item.id === 'embed')
    expect(embed?.description).not.toBe('Insert a note embed')
    embed?.run(editor, 12)
    expect(calls).toContain('setTextSelection:12')
    expect(calls).toContain('insertContent:"![["')
    expect(calls).toContain('run')
    expect(calls).not.toContain('splitBlock')
  })

  it('embed at end of non-empty paragraph splits once into empty textblock', () => {
    const { editor, calls, setParentOffset, setParentContentSize } = createMockEditor()
    setParentOffset(5)
    setParentContentSize(5)
    const embed = createSlashCommandItems(editor).find((item) => item.id === 'embed')
    embed?.run(editor, 10)
    const splits = calls.filter((c) => c === 'splitBlock')
    expect(splits).toHaveLength(1)
    expect(calls).toContain('insertContent:"![["')
    // After end-split the mock leaves an empty textblock (size 0) before insert.
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
  })

  it('embed mid-paragraph splits twice so suffix moves after and ![[ sits alone', () => {
    const { editor, calls, setParentOffset, setParentContentSize } = createMockEditor()
    setParentOffset(4)
    setParentContentSize(8)
    const embed = createSlashCommandItems(editor).find((item) => item.id === 'embed')
    embed?.run(editor, 9)
    const splits = calls.filter((c) => c === 'splitBlock')
    expect(splits).toHaveLength(2)
    // After start-split, caret must move into the empty middle block before insert.
    const lastSplit = calls.lastIndexOf('splitBlock')
    const moveIntoEmpty = calls.indexOf('setTextSelection:9', lastSplit)
    expect(moveIntoEmpty).toBeGreaterThan(lastSplit)
    expect(calls.indexOf('insertContent:"![["')).toBeGreaterThan(moveIntoEmpty)
    expect(editor.state.selection.$from.parentOffset).toBe(0)
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
  })

  it('embed at start of non-empty paragraph pushes existing text into following para', () => {
    const { editor, calls, setParentOffset, setParentContentSize } = createMockEditor()
    setParentOffset(0)
    setParentContentSize(7)
    const embed = createSlashCommandItems(editor).find((item) => item.id === 'embed')
    embed?.run(editor, 1)
    const splits = calls.filter((c) => c === 'splitBlock')
    expect(splits).toHaveLength(1)
    // splitBlock-at-start leaves caret in content; must setTextSelection into empty before insert.
    const lastSplit = calls.lastIndexOf('splitBlock')
    const moveIntoEmpty = calls.indexOf('setTextSelection:1', lastSplit)
    expect(moveIntoEmpty).toBeGreaterThan(lastSplit)
    expect(calls.indexOf('insertContent:"![["')).toBeGreaterThan(moveIntoEmpty)
    expect(editor.state.selection.$from.parentOffset).toBe(0)
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
  })

  it('equation aliases resolve to latex block insert', async () => {
    const { editor, calls } = createMockEditor()
    const items = createSlashCommandItems(editor)
    expect(filterSlashCommandItems(items, 'equation').some((item) => item.id === 'latex-code-block')).toBe(true)
    expect(filterSlashCommandItems(items, 'формула').some((item) => item.id === 'latex-code-block')).toBe(true)
    const latex = items.find((item) => item.id === 'latex-code-block')
    expect(latex?.aliases).toEqual(expect.arrayContaining(['equation', 'latex', 'math', 'tex', 'katex']))
    latex?.run(editor, 5)
    await Promise.resolve()
    expect(calls).toContain('insertContentAt:5:{"type":"latexBlock","attrs":{"code":"E = mc^2"}}')
  })
})
