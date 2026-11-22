---
type: C4 Component
title: UseFocusZone
status: stable
groma:
  id: usefocuszone
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/keyboard/useFocusZone.ts
      symbol: useFocusZone
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/keyboard/useRovingTabIndex.ts
      symbol: useRovingTabIndex
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/keyboard/index.ts
description: Registers a component as a keyboard focus zone navigable by Tab and Cmd+1/2/3.
---
