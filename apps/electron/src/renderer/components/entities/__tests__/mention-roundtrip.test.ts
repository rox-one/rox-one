/**
 * W1-08 (#1505) — mention round-trip:
 * TipTap JSON → Markdown (`[[kind:id|label]]`, `![[kind:id]]`) →
 * server-core extract.ts → the same refs; and Markdown → TipTap JSON again.
 * Covers the legacy engine (Notes) and the official @tiptap/markdown engine.
 */
import '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown as LegacyMarkdown } from 'tiptap-markdown'
import { Markdown as OfficialMarkdown } from '@tiptap/markdown'
import { formatEntityRef, type EntityRef } from '@rox/core/entities'
import { EntityEmbed, EntityMention } from '@rox/ui/markdown'
import { extractLinksFromTiptapDoc, wikilinkTargetsToRefs } from '@rox/server-core/entities/extract'

type Engine = 'legacy' | 'official'

function makeEditor(engine: Engine, content?: string | JSONContent): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [
      StarterKit,
      EntityMention,
      EntityEmbed,
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
      const fromJsonMentions = extractLinksFromTiptapDoc(json as never).map((link) => link.to)
      const fromMarkdown = wikilinkTargetsToRefs(markdown).map((link) => link.to)
      expect(keys(fromJsonMentions)).toEqual(keys(REFS))
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
