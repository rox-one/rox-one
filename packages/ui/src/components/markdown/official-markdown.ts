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
import { Markdown } from '@tiptap/markdown'
import { Marked, type marked } from 'marked'

export const PerEditorMarkdown = Markdown.extend({
  onBeforeCreate() {
    const configured = this.options.marked
    // Markdown's own onBeforeCreate builds the editor's MarkdownManager from
    // `this.options.marked`; hand it a fresh instance for this editor only.
    // (`Marked` has the `Lexer` / `use` / `setOptions` surface the manager uses.)
    this.options.marked = (configured ?? new Marked()) as typeof marked
    try {
      this.parent?.()
    } finally {
      this.options.marked = configured
    }
  },
})
