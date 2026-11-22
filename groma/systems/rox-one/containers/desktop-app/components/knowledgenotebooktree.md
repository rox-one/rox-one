---
type: C4 Component
title: KnowledgeNotebookTree
status: stable
groma:
  id: knowledgenotebooktree
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/knowledge/KnowledgeNotebookTree.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/KnowledgeNotebookTree.tsx
    - scanner: react
      file: apps/electron/src/renderer/knowledge/KnowledgeNavigator.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/KnowledgeNavigator.tsx
    - scanner: react
      file: apps/electron/src/renderer/knowledge/KnowledgeProposals.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/KnowledgeProposals.tsx
      symbol: KnowledgeProposals
    - scanner: react
      file: apps/electron/src/renderer/knowledge/KnowledgeDiff.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/KnowledgeDiff.tsx
    - scanner: react
      file: apps/electron/src/renderer/knowledge/KnowledgeAgentPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/KnowledgeAgentPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/knowledge/KnowledgeInspector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/KnowledgeInspector.tsx
    - scanner: react
      file: apps/electron/src/renderer/knowledge/KnowledgeHome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/KnowledgeHome.tsx
      symbol: KnowledgeHome
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/siyuan-url.ts
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/knowledge-entity-projection.ts
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/knowledge-home-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/knowledge-tree.ts
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/use-knowledge-node.ts
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/kernel-availability.ts
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/outline-parser.ts
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/knowledge-entity-ref.ts
      symbol: knowledgeEntityCompanionRef
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/knowledge-new-note.ts
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/knowledge-mobile.ts
    - scanner: typescript
      file: apps/electron/src/renderer/knowledge/proposal-actions.ts
description: Renders the Knowledge mode left-nav tree of notebooks, recents, favorites and saved views.
---
