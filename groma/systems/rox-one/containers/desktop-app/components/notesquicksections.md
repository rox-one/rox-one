---
type: C4 Component
title: NotesQuickSections
status: stable
groma:
  id: notesquicksections
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/screens/notes/NotesQuickSections.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/notes/NotesQuickSections.tsx
    - scanner: react
      file: apps/electron/src/renderer/screens/notes/useNotesScreenSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/notes/useNotesScreenSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/notes/notes-sidebar-sections.ts
    - scanner: typescript
      file: apps/electron/src/renderer/screens/notes/notes-pins.ts
      symbol: notesPinnedByWorkspaceAtom
    - scanner: typescript
      file: apps/electron/src/renderer/screens/notes/notes-recents.ts
      symbol: notesRecentOpenedByWorkspaceAtom
description: Publishes pinned and recently opened notes as quick sidebar sections with pin toggling.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/screens/notes/NotesQuickSections.tsx](../../../../../../apps/electron/src/renderer/screens/notes/NotesQuickSections.tsx) | [apps/electron/src/renderer/pages/NotesPage.tsx](../../../../../../apps/electron/src/renderer/pages/NotesPage.tsx) | Invokes supplied callback: onOpenNote | react |
