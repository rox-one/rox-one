---
type: C4 Component
title: WidgetFrame
status: stable
groma:
  id: widgetframe
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/board/WidgetFrame.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/board/WidgetFrame.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/board/WidgetCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/board/WidgetCard.tsx
  technology: sandboxed iframe
description: Sandboxes one leased board-widget document in an opaque-origin iframe and validates its size messages.
---
