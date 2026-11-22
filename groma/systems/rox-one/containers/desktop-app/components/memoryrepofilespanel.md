---
type: C4 Component
title: MemoryRepoFilesPanel
status: stable
groma:
  id: memoryrepofilespanel
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoFilesPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoFilesPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoGraphPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoGraphPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoHistoryPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoHistoryPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoDreamsPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoDreamsPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoSearchOverlay.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/memory/repo/MemoryRepoSearchOverlay.tsx
description: Shows the memory repository file tree and renders the selected markdown file with wikilinks.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/memory/repo/MemoryRepoFilesPanel.tsx](../../../../../../apps/electron/src/renderer/components/memory/repo/MemoryRepoFilesPanel.tsx) | [apps/electron/src/renderer/components/memory/MemoryRepoScreen.tsx](../../../../../../apps/electron/src/renderer/components/memory/MemoryRepoScreen.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/memory/repo/MemoryRepoHistoryPanel.tsx](../../../../../../apps/electron/src/renderer/components/memory/repo/MemoryRepoHistoryPanel.tsx) | [apps/electron/src/renderer/components/memory/MemoryRepoScreen.tsx](../../../../../../apps/electron/src/renderer/components/memory/MemoryRepoScreen.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/memory/repo/MemoryRepoSearchOverlay.tsx](../../../../../../apps/electron/src/renderer/components/memory/repo/MemoryRepoSearchOverlay.tsx) | [apps/electron/src/renderer/components/memory/MemoryRepoScreen.tsx](../../../../../../apps/electron/src/renderer/components/memory/MemoryRepoScreen.tsx) | Invokes supplied callbacks: onOpenFile, onOpenNote, onOpenSession | react |
