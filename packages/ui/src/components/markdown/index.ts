/**
 * Markdown component exports for @rox/ui
 */

export { Markdown, MemoizedMarkdown, type MarkdownProps, type RenderMode, type DisablablePreviewBlock } from './Markdown'
export { SourcedStatement, type SourcedStatementProps } from './SourcedStatement'
export { CodeBlock, InlineCode, type CodeBlockProps } from './CodeBlock'
export { preprocessLinks, detectLinks, hasLinks } from './linkify'
export { CollapsibleSection } from './CollapsibleSection'
export { CollapsibleMarkdownProvider, useCollapsibleMarkdown } from './CollapsibleMarkdownContext'
export { MarkdownDatatableBlock, type MarkdownDatatableBlockProps } from './MarkdownDatatableBlock'
export { MarkdownSpreadsheetBlock, type MarkdownSpreadsheetBlockProps } from './MarkdownSpreadsheetBlock'
export { MarkdownImageBlock, type MarkdownImageBlockProps } from './MarkdownImageBlock'
export { MarkdownDocBlock, type MarkdownDocBlockProps } from './MarkdownDocBlock'
export {
  parseMarkdownPreviewSpec,
  normalizePreviewItems,
  type MarkdownPreviewItem,
  type MarkdownPreviewSpec,
} from './markdown-preview-helpers'
export { ImageCardStack, type ImageCardStackProps, type ImageCardStackItem } from './ImageCardStack'
export { PerEditorMarkdown } from './official-markdown'
export { TiptapMarkdownEditor, type TiptapEditorHandle, type TiptapMarkdownEditorProps, type MarkdownEngine } from './TiptapMarkdownEditor'
// W1-08 (#1505): entity mention / embed nodes + Markdown serialisation.
export { type EntityNodesOptions } from './TiptapMarkdownEditor'
export { EntityMention, type EntityMentionOptions } from './extensions/EntityMention'
export { EntityEmbed, type EntityEmbedOptions } from './extensions/EntityEmbed'
export {
  entityEmbedInputRule,
  entityEmbedPasteRule,
  entityMentionInputRule,
  entityMentionPasteRule,
  isInBacktickSpan,
  isInCode,
} from './extensions/entity-input-rules'
export {
  ENTITY_EMBED_NODE,
  ENTITY_MENTION_NODE,
  canonicalEntityTarget,
  entityEmbedBlockStart,
  endsWithUnescapedBang,
  entityRefFromTarget,
  escapeTrailingBang,
  installEntityMarkdownRules,
  isMarkedRootTokenList,
  isWikilinkSafeRefLiteral,
  matchEntityEmbed,
  matchEntityEmbedBlock,
  matchEntityEmbedLine,
  matchEntityMention,
  sanitizeMentionLabel,
  serializeEntityEmbed,
  serializeEntityMention,
  type EntityMentionMatch,
} from './entity-markdown'
