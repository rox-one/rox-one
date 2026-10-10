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
export { MarkdownRoversCardBlock, type MarkdownRoversCardBlockProps } from './MarkdownRoversCardBlock'
export {
  ROVERS_CATEGORIES,
  parseRoversCardPayload,
  pickLocalized,
  roversCategoryColor,
  roversLanguage,
  roversMonogram,
  isDirectIconUrl,
  type RoversCardParseResult,
  type RoversCardSummary,
  type RoversCategory,
  type RoversDeploy,
  type RoversEntryFull,
  type RoversLanguage,
  type RoversLocalizedText,
} from './rovers-card'
// The OpenUI block (`@openuidev/*` + recharts) is only reachable through the
// lazy wrapper so importing this barrel never pulls the heavy chunk into the
// caller's bundle; the eager component stays an internal module detail.
export { LazyMarkdownOpenUIBlock, type LazyMarkdownOpenUIBlockProps } from './lazy-blocks'
export { type MarkdownOpenUIBlockProps } from './MarkdownOpenUIBlock'
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
