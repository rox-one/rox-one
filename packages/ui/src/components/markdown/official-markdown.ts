/**
 * `@tiptap/markdown` with a private `marked` instance per editor (#1505).
 *
 * Without a `marked` option, @tiptap/markdown registers every extension's
 * `markdownTokenizer` (math, Rox blocks, entity mention/embed, …) on the
 * shared global `marked` via `marked.use()`. That grows the global tokenizer
 * lists on every editor mount and leaks tokenizers into later editors: an
 * editor without EntityMention/EntityEmbed would lex `[[task:1]]` into a
 * token it has no handler for and silently drop the text on save.
 *
 * Here each editor creation gets its own `Marked` instance, so it only sees
 * the tokenizers of its own extensions, registered once. The instance is made
 * in `onBeforeCreate` (not at `configure()` time) so two editors built from
 * the same extension object (React StrictMode, remounts with memoised
 * extensions) still never share one.
 */
import { Markdown, type MarkdownManager } from '@tiptap/markdown'
import { Lexer, Marked, Parser, type MarkedOptions, type Token, type TokensList, type marked } from 'marked'

/**
 * A `Marked` instance whose `Lexer` / `Parser` classes default to the
 * instance's own options.
 *
 * `Marked#Lexer` / `#Parser` are marked's module-level classes, and their
 * constructors (and static `lex` / `lexInline` / `parse` / `parseInline`)
 * fall back to marked's *global* defaults when called without options. Only
 * the global `marked.use()` updates those; a private instance's `use()`
 * updates `instance.defaults` alone. @tiptap/markdown builds its helper
 * lexer as `new markedInstance.Lexer()` with no options, and the list /
 * task-list / underline tokenizers lex item text through it
 * (`helpers.inlineTokens` / `blockTokens`, task items via `lexer.inlineTokens`).
 * Unbound, that lexer would not know this editor's inline tokenizers (math,
 * underline, entity mentions) inside ordered-list and task items, and saving
 * would rewrite the text. Bound, it sees exactly what the global lexer sees
 * on main. `inst.defaults` is read at construction time because `use()`
 * replaces the object; MarkdownManager recreates its lexer after registering.
 * (`Marked#lexer()` / `#parser()` already pass `this.defaults`; marked's
 * Tokenizer / Renderer / Hooks are created from `this.defaults` in `use()`.)
 */
export function createEditorMarked(): typeof marked {
  const inst = new Marked()
  const withDefaults = (options?: MarkedOptions | null): MarkedOptions => options ?? inst.defaults

  class InstanceLexer extends Lexer {
    constructor(options?: MarkedOptions) {
      super(withDefaults(options))
    }
    static override lex<O = string, R = string>(src: string, options?: MarkedOptions<O, R>): TokensList {
      return new InstanceLexer(options as MarkedOptions | undefined).lex(src)
    }
    static override lexInline<O = string, R = string>(src: string, options?: MarkedOptions<O, R>): Token[] {
      return new InstanceLexer(options as MarkedOptions | undefined).inlineTokens(src)
    }
  }

  class InstanceParser extends Parser {
    constructor(options?: MarkedOptions) {
      super(withDefaults(options))
    }
    static override parse<O = string, R = string>(tokens: Token[], options?: MarkedOptions<O, R>): O {
      return new InstanceParser(options as MarkedOptions | undefined).parse(tokens) as unknown as O
    }
    static override parseInline<O = string, R = string>(tokens: Token[], options?: MarkedOptions<O, R>): O {
      return new InstanceParser(options as MarkedOptions | undefined).parseInline(tokens) as unknown as O
    }
  }

  inst.Lexer = InstanceLexer as unknown as typeof Lexer
  inst.Parser = InstanceParser
  // `Marked` has the `Lexer` / `use` / `setOptions` / `lexer` surface the manager uses.
  return inst as unknown as typeof marked
}

/**
 * `@tiptap/markdown` ≥3.21 serialises a text node through
 * `encodeTextForMarkdown` → `escapeMarkdownSyntax`, which backslash-escapes
 * markdown-significant characters (brackets, underscores, tildes, asterisks,
 * backticks, backslashes) and HTML-encodes entities. 3.20.0 returned
 * `node.text || ""` verbatim, and ROX notes depend on that byte-for-byte
 * round-trip: wiki-links (`[[My note]]`) and Obsidian callouts
 * (`> [!spoiler]- …`) are literal text the vault indexer re-reads from disk,
 * and `entity-markdown.ts` states the invariant "Saving never rewrites user
 * text". Restore the verbatim rendering the official engine shipped with.
 *
 * `encodeTextForMarkdown` is `private` in the package typings (TS `private`
 * is compile-time only), so patch the manager instance. Exported so the
 * global-`marked` parity control can model main's serializer on a stock
 * `Markdown` instance too.
 */
export function restoreVerbatimText(editor: { markdown?: MarkdownManager }): void {
  const manager = editor.markdown
  if (!manager) return
  // `encodeTextForMarkdown` is lib-private and absent from the package typings.
  type VerbatimManager = { encodeTextForMarkdown: (text: string) => string }
  const patched = manager as unknown as VerbatimManager
  patched.encodeTextForMarkdown = (text: string) => text
}

export const PerEditorMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    const configured = this.options.marked
    // Markdown's own onBeforeCreate builds the editor's MarkdownManager from
    // `this.options.marked`; hand it a fresh instance for this editor only.
    this.options.marked = configured ?? createEditorMarked()
    try {
      this.parent?.(event)
    } finally {
      this.options.marked = configured
    }
    restoreVerbatimText(this.editor)
  },
})
