/**
 * W1-08 (#1505) — mention round-trip:
 * TipTap JSON → Markdown (`[[kind:id|label]]`, `![[kind:id]]`) →
 * server-core extract.ts → the same refs; and Markdown → TipTap JSON again.
 * Covers the legacy engine (Notes) and the official @tiptap/markdown engine.
 */
import { useDomForFile } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown as LegacyMarkdown } from 'tiptap-markdown'
import { Markdown as OfficialMarkdown } from '@tiptap/markdown'
import { formatEntityRef, type EntityRef } from '@rox/core/entities'
import { EntityEmbed, EntityMention } from '@rox/ui/markdown'
import { extractLinksFromTiptapDoc, wikilinkTargetsToRefs } from '@rox/server-core/entities/extract'

useDomForFile()

type Engine = 'legacy' | 'official'

function makeEditor(engine: Engine, content?: string | JSONContent, options: { entityNodes?: boolean } = {}): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [
      StarterKit,
      ...(options.entityNodes === false ? [] : [EntityMention, EntityEmbed]),
      engine === 'legacy' ? LegacyMarkdown.configure({ html: false }) : OfficialMarkdown,
    ],
    ...(content !== undefined
      ? engine === 'official' && typeof content === 'string'
        ? { content, contentType: 'markdown' as const }
        : { content }
      : {}),
  })
}

function toMarkdown(editor: Editor, engine: Engine): string {
  return engine === 'legacy'
    ? (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
    : (editor as unknown as { getMarkdown(): string }).getMarkdown()
}

const REFS: EntityRef[] = [
  { kind: 'task', id: '42' },
  { kind: 'project', id: 'rox desktop' },
  { kind: 'note', id: 'a#b%c' },
]
const EMBED: EntityRef = { kind: 'goal', id: 'q4' }

const DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ' },
        { type: 'mention', attrs: { ref: formatEntityRef(REFS[0]!), label: 'Fix bug' } },
        { type: 'text', text: ' and ' },
        { type: 'mention', attrs: { ref: formatEntityRef(REFS[1]!), label: null } },
        { type: 'text', text: ', also ' },
        { type: 'mention', attrs: { ref: formatEntityRef(REFS[2]!), label: 'Odd | label ] here' } },
      ],
    },
    { type: 'entityEmbed', attrs: { ref: formatEntityRef(EMBED) } },
  ],
}

const keys = (refs: readonly EntityRef[]) => refs.map((ref) => formatEntityRef(ref)).sort()

for (const engine of ['legacy', 'official'] as const) {
  describe(`mention round-trip (${engine} engine)`, () => {
    it('serialises mention → [[kind:id|label]] and embed → ![[kind:id]]', () => {
      const editor = makeEditor(engine, DOC)
      const markdown = toMarkdown(editor, engine)
      editor.destroy()
      expect(markdown).toContain('[[task:42|Fix bug]]')
      expect(markdown).toContain(`[[${formatEntityRef(REFS[1]!)}]]`)
      expect(markdown).toMatch(/^!\[\[goal:q4\]\]$/m)
      // Labels can never break the wikilink syntax.
      expect(markdown).not.toContain('Odd | label ] here')
    })

    it('extract.ts recovers exactly the same refs from JSON and from Markdown', () => {
      const editor = makeEditor(engine, DOC)
      const json = editor.getJSON()
      const markdown = toMarkdown(editor, engine)
      editor.destroy()
      const fromJson = extractLinksFromTiptapDoc(json as never)
      const fromJsonMentions = fromJson.filter((link) => !link.relation).map((link) => link.to)
      const fromJsonEmbeds = fromJson.filter((link) => link.relation === 'embeds').map((link) => link.to)
      const fromMarkdown = wikilinkTargetsToRefs(markdown).map((link) => link.to)
      expect(keys(fromJsonMentions)).toEqual(keys(REFS))
      expect(keys(fromJsonEmbeds)).toEqual(keys([EMBED]))
      expect(keys(fromMarkdown)).toEqual(keys([...REFS, EMBED]))
    })

    it('Markdown → TipTap JSON restores the same mention/embed nodes', () => {
      const first = makeEditor(engine, DOC)
      const markdown = toMarkdown(first, engine)
      first.destroy()
      const second = makeEditor(engine, markdown)
      const json = second.getJSON()
      const again = toMarkdown(second, engine)
      second.destroy()
      const nodes: Array<{ type: string; ref: string; label?: string | null }> = []
      const walk = (node: JSONContent) => {
        if (node.type === 'mention' || node.type === 'entityEmbed') nodes.push({ type: node.type, ref: String(node.attrs?.ref), label: node.attrs?.label ?? null })
        for (const child of node.content ?? []) walk(child)
      }
      walk(json)
      expect(nodes.map((n) => [n.type, n.ref])).toEqual([
        ['mention', 'task:42'],
        ['mention', formatEntityRef(REFS[1]!)],
        ['mention', formatEntityRef(REFS[2]!)],
        ['entityEmbed', 'goal:q4'],
      ])
      expect(nodes[0]!.label).toBe('Fix bug')
      expect(again).toBe(markdown)
    })

    it('does not create mentions from bare kind:id, invalid refs or plain wikilinks (negative)', () => {
      const editor = makeEditor(engine, 'Bare task:42 and doc:2, bad [[nope:1|x]], note [[My note]], url file:///tmp/a\n')
      const json = JSON.stringify(editor.getJSON())
      editor.destroy()
      expect(json).not.toContain('"mention"')
      expect(json).not.toContain('"entityEmbed"')
    })
  })
}

/** Load → save once, returning the Markdown and the entity nodes seen. */
function roundTrip(engine: Engine, markdown: string, options: { entityNodes?: boolean } = {}) {
  const editor = makeEditor(engine, markdown, options)
  const out = toMarkdown(editor, engine)
  const nodes: Array<{ type: string; ref: string; label: string; source: string }> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'mention' || node.type.name === 'entityEmbed') {
      nodes.push({ type: node.type.name, ref: String(node.attrs.ref), label: String(node.attrs.label ?? ''), source: String(node.attrs.source ?? '') })
    }
  })
  editor.destroy()
  return { out, nodes }
}

const BYTE_IDENTICAL = [
  'See [[doc:2]] and [[meeting:x]] and [[user:a]] and [[heading:Intro]]',
  'Pct [[note:100%]] and [[note:a%23b]]',
  'Label [[task:1|  Spaced   label ]] and [[task:2|Fix bug]] and [[ task:3 ]]',
  '![[task:1|Release plan]]',
  '![[objective:q4]]',
  'A\n\n![[goal:q4| Q4 ]]\n\nB [[note:abc#Heading]]',
]

for (const engine of ['legacy', 'official'] as const) {
  describe(`saving never rewrites user text (${engine} engine)`, () => {
    it('round-trips alias kinds, % ids, labels and embed labels byte-identically', () => {
      for (const markdown of BYTE_IDENTICAL) {
        const { out, nodes } = roundTrip(engine, markdown)
        expect(out).toBe(markdown)
        expect(nodes.length).toBeGreaterThan(0)
      }
    })

    it('resolves through the canonical ref while keeping the original source', () => {
      const { nodes } = roundTrip(engine, 'See [[doc:2| Plan ]] and [[note:100%]]\n\n![[objective:q4|Goal]]')
      expect(nodes).toEqual([
        { type: 'mention', ref: 'note:2', label: 'Plan', source: '[[doc:2| Plan ]]' },
        { type: 'mention', ref: 'note:100%25', label: '', source: '[[note:100%]]' },
        { type: 'entityEmbed', ref: 'goal:q4', label: 'Goal', source: '![[objective:q4|Goal]]' },
      ])
    })

    it('mid-line embeds and embeds right under a paragraph stay in their paragraph', () => {
      for (const markdown of ['See ![[task:1]]', 'Para\n![[task:1]]']) {
        const flagOn = roundTrip(engine, markdown)
        const flagOff = roundTrip(engine, markdown, { entityNodes: false })
        expect(flagOn.nodes.filter((n) => n.type === 'entityEmbed')).toEqual([])
        // Flag on must save exactly what the editor saves with the flag off.
        expect(flagOn.out).toBe(flagOff.out)
        if (engine === 'official') expect(flagOn.out).toBe(markdown)
      }
    })

    it('note titles with a colon stay plain wikilinks', () => {
      const markdown = 'Title [[note: итоги]] and [[Встреча: итоги]] and [[My note]]'
      const flagOn = roundTrip(engine, markdown)
      expect(flagOn.nodes).toEqual([])
      expect(flagOn.out).toBe(roundTrip(engine, markdown, { entityNodes: false }).out)
      if (engine === 'official') expect(flagOn.out).toBe(markdown)
      // The link index agrees: a note-title link, not an entity ref.
      expect(wikilinkTargetsToRefs('[[note: итоги]]').map((l) => l.to)).toEqual([{ kind: 'note', id: 'note: итоги' }])
    })

    it('picker-inserted mentions serialise canonically', () => {
      const editor = makeEditor(engine, '')
      editor.commands.insertEntityMention({ ref: 'doc:2', label: 'Plan' })
      const out = toMarkdown(editor, engine)
      editor.destroy()
      expect(out).toBe('[[note:2|Plan]]')
    })
  })
}

/** Type `text` character by character through ProseMirror's text-input path (input rules). */
function typeText(editor: Editor, text: string): void {
  for (const ch of text) {
    const { from, to } = editor.state.selection
    const view = editor.view
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

function entityNodes(editor: Editor) {
  const nodes: Array<{ type: string; ref: string; label: string; source: string }> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'mention' || node.type.name === 'entityEmbed') {
      nodes.push({ type: node.type.name, ref: String(node.attrs.ref), label: String(node.attrs.label ?? ''), source: String(node.attrs.source ?? '') })
    }
  })
  return nodes
}

for (const engine of ['legacy', 'official'] as const) {
  describe(`input and paste rules (${engine} engine)`, () => {
    it('typing the closing ]] of explicit syntax creates a mention that saves as typed', () => {
      const editor = makeEditor(engine)
      editor.commands.focus('end')
      typeText(editor, 'See [[doc:2| Plan ]] now')
      const nodes = entityNodes(editor)
      const out = toMarkdown(editor, engine)
      editor.destroy()
      expect(nodes).toEqual([{ type: 'mention', ref: 'note:2', label: 'Plan', source: '[[doc:2| Plan ]]' }])
      expect(out).toBe('See [[doc:2| Plan ]] now')
    })

    it('typing ![[kind:id]] alone on a line creates an embed', () => {
      const editor = makeEditor(engine)
      editor.commands.focus('end')
      typeText(editor, '![[task:1|Release plan]]')
      const nodes = entityNodes(editor)
      const out = toMarkdown(editor, engine)
      editor.destroy()
      expect(nodes).toEqual([{ type: 'entityEmbed', ref: 'task:1', label: 'Release plan', source: '![[task:1|Release plan]]' }])
      expect(out.split('\n')[0]).toBe('![[task:1|Release plan]]')
    })

    it('plain wikilinks, note titles, unknown kinds and mid-line embeds stay text (negative)', () => {
      const editor = makeEditor(engine)
      editor.commands.focus('end')
      typeText(editor, '[[My note]] [[note: итоги]] [[Встреча: итоги]] [[nope:1]] x ![[task:1]] task:1')
      const nodes = entityNodes(editor)
      editor.destroy()
      expect(nodes).toEqual([])
    })

    it('pasted plain text with explicit syntax becomes nodes; plain titles do not', () => {
      const editor = makeEditor(engine)
      editor.commands.focus('end')
      editor.view.pasteText('Pasted [[user:a|Ann]] and [[My note]]')
      const nodes = entityNodes(editor)
      const out = toMarkdown(editor, engine)
      editor.destroy()
      expect(nodes).toEqual([{ type: 'mention', ref: 'person:a', label: 'Ann', source: '[[user:a|Ann]]' }])
      expect(out).toContain('[[user:a|Ann]]')
    })
  })
}

describe('input and paste rules without Markdown (rule-only path)', () => {
  function plainEditor(): Editor {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return new Editor({ element, extensions: [StarterKit, EntityMention, EntityEmbed] })
  }

  it('paste rule converts mentions and whole-paragraph embeds', () => {
    const editor = plainEditor()
    editor.commands.focus('end')
    editor.view.pasteHTML('<p>See [[doc:2]] and ![[task:9]] inline</p><p>![[goal:q4|Q4]]</p>')
    const nodes = entityNodes(editor)
    editor.destroy()
    expect(nodes).toEqual([
      { type: 'mention', ref: 'note:2', label: '', source: '[[doc:2]]' },
      { type: 'entityEmbed', ref: 'goal:q4', label: 'Q4', source: '![[goal:q4|Q4]]' },
    ])
  })
})
