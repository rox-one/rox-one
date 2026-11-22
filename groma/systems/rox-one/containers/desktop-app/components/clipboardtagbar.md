---
type: C4 Component
title: ClipboardTagBar
status: stable
groma:
  id: clipboardtagbar
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardTagBar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardTagBar.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardHistorySettings.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardHistorySettings.tsx
      symbol: ClipboardHistorySettings
    - scanner: react
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardHistoryPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardHistoryPanel.tsx
      symbol: ClipboardHistoryPanel
    - scanner: react
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardQuickLook.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/clipboard-history/ClipboardQuickLook.tsx
      symbol: ClipboardQuickLook
    - scanner: typescript
      file: apps/electron/src/renderer/components/clipboard-history/use-clipboard-sidebar.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/clipboard-history/clipboard-sidebar.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/clipboard-history/clipboard-history-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/clipboard-history/use-clipboard-history.ts
description: Renders clipboard-history tag filter chips and the per-entry tag editor dialog.
---
