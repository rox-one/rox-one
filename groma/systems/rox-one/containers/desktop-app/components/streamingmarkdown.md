---
type: C4 Component
title: StreamingMarkdown
status: stable
groma:
  id: streamingmarkdown
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/markdown/StreamingMarkdown.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/markdown/StreamingMarkdown.tsx
      symbol: StreamingMarkdown
    - scanner: typescript
      file: apps/electron/src/renderer/components/markdown/index.ts
description: Renders incrementally streamed markdown by splitting content into cached blocks.
---
