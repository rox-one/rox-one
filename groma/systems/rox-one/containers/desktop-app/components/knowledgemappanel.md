---
type: C4 Component
title: KnowledgeMapPanel
status: stable
groma:
  id: knowledgemappanel
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/knowledge-map/KnowledgeMapPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/knowledge-map/KnowledgeMapPanel.tsx
      symbol: KnowledgeMapPanel
    - scanner: react
      file: apps/electron/src/renderer/components/knowledge-map/KnowledgeMapDocView.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/knowledge-map/KnowledgeMapDocView.tsx
      symbol: KnowledgeMapDocView
    - scanner: react
      file: apps/electron/src/renderer/components/knowledge-map/KnowledgeMapTree.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/knowledge-map/KnowledgeMapTree.tsx
      symbol: KnowledgeMapTree
    - scanner: react
      file: apps/electron/src/renderer/components/knowledge-map/KnowledgeMapGraph.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/knowledge-map/KnowledgeMapGraph.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/knowledge-map/use-knowledge-map.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/knowledge-map/radial-layout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/knowledge-map/knowledge-map-model.ts
description: Renders the knowledge map as graph, tree or document view for Settings context.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/knowledge-map/KnowledgeMapPanel.tsx](../../../../../../apps/electron/src/renderer/components/knowledge-map/KnowledgeMapPanel.tsx) | [apps/electron/src/renderer/pages/settings/AccountSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/AccountSettingsPage.tsx) | Invokes supplied callback: onOpenFull | react |
