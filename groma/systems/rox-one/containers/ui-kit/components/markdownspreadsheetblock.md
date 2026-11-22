---
type: C4 Component
title: MarkdownSpreadsheetBlock
status: stable
groma:
  id: markdownspreadsheetblock
  parent: ui-kit
  code:
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownSpreadsheetBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownSpreadsheetBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/CollapsibleMarkdownContext.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/CollapsibleMarkdownContext.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/CodeBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/CodeBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/safe-components.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/safe-components.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/SourcedStatement.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/SourcedStatement.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownDiffBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownDiffBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/Markdown.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/Markdown.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/TiptapCodeBlockView.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/TiptapCodeBlockView.tsx
      symbol: tiptapCodeBlock
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownPdfBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownPdfBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownOpenUIBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownOpenUIBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/ImageCardStack.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/ImageCardStack.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownRoversCardBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownRoversCardBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/CollapsibleSection.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/CollapsibleSection.tsx
      symbol: CollapsibleSection
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownMermaidBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownMermaidBlock.tsx
      symbol: MarkdownMermaidBlock
    - scanner: react
      file: packages/ui/src/components/markdown/TableExportDropdown.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/TableExportDropdown.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownImageBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownImageBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/RichBlockShell.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/RichBlockShell.tsx
      symbol: RichBlockShell
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownJsonBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownJsonBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/lazy-blocks.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/lazy-blocks.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownLatexBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownLatexBlock.tsx
      symbol: MarkdownLatexBlock
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownDatatableBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownDatatableBlock.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/TiptapHoverActions.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/TiptapHoverActions.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/TiptapBubbleMenus.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/TiptapBubbleMenus.tsx
    - scanner: react
      file: packages/ui/src/components/markdown/MarkdownDocBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/MarkdownDocBlock.tsx
    - scanner: typescript
      file: packages/ui/src/components/markdown/linkify.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/mermaid-source.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/link-target.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/openui-form-state.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/rehype-katex-plugin.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/entity-markdown.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/url-transform.ts
      symbol: markdownUrlTransform
    - scanner: typescript
      file: packages/ui/src/components/markdown/tiptap-shiki-theme.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/math-options.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/openui-theme.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/index.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/diff-normalize.ts
      symbol: ensureUnifiedDiffFormat
    - scanner: typescript
      file: packages/ui/src/components/markdown/legacy-mixed-task-lists.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/annotation-resolver.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/rich-block-events.ts
      symbol: RICH_BLOCK_EDIT_EVENT
    - scanner: typescript
      file: packages/ui/src/components/markdown/remarkCollapsibleSections.ts
      symbol: remarkCollapsibleSections
    - scanner: typescript
      file: packages/ui/src/components/markdown/useScrollFade.ts
      symbol: useScrollFade
    - scanner: typescript
      file: packages/ui/src/components/markdown/table-export.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/official-markdown.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/code-presentation.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/shiki-highlight.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/markdown-preview-helpers.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/rovers-card.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/openui-program-guard.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/TiptapSlashMenu.ts
    - scanner: typescript
      file: packages/ui/src/components/markdown/retained-trailing-node.ts
description: Renders spreadsheet-fenced JSON as an Excel-style grid with export controls.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/ui/src/components/markdown/RichBlockShell.tsx](../../../../../../packages/ui/src/components/markdown/RichBlockShell.tsx) | [packages/ui/src/components/markdown/extensions/LatexBlock.tsx](../../../../../../packages/ui/src/components/markdown/extensions/LatexBlock.tsx) | Invokes supplied callback: onEdit | react |
| [packages/ui/src/components/markdown/RichBlockShell.tsx](../../../../../../packages/ui/src/components/markdown/RichBlockShell.tsx) | [packages/ui/src/components/markdown/extensions/MermaidBlock.tsx](../../../../../../packages/ui/src/components/markdown/extensions/MermaidBlock.tsx) | Invokes supplied callback: onEdit | react |
