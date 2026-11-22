---
type: C4 Component
title: ModeScreen
status: stable
groma:
  id: modescreen
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/mode-screen/ModeScreen.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/mode-screen/ModeScreen.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/mode-screen/ResponsiveModeScreen.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/mode-screen/ResponsiveModeScreen.tsx
description: Provides the shared navigator-list-detail layout and components for Задачи, Встречи, Входящие and Лента screens.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/mode-screen/ModeScreen.tsx](../../../../../../apps/electron/src/renderer/components/mode-screen/ModeScreen.tsx) | [apps/electron/src/renderer/components/clipboard-history/ClipboardHistoryPanel.tsx](../../../../../../apps/electron/src/renderer/components/clipboard-history/ClipboardHistoryPanel.tsx) | Invokes supplied callback: onChange | react |
