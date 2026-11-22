---
type: C4 Component
title: NotesImportButton
status: stable
groma:
  id: notesimportbutton
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/notes/NotesImportButton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/notes/NotesImportButton.tsx
description: Imports a local folder of notes into the workspace after preview and explicit consent.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/notes/NotesImportButton.tsx](../../../../../../apps/electron/src/renderer/components/notes/NotesImportButton.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callback: onImported | react |
