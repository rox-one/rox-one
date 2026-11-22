---
type: C4 Component
title: NotebookHome
status: stable
groma:
  id: notebookhome
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/playbooks/components/NotebookHome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/components/NotebookHome.tsx
description: Renders the Playbooks home list with notebook creation, search, deletion and recent podcasts.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/playbooks/components/NotebookHome.tsx](../../../../../../apps/electron/src/renderer/pages/playbooks/components/NotebookHome.tsx) | [apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx](../../../../../../apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx) | Invokes supplied callbacks: onCreate, onDelete, onOpen | react |
