---
type: C4 Component
title: ConationMailPanel
status: stable
groma:
  id: conationmailpanel
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/platform/conation/ConationMailPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/ConationMailPanel.tsx
      symbol: ConationMailPanel
    - scanner: react
      file: apps/electron/src/renderer/platform/conation/ConationNotesPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/ConationNotesPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/platform/conation/ConationInspectorPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/ConationInspectorPanel.tsx
      symbol: ConationInspectorPanel
    - scanner: react
      file: apps/electron/src/renderer/platform/conation/ConationBoardPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/ConationBoardPanel.tsx
      symbol: ConationBoardPanel
    - scanner: react
      file: apps/electron/src/renderer/platform/conation/ConationFundPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/ConationFundPanel.tsx
      symbol: ConationFundPanel
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/conation-board-panels.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/conation-mail-panels.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/conation-fund-panels.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/conation-panels.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/conation-inspector-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/conation/conation-notes-panels.ts
description: Shows the blocked-write Conation mail and channel panel, reporting unavailability rather than faking sends.
---
