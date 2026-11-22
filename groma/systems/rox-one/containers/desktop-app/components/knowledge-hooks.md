---
type: C4 Component
title: Hooks
status: stable
groma:
  id: knowledge-hooks
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/knowledge/hooks.ts
      symbol: useKnowledgeSignals
    - scanner: typescript
      file: apps/electron/src/renderer/features/product-tour/adapters/knowledge/index.ts
description: Hook deriving knowledge-publication tour signals from observed completions.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/features/product-tour/adapters/knowledge/index.ts](../../../../../../apps/electron/src/renderer/features/product-tour/adapters/knowledge/index.ts) | [apps/electron/src/renderer/pages/SearchPage.tsx](../../../../../../apps/electron/src/renderer/pages/SearchPage.tsx) | Invokes supplied callbacks: open, read | typescript |
