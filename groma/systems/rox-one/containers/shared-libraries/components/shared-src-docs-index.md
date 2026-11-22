---
type: C4 Component
title: Index
status: stable
groma:
  id: shared-src-docs-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/docs/index.ts
    - scanner: typescript
      file: packages/shared/src/docs/home-display.ts
    - scanner: typescript
      file: packages/shared/src/docs/source-guides.ts
    - scanner: typescript
      file: packages/shared/src/docs/doc-links.ts
description: Syncs bundled Markdown documentation into the config directory and serves it to agent prompts and the UI.
---
