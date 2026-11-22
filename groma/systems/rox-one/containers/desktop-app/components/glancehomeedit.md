---
type: C4 Component
title: GlanceHomeEdit
status: stable
groma:
  id: glancehomeedit
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/platform/home/glance/GlanceHomeEdit.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/GlanceHomeEdit.tsx
      symbol: GlancePageEdit
    - scanner: react
      file: apps/electron/src/renderer/platform/home/glance/GlanceHome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/GlanceHome.tsx
    - scanner: react
      file: apps/electron/src/renderer/platform/home/glance/GlanceTabs.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/GlanceTabs.tsx
      symbol: HomePageTabs
    - scanner: react
      file: apps/electron/src/renderer/platform/home/glance/HomeGlanceShell.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/HomeGlanceShell.tsx
      symbol: HomeGlanceShell
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/useGlanceLayout.ts
      symbol: useGlanceLayout
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/builtin.ts
      symbol: registerBuiltinGlanceWidgets
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/idle-mount.ts
      symbol: useNearViewport
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/registry.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/open-external.ts
      symbol: openExternalSafe
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/presets.ts
  technology: dnd-kit
description: Edits the Glance home layout of columns, pages and widget instances with drag-and-drop.
---
