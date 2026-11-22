---
type: C4 Component
title: PresetQuestions
status: stable
groma:
  id: presetquestions
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/playbooks/knowledge/PresetQuestions.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/knowledge/PresetQuestions.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/playbooks/knowledge/KnowledgeNotebookPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/knowledge/KnowledgeNotebookPage.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/playbooks/knowledge/SourceAnswerList.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/knowledge/SourceAnswerList.tsx
      symbol: SourceAnswerList
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/knowledge/useSourceIndex.ts
description: Lists fixed preset questions that run source retrieval in the playbooks notebook.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/playbooks/knowledge/KnowledgeNotebookPage.tsx](../../../../../../apps/electron/src/renderer/pages/playbooks/knowledge/KnowledgeNotebookPage.tsx) | [apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx](../../../../../../apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx) | Invokes supplied callbacks: onGeneratePodcast, onUpdate | react |
