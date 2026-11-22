---
type: C4 Component
title: CodebookNotebookPage
status: stable
groma:
  id: codebooknotebookpage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/playbooks/codebook/CodebookNotebookPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/codebook/CodebookNotebookPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/codebook/codebook-client.ts
description: Runs and edits a codebook notebook pipeline of script, agent and artifact cells over a repository.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/playbooks/codebook/CodebookNotebookPage.tsx](../../../../../../apps/electron/src/renderer/pages/playbooks/codebook/CodebookNotebookPage.tsx) | [apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx](../../../../../../apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx) | Invokes supplied callback: onUpdate | react |
