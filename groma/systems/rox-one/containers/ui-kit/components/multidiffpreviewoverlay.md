---
type: C4 Component
title: MultiDiffPreviewOverlay
status: stable
groma:
  id: multidiffpreviewoverlay
  parent: ui-kit
  code:
    - scanner: react
      file: packages/ui/src/components/overlay/MultiDiffPreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/MultiDiffPreviewOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/DataTableOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/DataTableOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/MermaidPreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/MermaidPreviewOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/PDFPreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/PDFPreviewOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/ActivityCardsOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/ActivityCardsOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/CodePreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/CodePreviewOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/GenericOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/GenericOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/OverlayErrorBanner.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/OverlayErrorBanner.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/ItemNavigator.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/ItemNavigator.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/FullscreenOverlayBase.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/FullscreenOverlayBase.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/ZoomControls.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/ZoomControls.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/PreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/PreviewOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/CopyButton.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/CopyButton.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/LazyPDFPreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/LazyPDFPreviewOverlay.tsx
      symbol: PDFPreviewOverlay
    - scanner: react
      file: packages/ui/src/components/overlay/ContentFrame.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/ContentFrame.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/AnnotatableMarkdownDocument.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/AnnotatableMarkdownDocument.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/TerminalPreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/TerminalPreviewOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/JSONPreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/JSONPreviewOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/FullscreenOverlayBaseHeader.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/FullscreenOverlayBaseHeader.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/ImagePreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/ImagePreviewOverlay.tsx
    - scanner: react
      file: packages/ui/src/components/overlay/LazyMultiDiffPreviewOverlay.tsx
    - scanner: typescript
      file: packages/ui/src/components/overlay/LazyMultiDiffPreviewOverlay.tsx
      symbol: MultiDiffPreviewOverlay
    - scanner: typescript
      file: packages/ui/src/components/overlay/index.ts
    - scanner: typescript
      file: packages/ui/src/components/overlay/useRichBlockInteractions.ts
    - scanner: typescript
      file: packages/ui/src/components/overlay/pdf-search.ts
      symbol: findMatchingPages
    - scanner: typescript
      file: packages/ui/src/components/overlay/rich-block-interaction-spec.ts
  technology: Shiki
description: Shows stacked, lazily rendered file diffs from edit and write tool calls.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx](../../../../../../packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx) | [packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx](../../../../../../packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx) | Invokes supplied callback: onLoadContent | react |
| [packages/ui/src/components/overlay/ImagePreviewOverlay.tsx](../../../../../../packages/ui/src/components/overlay/ImagePreviewOverlay.tsx) | [packages/ui/src/components/markdown/MarkdownImageBlock.tsx](../../../../../../packages/ui/src/components/markdown/MarkdownImageBlock.tsx) | Invokes supplied callback: loadDataUrl | react |
| [packages/ui/src/components/overlay/PDFPreviewOverlay.tsx](../../../../../../packages/ui/src/components/overlay/PDFPreviewOverlay.tsx) | [packages/ui/src/components/markdown/MarkdownPdfBlock.tsx](../../../../../../packages/ui/src/components/markdown/MarkdownPdfBlock.tsx) | Invokes supplied callback: loadPdfData | react |

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx](../../../../../../packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx) | [packages/core/src/index.ts](../../../../../../packages/core/src/index.ts) | Uses core types | TypeScript imports |
