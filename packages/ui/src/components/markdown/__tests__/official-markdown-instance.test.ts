/**
 * #1505 — the official engine gets a private `marked` instance per editor, so
 * entity tokenizers never land on the global `marked`, never grow per mount,
 * and never leak into later editors without entity nodes.
 */
import { useDomForFile } from '../../primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'
import { Editor, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Mathematics } from '@tiptap/extension-mathematics'
import { Markdown } from '@tiptap/markdown'
import { Marked, marked } from 'marked'
import { PerEditorMarkdown } from '../official-markdown'
import { EntityEmbed } from '../extensions/EntityEmbed'
import { EntityMention } from '../extensions/EntityMention'
import { preprocessMarkdownForOfficial, postprocessMarkdownFromOfficial } from '../TiptapMarkdownEditor'

useDomForFile()

// Same configuration as TiptapMarkdownEditor's official branch.
const markdownExtension = PerEditorMarkdown.configure({ markedOptions: { gfm: true } })
const math = Mathematics.configure({ katexOptions: { throwOnError: false, strict: false } })

type MarkedLike = { defaults: { extensions?: { block?: unknown[]; inline?: unknown[]; startBlock?: unknown[]; startInline?: unknown[] } | null } }

function mount(extensions: AnyExtension[], content: string): Editor {
  return new Editor({ extensions, content, contentType: 'markdown' })
}
function instanceOf(editor: Editor): MarkedLike {
  return (editor as unknown as { markdown: { instance: MarkedLike } }).markdown.instance
}
function sizes(instance: MarkedLike) {
  const ext = instance.defaults.extensions
  return { block: ext?.block?.length ?? 0, inline: ext?.inline?.length ?? 0, startBlock: ext?.startBlock?.length ?? 0, startInline: ext?.startInline?.length ?? 0 }
}

const flagOn = (): AnyExtension[] => [StarterKit, math, EntityMention, EntityEmbed, markdownExtension]
const flagOff = (): AnyExtension[] => [StarterKit, math, markdownExtension]
const CORPUS = ['[[task:1]]', '![[task:1]]', 'See [[task:1|One]] and [[My note]]\n\n![[goal:q4]]\n\nend']

describe('official engine: private marked instance per editor (#1505 fix4)', () => {
  it('a flag-off editor mounted after a flag-on one round-trips [[task:1]] and ![[task:1]] unchanged', () => {
    const on = mount(flagOn(), 'See [[task:1]]\n\n![[goal:q4]]')
    expect(JSON.stringify(on.getJSON())).toContain('"mention"')
    for (const source of CORPUS) {
      const off = mount(flagOff(), source)
      const out = off.getMarkdown()
      const json = JSON.stringify(off.getJSON())
      off.destroy()
      expect({ source, out }).toEqual({ source, out: source })
      expect(json).not.toContain('"mention"')
      expect(json).not.toContain('entityEmbed')
    }
    on.destroy()
  })

  it('control: editors sharing one marked instance (main\'s global behaviour) drop the text', () => {
    const shared = new Marked() as unknown as typeof marked
    const sharedMarkdown = Markdown.configure({ marked: shared })
    const on = mount([StarterKit, EntityMention, EntityEmbed, sharedMarkdown], '[[task:1]]')
    const off = mount([StarterKit, sharedMarkdown], 'a [[task:1]] b')
    const out = off.getMarkdown()
    on.destroy()
    off.destroy()
    expect(out).not.toContain('[[task:1]]')
  })

  it('repeated mounts never grow tokenizer arrays and never touch the global marked', () => {
    const globalBefore = sizes(marked as unknown as MarkedLike)
    const seen = new Set<MarkedLike>()
    const perMount: Array<ReturnType<typeof sizes>> = []
    for (let i = 0; i < 5; i++) {
      // The same configured extension object every time (memoised extensions / StrictMode).
      const editor = mount(flagOn(), '[[task:1]]')
      const instance = instanceOf(editor)
      seen.add(instance)
      perMount.push(sizes(instance))
      editor.destroy()
    }
    expect(seen.size).toBe(5)
    expect(perMount.every((s) => JSON.stringify(s) === JSON.stringify(perMount[0]))).toBe(true)
    expect(perMount[0]!.inline).toBeGreaterThan(0)
    expect(perMount[0]!.block).toBeGreaterThan(0)
    expect(sizes(marked as unknown as MarkedLike)).toEqual(globalBefore)
    // The configured options are left as configured (no instance pinned on the shared extension).
    expect(markdownExtension.options.marked).toBeUndefined()
  })

  it('math still parses and round-trips on the private instance', () => {
    const source = preprocessMarkdownForOfficial('Inline $$x$$ and value $100.\n\n$$E=mc^2$$')
    const editor = mount(flagOff(), source)
    const json = JSON.stringify(editor.getJSON())
    const out = postprocessMarkdownFromOfficial(editor.getMarkdown())
    editor.destroy()
    expect(json).toContain('inlineMath')
    expect(out).toContain('$x$')
    expect(out).toContain('$100')
    expect(out).toContain('E=mc^2')
  })

  it('an explicitly configured marked instance is respected', () => {
    const own = new Marked() as unknown as typeof marked
    const editor = mount([StarterKit, PerEditorMarkdown.configure({ marked: own })], 'x')
    const instance = instanceOf(editor)
    editor.destroy()
    expect(instance).toBe(own as unknown as MarkedLike)
  })
})
