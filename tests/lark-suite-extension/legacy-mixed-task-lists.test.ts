import { describe, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { getSchema, resolveExtensions, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { DOMParser as ProseMirrorDOMParser, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { DOMParser as XMLDOMParser, XMLSerializer } from '@xmldom/xmldom'
import { is, selectAll, type Options as SelectorOptions } from 'css-select'
import { Markdown } from 'tiptap-markdown'
import { LegacyMixedTaskLists, normalizeLegacyMixedTaskLists } from '../../packages/ui/src/components/markdown/legacy-mixed-task-lists'
import { RoxColumnsBlock, RoxColumnBlock } from '../../packages/ui/src/components/markdown/extensions/ColumnsBlock'
import { RoxBlockCallout, PortableCalloutBlockquote, collectRoxBlockTargets, toggleRoxBlockAt } from '../../packages/ui/src/components/markdown/extensions/rox-block-syntax'

// Existing transitive XML DOM + CSS selector dependencies provide a test-only
// browser surface. Run the installed MarkdownParser and ProseMirror DOMParser,
// rather than duplicating either library's list repair/serialization behavior.
const childNodes = (node: Node | null): Node[] => Array.from(node?.childNodes ?? [])
const descendants = (nodes: Node[]): Node[] => nodes.flatMap(node => [node, ...descendants(childNodes(node))])
const isElement = (node: Node): node is Element => node.nodeType === 1
const adapter: NonNullable<SelectorOptions<Node, Element>['adapter']> = {
  isTag: isElement,
  getChildren: childNodes,
  getParent: node => node.parentNode,
  getSiblings: node => childNodes(node.parentNode),
  getAttributeValue: (node, name) => node.getAttribute(name) ?? undefined,
  hasAttrib: (node, name) => node.hasAttribute(name),
  getName: node => node.tagName.toLowerCase(),
  getText: node => node.textContent ?? '',
  equals: (left, right) => left === right,
  existsOne: (predicate, nodes) => descendants(nodes).filter(isElement).some(predicate),
  findAll: (predicate, nodes) => descendants(nodes).filter(isElement).filter(predicate),
  findOne: (predicate, nodes) => descendants(nodes).filter(isElement).find(predicate) ?? null,
  removeSubsets: nodes => nodes.filter(node => {
    for (let parent = node.parentNode; parent; parent = parent.parentNode) if (nodes.includes(parent)) return false
    return true
  }),
}
const selectorOptions: SelectorOptions<Node, Element> = { adapter, xmlMode: false }
const xmlSerializer = new XMLSerializer()
const prototype: object = Object.getPrototypeOf(new XMLDOMParser().parseFromString('<body/>', 'text/html').documentElement)
Object.defineProperties(prototype, {
  children: { get(this: Element) { return childNodes(this).filter(isElement) } },
  parentElement: { get(this: Element) { return this.parentNode?.nodeType === 1 ? this.parentNode : null } },
  firstElementChild: { get(this: Element) { return this.children[0] ?? null } },
  nextElementSibling: { get(this: Element) { let next = this.nextSibling; while (next && next.nodeType !== 1) next = next.nextSibling; return next } },
  checked: { get(this: Element) { return this.hasAttribute('checked') } },
  classList: { get(this: Element) {
    const element = this
    const values = () => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
    return {
      contains: (value: string) => values().includes(value),
      add: (value: string) => element.setAttribute('class', [...new Set([...values(), value])].join(' ')),
      remove: (value: string) => {
        const remaining = values().filter((entry: string) => entry !== value)
        if (remaining.length) element.setAttribute('class', remaining.join(' '))
        else element.removeAttribute('class')
      },
    }
  } },
  innerHTML: { get(this: Element) { return childNodes(this).map(node => xmlSerializer.serializeToString(node)).join('') } },
})

describe('recovered presentation blocks in the actual legacy Markdown libraries', () => {
  const portable = 'Intro\n\n:::rox-columns {widths="60% 40%"}\n\n:::rox-column\n\nLeft **bold**\n\n:::\n\n:::rox-column\n\n> [!spoiler]- Private\n> Body text\n\n:::\n\n:::\n\nOutro'
  test('parse, edit, serialize and reopen keep columns, widths, text and portable callout markers', () => {
    const library = fixture(true, [RoxColumnsBlock, RoxColumnBlock, RoxBlockCallout, PortableCalloutBlockquote])
    const doc = library.parse(portable)
    expect(doc.child(1).type.name).toBe('roxColumns')
    expect(doc.child(1).childCount).toBe(2)
    expect(doc.child(1).attrs.widths).toBe('60% 40%')
    expect(collectRoxBlockTargets(doc)).toHaveLength(1)
    const state = EditorState.create({ schema: library.schema, doc })
    let editPos = 0
    doc.descendants((node, pos) => { if (node.isText && node.text?.startsWith('Left')) editPos = pos + 4 })
    expect(editPos).toBeGreaterThan(0)
    const edited = state.apply(state.tr.insertText(' updated', editPos)).doc
    const exported = library.serialize(edited)
    expect(exported).toContain(':::rox-columns {widths="60% 40%"}')
    expect(exported).toContain('[!spoiler]- Private')
    expect(exported).toContain('Body text')
    const reopened = library.parse(exported)
    expect(reopened.toJSON()).toEqual(edited.toJSON())
  })
  test('old slash-menu column aliases remain readable and code fences remain literal', () => {
    const library = fixture(true, [RoxColumnsBlock, RoxColumnBlock])
    const old = ':::columns 3\n:::column\nA\n:::\n:::column\nB\n:::\n:::column\nC\n:::\n:::\n'
    const doc = library.parse(old)
    expect(doc.firstChild?.type.name).toBe('roxColumns')
    expect(doc.firstChild?.childCount).toBe(3)
    const code = library.parse('```text\n:::rox-columns\n:::rox-column\n```')
    expect(code.textContent).toContain(':::rox-columns')
    expect(code.toJSON().content?.some(node => node.type === 'roxColumns')).toBe(false)
  })
  test('read-only callout interaction cannot change canonical Markdown', () => {
    const library = fixture(true, [RoxBlockCallout, PortableCalloutBlockquote])
    const doc = library.parse('> [!details]- Title\n> Body')
    const target = collectRoxBlockTargets(doc)[0]!
    let dispatched = false
    toggleRoxBlockAt({ editable: false, dispatch: () => { dispatched = true } } as never, target)
    expect(dispatched).toBe(false)
    expect(library.serialize(doc)).toContain('[!details]- Title')
  })
})
Object.assign(prototype, {
  matches(this: Element, selector: string) { return is(this, selector, selectorOptions) },
  closest(this: Element, selector: string): Element | null {
    for (let node: Element | null = this; node; node = node.parentElement) if (node.matches(selector)) return node
    return null
  },
  querySelectorAll(this: Element, selector: string) { return selectAll(selector, childNodes(this), selectorOptions) },
  querySelector(this: Element, selector: string) { return selectAll(selector, childNodes(this), selectorOptions)[0] ?? null },
  remove(this: Element) { this.parentNode?.removeChild(this) },
})

interface LegacyLibraryEditor {
  schema: Schema
  extensionManager: { extensions: Extensions }
  storage: { markdown: { options: { bulletListMarker: string } } }
}
interface LegacyParserPort {
  parse(content: string, options?: { inline?: boolean }): string
  parse<T>(content: T, options?: { inline?: boolean }): T
}
interface LegacySerializerPort {
  serialize(content: ProseMirrorNode): string
}
// These installed internal JS modules have no declarations. Narrow each actual
// runtime export to the constructor methods and editor fields used by its code.
const require = createRequire(import.meta.url)
const parserModule: unknown = require('../../node_modules/tiptap-markdown/src/parse/MarkdownParser.js')
const serializerModule: unknown = require('../../node_modules/tiptap-markdown/src/serialize/MarkdownSerializer.js')
const { MarkdownParser } = parserModule as {
  MarkdownParser: new (editor: LegacyLibraryEditor, options: { html: boolean; linkify: boolean; breaks: boolean }) => LegacyParserPort
}
const { MarkdownSerializer } = serializerModule as {
  MarkdownSerializer: new (editor: LegacyLibraryEditor) => LegacySerializerPort
}

function htmlBody(html: string): HTMLElement {
  return new XMLDOMParser().parseFromString(`<body>${html}</body>`, 'text/html').documentElement as unknown as HTMLElement
}

function fixture(fixed = true, additions: Extensions = []) {
  const base: Extensions = [
    StarterKit.configure({ codeBlock: false, ...(additions.some(extension => extension.name === 'blockquote') ? { blockquote: false as const } : {}) }), TaskList, TaskItem.configure({ nested: true }),
    ...(fixed ? [LegacyMixedTaskLists] : []), ...additions, Markdown.configure({ html: false }),
  ]
  const extensions = resolveExtensions(base)
  const schema = getSchema(base)
  const editor: LegacyLibraryEditor = { schema, extensionManager: { extensions }, storage: { markdown: { options: { bulletListMarker: '-' } } } }
  const parser = new MarkdownParser(editor, { html: false, linkify: false, breaks: false })
  const serializer = new MarkdownSerializer(editor)
  const parse = (markdown: string): ProseMirrorNode => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const previousNode = Object.getOwnPropertyDescriptor(globalThis, 'Node')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { DOMParser: class {
      parseFromString(html: string) { return { body: new XMLDOMParser().parseFromString(html, 'text/html').documentElement } }
    } } })
    Object.defineProperty(globalThis, 'Node', { configurable: true, value: { TEXT_NODE: 3 } })
    try {
      const html = parser.parse(markdown)
      return ProseMirrorDOMParser.fromSchema(schema).parse(htmlBody(html))
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else Reflect.deleteProperty(globalThis, 'window')
      if (previousNode) Object.defineProperty(globalThis, 'Node', previousNode)
      else Reflect.deleteProperty(globalThis, 'Node')
    }
  }
  return { schema, extensions, parser, parse, serialize: (doc: ProseMirrorNode) => serializer.serialize(doc) }
}

function nodes(doc: ProseMirrorNode, type: string) {
  const result: Array<{ node: ProseMirrorNode; pos: number }> = []
  doc.descendants((node, pos) => { if (node.type.name === type) result.push({ node, pos }) })
  return result
}
function listContent(doc: ProseMirrorNode): unknown {
  // The existing serializer separates sibling lists with a blank line. With
  // the same '-' marker, markdown-it reparses them as a loose list. Assert all
  // semantic attrs/content independently of that existing tight-list styling.
  return JSON.parse(JSON.stringify(doc.toJSON(), (key: string, value: unknown) => key === 'tight' ? undefined : value))
}
const SOURCE = '- Родитель ^existing-parent\n  - Дочерний блок ^existing-child\n- [ ] Новый блок без маркера'

describe('legacy mixed task lists through installed MarkdownParser and ProseMirror', () => {
  test('negative control reproduces schema repair; normalization preserves exactly two ordinary and one task items', () => {
    const broken = fixture(false).parse(SOURCE)
    expect(nodes(broken, 'taskItem').length).toBeGreaterThan(1)
    expect(nodes(broken, 'taskItem').some(({ node }) => !node.textContent)).toBe(true)
    const f = fixture()
    const doc = f.parse(SOURCE)
    doc.check()
    expect(nodes(doc, 'listItem').map(({ node }) => node.firstChild?.textContent)).toEqual(['Родитель ^existing-parent', 'Дочерний блок ^existing-child'])
    expect(nodes(doc, 'taskItem').map(({ node }) => ({ text: node.textContent, checked: node.attrs.checked }))).toEqual([{ text: 'Новый блок без маркера', checked: false }])
    expect(doc.content.content.map(node => node.type.name)).toEqual(['bulletList', 'taskList'])
    expect(nodes(doc, 'taskItem').every(({ node }) => node.textContent.length > 0)).toBe(true)
    const reparsed = f.parse(f.serialize(doc))
    expect(nodes(doc, 'bulletList')[0]?.node.attrs.tight).toBe(true)
    expect(nodes(reparsed, 'bulletList')[0]?.node.attrs.tight).toBe(false)
    expect(listContent(reparsed)).toEqual(listContent(doc))
  })

  test('hook runs before both built-in legacy adapters despite its array position', () => {
    const f = fixture()
    const names = f.extensions.map(extension => extension.name)
    expect(names.indexOf(LegacyMixedTaskLists.name)).toBeLessThan(names.indexOf('taskList'))
    expect(names.indexOf(LegacyMixedTaskLists.name)).toBeLessThan(names.indexOf('taskItem'))
    expect(f.parser.parse({ type: 'doc', content: [] })).toEqual({ type: 'doc', content: [] })
  })

  test('alternating runs preserve item order and checked states', () => {
    const f = fixture()
    const doc = f.parse('- [x] Done\n- Ordinary A\n- Ordinary B\n- [ ] Pending\n- Last')
    expect(doc.content.content.map(node => node.type.name)).toEqual(['taskList', 'bulletList', 'taskList', 'bulletList'])
    expect(doc.content.content.flatMap(list => list.content.content.map(item => item.textContent))).toEqual(['Done', 'Ordinary A', 'Ordinary B', 'Pending', 'Last'])
    expect(nodes(doc, 'taskItem').map(({ node }) => node.attrs.checked)).toEqual([true, false])
    expect(listContent(f.parse(f.serialize(doc)))).toEqual(listContent(doc))
  })

  test('nested mixed lists and checked parent tasks keep their descendants', () => {
    const f = fixture()
    const doc = f.parse('- [x] Parent\n  - Child plain\n  - [ ] Child task\n    - Grandchild plain\n    - [X] Grandchild task\n- Outer plain')
    doc.check()
    expect(nodes(doc, 'taskItem').map(({ node }) => [node.firstChild?.textContent, node.attrs.checked])).toEqual([['Parent', true], ['Child task', false], ['Grandchild task', true]])
    expect(nodes(doc, 'listItem').map(({ node }) => node.firstChild?.textContent)).toEqual(['Child plain', 'Grandchild plain', 'Outer plain'])
    expect(nodes(doc, 'taskItem')[0]?.node.child(1).type.name).toBe('bulletList')
    expect(listContent(f.parse(f.serialize(doc)))).toEqual(listContent(doc))
  })

  test('ordered ordinary runs retain their numbering after task segments', () => {
    const f = fixture()
    const doc = f.parse('3. Ordinary third\n4. [x] Fourth task\n5. Ordinary fifth\n6. Ordinary sixth\n7. [ ] Seventh task')
    doc.check()
    expect(doc.content.content.map(node => node.type.name)).toEqual(['orderedList', 'taskList', 'orderedList', 'taskList'])
    expect(nodes(doc, 'orderedList').map(({ node }) => node.attrs.start)).toEqual([3, 5])
    expect(nodes(doc, 'taskItem').map(({ node }) => node.attrs.checked)).toEqual([true, false])
    expect(f.parse(f.serialize(doc)).toJSON()).toEqual(doc.toJSON())
  })

  test('pure ordinary and pure task lists retain the legacy result', () => {
    const f = fixture()
    const original = fixture(false)
    for (const source of ['- A\n  - B\n- C', '- [x] Done\n  - [ ] Child\n- [ ] Pending', '8. A\n9. B', '- [ ]\n- [x]no-space\n- [q] malformed']) {
      const actual = f.parse(source)
      expect(actual.toJSON()).toEqual(original.parse(source).toJSON())
      expect(f.serialize(actual)).toBe(original.serialize(original.parse(source)))
    }
  })

  test('editing and checkbox transactions serialize normally after normalization', () => {
    const f = fixture()
    let state = EditorState.create({ schema: f.schema, doc: f.parse(SOURCE) })
    const task = nodes(state.doc, 'taskItem')[0]!
    const toggle = state.tr.setNodeMarkup(task.pos, undefined, { ...task.node.attrs, checked: true })
    expect(toggle.docChanged).toBe(true)
    state = state.apply(toggle)
    expect(f.serialize(state.doc)).toContain('- [x] Новый блок без маркера')
    state = state.apply(state.tr.insertText('Изменённый ', task.pos + 2))
    const saved = f.serialize(state.doc)
    expect(saved).toContain('- [x] Изменённый Новый блок без маркера')
    expect(saved).toContain('^existing-parent')
    expect(saved).toContain('^existing-child')
    expect(nodes(f.parse(saved), 'taskItem')).toHaveLength(1)
    expect(listContent(f.parse(saved))).toEqual(listContent(state.doc))
  })
})

describe('DOM normalization boundaries', () => {
  test('moves original LI, nested lists and input nodes and preserves list attributes', () => {
    const root = htmlBody('<ul id="list" class="custom contains-task-list" data-context="keep"><li>A<ul><li>Nested</li></ul></li>\n<li class="task-list-item"><input type="checkbox" checked=""/>B</li>\n<li>C</li></ul>')
    const items = Array.from(root.querySelectorAll('li'))
    const checkbox = root.querySelector('input')
    normalizeLegacyMixedTaskLists(root)
    expect(Array.from(root.querySelectorAll('li'))).toEqual(items)
    expect(root.querySelector('input')).toBe(checkbox)
    expect(root.children).toHaveLength(3)
    expect(root.querySelectorAll('#list')).toHaveLength(1)
    expect(Array.from(root.children).every(list => list.getAttribute('data-context') === 'keep' && list.classList.contains('custom'))).toBe(true)
    expect(Array.from(root.children).map(list => list.classList.contains('contains-task-list'))).toEqual([false, true, false])
    const once = root.innerHTML
    normalizeLegacyMixedTaskLists(root)
    expect(root.innerHTML).toBe(once)
  })

  test('pure lists are untouched and stale markers cannot turn ordinary/empty lists into task lists', () => {
    for (const html of ['<ul><li>A</li></ul>', '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox"/>A</li></ul>']) {
      const root = htmlBody(html)
      const before = root.innerHTML
      normalizeLegacyMixedTaskLists(root)
      expect(root.innerHTML).toBe(before)
    }
    const root = htmlBody('<ul class="custom contains-task-list" data-type="taskList"><li>A</li></ul><ul class="contains-task-list"/>')
    normalizeLegacyMixedTaskLists(root)
    expect(root.querySelectorAll('.contains-task-list')).toHaveLength(0)
    expect(root.querySelectorAll('[data-type="taskList"]')).toHaveLength(0)
    expect(root.querySelectorAll('li')).toHaveLength(1)
  })

  test('unrecognized malformed list HTML is left intact', () => {
    const root = htmlBody('<ul class="contains-task-list"><div>Unexpected</div><li class="task-list-item"><input type="checkbox"/>A</li></ul>')
    const before = root.innerHTML
    normalizeLegacyMixedTaskLists(root)
    expect(root.innerHTML).toBe(before)
  })
})
